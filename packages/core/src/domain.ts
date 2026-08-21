/**
 * =============================================================================
 * TIPOS DE DOMÍNIO — o vocabulário que atravessa pipeline, banco e front-end
 * =============================================================================
 *
 * Estes tipos são o "idioma comum". O Prisma gera tipos a partir do schema do
 * banco, mas nós NÃO os expomos diretamente para o front. Motivo: os tipos do
 * Prisma carregam detalhes de persistência (relações opcionais, campos internos,
 * `Decimal`) que vazariam decisões de banco para dentro dos componentes React.
 *
 * O padrão adotado é uma camada fina de mapeamento (packages/db/src/mappers.ts):
 *   linha do Prisma → tipo de domínio → componente
 * O custo é uma função de mapeamento por entidade. O ganho é poder trocar a
 * modelagem do banco (ex.: mover scores para uma time-series) sem tocar na UI.
 */

import type { CategorySlug, SubcategorySlug } from './taxonomy';
import type { EmotionalTrigger, ScoreBand } from './scoring-types';
import type { AffiliateOffer, DisclosureKind } from './monetization';
import type { ArticleBlock } from './blocks';

/** Estados do artigo. Modelado como máquina de estados explícita, não booleanos soltos. */
export type ArticleStatus =
  /** Sugestão criada pelo pipeline, ainda sem redator. */
  | 'suggested'
  /** Um jornalista assumiu — o cronômetro de time-to-publish está correndo. */
  | 'claimed'
  | 'draft'
  | 'in-review'
  | 'published'
  | 'archived';

/**
 * Por que uma máquina de estados e não `isPublished: boolean`?
 * Porque o KPI mais importante do pipeline — "% de QUENTE publicado em 30 min" —
 * depende de saber EXATAMENTE quando o cronômetro começou (`claimed`) e quando
 * parou (`published`). Com um booleano, essa informação não existe.
 */
export const ARTICLE_STATUS_FLOW: Record<ArticleStatus, ArticleStatus[]> = {
  suggested: ['claimed', 'archived'],
  claimed: ['draft', 'suggested', 'archived'],
  draft: ['in-review', 'published', 'archived'],
  'in-review': ['published', 'draft', 'archived'],
  // 'in-review' aqui NÃO é despublicação por engano: é o caso da matéria já no
  // ar cuja classificação de conteúdo SOBE numa edição feita por um redator
  // ('none' → 'sensitive', por exemplo). A versão nova nunca passou pela chefia,
  // então ela volta para a fila e sai do ar até ser aprovada. Ver
  // `requiresSensitiveApproval` em staff.ts — este mapa é a descrição do que as
  // rotas fazem, e deixá-lo desatualizado seria pior do que não tê-lo.
  published: ['archived', 'draft', 'in-review'],
  archived: ['draft'],
};

export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  return ARTICLE_STATUS_FLOW[from].includes(to);
}

export interface Author {
  id: string;
  name: string;
  slug: string;
  /**
   * Biografia e credenciais existem por E-E-A-T: o Google avalia
   * Experiência/Especialidade/Autoridade/Confiança, e para isso precisa de uma
   * entidade Person real e verificável por trás do texto. Autor "Redação" em
   * portal de notícias custa posição no ranking.
   */
  bio: string;
  avatarUrl: string | null;
  role: string;
  socialLinks: { platform: string; url: string }[];
  expertiseAreas: CategorySlug[];
}

export interface Category {
  id: string;
  slug: CategorySlug;
  name: string;
  description: string;
  accentColor: string;
}

/**
 * Franquia/fandom (Star Wars, Zelda, One Piece...).
 *
 * É a entidade mais estratégica do produto depois do artigo: os hubs de
 * franquia (/franquia/star-wars) são o principal mecanismo de RETENÇÃO — a
 * pessoa entra por uma notícia via Google e fica porque encontrou a casa do
 * fandom dela. Também são o que dá sentido ao sinal de "afinidade da audiência".
 */
export interface Franchise {
  id: string;
  slug: string;
  name: string;
  /** Nomes alternativos usados pelos conectores para casar menções. Ex.: ["SW", "Guerra nas Estrelas"]. */
  aliases: string[];
  description: string;
  primaryCategorySlug: CategorySlug;
  heroImageUrl: string | null;
  /**
   * Multiplicador de afinidade da nossa audiência, calculado a partir do
   * desempenho histórico interno (item 9 do briefing). ~1.0 = média do site.
   * É recalculado por job periódico, não escrito à mão.
   */
  audienceAffinityIndex: number;
  followerCount: number;
}

