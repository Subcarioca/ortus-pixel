/**
 * =============================================================================
 * CONTRATO DE APRESENTAÇÃO — a ponte entre o pipeline e o design system
 * =============================================================================
 *
 * Este arquivo existe por causa de uma exigência explícita do time de design
 * (design/README.md, seção 2):
 *
 *   "`heat` é calculado no servidor. O front-end só mapeia string -> classe
 *    CSS. Se a regra de corte mudar (ex.: 75 em vez de 80), muda em um lugar só."
 *
 * A observação é certeira e vale reforçar: se o template fizesse
 * `score >= 80 ? 'hot' : ...`, a regra de corte ficaria duplicada entre o
 * pipeline e cada componente. Um dia alguém mudaria o limiar no pipeline, o
 * push passaria a disparar em 75, mas o site continuaria pintando de vermelho
 * só a partir de 80 — e o bug seria descoberto por um leitor, não por um teste.
 *
 * Aqui a conversão acontece UMA vez, no servidor.
 */

import { bandForScore, type ScoreBand } from './scoring-types';

/**
 * Vocabulário de temperatura do design system.
 * Mapeia 1:1 com as faixas do algoritmo, mas com os nomes que o CSS usa
 * (`.heat--hot`, `.heat--rise`, `.heat--base`, `.heat--ever`).
 */
export type Heat = 'hot' | 'rise' | 'base' | 'ever';

const BAND_TO_HEAT: Record<ScoreBand, Heat> = {
  HOT: 'hot',
  RISING: 'rise',
  RELEVANT: 'base',
  EVERGREEN: 'ever',
};

export function heatForBand(band: ScoreBand): Heat {
  return BAND_TO_HEAT[band];
}

export function heatForScore(score: number): Heat {
  return heatForBand(bandForScore(score).band);
}

/** Rótulos textuais dos badges. */
export const HEAT_LABELS: Record<Heat, string> = {
  hot: 'Urgente',
  rise: 'Em alta',
  base: 'Relevante',
  ever: 'Guia',
};

// =============================================================================
// SUBSTITUTOS VISUAIS DO NÚMERO (design v0.2, §4 "O número saiu da tela")
// =============================================================================
//
// Ao esconder o score de 0 a 100 da interface pública (ADR 0009), perderíamos
// duas informações que o leitor de fato usa: INTENSIDADE ("quão quente?") e
// MOVIMENTO ("está subindo ou esfriando?"). O design resolveu isso sem número:
//
//   .heatbar → termômetro de 4 blocos. Comunica intensidade em escala ordinal.
//   .trend   → rótulo qualitativo ("Disparando", "Subindo", "Esfriando").
//
// Por que isto é melhor do que parece: "+38" só significa alguma coisa para
// quem conhece a escala — ou seja, para nós. "Disparando" é compreendido por
// qualquer pessoa no primeiro contato. (Nielsen #2: falar a linguagem do
// usuário, não a do sistema.)

/** Nível do termômetro. 4 = mais quente. Alimenta `data-on` do `.heatbar`. */
export type HeatLevel = 1 | 2 | 3 | 4;

const HEAT_TO_LEVEL: Record<Heat, HeatLevel> = {
  hot: 4,
  rise: 3,
  base: 2,
  ever: 1,
};

export function heatLevelForHeat(heat: Heat): HeatLevel {
  return HEAT_TO_LEVEL[heat];
}

/** Tendência qualitativa. */
export type Trend = 'surging' | 'up' | 'down' | 'flat' | 'new';

export const TREND_LABELS: Record<Trend, string> = {
  surging: 'Disparando',
  up: 'Subindo',
  down: 'Esfriando',
  flat: 'Estável',
  new: 'Novo',
};

/**
 * Limiares de tendência.
 *
 * São os MESMOS números que antes viravam "+38" na tela; a diferença é que
 * agora eles se transformam em palavra no servidor e o número não atravessa a
 * fronteira do HTML. Quem tiver acesso à página vê "Disparando"; quem quisesse
 * reconstruir a curva de calibração precisa agora de 5 observações para
 * distinguir o que antes lia direto.
 */
export const TREND_SURGING_DELTA = 20;
export const TREND_UP_DELTA = 5;
export const TREND_DOWN_DELTA = -5;
/** Abaixo desta idade, conteúdo sem histórico é "Novo" e não "Estável". */
export const TREND_NEW_MAX_AGE_HOURS = 3;

/**
 * Converte a variação de score da última hora em rótulo qualitativo.
 *
 * Função pura, com `now` por parâmetro — testável e reexecutável sobre o
 * histórico, como todo o resto do vocabulário de apresentação.
 */
