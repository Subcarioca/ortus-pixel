/**
 * =============================================================================
 * CONTRATO DE SINAIS — o coração da extensibilidade do pipeline
 * =============================================================================
 *
 * O REQUISITO: "adicionar novas fontes de sinal sem reescrever o núcleo".
 *
 * A forma errada de fazer isso (e a mais comum) é um `switch` gigante no meio
 * do cálculo do score:
 *
 *     if (fonte === 'reddit') { ... } else if (fonte === 'twitter') { ... }
 *
 * Isso força a editar o núcleo a cada fonte nova, e o núcleo vira um arquivo de
 * 2000 linhas que ninguém quer tocar.
 *
 * A forma adotada aqui é INVERSÃO DE DEPENDÊNCIA: o núcleo não conhece nenhuma
 * fonte concreta. Ele conhece apenas a interface `SignalConnector` e uma tabela
 * (registry) de conectores registrados. Cada fonte nova é um arquivo novo que
 * implementa a interface e se registra — zero linhas alteradas no núcleo.
 *
 * A peça que faz isso funcionar de verdade é a NORMALIZAÇÃO. O motor de score
 * não sabe o que é "12.400 upvotes" nem "posição 3 no trending". Todo conector
 * é obrigado a devolver um valor já normalizado em [0,1] com uma semântica
 * única: "0 = irrelevante, 1 = tão grande quanto isso costuma ficar". Assim o
 * motor soma peras com peras, e o conector — que é quem entende a escala da
 * sua própria plataforma — fica responsável por essa tradução.
 */

/**
 * As dimensões de sinal que o motor de score entende.
 *
 * Note que isto é um vocabulário SEMÂNTICO (o que o sinal significa), não uma
 * lista de fontes (de onde ele veio). Vários conectores podem alimentar a mesma
 * dimensão: Reddit, YouTube e X todos contribuem para `socialMomentum`. É essa
 * separação que permite adicionar o TikTok amanhã sem inventar um peso novo
 * nem rebalancear o algoritmo inteiro.
 */
export const SIGNAL_DIMENSIONS = [
  /** (1) Volume de busca absoluto — tamanho potencial da audiência. */
  'searchVolume',
  /** (2) Velocidade de crescimento do interesse (breakout). O sinal MAIS importante. */
  'searchVelocity',
  /** (3) Menções e crescimento em redes sociais. */
  'socialMomentum',
  /** (4) Presença em trending topics nativos das plataformas. */
  'platformTrending',
  /** (5) Autoridade/oficialidade da fonte primária. */
  'sourceAuthority',
  /** (6) Proximidade de data de lançamento conhecida (sazonalidade). */
  'releaseProximity',
  /** (7) Janela de oportunidade de SERP (poucos concorrentes publicaram = alto). */
  'serpOpportunity',
  /** (8) Afinidade histórica da nossa própria base de leitores com a franquia. */
  'audienceAffinity',
  /** (9) Gatilhos emocionais fortes (morte, cancelamento, vazamento, polêmica). */
  'emotionalTrigger',
] as const;

export type SignalDimension = (typeof SIGNAL_DIMENSIONS)[number];

/**
 * Uma medição individual produzida por um conector.
 *
 * Guardamos `rawValue` junto do valor normalizado por dois motivos práticos:
 *  1) Depuração: quando um editor pergunta "por que esse score deu 84?", o
 *     painel mostra "Reddit: 12.400 upvotes → 0,78". Sem o valor bruto, o
 *     número normalizado é uma caixa-preta e a redação perde a confiança no
 *     sistema — e um sistema de score em que a redação não confia é ignorado.
 *  2) Recalibração: para reajustar pesos no futuro (Fase 3) precisamos do
 *     histórico bruto, não só do normalizado sob os pesos antigos.
 */
export interface SignalMeasurement {
  dimension: SignalDimension;
  /** Id do conector que produziu a medição (ex.: 'reddit', 'youtube-trending'). */
  connectorId: string;
  /** Valor normalizado em [0,1]. É o único número que o motor de score consome. */
  value: number;
  /** Valor original, para auditoria e para a UI explicar o score ao editor. */
  rawValue?: number | string;
  /** Texto curto exibido no painel editorial. Ex.: "3º lugar no r/gaming". */
  explanation?: string;
  /**
   * Confiança do conector nesta medição específica, em [0,1].
   * Ex.: um conector que caiu em fallback (cache velho, amostra pequena) devolve
   * 0.4 e o motor pondera o sinal para baixo em vez de tratá-lo como verdade.
   */
  confidence: number;
  observedAt: Date;
}

