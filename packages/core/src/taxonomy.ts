/**
 * =============================================================================
 * TAXONOMIA DO CANALNERD — categorias, subnichos e prioridade de monitoramento
 * =============================================================================
 *
 * POR QUE ISSO É UM ARQUIVO DE CÓDIGO, E NÃO SÓ LINHAS NO BANCO?
 *
 * As categorias são *entidades de primeira classe* do produto: definem URLs
 * estáveis (/categoria/games), aparecem no schema.org, no sitemap, no menu e
 * na priorização do pipeline. Se elas vivessem só no banco, cada parte do
 * sistema precisaria de uma query para saber "quais categorias existem" e o
 * TypeScript não conseguiria nos proteger de um typo tipo "categoria/gamees".
 *
 * A estratégia adotada é a de "seed tipado":
 *   - Este arquivo é a FONTE DA VERDADE das categorias (poucas, estáveis, e que
 *     mudam junto com código: menu, rotas, prioridade de coleta).
 *   - O seed do banco lê daqui e materializa as linhas, para que artigos possam
 *     ter foreign key e para que o editor consiga editar título/descrição.
 *   - Já as FRANQUIAS (Star Wars, Zelda, One Piece...) são o oposto: são
 *     centenas, nascem e morrem o tempo todo, e a redação precisa criar novas
 *     sem deploy. Por isso franquias vivem SÓ no banco. Ver ADR 0002.
 *
 * A ordem de `monitoringPriority` reflete a priorização de negócio pedida:
 * 1) Games  2) Cinema & Séries  3) Anime & Mangá / HQs  4) Tech  5) Eventos.
 * O pipeline usa esse número para decidir onde gastar o orçamento de API
 * quando os limites de quota apertarem (ver services/curator).
 */