export function trendForDelta(
  delta: number,
  publishedAt: Date | null,
  now: Date = new Date(),
): Trend {
  const ageHours = publishedAt ? (now.getTime() - publishedAt.getTime()) / 3_600_000 : Infinity;

  // "Novo" vence "Estável" em conteúdo recém-publicado: delta zero aí significa
  // "ainda não deu tempo de medir", não "o interesse não se move". Rotular como
  // estável seria afirmar algo que não sabemos.
  if (ageHours <= TREND_NEW_MAX_AGE_HOURS && delta < TREND_UP_DELTA) return 'new';

  if (delta >= TREND_SURGING_DELTA) return 'surging';
  if (delta >= TREND_UP_DELTA) return 'up';
  if (delta <= TREND_DOWN_DELTA) return 'down';
  return 'flat';
}

/**
 * Formatos de conteúdo — definem o template do miolo do artigo.
 * Lista fechada, vinda de design/README.md seção 2.
 */
export const CONTENT_FORMATS = [
  'breaking',
  'live',
  'trailer',
  'review',
  'listicle',
  'theory',
  'comparison',
  'guide',
] as const;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export function isContentFormat(value: unknown): value is ContentFormat {
  return typeof value === 'string' && CONTENT_FORMATS.includes(value as ContentFormat);
}

/**
 * REGRA DE NEGÓCIO DO DESIGN: teto de 3 conteúdos "quentes" simultâneos na home.
 *
 * Justificativa do designer, que é de produto e não de estética: "Se o pipeline
 * devolver 6 itens com score 80+, exiba os 3 maiores como quentes e rebaixe o
 * resto. Página inteira vermelha = nada é urgente + cheiro de clickbait."
 *
 * A regra mora AQUI, e não no componente da home, por dois motivos:
 *  - a página "Em Alta" e a home precisam aplicar o mesmo teto;
 *  - é uma regra testável, e regra de negócio dentro de JSX não se testa bem.
 */
export const MAX_HOT_ITEMS_ON_HOME = 3;

export interface HeatRankable {
  currentScore: number;
  currentBand: ScoreBand;
}

/**
 * Aplica o teto de "quentes", rebaixando o excedente para 'rise'.
 * Recebe itens JÁ ordenados por score decrescente.
 */
export function applyHeatCap<T extends HeatRankable>(
  items: T[],
  maxHot = MAX_HOT_ITEMS_ON_HOME,
): (T & { heat: Heat })[] {
  let hotCount = 0;

  return items.map((item) => {
    const naturalHeat = heatForBand(item.currentBand);

    if (naturalHeat === 'hot') {
      hotCount++;
      // A partir do 4º quente, rebaixa visualmente para "em alta".
      // Note que o SCORE não muda — só o tratamento visual. O dado continua
      // verdadeiro para o painel editorial e para as métricas.
      return { ...item, heat: hotCount <= maxHot ? ('hot' as Heat) : ('rise' as Heat) };
    }

    return { ...item, heat: naturalHeat };
  });
}

/**
 * O ticker vermelho do topo só aparece com score >= 90 (não 80).
 * Design: "É o sinal de 'site vivo' e a única coisa que empurra o conteúdo
 * para baixo — por isso o corte é alto."
 */
export const TICKER_MIN_SCORE = 90;

/**
 * =============================================================================
 * SLUG DE EDITORIA → SUFIXO DE CLASSE DO DESIGN (`.cat--*`, `.thumb[data-c]`)
 * =============================================================================
 *
 * O design system nomeia as editorias pela PALAVRA-CHAVE curta — `.cat--cinema`,
 * `.cat--anime`, `.cat--hq` —, enquanto o produto usa slugs de URL, que são
 * mais longos porque precisam ser bons para busca: `cinema-e-series`,
 * `anime-e-manga`, `hqs`.
 *
 * Três das seis editorias, portanto, NÃO coincidem. Antes desta função o
 * markup escrevia `cat--${slug}` direto, produzindo `.cat--cinema-e-series`,
 * `.cat--anime-e-manga` e `.cat--hqs` — três classes que não existem em lugar
 * nenhum. O efeito era silencioso e por isso passou despercebido: `.cat` sem o
 * modificador continua renderizando o rótulo, só que com o filete no cinza
 * padrão (`--c: var(--ink-3)`). Metade das editorias do site tinha perdido a
 * cor, e nada quebrava.
 *
 * A conversão mora aqui, junto de `heatForBand` e `heatLevelForHeat`, porque é
 * exatamente o mesmo tipo de tradução: vocabulário do domínio → vocabulário do
 * design. Um lugar só, tipado contra `CategorySlug` — se um slug novo entrar na
 * taxonomia sem entrar neste mapa, o TypeScript reclama no build em vez de o
 * leitor descobrir um filete cinza em produção.
 */
