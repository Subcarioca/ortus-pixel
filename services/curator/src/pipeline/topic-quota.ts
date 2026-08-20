/**
 * =============================================================================
 * COTA DE PAUTAS NOVAS POR CICLO — o freio de VOLUME (não o de custo)
 * =============================================================================
 *
 * O REQUISITO, nas palavras do dono do site: "no máximo 20 pautas novas por
 * ciclo, e no máximo 5 do mesmo tema — ao atingir o teto do tema, o buscador
 * passa para o próximo, mesmo que tenham outros assuntos em alta".
 *
 * -----------------------------------------------------------------------------
 * POR QUE ISTO NÃO É O `MAX_ENRICHMENT_PER_CYCLE` QUE JÁ EXISTIA
 * -----------------------------------------------------------------------------
 * `MAX_ENRICHMENT_PER_CYCLE = 40` limita quantos tópicos são PONTUADOS com API
 * paga — é uma trava de CUSTO, e ela age numa etapa POSTERIOR à criação: o
 * tópico já está no banco, já ocupa uma linha, já aparece na fila do painel; o
 * que o teto de enriquecimento evita é só a segunda rodada de chamadas caras.
 *
 * O teto deste módulo é outra coisa: é uma trava de VOLUME EDITORIAL. Ele
 * responde a "quantas pautas uma redação humana consegue olhar a cada 15
 * minutos?", não a "quanto isso custa em dólar". Os dois números poderiam ter
 * qualquer relação entre si (40 > 20 hoje é coincidência de calibragem) e
 * mudam por motivos completamente diferentes: o de custo muda quando o preço da
 * API muda; o de volume muda quando o tamanho da redação muda. Misturar os dois
 * numa constante só faria o primeiro reajuste de preço da X mexer, sem querer,
 * no tamanho da fila que a redação lê de manhã.
 *
 * -----------------------------------------------------------------------------
 * DECISÃO EDITORIAL ASSUMIDA: "TEMA" = CATEGORIA/EDITORIA
 * -----------------------------------------------------------------------------
 * O requisito diz "5 pautas do mesmo tema" sem definir "tema". A leitura
 * adotada aqui é TEMA = EDITORIA (`Topic.category` / `DiscoveredItem.source
 * .categorySlug`): Games, Cinema & Séries, Anime & Mangá, HQs, Tech, Eventos.
 * É o mesmo conceito que o resto da base chama de "nicho" e é o eixo pelo qual
 * a home, o painel e a taxonomia já organizam tudo.
 *
 * A ALTERNATIVA DESCARTADA era "tema = franquia" (GTA VI, One Piece, Marvel).
 * Ela foi descartada por uma razão aritmética, não estética: uma franquia
 * raramente produz 5 notícias DISTINTAS numa janela de 15 minutos — as cinco
 * matérias que aparecem juntas sobre o mesmo anúncio são o mesmo fato repetido
 * por veículos diferentes, e isso a deduplicação (`dedupe.ts`) já colapsa em um
 * tópico só, ANTES de chegar aqui. Um teto de 5 por franquia praticamente nunca
 * seria atingido — ou seja, seria código que não faz nada, e o requisito do dono
 * do site (que claramente quer LIMITAR alguma coisa) não estaria atendido.
 *
 * Já 5 por editoria é um teto que ENCOSTA na realidade: num dia de E3/Game
 * Awards, os feeds de games sozinhos trazem dezenas de itens distintos, e sem
 * este freio um único evento de games ocuparia as 20 vagas do ciclo e o painel
 * ficaria monotemático — que é exatamente a queixa por trás do "mesmo que tenham
 * outros assuntos em alta".
 *
 * ESTA É UMA DECISÃO EDITORIAL ASSUMIDA PELO TIME TÉCNICO, e está escrita aqui
 * justamente para poder ser contestada: se a intenção era "franquia", o número 5
 * precisa ser revisto junto (provavelmente para 1 ou 2), não só o campo.
 *
 * -----------------------------------------------------------------------------
 * A ARITMÉTICA DOS DOIS TETOS JUNTOS
 * -----------------------------------------------------------------------------
 * Com 6 editorias no catálogo (`CATEGORY_SLUGS`), o teto por categoria permitiria
 * até 6 × 5 = 30 pautas — mais que o teto global de 20. Ou seja:
 *   - o teto GLOBAL é o que realmente corta num dia agitado em várias frentes;
 *   - o teto POR CATEGORIA é o que garante PLURALIDADE: como nenhuma editoria
 *     passa de 5, encher as 20 vagas do ciclo exige pelo menos 4 editorias
 *     diferentes. Esse "pelo menos 4" é o efeito de produto que o requisito
 *     pede, e ele é consequência da razão 20/5 — mexer em um dos números sem
 *     olhar o outro muda a pluralidade sem que ninguém perceba.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ISTO É UM MÓDULO SEPARADO, E NÃO DUAS VARIÁVEIS DENTRO DO LAÇO
 * -----------------------------------------------------------------------------
 * Duas razões práticas:
 *
 *  1. TESTE SEM BANCO. O laço da etapa [2] de `curate.ts` é E/S pura (upsert,
 *     lookup, log): testá-lo exigiria MySQL de pé, e o projeto já decidiu que
 *     teste que precisa de infraestrutura é teste que ninguém roda (ver o
 *     cabeçalho de `expire-topics.test.ts`). A DECISÃO — "este item ainda cabe
 *     no ciclo?" — é determinística e não toca em nada externo. Separada, ela
 *     tem teste de verdade; embutida no laço, teria zero.
 *
 *  2. A SEPARAÇÃO ENTRE "AVALIAR" E "CONTAR". `evaluate()` NÃO incrementa nada;
 *     só `registerCreated()` incrementa. Essa distinção é o coração da regra e
 *     seria fácil de errar dentro do laço: item que a deduplicação descarta, ou
 *     que é ignorado por já ter matéria, NÃO PODE consumir vaga — senão 20
 *     reposts da mesma notícia gastariam o ciclo inteiro sem criar uma pauta
 *     sequer, e o efeito ("o curator parou de trazer pauta") não teria pista
 *     nenhuma no log. Com as duas operações separadas e testadas, a única forma
 *     de consumir cota é ter havido criação de verdade.
 */

