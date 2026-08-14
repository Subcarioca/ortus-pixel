/**
 * =============================================================================
 * ROTAS — fonte única da verdade das URLs do site
 * =============================================================================
 *
 * DECISÃO PENDENTE DE VALIDAÇÃO — CONFLITO ENTRE BRIEFING E DESIGN:
 *
 * O briefing do produto especifica URLs no formato:
 *     /categoria/games            /franquia/star-wars
 *
 * O protótipo de design (design/README.md, seção 1) propõe:
 *     /games                      /f/gta-6
 *
 * As duas opções são defensáveis:
 *
 *   /categoria/games  → PRÓS: namespace explícito, zero risco de colisão com
 *                       slug de artigo ou rota futura (/sobre, /newsletter);
 *                       trivial de rotear.
 *                       CONTRAS: URL mais longa; dilui um pouco a relevância
 *                       do termo por afastá-lo da raiz.
 *
 *   /games            → PRÓS: mais curta, o termo fica junto à raiz (leve
 *                       vantagem de SEO), e é o padrão adotado por Verge,
 *                       Polygon e IGN.
 *                       CONTRAS: exige lista de rotas reservadas para sempre;
 *                       o dia em que alguém criar a franquia "tech" nasce um
 *                       conflito de rota.
 *
 * COMO ISTO FOI RESOLVIDO SEM TRAVAR O PROJETO: as URLs canônicas ficam
 * centralizadas neste arquivo, e o `next.config.ts` publica redirecionamentos
 * 301 do formato alternativo para o canônico. Consequências:
 *   1. Trocar a decisão é mudar as constantes daqui e inverter os redirects.
 *   2. Nenhum link interno quebra, porque nenhum componente escreve URL na mão.
 *   3. Os dois formatos funcionam desde o dia 1; só um é canônico.
 *
 * O padrão adotado por ora é o do BRIEFING, por ser requisito escrito do
 * cliente. Isto precisa de confirmação explícita antes do lançamento —
 * DEPOIS de indexado, mudar URL custa autoridade e exige cadeia de redirects.
 */

/** Prefixos canônicos. Mudar aqui muda o site inteiro, de forma consistente. */
export const ROUTE_PREFIXES = {
  category: '/categoria',
  franchise: '/franquia',
  trending: '/em-alta',
  event: '/evento',
  author: '/autor',
} as const;

/** Prefixos alternativos, mantidos vivos via redirecionamento 301. */
export const LEGACY_PREFIXES = {
  franchise: '/f',
  trending: '/trending',
} as const;

