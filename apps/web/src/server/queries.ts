/**
 * =============================================================================
 * CAMADA DE CONSULTAS — acesso a dados + estratégia de cache
 * =============================================================================
 *
 * Todas as leituras do site passam por aqui. Concentrar isso num único módulo
 * traz três benefícios que valem o arquivo extra:
 *
 *  1. As TAGS DE CACHE ficam num lugar só. O curator invalida por tag; se as
 *     tags fossem espalhadas pelas páginas, a invalidação erraria o alvo e
 *     ninguém entenderia por que a home não atualiza.
 *  2. Evita N+1 por construção: os `include` corretos ficam definidos junto da
 *     query, não montados ad hoc em cada página.
 *  3. As páginas ficam declarativas — pedem dados, não sabem de Prisma.
 *
 * A ESTRATÉGIA DE CACHE EM DUAS VELOCIDADES (requisito de Core Web Vitals sob
 * pico de tráfego):
 *
 *   ARTIGO         -> revalidate 1h + invalidação por evento na edição.
 *                     Conteúdo praticamente imutável: servido da CDN, aguenta
 *                     pico de breaking news sem tocar no banco.
 *
 *   HOME / EM ALTA -> revalidate 60s + invalidação por evento a cada mudança
 *                     de FAIXA de score. Rede de segurança curta + precisão.
 *
 * Sem o cache de artigo, 50 mil leitores simultâneos em um breaking news
 * gerariam 50 mil queries — e o banco cairia exatamente no momento de maior
 * visibilidade do site.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  applyHeatCap,
  EVERGREEN_FORMATS,
  heatForBand,
  heatLevelForHeat,
  isCategorySlug,
  MAX_HOT_ITEMS_ON_HOME,
  rankRecommendations,
  TREND_UP_DELTA,
  trendForDelta,
  type ContentCardData,
  type ContentFormat,
  type ScoreBand,
} from '@subcarioca/core';
import { ARTICLE_INCLUDE, mapArticle, mapComment, prisma, toStringArray } from '@subcarioca/db';

/**
 * `unstable_cache` serializa o valor de retorno via JSON ao gravar/ler do
 * cache. Todo `Date` que atravessa essa fronteira volta como string ISO em
 * runtime — mesmo com o tipo do Prisma/TypeScript continuando a dizer `Date`.
 * Sem isso, qualquer `.getTime()`/`.toISOString()` chamado sobre um campo de
 * data vindo de uma função cacheada quebra em produção (não em dev sem cache,
 * o que faz o bug passar despercebido em testes locais rápidos).
 *
 * Revivemos aqui, uma única vez, na borda de saída do cache — em vez de
 * espalhar `new Date(...)` em cada página que consome estas funções.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function reviveDates<T>(value: T): T {
  if (typeof value === 'string') {
    return (ISO_DATE_RE.test(value) ? new Date(value) : value) as unknown as T;
  }
  // `unstable_cache` só serializa ao GRAVAR/LER do armazenamento do cache. Em
  // cache miss, a função original roda e devolve `Date` de verdade — sem este
  // guard, `Object.entries(umaData)` é vazio (Date não tem props enumeráveis)
  // e o objeto vira `{}`, destruindo a data em vez de preservá-la.
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => reviveDates(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = reviveDates(val);
    }
    return out as T;
  }
  return value;
}

/** Envolve uma função cacheada para revivificar `Date`s no valor de retorno. */
function withDateRevival<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async (...args: A) => reviveDates(await fn(...args));
}

/**
 * Executa uma consulta e devolve um valor de reserva se o banco falhar.
 *
 * POR QUE ISSO EXISTE — duas razões, ambas concretas:
 *
 *  1. BUILD EM CI: o `next build` pré-renderiza as páginas estáticas. Sem esta
 *     proteção, o deploy inteiro quebra quando o runner de CI não tem acesso ao
 *     banco — situação normal em muitos pipelines. Perder o deploy porque uma
 *     listagem não pôde ser lida é um péssimo negócio.
 *
 *  2. PRODUÇÃO SOB PICO: se o banco engasgar durante um breaking news, é muito
 *     melhor servir a home com uma seção vazia (o resto vem da CDN) do que
 *     devolver erro 500 para todo mundo. O site degrada em vez de cair.
 *
 * O erro é sempre registrado — degradar em silêncio é como um sistema fica
 * quebrado por semanas sem ninguém notar.
 */