/**
 * Teto de pautas NOVAS criadas por ciclo.
 *
 * NÃO é configurável por variável de ambiente, pela mesma razão que
 * `TOPIC_EXPIRY_DAYS` não é (ver `expire-topics.ts`): é regra EDITORIAL —
 * quantas pautas a redação consegue absorver por rodada —, não parâmetro de
 * infraestrutura. Regra editorial que mora no ambiente muda sem ninguém decidir
 * e sem deixar rastro no histórico do código.
 */
export const MAX_NEW_TOPICS_PER_CYCLE = 20;

/** Teto de pautas novas por editoria, dentro do mesmo ciclo. Ver o cabeçalho. */
export const MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE = 5;

/**
 * Chave usada para agrupar itens SEM categoria.
 *
 * Item sem categoria é anomalia (as fontes RSS declaram `categorySlug`
 * obrigatoriamente), mas pauta manual e fonte mal cadastrada podem produzir
 * `null`. A decisão é tratar "sem categoria" como UMA editoria, e não como
 * "cada item é uma editoria diferente": se cada `null` fosse um balde próprio,
 * um cadastro quebrado furaria o teto por categoria em silêncio e encheria o
 * ciclo inteiro — exatamente o cenário contra o qual o teto existe.
 */
export const UNCATEGORIZED_QUOTA_KEY = '(sem-categoria)';

/** Por que um item foi barrado. Nomes usados no log e no evento agregado. */
export type QuotaRejectionReason = 'cycle_limit' | 'category_limit';