export const CATEGORY_DESIGN_TOKEN = {
  games: 'games',
  'cinema-e-series': 'cinema',
  'anime-e-manga': 'anime',
  hqs: 'hq',
  tech: 'tech',
  eventos: 'eventos',
} as const;

export type CategoryDesignToken =
  (typeof CATEGORY_DESIGN_TOKEN)[keyof typeof CATEGORY_DESIGN_TOKEN];

/**
 * Sufixo do design para uma editoria, ou `undefined` se o slug não for
 * conhecido.
 *
 * Aceita `string` (e não só `CategorySlug`) porque vários chamadores recebem o
 * slug já como texto — parâmetro de rota, campo do banco. O `undefined` é
 * deliberado e é o comportamento seguro nos dois usos:
 *   - em `.cat`, sem modificador o filete cai no neutro (`--c: var(--ink-3)`),
 *     que é a degradação correta;
 *   - em `data-c`, o atributo simplesmente não é escrito e o `.thumb` usa o
 *     gradiente padrão.
 * Escolher uma cor "chutada" seria pior: pintaria uma editoria com a identidade
 * de outra.
 */
export function catToken(slug: string): CategoryDesignToken | undefined {
  return (CATEGORY_DESIGN_TOKEN as Record<string, CategoryDesignToken | undefined>)[slug];
}

/** Açúcar para o uso mais comum: `className={catClass(slug)}`. */
export function catClass(slug: string): string {
  const token = catToken(slug);
  return token ? `cat cat--${token}` : 'cat';
}

/**
 * Payload de apresentação consumido pelos componentes.
 * Espelha o "contrato de dados esperado do pipeline" do design/README.md,
 * porém em camelCase (convenção do projeto; a conversão fica na borda da API
 * pública, se algum consumidor externo precisar de snake_case).
 */
export interface ContentCardData {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
  /**
   * Score de 0 a 100.
   *
   * ATENÇÃO: campo INTERNO. Continua no contrato porque o servidor ordena e
   * filtra por ele (a página Em Alta corta em 60, por exemplo), mas NENHUM
   * componente pode renderizá-lo — ver ADR 0009. Para exibir intensidade, use
   * `heat` + `heatLevel`; para movimento, use `trend`.
   */
  score: number;
  heat: Heat;
  /** 1 a 4 — alimenta o termômetro `.heatbar`. Substitui o número na tela. */
  heatLevel: HeatLevel;
  /** Rótulo qualitativo de movimento. Substitui o "+38". */
  trend: Trend;
  /** Variação do score na última hora — INTERNO, insumo de `trend`. */
  scoreDelta1h: number;
  scoreUpdatedAt: Date | null;
  category: { slug: string; label: string };
  /** Sub-seção (ex.: 'hardware'). Liga o template comercial da sub-seção. */
  subsection: string | null;
  franchises: { slug: string; label: string }[];
  format: ContentFormat;
  isLive: boolean;
  updatesCount: number;
  hasSpoiler: boolean;
  /** 3 a 5 bullets. Obrigatório em 'breaking' e 'review' (ver validação abaixo). */
  tldr: string[];
  readingTimeMin: number;
  publishedAt: Date | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  /** score >= 80 E fonte oficial confirmada. Calculado no servidor. */
  pushEligible: boolean;
}

/**
 * Valida a regra editorial "TL;DR não é opcional em conteúdo quente".
 *
 * Design: "É o que segura a taxa de rejeição de quem chega pelo push, lê a
 * resposta e decide se fica."
 *
 * Usada pelo painel editorial para BLOQUEAR a publicação de um breaking sem
 * TL;DR. Sem trava, a regra vira sugestão — e sugestão em redação sob pressão
 * de 30 minutos é sistematicamente ignorada.
 */
export function validateTldrRequirement(
  format: ContentFormat,
  tldr: string[],
): { valid: boolean; message?: string } {
  const requiresTldr = format === 'breaking' || format === 'review';

  if (!requiresTldr) return { valid: true };

  if (tldr.length < 3) {
    return {
      valid: false,
      message: `Conteúdo do formato "${format}" exige TL;DR com ao menos 3 pontos (atual: ${tldr.length}).`,
    };
  }
  if (tldr.length > 5) {
    return {
      valid: false,
      message: `TL;DR deve ter no máximo 5 pontos para caber na tela sem rolagem (atual: ${tldr.length}).`,
    };
  }
  return { valid: true };
}