async function safeQuery<T>(label: string, query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query();
  } catch (error) {
    console.error(
      `[queries] "${label}" falhou; usando valor de reserva:`,
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

/**
 * Como `safeQuery`, mas para a consulta que decide se a ENTIDADE existe
 * (artigo por slug, categoria, sub-categoria, franquia). Aqui `null` tem um
 * significado público específico: a página chama `notFound()` e devolve 404.
 *
 * Se a causa real for o banco fora do ar, 404 é a resposta ERRADA — o Google
 * desindexa 404 persistente, enquanto trata 500 como falha transitória e tenta
 * de novo depois. Por isso a exceção NÃO é engolida aqui: sobe e vira erro 500
 * de verdade, distinguível de "este artigo/categoria não existe".
 *
 * Um "não encontrado" LEGÍTIMO (o `findUnique`/`findFirst` resolve para
 * `null` sem lançar) continua funcionando normalmente — só a EXCEÇÃO é
 * repropagada. Listas (matérias da categoria, relacionadas etc.) continuam em
 * `safeQuery`: ali, degradar para vazio é a resposta certa.
 */
async function requiredQuery<T>(label: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    console.error(
      `[queries] "${label}" falhou (entidade obrigatória; erro repropagado como 500):`,
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

/**
 * Tags de cache. O curator invalida por estes nomes via /api/revalidate.
 * Constantes (e não strings soltas) porque um typo aqui produz um bug mudo:
 * a invalidação "funciona" e a página nunca atualiza.
 */
export const CACHE_TAGS = {
  home: 'home',
  trending: 'trending',
  ticker: 'ticker',
  article: (slug: string) => `article:${slug}`,
  category: (slug: string) => `category:${slug}`,
  franchise: (slug: string) => `franchise:${slug}`,
  sitemap: 'sitemap',
} as const;

/** Seleção mínima para montar um card. Menos colunas = menos I/O no pico. */
const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  coverImageAlt: true,
  currentScore: true,
  currentBand: true,
  scoreDelta1h: true,
  scoreUpdatedAt: true,
  publishedAt: true,
  readingMinutes: true,
  format: true,
  isLive: true,
  updatesCount: true,
  hasSpoiler: true,
  tldr: true,
  isBreaking: true,
  category: { select: { slug: true, name: true } },
  subcategory: { select: { slug: true } },
  franchises: { select: { franchise: { select: { slug: true, name: true } } } },
} as const;

type CardRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  currentScore: number;
  currentBand: string;
  scoreDelta1h: number;
  scoreUpdatedAt: Date | null;
  publishedAt: Date | null;
  readingMinutes: number;
  format: string;
  isLive: boolean;
  updatesCount: number;
  hasSpoiler: boolean;
  // `unknown` e não `string[]`: desde a migração para o MySQL, `tldr` é uma
  // coluna `Json` (MySQL não tem array nativo), e o Prisma tipa o retorno como
  // `JsonValue` — que inclui `null`. A forma volta a ser garantida em
  // `toCardData`, com `toStringArray`. Ver packages/db/src/json.ts.
  tldr: unknown;
  isBreaking: boolean;
  category: { slug: string; name: string };
  subcategory: { slug: string } | null;
  franchises: { franchise: { slug: string; name: string } }[];
};

/**
 * Converte linha do banco no contrato de apresentação do design.
 *
 * O `heat` é calculado AQUI, no servidor — exigência explícita do design:
 * "o front-end só mapeia string -> classe CSS". Ver core/presentation.ts.
 */
function toCardData(row: CardRow): ContentCardData {
  const band = row.currentBand as ScoreBand;
  const categorySlug = isCategorySlug(row.category.slug) ? row.category.slug : 'games';
  const heat = heatForBand(band);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    url: `/${categorySlug}/${row.slug}`,
    score: row.currentScore,
    heat,
    // O número vira TERMÔMETRO e PALAVRA aqui, no servidor — nunca no template.
    // Mesma regra que já valia para `heat`: se o critério mudar, muda em um
    // lugar só, e o front continua sendo tradução de string para classe CSS.
    heatLevel: heatLevelForHeat(heat),
    trend: trendForDelta(row.scoreDelta1h, row.publishedAt),
    scoreDelta1h: row.scoreDelta1h,
    scoreUpdatedAt: row.scoreUpdatedAt,
    category: { slug: categorySlug, label: row.category.name },
    subsection: row.subcategory?.slug ?? null,
    franchises: row.franchises.map((f) => ({
      slug: f.franchise.slug,
      label: f.franchise.name,
    })),
    format: row.format as ContentFormat,
    isLive: row.isLive,
    updatesCount: row.updatesCount,
    hasSpoiler: row.hasSpoiler,
    // Este é o ponto ÚNICO em que o `tldr` de uma listagem recupera a forma de
    // `string[]`. Concentrar aqui é o que mantém o resto do código (cards, hero,
    // página de artigo) sem saber que a coluna virou `Json`.
    tldr: toStringArray(row.tldr),
    readingTimeMin: row.readingMinutes,
    publishedAt: row.publishedAt,
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    // "score >= 80 E fonte oficial confirmada" (design/README.md).
    // A checagem de fonte oficial mora no pipeline; aqui usamos a faixa como
    // condição necessária. O push efetivo passa por `isEligibleForAutomation`.
    pushEligible: band === 'HOT',
  };
}

// =============================================================================
// HOME
// =============================================================================

/**
 * Nível da cascata que produziu o hero. A home usa isto para escolher o RÓTULO
 * do destaque — e só ele muda; o layout é o mesmo nos quatro casos.
 *
 *   'hot'    existe algo na faixa de urgência  → "Urgente"
 *   'rise'   nada urgente, mas algo subindo    → "Destaque de hoje"
 *   'latest' nada quente: a matéria mais nova  → "Última publicada"
 *   'none'   nenhuma matéria publicada         → estado vazio de verdade
 */
export type HomeHeroKind = 'hot' | 'rise' | 'latest' | 'none';

/** Cards da seção-âncora "Mais repercutido agora". */
const HOME_FEED_SIZE = 12;

/**
 * Títulos da faixa "Acabou de sair".
 *
 * Cinco: o suficiente para cobrir um dia de publicação da redação e curto o
 * bastante para ser lido de uma vez, sem virar uma segunda listagem competindo
 * com a grade logo abaixo.
 */
const JUST_OUT_SIZE = 5;

/**
 * Dados da home.
 *
 * =============================================================================
 * O PRINCÍPIO QUE ESTA FUNÇÃO SEGUE
 * =============================================================================
 *
 *   O SCORE DETERMINA A HIERARQUIA, NUNCA A EXISTÊNCIA.
 *
 * A versão anterior condicionava TODA seção a uma faixa de score: o hero exigia
 * algo acima do limiar de urgência, o feed excluía a faixa mais fria, os guias
 * eram "o que tem score baixo". A consequência não era um caso de borda — era o
 * comportamento na maior parte do tempo: num site que publica poucas matérias
 * por dia, nenhuma delas passa de 80, e a home renderizava "Nada urgente no
 * momento" com o acervo inteiro escondido logo abaixo, no banco.
 *
 * Agora a temperatura escolhe QUAL matéria vai para o topo e em que ORDEM as
 * outras aparecem; o conteúdo aparece de qualquer forma.
 *
 * -----------------------------------------------------------------------------
 * A ORDEM DA HOME É POR REPERCUSSÃO — decisão do dono do produto
 * -----------------------------------------------------------------------------
 * Até aqui a seção abaixo do hero era CRONOLÓGICA, seguindo a regra antiga do
 * design ("a temperatura muda o peso, não a ordem cronológica"). O dono do
 * produto reviu essa regra: a home deve estampar a matéria de maior
 * popularidade no topo e seguir em ordem DECRESCENTE DE SCORE, com a data
 * apenas como desempate.
 *
 * O que isso troca, para quem for reavaliar depois: ganha-se a promessa de que
 * a home é sempre "o que mais está repercutindo agora"; perde-se a garantia de
 * que o que acabou de sair aparece no topo. Como score leva horas para subir,
 * uma matéria recém-publicada entra na home em posição baixa e sobe conforme
 * repercute. Quem quiser o corte cronológico tem a página de cada editoria, que
 * continua ordenada por `publishedAt`.
 *
 * O ordenamento não afeta a regra de nunca ficar vazia: a seção continua sem
 * NENHUM filtro de faixa — entra tudo o que está publicado, na ordem nova.
 *
 * DECISÃO DE ESTRUTURA: uma única função cacheada com três consultas em
 * paralelo. Como a home inteira passou a ser ordenada por score, o hero, o
 * ranking e a grade saem todos do MESMO lote (`home:scored`) — o que também
 * garante, de graça, que nenhum card apareça em dois blocos. As outras duas
 * consultas existem porque pedem ordem diferente: a do degrau "Última
 * publicada" (a mais recente, que pode não estar entre os 40 maiores scores) e
 * a dos guias (por formato).
 */
const getHomeDataCached = unstable_cache(
  async () => {
    const [scoredRows, newestRows, guideRows] = await Promise.all([
      // Lote único por REPERCUSSÃO: alimenta o hero, o ranking e a grade.
      // `publishedAt` como segundo critério não é detalhe: score empata com
      // frequência (o motor trabalha com poucas casas), e sem desempate estável
      // a ordem da home mudaria a cada consulta, com cards trocando de lugar
      // entre duas visitas sem nada ter mudado no site.
      safeQuery(
        'home:scored',
        () =>
          prisma.article.findMany({
            where: { status: 'published', publishedAt: { not: null } },
            select: CARD_SELECT,
            orderBy: [{ currentScore: 'desc' }, { publishedAt: 'desc' }],
            take: 40,
          }),
        [],
      ),
      // As mais RECENTES. Consulta própria (e não uma reordenação do lote por
      // score) porque num acervo grande a matéria mais nova pode estar fora dos
      // 40 maiores scores — justamente por ser nova.
      //
      // UMA consulta, DOIS usos: a primeira linha é o terceiro degrau do hero
      // ("Última publicada"), e a lista inteira é a faixa "Acabou de sair". Eram
      // duas consultas idênticas a menos de um `take`; buscar cinco linhas em
      // vez de uma custa o mesmo e economiza uma ida ao banco na home.
      safeQuery(
        'home:newest',
        () =>
          prisma.article.findMany({
            where: { status: 'published', publishedAt: { not: null } },
            select: CARD_SELECT,
            orderBy: { publishedAt: 'desc' },
            take: JUST_OUT_SIZE,
          }),
        [],
      ),
      // "Guias e essenciais" por FORMATO. Ordenado por data (e não por
      // audiência) porque num acervo novo `viewCount` é zero em tudo — ordenar
      // por ele produziria uma ordem arbitrária disfarçada de curadoria.
      safeQuery(
        'home:guides',
        () =>
          prisma.article.findMany({
            where: {
              status: 'published',
              publishedAt: { not: null },
              format: { in: [...EVERGREEN_FORMATS] },
            },
            select: CARD_SELECT,
            orderBy: { publishedAt: 'desc' },
            take: 4,
          }),
        [],
      ),
    ]);

    // Aplica o teto de 3 "quentes" simultâneos (regra do design): página
    // inteira vermelha = nada é urgente.
    const withHeat = applyHeatCap(
      scoredRows.map((a) => ({ ...a, currentBand: a.currentBand as ScoreBand })),
    );

    const scored = scoredRows.map((row, index) => ({
      ...toCardData(row),
      heat: withHeat[index]?.heat ?? heatForBand(row.currentBand as ScoreBand),
    }));

    const newest = newestRows.map(toCardData);

    // ---------------------------------------------------------------------
    // HERO EM CASCATA — degradação graciosa em quatro níveis
    // ---------------------------------------------------------------------
    // Cada degrau é uma AFIRMAÇÃO DIFERENTE, e é por isso que o rótulo muda
    // junto: chamar de "Urgente" a matéria mais recente de um dia parado seria
    // mentir para o leitor, e o leitor descobre na segunda visita.
    const hot = scored.filter((c) => c.heat === 'hot').slice(0, MAX_HOT_ITEMS_ON_HOME);
    // O mesmo teto de 3 vale para o degrau seguinte, pela mesma razão: mais que
    // isso deixa de ser destaque e vira lista.
    const rise = scored.filter((c) => c.heat === 'rise').slice(0, MAX_HOT_ITEMS_ON_HOME);

    let heroKind: HomeHeroKind = 'none';
    let hero: ContentCardData[] = [];

    if (hot.length > 0) {
      heroKind = 'hot';
      hero = hot;
    } else if (rise.length > 0) {
      heroKind = 'rise';
      hero = rise;
    } else if (newest.length > 0 && newest[0]) {
      heroKind = 'latest';
      hero = [newest[0]];
    }

    const heroIds = new Set(hero.map((h) => h.id));

    const trending = scored
      .filter((c) => !heroIds.has(c.id) && (c.heat === 'hot' || c.heat === 'rise'))
      .slice(0, 6);
    const trendingIds = new Set(trending.map((t) => t.id));

    // A grade é a CONTINUAÇÃO da mesma ordem: hero (1º) → lista numerada (os
    // que estão quentes) → grade (todo o resto, ainda em score decrescente).
    //
    // Por isso ela exclui o ranking, e não só o hero. Enquanto a seção era
    // cronológica, repetir um card fazia sentido — eram duas leituras
    // diferentes do acervo, uma por horário e outra por temperatura. Agora as
    // duas leem na MESMA ordem, e os seis primeiros cards da grade seriam,
    // literalmente, os seis itens da lista logo acima.
    //
    // Nada some da página por causa disso: o que sai da grade está visível no
    // bloco anterior. O que continua valendo é a regra que motivou a reforma —
    // NENHUM filtro de faixa aqui, entra tudo o que está publicado.
    const feed = scored
      .filter((c) => !heroIds.has(c.id) && !trendingIds.has(c.id))
      .slice(0, HOME_FEED_SIZE);

    const evergreen = guideRows.map(toCardData);

    /**
     * FAIXA "ACABOU DE SAIR" — a única superfície CRONOLÓGICA da home.
     *
     * Ela existe porque a home inteira é ordenada por repercussão, e score leva
     * horas para subir: uma matéria publicada há 10 minutos entra na grade numa
     * posição baixa e só sobe depois. Sem esta faixa, o leitor que volta ao site
     * três vezes por dia não tem NENHUMA forma de ver o que mudou desde a última
     * visita — que é o motivo pelo qual ele voltou.
     *
     * A decisão contraria a regra "a home inteira é ordenada por repercussão" e
     * foi aprovada pelo dono do produto. Ela não muda a ordenação de nada: é uma
     * faixa a mais, entre o ranking e a grade.
     *
     * SEM IMAGEM E COM HORÁRIO, de propósito: com capa, ela competiria com o
     * hero e com a grade pelo mesmo olhar, e a home teria três blocos de cards
     * disputando atenção. Como lista de títulos com horário, ela é lida em dois
     * segundos e não rouba hierarquia de ninguém.
     *
     * A faixa NÃO exclui o que está no hero nem no ranking. Aqui a pergunta é
     * "o que saiu agora?", e uma matéria pode legitimamente ser a mais nova E a
     * mais repercutida. Escondê-la por já aparecer acima responderia a pergunta
     * errada — a faixa passaria a mentir sobre o que é recente.
     */
    return { hero, heroKind, trending, feed, evergreen, justOut: newest };
  },
  ['home-data'],
  {
    // Rede de segurança. O caminho normal de atualização é a invalidação por
    // evento disparada pelo curator quando um score muda de faixa.
    revalidate: 60,
    tags: [CACHE_TAGS.home],
  },
);
export const getHomeData = withDateRevival(getHomeDataCached);

/** Itens do ticker vermelho: só score >= 90 (corte alto, por decisão do design). */
const getTickerItemsCached = unstable_cache(
  async () => {
    const articles = await safeQuery(
      'ticker',
      () =>
        prisma.article.findMany({
          where: { status: 'published', currentScore: { gte: 90 } },
          select: CARD_SELECT,
          orderBy: { currentScore: 'desc' },
          take: 5,
        }),
      [],
    );
    return articles.map(toCardData);
  },
  ['ticker-items'],
  { revalidate: 60, tags: [CACHE_TAGS.ticker, CACHE_TAGS.home] },
);
export const getTickerItems = withDateRevival(getTickerItemsCached);

// =============================================================================
// EM ALTA (ranking ao vivo)
// =============================================================================

/**
 * Corte da faixa "em alta". Continua existindo — mudou o que ele decide.
 *
 * ANTES: decidia se a LISTA existia (`ranking = cards.filter(score >= 60)`).
 * Num dia calmo o resultado era uma página de ranking sem ranking nenhum —
 * um site provando publicamente que não tem o que mostrar.
 *
 * AGORA: decide onde cai o DEGRAU dentro de uma lista que sempre existe.
 * Ranking é ordem relativa; ordem relativa não depende de limiar absoluto. Com
 * dois artigos publicados, o 1º ainda é o 1º.
 */
const TRENDING_STEP_SCORE = 60;

/** Tamanho do ranking público. */
const TRENDING_SIZE = 20;

const getTrendingRankingCached = unstable_cache(
  async () => {
    const articles = await safeQuery(
      'trending:articles',
      () =>
        prisma.article.findMany({
          where: { status: 'published', publishedAt: { not: null } },
          select: CARD_SELECT,
          orderBy: [{ currentScore: 'desc' }, { publishedAt: 'desc' }],
          take: TRENDING_SIZE,
        }),
      [],
    );

    const ranking = articles.map(toCardData);

    const stats = await safeQuery(
      'trending:stats',
      async () => {
        const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
        const startOfWeek = new Date(Date.now() - 7 * 24 * 3_600_000);

        const [hotCount, risingCount, todayCount, trackedCount, movingCount, weekCount, lastRun] =
          await Promise.all([
            prisma.article.count({ where: { status: 'published', currentBand: 'HOT' } }),
            prisma.article.count({ where: { status: 'published', currentBand: 'RISING' } }),
            prisma.article.count({
              where: { status: 'published', publishedAt: { gte: startOfToday } },
            }),
            // --- Trio alternativo, para o dia calmo. Ver o comentário da página.
            prisma.article.count({ where: { status: 'published' } }),
            // Mesmo limiar que vira o rótulo "Subindo" no card: se a página diz
            // que N estão subindo, é o mesmo N que o leitor vê marcado na lista.
            prisma.article.count({
              where: { status: 'published', scoreDelta1h: { gte: TREND_UP_DELTA } },
            }),
            prisma.article.count({
              where: { status: 'published', publishedAt: { gte: startOfWeek } },
            }),
            // "Atualizado há X min" — prova de que o site está vivo (design §3).
            prisma.pipelineRun.findFirst({
              where: { status: 'completed' },
              orderBy: { finishedAt: 'desc' },
              select: { finishedAt: true },
            }),
          ]);

        return {
          hotCount,
          risingCount,
          todayCount,
          trackedCount,
          movingCount,
          weekCount,
          lastUpdatedAt: lastRun?.finishedAt ?? null,
        };
      },
      {
        hotCount: 0,
        risingCount: 0,
        todayCount: 0,
        trackedCount: 0,
        movingCount: 0,
        weekCount: 0,
        lastUpdatedAt: null as Date | null,
      },
    );

    return {
      ranking,
      // Quantos itens do ranking estão acima do corte. É por aqui que a página
      // sabe em que posição desenhar o degrau — o número 60 não atravessa a
      // fronteira da apresentação (ADR 0009: o score não é público).
      hotZoneCount: ranking.filter((c) => c.score >= TRENDING_STEP_SCORE).length,
      stats,
    };
  },
  ['trending-ranking'],
  { revalidate: 60, tags: [CACHE_TAGS.trending] },
);
export const getTrendingRanking = withDateRevival(getTrendingRankingCached);

// =============================================================================
// CATEGORIA
// =============================================================================

/**
 * Tamanho da página da editoria.
 *
 * 18 é múltiplo de 2 e de 3 — os dois números de colunas da grade (`g-sm-2`).
 * Um total que não fecha a grade deixa um card órfão na última linha, que é o
 * defeito visual mais visível de uma listagem paginada.
 */
export const CATEGORY_PAGE_SIZE = 18;

const getCategoryPageCached = unstable_cache(
  async (slug: string, page: number, format: string | null) => {
    const category = await requiredQuery('category:lookup', () =>
      prisma.category.findUnique({ where: { slug } }),
    );
    if (!category) return null;

    /**
     * O FILTRO POR FORMATO É UM RECORTE DO MESMO ACERVO, não uma seção nova.
     *
     * Por isso ele entra no `where` da MESMA consulta e a página continua com
     * `canonical` apontando para a editoria sem filtro (ver `routes.ts`): uma
     * URL indexável por filtro criaria N páginas quase idênticas competindo
     * entre si pela mesma consulta de busca — canibalização de SEO.
     */
    const where = {
      status: 'published' as const,
      categoryId: category.id,
      ...(format ? { format } : {}),
    };

    const data = await safeQuery(
      'category:data',
      async () => {
        const [total, articles, trendingInCategory, upcomingReleases] = await Promise.all([
          // A CONTAGEM é o que permite a paginação saber se existe página
          // seguinte SEM buscar uma linha a mais e descartá-la. Ela roda em
          // paralelo com a listagem, então não soma latência.
          prisma.article.count({ where }),
          prisma.article.findMany({
            where,
            select: CARD_SELECT,
            // Ordem CRONOLÓGICA: quem entra na categoria quer ver o que saiu hoje.
            orderBy: { publishedAt: 'desc' },
            skip: (page - 1) * CATEGORY_PAGE_SIZE,
            take: CATEGORY_PAGE_SIZE,
          }),
          prisma.article.findMany({
            where: {
              status: 'published',
              categoryId: category.id,
              currentScore: { gte: 60 },
            },
            select: CARD_SELECT,
            orderBy: { currentScore: 'desc' },
            take: 5,
          }),
          // Conecta a categoria ao calendário — o MESMO dado que alimenta o
          // sinal de sazonalidade do score. Um insumo, dois usos.
          prisma.releaseEvent.findMany({
            where: {
              releaseDate: { gte: new Date() },
              franchise: { primaryCategoryId: category.id },
            },
            orderBy: { releaseDate: 'asc' },
            take: 5,
            select: { title: true, releaseDate: true, isConfirmed: true, kind: true },
          }),
        ]);

        return { total, articles, trendingInCategory, upcomingReleases };
      },
      {
        total: 0,
        articles: [] as CardRow[],
        trendingInCategory: [] as CardRow[],
        upcomingReleases: [] as {
          title: string;
          releaseDate: Date;
          isConfirmed: boolean;
          kind: string;
        }[],
      },
    );

    return {
      category: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        accentColor: category.accentColor,
        seoTitle: category.seoTitle,
        seoDescription: category.seoDescription,
      },
      articles: data.articles.map(toCardData),
      trending: data.trendingInCategory.map(toCardData),
      upcomingReleases: data.upcomingReleases,
      page,
      totalPages: Math.max(1, Math.ceil(data.total / CATEGORY_PAGE_SIZE)),
      totalArticles: data.total,
    };
  },
  ['category-page'],
  { revalidate: 300, tags: [CACHE_TAGS.home] },
);