/** O que o conector recebe para trabalhar. */
export interface SignalContext {
  /** Termo/entidade principal do tópico. Ex.: "GTA VI", "The Last of Us S3". */
  query: string;
  /** Termos alternativos (apelidos, título original, sigla) para ampliar a busca. */
  aliases: string[];
  /** Slug da categoria, se já classificada — permite ao conector escolher subreddits/canais. */
  categorySlug?: string;
  /** Slugs de franquias associadas. Usado pelo conector de histórico interno. */
  franchiseSlugs: string[];
  /** Quando o tópico foi visto pela primeira vez. Base para cálculo de velocidade. */
  firstSeenAt: Date;
  /**
   * Sinal de cancelamento. OBRIGATÓRIO respeitar: é ele que garante que um
   * conector lento não segure o pipeline inteiro (ver `timeoutMs` abaixo).
   */
  signal: AbortSignal;
}

/** Custo de execução — usado pelo orquestrador para decidir quem roda e quando. */
export type SignalCost =
  /** Grátis e ilimitado (RSS, cálculo local, consulta ao nosso próprio banco). */
  | 'free'
  /** Grátis com quota diária (YouTube Data API). */
  | 'quota'
  /** Pago por chamada (X/Twitter, DataForSEO, SerpApi). */
  | 'metered';

/**
 * A INTERFACE QUE TODO CONECTOR IMPLEMENTA.
 *
 * Repare no que ela NÃO tem: nada de HTTP, nada de credenciais no construtor,
 * nada de banco. Um conector é uma função pura de "contexto → medições", com
 * duas capacidades administrativas (`isAvailable` e `stage`). Isso o torna
 * trivial de testar: passe um contexto, verifique as medições.
 */
export interface SignalConnector {
  /** Identificador estável. Vai para o banco e para os logs — não mude depois. */
  readonly id: string;
  readonly displayName: string;
  /** Dimensões que este conector é capaz de alimentar. */
  readonly dimensions: readonly SignalDimension[];
  readonly cost: SignalCost;

  /**
   * ESTÁGIO DO PIPELINE — decisão de arquitetura crítica para o custo.
   *
   * Em 2026 os preços das APIs sociais mudaram o desenho correto do sistema:
   * o X passou a cobrar por leitura (~US$ 0,005/post, sem free tier) e o Reddit
   * fechou o uso comercial gratuito. Consultar todas as fontes para todos os
   * candidatos ficaria caro a ponto de inviabilizar o produto.
   *
   * Por isso o pipeline tem dois estágios:
   *   - 'discovery'  → roda para TODOS os candidatos. Só fontes 'free'.
   *                    Serve para separar o joio do trigo de graça.
   *   - 'enrichment' → roda só para quem passou do limiar de triagem. Aqui
   *                    entram as fontes caras, aplicadas a poucas dezenas de
   *                    tópicos por ciclo em vez de milhares.
   * Ver ADR 0004 no README.
   */
  readonly stage: 'discovery' | 'enrichment';

  /**
   * Timeout individual. O orquestrador aborta o conector após esse tempo e
   * segue com os demais. É a primeira linha de defesa do requisito
   * "uma API de trends fora do ar não pode travar o sistema".
   */
  readonly timeoutMs: number;

  /**
   * O conector tem o que precisa para rodar (credenciais, feature flag)?
   * Chamado uma vez no boot. Se `false`, o conector é desativado e seu peso é
   * redistribuído entre os demais — o score continua saindo, com confiança menor.
   */
  isAvailable(): boolean | Promise<boolean>;

  /**
   * Coleta as medições. Pode lançar exceção à vontade: o orquestrador captura,
   * registra e segue em frente. Um conector NUNCA derruba o ciclo.
   */
  collect(context: SignalContext): Promise<SignalMeasurement[]>;
}

/** Resultado da execução de um conector, com os metadados de resiliência. */
export interface ConnectorRunResult {
  connectorId: string;
  status: 'ok' | 'failed' | 'timeout' | 'skipped' | 'circuit-open';
  measurements: SignalMeasurement[];
  durationMs: number;
  error?: string;
}
