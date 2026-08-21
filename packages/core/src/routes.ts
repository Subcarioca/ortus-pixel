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
  /**
   * PAINEL EDITORIAL. Este prefixo não é só o começo de uma URL — é uma
   * FRONTEIRA, e três coisas dependem dela:
   *
   *   1. `robots.txt` bloqueia o prefixo inteiro (nada do painel é indexado);
   *   2. `staff-auth` exige conta da redação em toda página sob ele;
   *   3. o script do AdSense NÃO é carregado abaixo dele (ver `isAdminPath`).
   *
   * Por isso ele vive aqui, com nome, em vez de aparecer como o literal
   * `'/admin'` espalhado por três arquivos que precisam concordar entre si.
   */
  admin: '/admin',
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

  /**
   * Vitrine das 6 editorias — o destino real da aba "Editorias" do menu
   * inferior mobile (ver `bottom-nav.tsx`). Existe porque, antes dela, aquela
   * aba apontava para `/categoria/games` sem avisar ninguém: um leitor que
   * queria "escolher uma editoria" caía direto dentro de Games.
   */
  editorias: () => '/editorias',

  methodology: () => '/metodologia',

  newsletter: () => '/newsletter',
  newsroom: () => '/redacao',
  author: (slug: string) => `${ROUTE_PREFIXES.author}/${slug}`,
  event: (slug: string) => `${ROUTE_PREFIXES.event}/${slug}`,

  // --- Painel editorial ---
  // Todas derivadas de `ROUTE_PREFIXES.admin`: é o que garante que `isAdminPath`
  // reconheça TODA rota do painel, inclusive as que forem criadas depois desta
  // linha. Um literal `'/admin/...'` escrito à mão seria uma rota que continua
  // funcionando, continua protegida por `staff-auth`... e passa a carregar o
  // script do AdSense sem ninguém perceber.
  admin: () => ROUTE_PREFIXES.admin,
  adminTopic: (id: string) => `${ROUTE_PREFIXES.admin}/topicos/${id}`,
  adminArticles: () => `${ROUTE_PREFIXES.admin}/materias`,

  /**
   * PREVIEW DA MATÉRIA — como o leitor a veria, antes de publicar.
   *
   * POR ID, e não pelo par categoria/slug da rota pública. Um rascunho pode ter
   * o slug ainda em branco, repetido ou prestes a mudar; o id é a única chave
   * que já existe no momento em que o preview é útil.
   *
   * Fica sob `/admin` de propósito: é o prefixo que o `robots.txt` já bloqueia e
   * que `staff-auth` já protege página a página. Uma rota de preview fora dele
   * (`/preview/...`) exigiria lembrar das duas coisas de novo — e a primeira
   * esquecida seria um rascunho indexado pelo Google.
   */
  adminPreview: (id: string) => `${ROUTE_PREFIXES.admin}/preview/${id}`,
  /** Audiência: visualizações e cliques. O RECORTE por autoria é da tela. */
  adminAnalytics: () => `${ROUTE_PREFIXES.admin}/analytics`,
  adminAccuracy: () => `${ROUTE_PREFIXES.admin}/precisao`,
  adminAffiliates: () => `${ROUTE_PREFIXES.admin}/afiliados`,
  adminComments: () => `${ROUTE_PREFIXES.admin}/comentarios`,
  /** Gestão de contas da redação. Só administrador. */
  adminAccounts: () => `${ROUTE_PREFIXES.admin}/contas`,
  /**
   * Catálogo de franquias — a tela onde GTA, Zelda e Marvel nascem.
   *
   * Aberta a administrador E redator (capacidade `criarFranquia`, ver
   * core/staff.ts): até ela existir, uma franquia nova só podia ser criada
   * escrevendo direto no banco, e etiquetar matéria com franquia inexistente
   * simplesmente não era possível pelo painel.
   */
  adminFranchises: () => `${ROUTE_PREFIXES.admin}/franquias`,

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
  // Vitrine das editorias (ver `routes.editorias`) — mesmo motivo da linha
  // acima: sem reservar o slug, uma franquia "editorias" tomaria a página.
  'editorias',
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
 * Este caminho pertence ao PAINEL EDITORIAL?
 *
 * POR QUE ESTA FUNÇÃO EXISTE, e a consequência de errá-la não é cosmética:
 *
 * O script do AdSense era carregado no layout raiz, ou seja, no site INTEIRO —
 * painel incluído. Com "Auto ads" ligado (um interruptor da CONTA do Google, não
 * do nosso código), o Google injeta unidades sozinho em qualquer página onde o
 * script esteja presente. Na prática: anúncios dentro da fila de pautas, da
 * lista de matérias, da tela de contas — vistos e eventualmente clicados pela
 * PRÓPRIA REDAÇÃO. Isso é a definição de impressão inválida, e a punição do
 * AdSense para tráfego inválido recai sobre a CONTA inteira, com todo o
 * histórico de receita junto. Não é risco hipotético: é o motivo mais comum de
 * suspensão de publisher pequeno.
 *
 * MORA EM `core`, e não em `apps/web`, por duas razões:
 *   1. a definição de "rota de painel" fica colada à definição das rotas de
 *      painel (o objeto `routes` acima) — quem criar `/admin/algo-novo` amanhã
 *      não precisa lembrar de atualizar uma segunda lista em outro pacote;
 *   2. `core` tem suíte de testes que roda no CI, e esta regra PRECISA de teste:
 *      o efeito de quebrá-la é silencioso (nenhum erro, nenhuma tela diferente,
 *      só um e-mail do Google semanas depois).
 *
 * DETALHES DE IMPLEMENTAÇÃO QUE PARECEM PARANOIA E NÃO SÃO:
 *
 * - A comparação é por SEGMENTO, não por `startsWith('/admin')` cru. Sem isso,
 *   uma futura rota pública `/administrativo` ou `/admin-de-si-mesmo` seria
 *   tratada como painel e ficaria sem monetização — o erro contrário, mas
 *   igualmente invisível.
 * - `toLowerCase()`: o roteador do Next diferencia maiúsculas, então `/ADMIN`
 *   nem existe como página. Normalizar mesmo assim custa nada e fecha a única
 *   porta que sobraria (um proxy ou redirect que preserve o caminho original).
 * - Aceita string vazia e caminhos sem barra inicial sem estourar: a entrada
 *   típica é `usePathname()`, e uma função de segurança que lança exceção em
 *   entrada estranha derruba a página em vez de proteger a conta.
 */
export function isAdminPath(pathname: string): boolean {
  const path = pathname.trim().toLowerCase();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  return normalized === ROUTE_PREFIXES.admin || normalized.startsWith(`${ROUTE_PREFIXES.admin}/`);
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