/**
 * `page` e `format` entram na CHAVE do cache automaticamente (o `unstable_cache`
 * usa os argumentos), então cada combinação tem entrada própria e nenhuma
 * invalida a outra por engano.
 */
export const getCategoryPage = withDateRevival(getCategoryPageCached);

/**
 * Página de SUB-CATEGORIA (/categoria/tech/hardware).
 *
 * Consulta separada da categoria-mãe, e não um filtro em memória sobre ela: a
 * sub-seção tem acervo próprio, ordenação própria e vai crescer sozinha. Filtrar
 * a listagem da categoria significaria buscar 24 artigos de Tech para exibir os
 * 3 que são de Hardware — e, no dia em que Hardware tiver 200 matérias, a página
 * mostraria só as que por acaso estivessem entre as 24 mais recentes de Tech.
 *
 * O filtro é por CHAVE ESTRANGEIRA (`subcategory.slug`), com índice dedicado —
 * não por texto de tag. Ver o racional em core/taxonomy.ts.
 */
const getSubcategoryPageCached = unstable_cache(
  async (categorySlug: string, subSlug: string) => {
    const subcategory = await requiredQuery('subcategory:lookup', () =>
      prisma.subcategory.findFirst({
        where: { slug: subSlug, category: { slug: categorySlug } },
        include: { category: { select: { slug: true, name: true, accentColor: true } } },
      }),
    );
    if (!subcategory) return null;

    const articles = await safeQuery(
      'subcategory:articles',
      () =>
        prisma.article.findMany({
          where: { status: 'published', subcategoryId: subcategory.id },
          select: CARD_SELECT,
          orderBy: { publishedAt: 'desc' },
          take: 24,
        }),
      [] as CardRow[],
    );

    return {
      subcategory: {
        slug: subcategory.slug,
        name: subcategory.name,
        description: subcategory.description,
        affiliateWeight: subcategory.affiliateWeight,
        categorySlug: subcategory.category.slug,
        categoryName: subcategory.category.name,
        accentColor: subcategory.category.accentColor,
      },
      articles: articles.map(toCardData),
    };
  },
  ['subcategory-page'],
  { revalidate: 300, tags: [CACHE_TAGS.home] },
);
export const getSubcategoryPage = withDateRevival(getSubcategoryPageCached);