/**
 * O veredito para um item.
 *
 * União discriminada (e não um booleano) porque as duas recusas pedem AÇÕES
 * DIFERENTES no chamador: `category_limit` significa "pule este item e siga o
 * laço" (é o "passa para o próximo assunto" do requisito), enquanto
 * `cycle_limit` significa "não há mais vaga para ninguém, encerre o laço". Um
 * `false` solto obrigaria o laço a redescobrir qual era o caso.
 */
export type QuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: QuotaRejectionReason;
      /** O teto que foi atingido — vai para o log, para o número não parecer mágico. */
      limit: number;
    };

export interface TopicQuota {
  /**
   * Este item ainda cabe no ciclo? NÃO altera contador nenhum — chamar duas
   * vezes para o mesmo item devolve a mesma resposta.
   */
  evaluate(categorySlug: string | null): QuotaDecision;
  /**
   * Registra que uma pauta foi GENUINAMENTE CRIADA. Só isto consome vaga.
   * Chamar depois da escrita no banco, nunca antes.
   */
  registerCreated(categorySlug: string | null): void;
  /** Total criado no ciclo. Leitura, para o log do fim da etapa. */
  readonly created: number;
  /** Criados por editoria, para o log/evento agregado explicar QUEM encheu o ciclo. */
  createdByCategory(): Record<string, number>;
}

/**
 * Cria um contador de cota para UM ciclo.
 *
 * O estado é de ciclo e morre com ele — por isso é uma fábrica e não um módulo
 * com variáveis no topo. Contador global de módulo sobreviveria entre execuções
 * dentro do mesmo processo (o `main.ts` roda em laço, não é um script que morre
 * a cada rodada) e o segundo ciclo nasceria com a cota do primeiro já gasta: o
 * curator simplesmente pararia de criar pautas depois da primeira rodada, sem
 * erro nenhum em lugar nenhum.
 *
 * Os limites são parâmetro (com o valor de produção como padrão) para que o
 * teste possa exercitar a regra com números pequenos sem depender das constantes
 * — e, ao mesmo tempo, o teste trava os valores reais em asserções próprias.
 */
export function createTopicQuota(
  limits: { perCycle?: number; perCategory?: number } = {},
): TopicQuota {
  const perCycle = limits.perCycle ?? MAX_NEW_TOPICS_PER_CYCLE;
  const perCategory = limits.perCategory ?? MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE;

  let total = 0;
  const porCategoria = new Map<string, number>();

  const chave = (categorySlug: string | null): string =>
    categorySlug ?? UNCATEGORIZED_QUOTA_KEY;

  return {
    evaluate(categorySlug) {
      // O TETO GLOBAL É AVALIADO PRIMEIRO, e a ordem é a regra, não estilo:
      // quando os dois estouram ao mesmo tempo, o motivo relatado precisa ser
      // 'cycle_limit', porque é ele que manda o laço PARAR. Invertida, a ordem
      // faria o laço achar que era só uma editoria cheia e continuar varrendo
      // centenas de itens que nunca poderiam virar pauta.
      if (total >= perCycle) {
        return { allowed: false, reason: 'cycle_limit', limit: perCycle };
      }

      if ((porCategoria.get(chave(categorySlug)) ?? 0) >= perCategory) {
        return { allowed: false, reason: 'category_limit', limit: perCategory };
      }

      return { allowed: true };
    },

    registerCreated(categorySlug) {
      total++;
      const k = chave(categorySlug);
      porCategoria.set(k, (porCategoria.get(k) ?? 0) + 1);
    },

    get created() {
      return total;
    },

    createdByCategory() {
      // Cópia rasa: o chamador loga/serializa isto, e devolver o Map interno
      // deixaria o estado da cota mutável de fora — o tipo de acoplamento que
      // só aparece no dia em que alguém "só quis ajustar um número" no log.
      return Object.fromEntries(porCategoria);
    },
  };
}
