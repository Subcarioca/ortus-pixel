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
  heatForBand,
  heatLevelForHeat,
  isCategorySlug,
  rankRecommendations,
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
 * Dados da home.
 *
 * DECISÃO: uma única função cacheada devolve hero + trending + feed, em vez de
 * três funções separadas. Motivo: as três listas precisam ser MUTUAMENTE
 * EXCLUSIVAS (o hero não pode reaparecer no feed logo abaixo). Com queries
 * separadas, a exclusão teria de ser feita na página, misturando regra de
 * negócio com renderização — e falharia silenciosamente quando os caches
 * expirassem em momentos diferentes.
 */
const getHomeDataCached = unstable_cache(
  async () => {
    // Buscamos um lote único e particionamos em memória. Para ~40 linhas isso é
    // muito mais barato que três idas ao banco, e garante a exclusividade.
    const articles = await safeQuery(
      'home:articles',
      () =>
        prisma.article.findMany({
          where: { status: 'published', publishedAt: { not: null } },
          select: CARD_SELECT,
          orderBy: [{ currentScore: 'desc' }, { publishedAt: 'desc' }],
          take: 40,
        }),
      [],
    );

    const cards = articles.map(toCardData);

    // Aplica o teto de 3 "quentes" simultâneos (regra do design): página
    // inteira vermelha = nada é urgente.
    const withHeat = applyHeatCap(
      articles.map((a) => ({ ...a, currentBand: a.currentBand as ScoreBand })),
    );

    const adjusted = cards.map((card, index) => ({
      ...card,
      heat: withHeat[index]?.heat ?? card.heat,
    }));

    const hero = adjusted.filter((c) => c.heat === 'hot').slice(0, 3);
    const heroIds = new Set(hero.map((h) => h.id));

    const trending = adjusted
      .filter((c) => !heroIds.has(c.id) && (c.heat === 'hot' || c.heat === 'rise'))
      .slice(0, 6);
    const trendingIds = new Set(trending.map((t) => t.id));

    // O feed é CRONOLÓGICO, não por score. Decisão do design: "a temperatura
    // muda o peso, não a ordem cronológica" — quem rola a home espera ver o que
    // saiu por último.
    const feed = adjusted
      .filter((c) => !heroIds.has(c.id) && !trendingIds.has(c.id) && c.heat !== 'ever')
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .slice(0, 12);

    const evergreen = adjusted.filter((c) => c.heat === 'ever').slice(0, 4);

    return { hero, trending, feed, evergreen };
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

const getTrendingRankingCached = unstable_cache(
  async () => {
    const articles = await safeQuery(
      'trending:articles',
      () =>
        prisma.article.findMany({
          where: { status: 'published', publishedAt: { not: null } },
          select: CARD_SELECT,
          orderBy: { currentScore: 'desc' },
          take: 30,
        }),
      [],
    );

    const cards = articles.map(toCardData);

    const stats = await safeQuery(
      'trending:stats',
      async () => {
        const [hotCount, risingCount, todayCount, lastRun] = await Promise.all([
          prisma.article.count({ where: { status: 'published', currentBand: 'HOT' } }),
          prisma.article.count({ where: { status: 'published', currentBand: 'RISING' } }),
          prisma.article.count({
            where: {
              status: 'published',
              publishedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            },
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
          lastUpdatedAt: lastRun?.finishedAt ?? null,
        };
      },
      { hotCount: 0, risingCount: 0, todayCount: 0, lastUpdatedAt: null as Date | null },
    );

    return {
      // Acima de 60: o que está "pegando".
      ranking: cards.filter((c) => c.score >= 60),
      // Degrau explícito abaixo de 60 (decisão do design).
      belowThreshold: cards.filter((c) => c.score < 60).slice(0, 10),
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
    const category = await requiredQuery('category:lookup', () =>
      prisma.category.findUnique({ where: { slug } }),
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
 * ARTIGO usa FULL-TEXT (`tsvector` + GIN, ver a migração
 * 20260809120000_follows_by_reader_and_article_search): o corpo é grande, o
 * acervo cresce todo dia e o leitor espera que "jogos" encontre "jogo".
 *
 * FRANQUIA e EDITORIA usam `ILIKE`: são dezenas de linhas, com um nome curto
 * cada. Montar `tsvector` para isso seria infraestrutura para um problema que
 * não existe — e `ILIKE '%termo%'` ainda casa PEDAÇO de palavra ("zel" acha
 * "Zelda"), que é justamente o comportamento desejado num campo que funciona
 * como atalho de navegação.
 *
 * SEGURANÇA (A03 — Injeção): o termo entra por `$queryRaw` TEMPLATE TAG, que o
 * Prisma envia como parâmetro ligado ($1), nunca por concatenação. E o parser
 * escolhido é `websearch_to_tsquery`, não `to_tsquery`: o primeiro aceita
 * qualquer texto humano (inclusive aspas soltas, `&`, `!`) sem lançar exceção,
 * enquanto o segundo estoura erro de sintaxe e transformaria um caractere
 * digitado por engano em erro 500.
 */
export async function searchContent(rawTerm: unknown): Promise<SearchResults | null> {
  const term = normalizeSearchTerm(rawTerm);
  if (!term) return null;

  // `safeQuery` (e não `requiredQuery`): busca é LISTAGEM. Se o banco falhar, a
  // página responde "nada encontrado" e o site continua de pé — devolver 500
  // numa busca é pior para o leitor do que devolver vazio.
  const [articleHits, franchises, categories] = await safeQuery(
    'search:all',
    () =>
      Promise.all([
        prisma.$queryRaw<{ id: string }[]>`
          SELECT a."id"
          FROM "Article" a, websearch_to_tsquery('portuguese', ${term}) AS q
          WHERE a."status" = 'published'
            AND a."searchVector" @@ q
          ORDER BY ts_rank(a."searchVector", q) DESC, a."publishedAt" DESC NULLS LAST
          LIMIT 24
        `,
        prisma.franchise.findMany({
          where: { name: { contains: term, mode: 'insensitive' } },
          select: { slug: true, name: true, logoUrl: true },
          orderBy: { followerCount: 'desc' },
          take: 6,
        }),
        prisma.category.findMany({
          where: { name: { contains: term, mode: 'insensitive' } },
          select: { slug: true, name: true, description: true },
          orderBy: { monitoringPriority: 'asc' },
          take: 4,
        }),
      ]),
    [[], [], []] as [{ id: string }[], SearchResults['franchises'], SearchResults['categories']],
  );

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