// =============================================================================
// HUB DE FRANQUIA — peça central de retenção
// =============================================================================

const getFranchiseHubCached = unstable_cache(
  async (slug: string) => {
    const franchise = await requiredQuery('franchise:lookup', () =>
      prisma.franchise.findUnique({
        where: { slug },
        include: { primaryCategory: { select: { slug: true, name: true } } },
      }),
    );
    if (!franchise) return null;

    const data = await safeQuery(
      'franchise:data',
      async () => {
        const [latest, evergreen, nextRelease, timeline] = await Promise.all([
          prisma.article.findMany({
            where: {
              status: 'published',
              franchises: { some: { franchiseId: franchise.id } },
            },
            select: CARD_SELECT,
            orderBy: { publishedAt: 'desc' },
            take: 12,
          }),
          // "Essencial": evergreen fixado, porta de entrada para quem chega agora.
          prisma.article.findMany({
            where: {
              status: 'published',
              franchises: { some: { franchiseId: franchise.id } },
              currentBand: 'EVERGREEN',
            },
            select: CARD_SELECT,
            orderBy: { viewCount: 'desc' },
            take: 4,
          }),
          // Countdown: motivo de revisita diária (design §3).
          prisma.releaseEvent.findFirst({
            where: { franchiseId: franchise.id, releaseDate: { gte: new Date() } },
            orderBy: { releaseDate: 'asc' },
          }),
          // Linha do tempo: resolve a dor real do fã ("perdi alguma coisa?").
          prisma.article.findMany({
            where: {
              status: 'published',
              franchises: { some: { franchiseId: franchise.id } },
            },
            select: {
              id: true,
              slug: true,
              title: true,
              publishedAt: true,
              currentBand: true,
              category: { select: { slug: true } },
            },
            orderBy: { publishedAt: 'desc' },
            take: 20,
          }),
        ]);

        return { latest, evergreen, nextRelease, timeline };
      },
      {
        latest: [] as CardRow[],
        evergreen: [] as CardRow[],
        nextRelease: null as { title: string; releaseDate: Date } | null,
        timeline: [] as {
          id: string;
          slug: string;
          title: string;
          publishedAt: Date | null;
          currentBand: string;
          category: { slug: string };
        }[],
      },
    );

    return {
      franchise: {
        slug: franchise.slug,
        name: franchise.name,
        description: franchise.description,
        heroImageUrl: franchise.heroImageUrl,
        logoUrl: franchise.logoUrl,
        followerCount: franchise.followerCount,
        audienceAffinityIndex: franchise.audienceAffinityIndex,
        categorySlug: franchise.primaryCategory.slug,
        categoryName: franchise.primaryCategory.name,
      },
      latest: data.latest.map(toCardData),
      evergreen: data.evergreen.map(toCardData),
      nextRelease: data.nextRelease,
      timeline: data.timeline,
      // Score atual do fandom = maior score entre os conteúdos da franquia.
      currentScore: data.latest[0]?.currentScore ?? 0,
    };
  },
  ['franchise-hub'],
  { revalidate: 300 },
);
export const getFranchiseHub = withDateRevival(getFranchiseHubCached);

