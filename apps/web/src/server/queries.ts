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
  TREND_UP_DELTA,
  trendForDelta,
  type ContentCardData,
  type ContentFormat,
  type ScoreBand,
} from '@subcarioca/core';
import { ARTICLE_INCLUDE, mapArticle, mapComment, prisma } from '@subcarioca/db';

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
  tldr: string[];
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
    tldr: row.tldr,
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
      // A mais recente, e só ela: serve ao terceiro degrau do hero ("Última
      // publicada"). Consulta própria porque num acervo grande a matéria mais
      // nova pode estar fora dos 40 maiores scores — justamente por ser nova.
      safeQuery(
        'home:newest',
        () =>
          prisma.article.findMany({
            where: { status: 'published', publishedAt: { not: null } },
            select: CARD_SELECT,
            orderBy: { publishedAt: 'desc' },
            take: 1,
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

    return { hero, heroKind, trending, feed, evergreen };
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

const getCategoryPageCached = unstable_cache(
  async (slug: string) => {
    const category = await safeQuery(
      'category:lookup',
      () => prisma.category.findUnique({ where: { slug } }),
      null,
    );
    if (!category) return null;

    const data = await safeQuery(
      'category:data',
      async () => {
        const [articles, trendingInCategory, upcomingReleases] = await Promise.all([
          prisma.article.findMany({
            where: { status: 'published', categoryId: category.id },
            select: CARD_SELECT,
            // Ordem CRONOLÓGICA: quem entra na categoria quer ver o que saiu hoje.
            orderBy: { publishedAt: 'desc' },
            take: 24,
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

        return { articles, trendingInCategory, upcomingReleases };
      },
      {
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
    };
  },
  ['category-page'],
  { revalidate: 300, tags: [CACHE_TAGS.home] },
);
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
    const subcategory = await safeQuery(
      'subcategory:lookup',
      () =>
        prisma.subcategory.findFirst({
          where: { slug: subSlug, category: { slug: categorySlug } },
          include: { category: { select: { slug: true, name: true, accentColor: true } } },
        }),
      null,
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
    const franchise = await safeQuery(
      'franchise:lookup',
      () =>
        prisma.franchise.findUnique({
          where: { slug },
          include: { primaryCategory: { select: { slug: true, name: true } } },
        }),
      null,
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
    const article = await safeQuery(
      'article:by-slug',
      () =>
        prisma.article.findFirst({
          where: { slug, status: 'published' },
          include: {
            ...ARTICLE_INCLUDE,
            liveUpdates: { orderBy: { createdAt: 'desc' }, take: 50 },
          },
        }),
      null,
    );
    if (!article) return null;

    return {
      article: mapArticle(article),
      liveUpdates: article.liveUpdates,
      format: article.format as ContentFormat,
      isLive: article.isLive,
      hasSpoiler: article.hasSpoiler,
      tldr: article.tldr,
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

/** Relacionadas por franquia: principal alavanca de páginas por sessão. */
const getRelatedArticlesCached = unstable_cache(
  async (articleId: string, franchiseSlugs: string[]) => {
    if (franchiseSlugs.length === 0) return [];

    const articles = await safeQuery(
      'article:related',
      () =>
        prisma.article.findMany({
          where: {
            status: 'published',
            id: { not: articleId },
            franchises: { some: { franchise: { slug: { in: franchiseSlugs } } } },
          },
          select: CARD_SELECT,
          orderBy: { publishedAt: 'desc' },
          take: 4,
        }),
      [],
    );

    return articles.map(toCardData);
  },
  ['related-articles'],
  { revalidate: 3600 },
);
export const getRelatedArticles = withDateRevival(getRelatedArticlesCached);

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