/** Slugs de categoria. `as const` + type derivado = autocomplete e checagem em compilação. */
export const CATEGORY_SLUGS = [
  'games',
  'cinema-e-series',
  'anime-e-manga',
  'hqs',
  'tech',
  'eventos',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export interface CategoryDefinition {
  slug: CategorySlug;
  name: string;
  /** Usado em <title> e H1. Curto, porque mobile-first: cabeçalho não pode quebrar em 3 linhas. */
  shortName: string;
  description: string;
  /** 1 = prioridade máxima de coleta. Ver comentário no topo do arquivo. */
  monitoringPriority: number;
  /**
   * Fase do roadmap em que a COLETA AUTOMÁTICA desta categoria entra no ar.
   * A categoria existe no modelo de dados desde o dia 1 (URLs estáveis desde
   * o início são um requisito de SEO — mudar URL depois custa autoridade),
   * mas o pipeline só liga os conectores dela na fase indicada.
   */
  launchPhase: 1 | 2 | 3;
  /** Cor de acento usada no front. Mantida aqui para categoria e UI não divergirem. */
  accentColor: string;
  /**
   * Peso de monetização por afiliados. Tech e Games convertem muito melhor em
   * links de afiliado (hardware, jogos, colecionáveis), então a UI mostra
   * blocos de recomendação de produto com mais destaque nessas categorias.
   */
  affiliateWeight: number;
}

export const CATEGORIES: readonly CategoryDefinition[] = [
  {
    slug: 'games',
    name: 'Games',
    shortName: 'Games',
    description:
      'Notícias, lançamentos, atualizações e bastidores da indústria de jogos: consoles, PC, mobile e indies.',
    monitoringPriority: 1,
    launchPhase: 1,
    accentColor: '#7C3AED',
    affiliateWeight: 0.9,
  },
  {
    slug: 'cinema-e-series',
    name: 'Cinema & Séries',
    shortName: 'Cinema',
    description:
      'Trailers, estreias, elencos, bastidores e análises de filmes e séries do universo nerd.',
    monitoringPriority: 2,
    launchPhase: 1,
    accentColor: '#DC2626',
    affiliateWeight: 0.3,
  },
  {
    slug: 'anime-e-manga',
    name: 'Anime & Mangá',
    shortName: 'Anime',
    description:
      'Temporadas, capítulos, adaptações e novidades do mundo dos animes e mangás.',
    monitoringPriority: 3,
    launchPhase: 2,
    accentColor: '#DB2777',
    affiliateWeight: 0.5,
  },
  {
    slug: 'hqs',
    name: 'HQs',
    shortName: 'HQs',
    description:
      'Quadrinhos, graphic novels, editoras e os arcos que moldam os universos compartilhados.',
    monitoringPriority: 3,
    launchPhase: 2,
    accentColor: '#EA580C',
    affiliateWeight: 0.6,
  },
  {
    slug: 'tech',
    name: 'Tech',
    shortName: 'Tech',
    description:
      'Hardware, gadgets, IA e tecnologia com recorte nerd — reviews e recomendações de compra.',
    monitoringPriority: 4,
    launchPhase: 2,
    accentColor: '#0891B2',
    affiliateWeight: 1.0,
  },
  {
    slug: 'eventos',
    name: 'Eventos',
    shortName: 'Eventos',
    description:
      'CCXP, San Diego Comic-Con, Game Awards, Anime Friends: cobertura, painéis e colecionáveis.',
    monitoringPriority: 5,
    launchPhase: 3,
    accentColor: '#65A30D',
    affiliateWeight: 0.7,
  },
] as const;

// =============================================================================
// SUB-CATEGORIAS — hierarquia de um nível dentro de uma editoria
// =============================================================================
//
// POR QUE HARDWARE VIROU SUB-CATEGORIA E NÃO UMA TAG:
//
// O dono do site pediu uma aba dedicada de Hardware dentro de Tech. A diferença
// entre "tag" e "sub-categoria" parece cosmética e não é:
//
//   TAG              → rótulo livre, criado pela redação, sem URL própria
//                      garantida, sem lugar fixo no menu, sem prioridade de
//                      monitoramento. Serve para "RTX 5090" ou "Steam Deck".
//   SUB-CATEGORIA    → entidade estrutural: tem URL estável e indexável
//                      (/categoria/tech/hardware), aparece na navegação, é
//                      FILTRÁVEL no banco por foreign key (não por texto) e
//                      sobrevive a alguém renomear a tag.
//
// Hardware é o segundo caso: é onde vive a maior parte do conteúdo de review e
// comparativo — justamente o conteúdo que sustenta afiliados. Modelar isso como
// tag solta significaria que "todos os artigos de hardware" seria uma busca por
// string, e que a URL da seção dependeria de ninguém errar a grafia da tag.
//
// A hierarquia é de UM NÍVEL SÓ, de propósito. Árvore profunda de categorias em
// portal de notícias produz páginas com 3 artigos, canibalização de SEO entre
// níveis e um menu que ninguém entende. Um nível cobre o caso real e para por aí.

export const SUBCATEGORY_SLUGS = ['hardware'] as const;

export type SubcategorySlug = (typeof SUBCATEGORY_SLUGS)[number];

export interface SubcategoryDefinition {
  slug: SubcategorySlug;
  /** Editoria-mãe. A URL é sempre /categoria/{parent}/{slug}. */
  parent: CategorySlug;
  name: string;
  description: string;
  /**
   * Peso de monetização PRÓPRIO, que sobrescreve o da editoria-mãe.
   *
   * Hardware converte melhor que o restante de Tech (quem lê review de placa de
   * vídeo está a um clique de comprar; quem lê sobre política de IA, não).
   *
   * ATENÇÃO: como todo `affiliateWeight`, isto controla SÓ densidade/prioridade
   * de bloco na UI e priorização humana de pauta. NUNCA entra no cálculo de
   * score — ver packages/core/src/monetization.ts.
   */
  affiliateWeight: number;
}

export const SUBCATEGORIES: readonly SubcategoryDefinition[] = [
  {
    slug: 'hardware',
    parent: 'tech',
    name: 'Hardware',
    description:
      'Placas de vídeo, processadores, consoles portáteis, periféricos e setups: reviews, comparativos e guias de compra.',
    affiliateWeight: 1.0,
  },
] as const;

export const SUBCATEGORY_BY_SLUG: Record<SubcategorySlug, SubcategoryDefinition> =
  Object.fromEntries(SUBCATEGORIES.map((s) => [s.slug, s])) as Record<
    SubcategorySlug,
    SubcategoryDefinition
  >;

export function isSubcategorySlug(value: unknown): value is SubcategorySlug {
  return typeof value === 'string' && SUBCATEGORY_SLUGS.includes(value as SubcategorySlug);
}

/** Sub-categorias de uma editoria — alimenta as abas da página de categoria. */
export function subcategoriesOf(parent: CategorySlug): SubcategoryDefinition[] {
  return SUBCATEGORIES.filter((s) => s.parent === parent);
}

/**
 * Valida o par (categoria, sub-categoria).
 *
 * Sem esta checagem, /categoria/games/hardware responderia 200 exibindo a mesma
 * listagem de /categoria/tech/hardware — conteúdo duplicado em N URLs, que o
 * Google pune e que dilui autoridade. É o mesmo cuidado já aplicado ao par
 * (categoria, slug de artigo) na página de artigo.
 */
export function isValidSubcategoryPath(parent: unknown, sub: unknown): boolean {
  if (!isCategorySlug(parent) || !isSubcategorySlug(sub)) return false;
  return SUBCATEGORY_BY_SLUG[sub].parent === parent;
}

/**
 * Peso de afiliado efetivo de um par categoria/sub-categoria.
 * A sub-categoria, quando existe, manda — ela é mais específica.
 */
export function affiliateWeightFor(
  category: CategorySlug,
  subcategory?: SubcategorySlug | null,
): number {
  if (subcategory && SUBCATEGORY_BY_SLUG[subcategory]) {
    return SUBCATEGORY_BY_SLUG[subcategory].affiliateWeight;
  }
  return CATEGORY_BY_SLUG[category].affiliateWeight;
}

/** Índice por slug — evita `.find()` espalhado pelo código (O(n) virando O(1) e menos ruído). */
export const CATEGORY_BY_SLUG: Record<CategorySlug, CategoryDefinition> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
) as Record<CategorySlug, CategoryDefinition>;

/**
 * Type guard: valida uma string vinda de fora (URL, query param, payload de API).
 *
 * SEGURANÇA: toda string que chega do usuário é hostil até prova em contrário.
 * Validar o slug contra a lista fechada aqui elimina de saída uma classe inteira
 * de problemas (path traversal em rotas, injeção em query, cache poisoning por
 * variações infinitas de URL como /categoria/games?a=1&a=2...).
 */
export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === 'string' && CATEGORY_SLUGS.includes(value as CategorySlug);
}

/** Categorias cuja coleta automática está ativa numa dada fase do roadmap. */
export function categoriesForPhase(phase: 1 | 2 | 3): CategoryDefinition[] {
  return CATEGORIES.filter((c) => c.launchPhase <= phase);
}