// =============================================================================
// ARTIGO
// =============================================================================

/**
 * Artigo por slug. Cache LONGO: é o conteúdo que aguenta o pico.
 * Invalidado por evento quando o editor publica uma alteração.
 *
 * -----------------------------------------------------------------------------
 * CORREÇÃO IMPORTANTE — A TAG DE CACHE DO ARTIGO NÃO ESTAVA LIGADA
 * -----------------------------------------------------------------------------
 * A versão anterior não passava `tags` para o `unstable_cache`. Como o
 * `/api/revalidate` invalida por `article:{slug}`, o efeito era um bug MUDO: a
 * invalidação respondia "ok", contava a tag no log, e a página continuava
 * servindo a versão antiga por até uma hora. Ninguém percebe um cache que não
 * limpa — só se percebe a correção que "demorou a entrar no ar".
 *
 * A tag depende do ARGUMENTO, e `unstable_cache` recebe `tags` como valor
 * estático. A solução é criar a função cacheada por slug (o `slug` também entra
 * na chave), que é o padrão recomendado para este caso.
 * -----------------------------------------------------------------------------
 *
 * PREÇO DE AFILIADO E COMENTÁRIOS DENTRO DE UM CACHE DE 1 HORA (ADR 0013):
 *
 * As ofertas vêm no mesmo `include` do artigo, e os comentários são lidos no
 * render da página. Os dois mudam mais rápido do que uma hora — e mesmo assim
 * NÃO encurtamos o cache. O caminho de atualização é o mesmo que o projeto já
 * usa para score: INVALIDAÇÃO POR EVENTO. Editor mexeu no preço, moderação
 * aprovou um comentário → a tag deste artigo é invalidada e a página é
 * regenerada na hora.
 *
 * A alternativa (baixar o `revalidate` para 5 minutos) custaria 12 regenerações
 * por hora em TODOS os artigos do site, o dia inteiro, para atualizar preço em
 * um punhado deles — e ainda assim exibiria preço de até 5 minutos atrás.
 *
 * A rede de segurança que torna isso seguro não é o cache: é a regra de que
 * preço com mais de 24h simplesmente NÃO é exibido (core/monetization.ts).
 * Mesmo que toda a invalidação falhe, o site nunca mostra um número em que ele
 * próprio não confia.
 */
function articleQuery(slug: string) {
  return unstable_cache(
    articleLoader,
    ['article-by-slug', slug],
    { revalidate: 3600, tags: [CACHE_TAGS.article(slug)] },
  )(slug);
}