/** Tag livre (personagem, ator, evento). Mais granular que franquia. */
export interface Tag {
  id: string;
  slug: string;
  name: string;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  /** Subtítulo/linha fina. Usado como meta description quando não há uma específica. */
  excerpt: string;
  /**
   * Corpo em Markdown. Ver ADR 0005 para a escolha de formato.
   *
   * Quando `blocks` não é vazio, este campo passa a ser a PROJEÇÃO em texto puro
   * dos blocos (montada pelo servidor na gravação) e deixa de ser o que o leitor
   * vê. Ele continua existindo por dois motivos, ambos invisíveis na tela: é a
   * origem do `searchVector` e é o caminho de renderização do acervo antigo.
   */
  content: string;
  /**
   * Corpo em BLOCOS. Vazio = matéria escrita antes do editor de blocos (ou
   * convertida de volta), que renderiza a partir de `content`.
   *
   * A lista chega aqui SEM revalidação de forma: o mapper confia no que está no
   * banco porque a validação aconteceu na escrita (server/blocks-input.ts). O
   * renderizador ainda assim ignora tipo desconhecido — ver o cabeçalho de
   * article-blocks.tsx.
   */
  blocks: ArticleBlock[];
  status: ArticleStatus;
  category: Category;
  /**
   * Sub-categoria (ex.: 'hardware' dentro de 'tech'). Opcional: a maioria dos
   * artigos vive direto na editoria. Ver taxonomy.ts para o motivo de isto ser
   * estrutura, e não tag.
   */
  subcategorySlug: SubcategorySlug | null;
  franchises: Franchise[];
  tags: Tag[];
  author: Author;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  /** Score no momento da publicação — congelado. Base para medir a PRECISÃO do algoritmo. */
  scoreAtPublish: number | null;
  /** Score vivo, recalculado continuamente. É ele que ordena a home e o Trending. */
  currentScore: number;
  currentBand: ScoreBand;
  /** Tempo estimado de leitura em minutos. */
  readingMinutes: number;
  /** Vídeo associado (trailer) — vira schema.org VideoObject. */
  video: { url: string; thumbnailUrl: string; durationSeconds: number } | null;
  isBreaking: boolean;
  viewCount: number;
  /** Curtidas + descurtidas somadas (mesmo peso). Ver `Article.reactionCount` no schema. */
  reactionCount: number;

  // ---------------------------------------------------------------------------
  // MONETIZAÇÃO — campos DERIVADOS, nunca editáveis à mão
  // ---------------------------------------------------------------------------

  /**
   * Ofertas de afiliado vinculadas, já ordenadas pela posição definida pelo
   * editor. Vazio na imensa maioria dos artigos.
   */
  affiliateOffers: AffiliateOffer[];

  /**
   * `true` quando existe ao menos uma oferta ATIVA vinculada.
   *
   * POR QUE ISTO É DERIVADO E NÃO UM CHECKBOX NO CMS:
   *
   * Se o selo de disclosure dependesse de o editor marcar uma caixa, a primeira
   * vez que alguém esquecesse (e alguém sempre esquece, às 23h, publicando um
   * comparativo em cima da hora) o site estaria veiculando link comercial sem
   * aviso. Isso é infração ao CDC art. 36 (identificação da publicidade), ao
   * Código do CONAR e à política de conteúdo do Google — com o agravante de ser
   * invisível: nada quebra, nenhum teste falha, ninguém percebe.
   *
   * Derivando da RELAÇÃO, "ter link de afiliado" e "mostrar o selo" viram
   * literalmente o mesmo fato. Não existe estado em que um seja verdadeiro e o
   * outro falso. É o mesmo princípio de falha segura de `toArticleStatus`.
   */
  hasAffiliateLinks: boolean;

  /**
   * Tipo de disclosure a exibir, derivado das ofertas vinculadas.
   * Se qualquer oferta for 'sponsored', o artigo inteiro é anunciado como
   * patrocinado — na dúvida, avisa-se MAIS, nunca menos.
   */
  disclosureKind: DisclosureKind | null;
}

/**
 * Tópico candidato: o que o pipeline descobre ANTES de existir um artigo.
 *
 * A separação entre `Topic` e `Article` é deliberada e importante. Um tópico é
 * um fato do mundo ("a Rockstar anunciou atraso de GTA VI"); um artigo é o
 * nosso conteúdo sobre ele. Um tópico pode gerar 3 artigos (notícia, análise,
 * repercussão), ou nenhum. Misturar os dois numa tabela só produziria linhas
 * "fantasma" de artigos nunca escritos poluindo o CMS e o sitemap.
 */
export interface Topic {
  id: string;
  /** Termo canônico usado nas consultas aos conectores. */
  query: string;
  aliases: string[];
  title: string;
  summary: string;
  categorySlug: CategorySlug | null;
  franchiseSlugs: string[];
  /** URL da fonte primária que originou a descoberta. */
  sourceUrl: string | null;
  sourceName: string | null;
  firstSeenAt: Date;
  lastScoredAt: Date | null;
  currentScore: number;
  currentBand: ScoreBand;
  seoOpportunity: number;
  termType: 'head' | 'mid' | 'long-tail';
  emotionalTriggers: EmotionalTrigger[];
  requiresHumanReview: boolean;
  /**
   * Override manual. REQUISITO EXPLÍCITO: o humano sempre vence o algoritmo.
   * Quando preenchido, este valor substitui o score calculado em toda a UI e
   * em todas as automações — mas o score algorítmico continua sendo gravado no
   * histórico, senão perderíamos a capacidade de medir a precisão do modelo.
   */
  manualScoreOverride: number | null;
  manualOverrideReason: string | null;
  manualOverrideBy: string | null;
  status: 'new' | 'assigned' | 'published' | 'dismissed';
  /** Artigos já publicados a partir deste tópico. */
  articleIds: string[];
}

/** Tipos de fonte, ordenados por autoridade — alimenta o sinal `sourceAuthority`. */
export const SOURCE_TIERS = {
  /** Anúncio do próprio estúdio/dev/ator. Máxima confiança e máxima urgência. */
  official: 1.0,
  /** Veículo consolidado (Variety, THR, IGN, Eurogamer). */
  tier1Press: 0.8,
  /** Portal nerd relevante (Omelete, JovemNerd). */
  tier2Press: 0.6,
  /** Insider com histórico de acertos (ex.: leaker conhecido). */
  credibleInsider: 0.45,
  /** Agregador/repost. */
  aggregator: 0.3,
  /** Rumor não confirmado, fórum, thread anônima. */
  unverified: 0.15,
} as const;

export type SourceTier = keyof typeof SOURCE_TIERS;