export const routes = {
  home: () => '/',

  category: (slug: string) => `${ROUTE_PREFIXES.category}/${slug}`,

  /**
   * O design prevê sub-abas por formato como FILTRO, não como nova hierarquia
   * de URL: "evita canibalização de SEO e árvore de navegação confusa".
   * Por isso usamos query string, e não /games/trailers — assim existe uma
   * única URL indexável por categoria.
   */
  categoryFiltered: (slug: string, filter?: string) =>
    filter ? `${ROUTE_PREFIXES.category}/${slug}?formato=${encodeURIComponent(filter)}` : `${ROUTE_PREFIXES.category}/${slug}`,

  /**
   * Sub-categoria: /categoria/tech/hardware.
   *
   * Aqui o segmento REAL de URL é intencional, ao contrário das sub-abas por
   * formato (que são query string). A diferença de tratamento tem uma razão:
   *
   *   FORMATO (trailers, análises) → é um FILTRO sobre o mesmo acervo. Uma URL
   *     indexável por filtro criaria N páginas quase idênticas competindo entre
   *     si pela mesma consulta.
   *   SUB-CATEGORIA (hardware)     → é um ACERVO PRÓPRIO, com intenção de busca
   *     distinta ("melhor placa de vídeo custo-benefício" não é a mesma
   *     consulta de "notícias de tecnologia"). Merece URL própria, título
   *     próprio e link no menu.
   */
  subcategory: (categorySlug: string, subSlug: string) =>
    `${ROUTE_PREFIXES.category}/${categorySlug}/${subSlug}`,

  franchise: (slug: string) => `${ROUTE_PREFIXES.franchise}/${slug}`,

  /** Artigo: /{categoria}/{slug}, conforme o design. */
  article: (categorySlug: string, articleSlug: string) => `/${categorySlug}/${articleSlug}`,

  trending: () => ROUTE_PREFIXES.trending,

  /**
   * Busca. O parâmetro se chama `q` por convenção universal — é o que as
   * pessoas esperam ao colar uma URL de busca, e o que o `SearchAction` do
   * schema.org descreve para os buscadores.
   */
  search: (term?: string) => (term ? `/busca?q=${encodeURIComponent(term)}` : '/busca'),

  /**
   * Área do LEITOR. Deliberadamente fora de `/admin`: são dois públicos
   * distintos (redação e leitor) com autenticações distintas, e nada na
   * navegação deve sugerir que existe passagem de um para o outro.
   */
  account: () => '/minha-conta',

  methodology: () => '/metodologia',

  newsletter: () => '/newsletter',
  newsroom: () => '/redacao',
  author: (slug: string) => `${ROUTE_PREFIXES.author}/${slug}`,
  event: (slug: string) => `${ROUTE_PREFIXES.event}/${slug}`,

  // --- Painel editorial ---
  admin: () => '/admin',
  adminTopic: (id: string) => `/admin/topicos/${id}`,
  adminArticles: () => '/admin/materias',
  /** Audiência: visualizações e cliques. O RECORTE por autoria é da tela. */
  adminAnalytics: () => '/admin/analytics',
  adminAccuracy: () => '/admin/precisao',
  adminAffiliates: () => '/admin/afiliados',
  adminComments: () => '/admin/comentarios',
  /** Gestão de contas da redação. Só administrador. */
  adminAccounts: () => '/admin/contas',

  // --- APIs públicas ---
  apiTrending: () => '/api/trending',
  apiNewsletterSubscribe: () => '/api/newsletter/subscribe',
  apiNewsletterConfirm: (token: string) =>
    `/api/newsletter/confirm?token=${encodeURIComponent(token)}`,
  apiPushSubscribe: () => '/api/push/subscribe',
} as const;

/**
 * Rotas reservadas — não podem virar slug de categoria nem de franquia.
 *
 * Esta lista é a prevenção de um bug que só apareceria em produção: um editor
 * cria a franquia "newsletter", o slug vira /franquia/newsletter (ok hoje), mas
 * no dia em que migrarmos para URLs curtas o /newsletter passaria a resolver
 * para a franquia e derrubaria a landing de captação. Validar desde já custa
 * nada e evita a dor.
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'em-alta',
  'trending',
  'newsletter',
  'redacao',
  'metodologia',
  'sobre',
  'contato',
  'busca',
  'search',
  // Área do leitor logado. Sem esta linha, uma franquia com slug "minha-conta"
  // sequestraria a página de conta no dia em que as URLs curtas entrarem.
  'minha-conta',
  'sitemap',
  'sitemap.xml',
  'robots.txt',
  // Rotas novas da camada de monetização e comentários. `ads.txt` é servido por
  // uma rota do Next (apps/web/src/app/ads.txt/route.ts) e uma franquia com
  // esse slug derrubaria a verificação de vendedores autorizados.
  'ads.txt',
  'politica-de-afiliados',
  'auth',
  'comentarios',
  'feed',
  'rss',
  'autor',
  'evento',
  'categoria',
  'franquia',
  'f',
  '_next',
  'static',
  'assets',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * Monta a URL absoluta. Necessária para canonical, Open Graph, sitemap e
 * schema.org — todos exigem URL completa, não relativa.
 *
 * SEGURANÇA: a base vem de variável de ambiente e nunca do cabeçalho `Host` da
 * requisição. Confiar no `Host` abre caminho para *host header injection*: o
 * atacante envia `Host: evil.com`, e nosso e-mail de confirmação de newsletter
 * sai com um link para o domínio dele — transformando nosso sistema em
 * ferramenta de phishing com nosso próprio remetente.
 */
export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