const articleLoader = async (slug: string) => {
  {
    const article = await requiredQuery('article:by-slug', () =>
      prisma.article.findFirst({
        where: { slug, status: 'published' },
        include: {
          ...ARTICLE_INCLUDE,
          liveUpdates: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      }),
    );
    if (!article) return null;

    return {
      article: mapArticle(article),
      liveUpdates: article.liveUpdates,
      format: article.format as ContentFormat,
      isLive: article.isLive,
      hasSpoiler: article.hasSpoiler,
      // Coluna `Json` desde a migração para o MySQL: normalizamos AQUI, no
      // servidor, para que a página do artigo continue recebendo `string[]` e
      // possa fazer `.length` e `.map` sem checagem defensiva na view.
      tldr: toStringArray(article.tldr),
      reviewData: article.reviewData,
      scoreDelta1h: article.scoreDelta1h,
    };
  }
};

export const getArticleBySlug = withDateRevival(articleQuery);

/**
 * Comentários APROVADOS de um artigo.
 *
 * NÃO usa `unstable_cache`: a consulta roda durante a renderização da página,
 * cujo HTML já está no cache de 1 hora e é invalidado por evento quando a
 * moderação aprova ou remove algo. Uma segunda camada de cache aqui só
 * acrescentaria um lugar a mais para esquecer de invalidar.
 *
 * O limite de 100 é uma trava de página: com mais que isso, o HTML fica pesado
 * e a rolagem infinita passa a fazer sentido — que é outra funcionalidade, e
 * não um efeito colateral de um `take` esquecido.
 */
export async function getArticleComments(articleId: string) {
  const rows = await safeQuery(
    'article:comments',
    () =>
      prisma.comment.findMany({
        where: { articleId, status: 'approved' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          content: true,
          createdAt: true,
          status: true,
          authorName: true,
          authorAccount: {
            select: { id: true, displayName: true, avatarUrl: true, provider: true },
          },
        },
      }),
    [],
  );

  // O mapper é a fronteira que impede `ipHash`, `emailHash` e nota de moderação
  // de vazarem para o HTML por causa de um `select` generoso.
  return rows.map(mapComment);
}

/**
 * Relacionadas: principal alavanca de páginas por sessão.
 *
 * A ORDEM NÃO É MAIS CRONOLÓGICA. Antes, o bloco mostrava as 4 matérias mais
 * recentes que dividissem qualquer franquia com o artigo aberto — o que fazia
 * todos os artigos de uma franquia movimentada exibirem as MESMAS relacionadas,
 * e nunca conectava dois conteúdos parecidos de franquias diferentes.
 *
 * Agora o pool é pontuado por `rankRecommendations` (packages/core), que combina
 * franquia, sub-categoria, categoria e recência. Os pesos e o comportamento
 * esperado estão fixados por teste lá — este arquivo cuida só de montar o pool
 * e traduzir o resultado em cards.
 */
const getRelatedArticlesCached = unstable_cache(
  async (seed: {
    id: string;
    franchiseSlugs: string[];
    categorySlug: string;
    subcategorySlug: string | null;
  }) => {
    /**
     * O POOL DE CANDIDATOS VEM DE DUAS CONSULTAS, E NÃO DE UM `OR` ÚNICO.
     *
     * A razão é o `take`. Com um `OR` só, o banco devolveria os N mais recentes
     * entre "mesma franquia OU mesma editoria" — e, como a editoria tem ordens
     * de grandeza mais artigos que a franquia, o corte por data comeria
     * justamente os da franquia (o sinal FORTE) sempre que ela estivesse quieta
     * há algumas semanas. O resultado seria o defeito que esta função existe
     * para corrigir, só que mais caro.
     *
     * Separando, cada sinal tem cota própria: os da franquia entram no pool
     * mesmo antigos, e a pontuação decide o resto.
     */
    const [byFranchise, byTaxonomy] = await safeQuery(
      'article:related',
      () =>
        Promise.all([
          seed.franchiseSlugs.length > 0
            ? prisma.article.findMany({
                where: {
                  status: 'published',
                  id: { not: seed.id },
                  franchises: { some: { franchise: { slug: { in: seed.franchiseSlugs } } } },
                },
                select: CARD_SELECT,
                orderBy: { publishedAt: 'desc' },
                take: 30,
              })
            : Promise.resolve([] as CardRow[]),
          prisma.article.findMany({
            where: {
              status: 'published',
              id: { not: seed.id },
              // A sub-categoria entra por slug junto da categoria: é o mesmo
              // filtro por chave estrangeira usado nas páginas de seção.
              OR: [
                { category: { slug: seed.categorySlug } },
                ...(seed.subcategorySlug
                  ? [{ subcategory: { slug: seed.subcategorySlug } }]
                  : []),
              ],
            },
            select: CARD_SELECT,
            orderBy: { publishedAt: 'desc' },
            take: 30,
          }),
        ]),
      [[], []] as [CardRow[], CardRow[]],
    );

    // Deduplicação por id: um artigo da mesma franquia E da mesma editoria
    // aparece nas duas listas, e contá-lo duas vezes distorceria o ranking.
    const pool = new Map<string, CardRow>();
    for (const row of [...byFranchise, ...byTaxonomy]) pool.set(row.id, row);

    const now = new Date();

    const ranked = rankRecommendations(
      {
        id: seed.id,
        franchiseSlugs: seed.franchiseSlugs,
        categoryKey: seed.categorySlug,
        subcategoryKey: seed.subcategorySlug,
        // A data do artigo ABERTO não entra na conta: o desconto por idade se
        // aplica ao candidato, não a quem está sendo lido. Ler uma matéria
        // antiga não deve piorar a qualidade das relacionadas dela.
        publishedAt: null,
      },
      [...pool.values()].map((row) => ({
        id: row.id,
        franchiseSlugs: row.franchises.map((f) => f.franchise.slug),
        categoryKey: row.category.slug,
        subcategoryKey: row.subcategory?.slug ?? null,
        publishedAt: row.publishedAt,
        row,
      })),
      now,
      4,
    );

    return ranked.map((entry) => toCardData(entry.item.row));
  },
  ['related-articles'],
  { revalidate: 3600 },
);
export const getRelatedArticles = withDateRevival(getRelatedArticlesCached);

// =============================================================================
// BUSCA
// =============================================================================

/**
 * Tamanho máximo do termo aceito.
 *
 * Corta antes de qualquer processamento: um termo de 10 KB não encontra nada de
 * útil e só serve para fazer o banco trabalhar à toa, repetidamente, de graça.
 */
const SEARCH_MAX_LENGTH = 80;

/**
 * Mínimo de 2 caracteres. Com 1, praticamente todo o acervo casa e o resultado
 * não ajuda ninguém — além de ser a consulta mais cara possível.
 */
const SEARCH_MIN_LENGTH = 2;

export interface SearchResults {
  /** Termo já normalizado — é ele que a página exibe de volta ao leitor. */
  term: string;
  articles: ContentCardData[];
  franchises: { slug: string; name: string; logoUrl: string | null }[];
  categories: { slug: string; name: string; description: string }[];
}

/** Normaliza e valida o termo. Devolve `null` quando não vale consultar. */
export function normalizeSearchTerm(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  // `\s+` colapsado: "zelda    breath" e "zelda breath" são a mesma busca, e
  // manter as duas formas geraria entradas de log e métricas distintas.
  const term = input.trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX_LENGTH);
  return term.length >= SEARCH_MIN_LENGTH ? term : null;
}

/**
 * Teto de termos por busca. Cada token vira TRÊS `MATCH ... AGAINST` na consulta
 * (um por campo do `ORDER BY`), então o custo cresce em múltiplos do que o
 * visitante digitar. Sem teto, `SEARCH_MAX_LENGTH` (80 caracteres) permitiria
 * uns 20 tokens = 60 avaliações de full-text por requisição, de graça, por
 * qualquer um. Seis cobre com folga qualquer busca humana real.
 */
const MAX_SEARCH_TOKENS = 6;

/**
 * ⚠ DECISÃO DE PRODUTO PENDENTE DE CONFIRMAÇÃO DO DONO DO SITE — leia antes de
 * mexer, e não troque este valor sem registrar a decisão.
 *
 * Define se uma busca de duas palavras exige TODAS elas ou qualquer uma.
 *
 *   `true`  → "zelda breath" vira `+zelda* +breath*`: exige as DUAS (E lógico).
 *   `false` → "zelda breath" vira `zelda* breath*`: basta UMA (OU lógico), que
 *             é o padrão do modo booleano do MySQL.
 *
 * ESTÁ EM `true` PORQUE ISSO PRESERVA O COMPORTAMENTO ATUAL DO SITE. No
 * Postgres, `websearch_to_tsquery('portuguese', 'zelda breath')` produz
 * `zelda & breath` — ou seja, a busca de hoje já é E. A primeira versão desta
 * migração usou o padrão do MySQL e teria trocado E por OU **em silêncio**, que
 * é exatamente o tipo de mudança que o objetivo declarado da migração ("não se
 * distanciar do que existe") manda evitar.
 *
 * O CUSTO DE MANTER `true`, dito com honestidade: com E, buscas de duas ou mais
 * palavras devolvem vazio com mais frequência num acervo pequeno — e o fallback
 * `LIKE` não socorre, porque ele procura a frase inteira literalmente. Se a
 * redação achar que a busca ficou "seca demais", trocar para `false` é uma
 * linha. O que não se deve fazer é trocar sem decidir.
 */
const SEARCH_REQUIRES_ALL_TERMS = true;

/**
 * Converte o termo humano em expressão do modo BOOLEANO do MySQL/MariaDB.
 *
 * POR QUE ESTA FUNÇÃO EXISTE — é o substituto direto do `websearch_to_tsquery`.
 * O motivo é o mesmo que estava documentado na versão Postgres: no modo
 * booleano, `+ - > < ( ) ~ * " @` são OPERADORES. Um `@` digitado por engano
 * vira erro de sintaxe, e um erro de sintaxe numa busca vira 500 para o leitor.
 * Removemos os operadores para que qualquer coisa que um humano digite continue
 * sendo uma busca válida — exatamente a garantia que tínhamos antes.
 *
 * ATENÇÃO: isto NÃO é proteção contra injeção de SQL. Essa proteção continua
 * sendo a parametrização do `$queryRaw` (o valor vai como parâmetro ligado,
 * jamais concatenado). Confundir as duas coisas levaria alguém a "otimizar"
 * removendo a parametrização por achar que a sanitização já basta.
 *
 * O sufixo `*` é o que recupera parte do stemming que o Postgres nos dava de
 * graça: "jogo*" casa jogo, jogos, jogador. Não é equivalente a radicalização
 * (não liga "correu" a "correr"), e só funciona na direção do PREFIXO — quem
 * busca "jogos" continua não achando "jogo". Cobre, ainda assim, o caso
 * dominante do português, que é plural e sufixo de derivação.
 *
 * OS TRÊS FILTROS APLICADOS A CADA TOKEN, e por que cada um existe:
 *
 *   1. `length >= 3` — o índice do InnoDB não contém tokens menores
 *      (`innodb_ft_min_token_size` = 3, imutável em hospedagem compartilhada;
 *      confirmado no servidor). Mantê-los não acharia nada e, com o E lógico,
 *      zeraria a busca inteira. O fallback `LIKE` é quem cobre esse caso.
 *
 *   2. TEM QUE CONTER LETRA OU DÍGITO — um token só de pontuação ("...", "###")
 *      não casa com nada no índice, porque o tokenizador do InnoDB quebra
 *      justamente na pontuação. Com o E lógico isso é pior do que inútil: um
 *      `+###*` impossível de satisfazer zeraria uma busca que de outro modo
 *      funcionaria. `\p{L}` e `\p{N}` (com a flag `u`) e não `[a-z0-9]`, senão
 *      "ação" e "coração" seriam tratados como pontuação.
 *
 *   3. NO MÁXIMO `MAX_SEARCH_TOKENS` — teto de custo, ver a constante.
 */
export function toBooleanFtsQuery(term: string): string | null {
  const tokens = term
    .replace(/[+\-><()~*"@]/g, ' ') // operadores do modo booleano
    .split(/\s+/)
    .filter((t) => t.length >= 3 && /[\p{L}\p{N}]/u.test(t))
    .slice(0, MAX_SEARCH_TOKENS);

  if (tokens.length === 0) return null; // sinaliza "vá direto para o fallback"

  const prefixo = SEARCH_REQUIRES_ALL_TERMS ? '+' : '';
  return tokens.map((t) => `${prefixo}${t}*`).join(' ');
}

/**
 * Escapa os curingas de `LIKE` (`%` e `_`) e a própria barra de escape.
 *
 * POR QUE ISTO É NECESSÁRIO — o Prisma NÃO escapa curingas em `contains`. Ele
 * parametriza o valor (o que impede injeção de SQL, e essa parte está correta),
 * mas o valor parametrizado ainda é interpretado como PADRÃO de `LIKE`. Logo,
 * um `%` digitado pelo visitante deixa de ser a letra "por cento" e vira "case
 * qualquer coisa".
 *
 * O problema não é vazamento de dado — o `where` já restringe a `published` e as
 * colunas selecionadas são as mesmas. O problema é CUSTO: um termo como
 * `%a%a%a%a%a%` vira um padrão com múltiplos curingas que o MySQL avalia com
 * retrocesso, sobre a tabela inteira, sem usar índice nenhum. É barato de
 * enviar, caro de responder e repetível à vontade — o formato clássico de
 * negação de serviço por consulta.
 *
 * A ordem do `replace` importa: a barra invertida vem PRIMEIRO na classe de
 * caracteres, senão escaparíamos `%` para `\%` e, na sequência, a barra recém
 * criada de novo, produzindo `\\%` — que casa uma barra literal seguida de
 * curinga, exatamente o que queríamos evitar. Uma passada só, com os três
 * caracteres na mesma classe, não tem esse problema.
 *
 * `\` funciona como escape porque é o caractere de escape padrão do `LIKE` no
 * MySQL/MariaDB. Como o termo viaja parametrizado, ele não é reinterpretado
 * como escape de string no caminho — só o `LIKE` o enxerga.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Busca artigos, franquias e editorias.
 *
 * -----------------------------------------------------------------------------
 * POR QUE NÃO PASSA POR `unstable_cache`
 * -----------------------------------------------------------------------------
 * O espaço de chaves é o conjunto de tudo que um humano pode digitar. Cachear
 * por termo encheria o armazenamento de cache com entradas de uso único (e com
 * o que bots digitarem), para acertar quase nada — o oposto do que o cache da
 * home faz, onde uma chave serve a todo mundo. A página de busca é dinâmica
 * por natureza; o custo é uma consulta indexada.
 *
 * -----------------------------------------------------------------------------
 * DOIS MOTORES, DE PROPÓSITO
 * -----------------------------------------------------------------------------
 * ARTIGO usa FULL-TEXT (`FULLTEXT` do InnoDB — os quatro índices são criados por
 * `npm run db:fulltext`, ver packages/db/prisma/migrations-manual/): o corpo é
 * grande e o acervo cresce todo dia, então varredura com `LIKE` não serve.
 *
 * FRANQUIA e EDITORIA usam `contains` (`LIKE '%termo%'`): são dezenas de linhas,
 * com um nome curto cada. Montar índice de texto para isso seria infraestrutura
 * para um problema que não existe — e `LIKE '%termo%'` ainda casa PEDAÇO de
 * palavra ("zel" acha "Zelda"), que é justamente o comportamento desejado num
 * campo que funciona como atalho de navegação.
 *
 * -----------------------------------------------------------------------------
 * O QUE MUDOU NA SAÍDA DO POSTGRES, e o que foi feito a respeito
 * -----------------------------------------------------------------------------
 * Antes: `tsvector` com dicionário de português, `setweight(A/B/C)`, `ts_rank` e
 * índice GIN. O MariaDB não tem nada disso. As três perdas e as respostas:
 *
 *   1. STEMMING. O Postgres ligava "jogos" a "jogo" pelo radical. O MariaDB não
 *      radicaliza em língua nenhuma. Resposta: modo BOOLEANO com sufixo `*`
 *      (`jogo*`), que recupera o caso dominante — plural e derivação por sufixo.
 *      NÃO é equivalente, e a diferença é assimétrica: "jogo" acha "jogos", mas
 *      "jogos" não acha "jogo". É uma regressão aceita conscientemente.
 *
 *   2. PESO POR CAMPO. Sem `setweight`, o peso é emulado somando três `MATCH`
 *      separados na proporção 5 : 2 : 1 — os pesos padrão do `ts_rank`
 *      (1.0 : 0.4 : 0.2) normalizados. Preserva a intenção original: "Zelda" no
 *      TÍTULO vence "Zelda" citado de passagem no meio de um texto sobre outra
 *      coisa. Como as pontuações de `MATCH` não são normalizadas, esses pesos
 *      são calibráveis — se título passar a perder para corpo, mexa AQUI.
 *
 *   3. TERMOS DE 2 LETRAS. "IA", "PS", "3D" não entram no índice do InnoDB
 *      (`innodb_ft_min_token_size` = 3, imutável em hospedagem compartilhada).
 *      Resposta: o fallback `LIKE` mais abaixo. Para um portal que cobre IA,
 *      isso não é detalhe.
 *
 * E UM GANHO REAL: "lancamento" passa a achar "lançamento" — uma limitação que o
 * Postgres tinha e que era documentada como conhecida e aceita. Quem dá isso é a
 * collation, `utf8mb4_unicode_ci`, conferida coluna a coluna em
 * `information_schema.COLUMNS` (o plano supunha `utf8mb4_uca1400_ai_ci`, que não
 * é a que está no servidor) e validada por comportamento: `'lancamento' =
 * 'lançamento'` e `'Zelda' = 'zelda'` são ambos verdadeiros.
 * É também por isso que não existe mais `mode: 'insensitive'` nas duas consultas
 * abaixo: além de a opção não existir no conector MySQL, ela ficou redundante.
 * ⚠ Essas duas propriedades vêm da COLLATION, não deste código. Trocar a
 * collation do banco para uma `_as_` quebraria a busca por acento sem alterar
 * uma linha daqui.
 *
 * SEGURANÇA (A03 — Injeção): o termo entra por `$queryRaw` TEMPLATE TAG, que o
 * Prisma envia como parâmetro ligado (`?`), nunca por concatenação — inclusive
 * as quatro ocorrências no `ORDER BY`. O `toBooleanFtsQuery` que roda antes NÃO
 * é a defesa contra injeção (ver o comentário dele): é a defesa contra ERRO DE
 * SINTAXE do parser de full-text, exatamente o papel que o `websearch_to_tsquery`
 * cumpria no Postgres.
 */
export async function searchContent(rawTerm: unknown): Promise<SearchResults | null> {
  const term = normalizeSearchTerm(rawTerm);
  if (!term) return null;

  // `null` aqui significa "sobrou nenhum token utilizável" (ex.: o leitor digitou
  // "IA", ou só pontuação). Nesse caso nem chamamos o full-text: ele devolveria
  // vazio de qualquer forma, e a consulta seria puro desperdício. Vamos direto ao
  // fallback, que é justamente quem cobre esse caso.
  const ftsQuery = toBooleanFtsQuery(term);

  // O termo escapado, para todo `contains` desta função. Ver `escapeLikePattern`:
  // sem isto, um `%` digitado pelo visitante é interpretado como CURINGA, não
  // como o caractere "por cento".
  const termoLike = escapeLikePattern(term);

  // ---------------------------------------------------------------------------
  // ETAPA 1a — FULL-TEXT, com tratamento de erro PRÓPRIO
  // ---------------------------------------------------------------------------
  //
  // POR QUE ESTA CONSULTA NÃO ESTÁ NO `safeQuery` DAS OUTRAS DUAS: porque
  // "o full-text não achou nada" e "o full-text QUEBROU" são coisas diferentes, e
  // colapsá-las num `safeQuery` genérico faz o segundo caso virar o primeiro —
  // silenciosamente.
  //
  // O cenário concreto: alguém roda `prisma db push` e esquece o
  // `npm run db:fulltext`. Os índices somem (o `db push` os derruba, ele não os
  // conhece). A partir daí, TODA busca do site vira um erro de SQL, que o
  // `safeQuery` engole e converte em lista vazia, que dispara o fallback `LIKE`
  // em TODA busca. O site não quebra — ele só fica pior, mais lento e mais caro,
  // por tempo indeterminado, sem ninguém receber sinal nenhum. Um índice de busca
  // desaparecido tem que gritar.
  let ftsHits: { id: string }[] = [];
  let ftsFalhou = false;

  if (ftsQuery !== null) {
    try {
      ftsHits = await prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id
        FROM \`Article\` a
        WHERE a.\`status\` = 'published'
          AND MATCH(a.\`title\`, a.\`excerpt\`, a.\`content\`)
              AGAINST (${ftsQuery} IN BOOLEAN MODE)
        ORDER BY
          ( 5.0 * MATCH(a.\`title\`)   AGAINST (${ftsQuery} IN BOOLEAN MODE)
          + 2.0 * MATCH(a.\`excerpt\`) AGAINST (${ftsQuery} IN BOOLEAN MODE)
          + 1.0 * MATCH(a.\`content\`) AGAINST (${ftsQuery} IN BOOLEAN MODE)
          ) DESC,
          a.\`publishedAt\` DESC
        LIMIT 24
      `;
    } catch (error) {
      ftsFalhou = true;

      // O MySQL responde 1191 (`ER_FT_MATCHING_KEY_NOT_FOUND`) quando não existe
      // índice FULLTEXT para a lista de colunas do `MATCH`. É o sintoma exato do
      // `db:fulltext` esquecido, e é ACIONÁVEL — por isso tem mensagem própria,
      // dizendo o comando que resolve, em vez de um "erro na busca" genérico que
      // mandaria alguém depurar SQL.
      const mensagem = error instanceof Error ? error.message : String(error);
      const indiceAusente = mensagem.includes('1191') || /fulltext/i.test(mensagem);

      if (indiceAusente) {
        console.error(
          '[busca] CRÍTICO: índice FULLTEXT ausente na tabela Article. ' +
            'A busca do site está degradada para o fallback LIKE em TODAS as ' +
            'consultas. Rode `npm run db:fulltext` para restaurar.',
          mensagem,
        );
      } else {
        console.error('[busca] falha no full-text; caindo para o fallback LIKE.', mensagem);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ETAPA 1b — atalhos de navegação (franquia e editoria)
  // ---------------------------------------------------------------------------
  // Estes continuam no `safeQuery` de sempre: são listagens auxiliares, e falhar
  // nelas é motivo legítimo para simplesmente não mostrar os chips.
  const [franchises, categories] = await safeQuery(
    'search:shortcuts',
    () =>
      Promise.all([
        prisma.franchise.findMany({
          where: { name: { contains: termoLike } },
          select: { slug: true, name: true, logoUrl: true },
          orderBy: { followerCount: 'desc' },
          take: 6,
        }),
        prisma.category.findMany({
          where: { name: { contains: termoLike } },
          select: { slug: true, name: true, description: true },
          orderBy: { monitoringPriority: 'asc' },
          take: 4,
        }),
      ]),
    [[], []] as [SearchResults['franchises'], SearchResults['categories']],
  );

  // ---------------------------------------------------------------------------
  // ETAPA 1c — REDE DE SEGURANÇA (`LIKE`)
  // ---------------------------------------------------------------------------
  // Roda SÓ quando o full-text não trouxe nada — custo zero no caminho feliz.
  // Cobre os dois buracos conhecidos do FULLTEXT do InnoDB:
  //   1. termos com menos de 3 caracteres ("IA", "PS"), que não estão no índice;
  //   2. buscas por pedaço de palavra no MEIO ("elda" achando "Zelda"), que o
  //      prefixo `termo*` não alcança.
  // E, agora explicitamente, o terceiro caso: o full-text ter FALHADO. Aí ele é
  // resposta de emergência, não complemento — e o log da etapa 1a já registrou.
  //
  // Só título e resumo: varrer `content` (MEDIUMTEXT) sem índice é justamente o
  // que não pode. A ordem é só por data — `LIKE` não produz relevância nenhuma,
  // e fingir que produz seria pior do que assumir que não há.
  //
  // ⚠ `termoLike`, e nunca `term` cru: é `%` e `_` escapados. Esta é a consulta
  // mais cara da função e a única sem índice — é exatamente onde um curinga
  // injetado pelo visitante faria mais estrago. Ver `escapeLikePattern`.
  const precisaDeFallback = ftsHits.length === 0;

  const articleHits = precisaDeFallback
    ? await safeQuery(
        ftsFalhou ? 'search:articles-fallback-apos-falha' : 'search:articles-fallback',
        () =>
          prisma.article.findMany({
            where: {
              status: 'published',
              OR: [{ title: { contains: termoLike } }, { excerpt: { contains: termoLike } }],
            },
            select: { id: true },
            orderBy: { publishedAt: 'desc' },
            take: 24,
          }),
        [] as { id: string }[],
      )
    : ftsHits;

  // Segunda etapa: os cards vêm do `CARD_SELECT` de sempre.
  //
  // Poderíamos ter trazido todas as colunas já no SQL cru, mas aí o contrato de
  // apresentação existiria em dois lugares — e o dia em que alguém acrescentar
  // um campo ao card, a busca seria a única listagem do site a não exibi-lo.
  const ids = articleHits.map((hit) => hit.id);

  const rows =
    ids.length > 0
      ? await safeQuery(
          'search:articles',
          () => prisma.article.findMany({ where: { id: { in: ids } }, select: CARD_SELECT }),
          [] as CardRow[],
        )
      : [];

  // `findMany` com `in` NÃO preserva a ordem dos ids — e a ordem é o resultado
  // do ranking, ou seja, a parte que importa. Reordenamos pela posição original.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const articles = ids
    .map((id) => byId.get(id))
    .filter((row): row is CardRow => row !== undefined)
    .map(toCardData);

  return { term, articles, franchises, categories };
}

/** Chips "Seus universos" da home. */
const getTopFranchisesCached = unstable_cache(
  async () => {
    return safeQuery(
      'top-franchises',
      () =>
        prisma.franchise.findMany({
          orderBy: { followerCount: 'desc' },
          take: 8,
          select: { slug: true, name: true, followerCount: true, logoUrl: true },
        }),
      [],
    );
  },
  ['top-franchises'],
  { revalidate: 3600 },
);
export const getTopFranchises = withDateRevival(getTopFranchisesCached);

/** Slugs publicados, para o sitemap. */
export async function getAllPublishedSlugs() {
  return safeQuery(
    'sitemap:slugs',
    () =>
      prisma.article.findMany({
        where: { status: 'published' },
        select: {
          slug: true,
          updatedAt: true,
          publishedAt: true,
          category: { select: { slug: true } },
        },
        orderBy: { publishedAt: 'desc' },
      }),
    [],
  );
}
