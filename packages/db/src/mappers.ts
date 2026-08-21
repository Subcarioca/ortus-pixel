/**
 * =============================================================================
 * MAPPERS — a fronteira entre persistência e domínio
 * =============================================================================
 *
 * Estas funções traduzem linhas do Prisma para os tipos de `@subcarioca/core`.
 *
 * "Isso não é boilerplate desnecessário?" É a pergunta certa, e a resposta é
 * não, por três motivos concretos:
 *
 * 1) TIPOS DE BANCO VAZAM PARA A UI. No Prisma, toda relação não incluída no
 *    `select` é opcional no tipo. Sem mapper, os componentes React ficam
 *    cheios de `article.category?.name ?? ''` — ruído que esconde bugs reais.
 *
 * 2) STRINGS VIRAM UNIONS. O banco guarda `status` como texto livre; o domínio
 *    trabalha com `ArticleStatus`. É aqui que validamos essa fronteira, uma vez
 *    só, em vez de espalhar `as ArticleStatus` por vinte arquivos.
 *
 * 3) LIBERDADE PARA EVOLUIR O BANCO. Quando os snapshots de score migrarem
 *    para uma tabela particionada por tempo, só o mapper muda. A UI nem fica
 *    sabendo.
 */

import type {
  AffiliateOffer,
  Article,
  ArticleBlock,
  ArticleStatus,
  Author,
  Category,
  CommentAuthorView,
  CommentProvider,
  CommentStatus,
  CommentView,
  DisclosureKind,
  Franchise,
  ScoreBand,
  Tag,
} from '@subcarioca/core';
import {
  CATEGORY_BY_SLUG,
  isCategorySlug,
  isCommentProvider,
  isSubcategorySlug,
  toAffiliateProgramCategory,
  toCommentStatus,
  toDisclosureKind,
  toOfferAvailability,
} from '@subcarioca/core';
import type { Prisma } from '@prisma/client';

// Sem extensão, como o resto de `src/` (ver `client`/`json` em index.ts): os
// pacotes são consumidos como TypeScript-fonte pelo bundler do Next, e um
// `./json.js` não resolve no webpack — o `tsc --noEmit` aceita, o build quebra.
import { toStringArray } from './json';

/**
 * Conjunto padrão de relações necessárias para montar um `Article` de domínio.
 *
 * Definir isso UMA VEZ e reutilizar em todas as queries evita o clássico "essa
 * página quebrou porque esqueci de incluir a categoria". O `satisfies` garante
 * que o objeto seja validado contra o tipo do Prisma sem perder a inferência
 * literal — que é o que faz o `ArticleWithRelations` abaixo funcionar.
 */
export const ARTICLE_INCLUDE = {
  category: true,
  subcategory: true,
  author: true,
  franchises: { include: { franchise: { include: { primaryCategory: true } } } },
  tags: { include: { tag: true } },
  /**
   * As ofertas de afiliado vêm JUNTO do artigo, e não numa segunda consulta.
   *
   * Isso é o que torna `hasAffiliateLinks` impossível de dessincronizar na
   * renderização: quem decide se o selo de disclosure aparece é a MESMA leitura
   * que decide se o bloco de ofertas aparece. Não existe caminho de código em
   * que um seja verdadeiro e o outro falso.
   *
   * O filtro por `isActive` mora aqui, e não na página: oferta desativada não
   * deve nem contar para o selo — se não há link comercial visível, não há o
   * que divulgar.
   */
  affiliateOffers: {
    where: { offer: { isActive: true } },
    include: { offer: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ArticleInclude;

/**
 * Tipo do artigo COM as relações de `ARTICLE_INCLUDE` já carregadas.
 * `ArticleGetPayload` deriva isso do include automaticamente: se alguém
 * adicionar uma relação lá em cima, este tipo acompanha sozinho e o compilador
 * aponta o mapper desatualizado. É o oposto de escrever a interface à mão.
 */
export type ArticleWithRelations = Prisma.ArticleGetPayload<{
  include: typeof ARTICLE_INCLUDE;
}>;

/**
 * Converte string do banco em `ArticleStatus`.
 * Valor desconhecido cai em 'draft' — o padrão SEGURO. Errar para 'published'
 * poderia expor conteúdo não revisado; errar para 'draft' apenas o esconde.
 */
function toArticleStatus(value: string): ArticleStatus {
  const valid: ArticleStatus[] = [
    'suggested',
    'claimed',
    'draft',
    'in-review',
    'published',
    'archived',
  ];
  return valid.includes(value as ArticleStatus) ? (value as ArticleStatus) : 'draft';
}

/**
 * Coluna `Json` → lista de blocos.
 *
 * NÃO revalida a forma de cada bloco, e isso é uma escolha: a validação vive na
 * ESCRITA (apps/web/src/server/blocks-input.ts), onde ela acontece uma vez por
 * salvamento, e não a cada leitura de uma página que é servida a dezenas de
 * milhares de pessoas. O que este mapper garante é o mínimo que o consumidor
 * precisa para não quebrar: que seja um array. Bloco de tipo desconhecido chega
 * ao renderizador e é ignorado por ele.
 *
 * `null`, `{}` e string viram lista vazia — que a página lê como "renderize a
 * partir do Markdown", o comportamento de sempre.
 */
function toArticleBlocks(value: unknown): ArticleBlock[] {
  return Array.isArray(value) ? (value as ArticleBlock[]) : [];
}

function toScoreBand(value: string): ScoreBand {
  const valid: ScoreBand[] = ['HOT', 'RISING', 'RELEVANT', 'EVERGREEN'];
  return valid.includes(value as ScoreBand) ? (value as ScoreBand) : 'EVERGREEN';
}

export function mapCategory(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  accentColor: string;
}): Category {
  // Se o slug do banco não estiver na taxonomia tipada, caímos para 'games'
  // e mantemos nome/descrição do banco. É preferível renderizar algo coerente
  // a derrubar a página inteira por um dado inesperado.
  const slug = isCategorySlug(row.slug) ? row.slug : 'games';
  return {
    id: row.id,
    slug,
    name: row.name || CATEGORY_BY_SLUG[slug].name,
    description: row.description,
    accentColor: row.accentColor,
  };
}

export function mapAuthor(row: {
  id: string;
  name: string;
  slug: string;
  bio: string;
  avatarUrl: string | null;
  role: string;
  socialLinks: unknown;
  // `unknown` e não `string[]`: a coluna é `Json` desde a migração para o MySQL,
  // e o Prisma tipa o retorno como `JsonValue` (que inclui `null`). Ver
  // `toStringArray` em ../json.ts.
  expertiseAreas: unknown;
}): Author {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    role: row.role,
    // `socialLinks` é Json no banco, portanto `unknown` aqui. Validamos a forma
    // antes de confiar: um Json malformado não pode quebrar a renderização do
    // schema.org na página.
    socialLinks: parseSocialLinks(row.socialLinks),
    // Dois filtros encadeados, com responsabilidades distintas:
    // `toStringArray` garante a FORMA (é uma lista de strings?) e `isCategorySlug`
    // garante o DOMÍNIO (essas strings são editorias que existem?). A primeira
    // garantia era do banco antes da migração; a segunda sempre foi daqui.
    expertiseAreas: toStringArray(row.expertiseAreas).filter(isCategorySlug),
  };
}

function parseSocialLinks(value: unknown): { platform: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { platform: string; url: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).platform === 'string' &&
      typeof (item as Record<string, unknown>).url === 'string',
  );
}

export function mapFranchise(row: {
  id: string;
  slug: string;
  name: string;
  // `unknown`: coluna `Json` desde a migração para o MySQL. Ver `toStringArray`.
  aliases: unknown;
  description: string;
  heroImageUrl: string | null;
  audienceAffinityIndex: number;
  followerCount: number;
  primaryCategory?: { slug: string } | null;
}): Franchise {
  const categorySlug = row.primaryCategory?.slug;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    aliases: toStringArray(row.aliases),
    description: row.description,
    primaryCategorySlug: isCategorySlug(categorySlug) ? categorySlug : 'games',
    heroImageUrl: row.heroImageUrl,
    audienceAffinityIndex: row.audienceAffinityIndex,
    followerCount: row.followerCount,
  };
}

export function mapTag(row: { id: string; slug: string; name: string }): Tag {
  return { id: row.id, slug: row.slug, name: row.name };
}

// =============================================================================
// MONETIZAÇÃO
// =============================================================================

/** Linha de `AffiliateOffer` -> tipo de domínio. */
export function mapAffiliateOffer(row: {
  id: string;
  productName: string;
  retailerName: string;
  brand: string | null;
  priceCents: number | null;
  currency: string;
  offerUrl: string;
  programCategory: string;
  network: string | null;
  imageUrl: string | null;
  availability: string;
  disclosureKind: string;
  priceUpdatedAt: Date | null;
  isActive: boolean;
}): AffiliateOffer {
  return {
    id: row.id,
    productName: row.productName,
    retailerName: row.retailerName,
    brand: row.brand,
    priceCents: row.priceCents,
    currency: row.currency,
    offerUrl: row.offerUrl,
    // Cada string livre do banco vira union validada AQUI, uma vez só — mesmo
    // princípio de `toArticleStatus`. Sem isso, cada componente precisaria
    // tratar o caso "e se vier um valor que eu não conheço?".
    programCategory: toAffiliateProgramCategory(row.programCategory),
    network: row.network,
    imageUrl: row.imageUrl,
    availability: toOfferAvailability(row.availability),
    disclosureKind: toDisclosureKind(row.disclosureKind),
    priceUpdatedAt: row.priceUpdatedAt,
    isActive: row.isActive,
  };
}

/**
 * Decide QUAL disclosure o artigo exibe a partir das ofertas vinculadas.
 *
 * Regra: 'sponsored' vence 'affiliate'. Se uma única oferta for patrocinada, o
 * artigo inteiro é anunciado como patrocinado.
 *
 * Por que o mais restritivo vence: divulgar demais custa um selo a mais na
 * página; divulgar de menos é publicidade não identificada — infração ao CDC
 * (art. 36) e ao Código do CONAR. A assimetria entre os dois erros define a
 * direção do padrão.
 */
function resolveDisclosureKind(kinds: DisclosureKind[]): DisclosureKind | null {
  if (kinds.length === 0) return null;
  return kinds.includes('sponsored') ? 'sponsored' : 'affiliate';
}

// =============================================================================
// COMUNIDADE
// =============================================================================

function toProvider(value: string): CommentProvider {
  // Provedor desconhecido cai em 'discord' apenas para a exibição do rótulo não
  // quebrar. A autenticação em si valida contra a lista fechada ANTES de
  // qualquer escrita — aqui já estamos lendo dado nosso.
  return isCommentProvider(value) ? value : 'discord';
}

export function mapCommentAuthor(row: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  provider: string;
}): CommentAuthorView {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    provider: toProvider(row.provider),
  };
}

/**
 * Comentário -> projeção pública.
 *
 * Note o que NÃO atravessa esta função: `ipHash`, `authorEmailHash`,
 * `providerAccountHash`, nota de moderação. O mapper é a fronteira que garante
 * que dado de antiabuso não vaze para o HTML só porque alguém fez um `select`
 * generoso na página. É a mesma razão de existir dos outros mappers, aplicada a
 * dado pessoal.
 */
export function mapComment(row: {
  id: string;
  content: string;
  createdAt: Date;
  status: string;
  authorName: string;
  authorAccount: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    provider: string;
  } | null;
}): CommentView {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    status: toCommentStatus(row.status) as CommentStatus,
    author: row.authorAccount
      ? mapCommentAuthor(row.authorAccount)
      : {
          // Comentário legado (modelo antigo, sem conta): mantém o nome
          // publicado e não inventa um provedor.
          id: `legacy:${row.id}`,
          displayName: row.authorName,
          avatarUrl: null,
          provider: 'discord',
        },
  };
}

/** Mapeia um artigo com suas relações para o tipo de domínio. */
export function mapArticle(row: ArticleWithRelations): Article {
  const offers = row.affiliateOffers.map((link) => mapAffiliateOffer(link.offer));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    blocks: toArticleBlocks(row.blocks),
    status: toArticleStatus(row.status),
    category: mapCategory(row.category),
    // Sub-categoria só é aceita se estiver na taxonomia tipada. Um slug órfão
    // no banco (por exemplo, sobrevivente de uma sub-categoria removida do
    // código) é tratado como ausente, e não como rota inválida na UI.
    subcategorySlug: isSubcategorySlug(row.subcategory?.slug) ? row.subcategory.slug : null,
    franchises: row.franchises.map((f) => mapFranchise(f.franchise)),
    tags: row.tags.map((t) => mapTag(t.tag)),
    author: mapAuthor(row.author),
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    scoreAtPublish: row.scoreAtPublish,
    currentScore: row.currentScore,
    currentBand: toScoreBand(row.currentBand),
    readingMinutes: row.readingMinutes,
    // O vídeo só existe se tivermos URL E thumbnail. Meio-vídeo geraria um
    // VideoObject inválido no schema.org, o que o Search Console reporta
    // como erro estrutural.
    video:
      row.videoUrl && row.videoThumbnailUrl
        ? {
            url: row.videoUrl,
            thumbnailUrl: row.videoThumbnailUrl,
            durationSeconds: row.videoDurationSeconds ?? 0,
          }
        : null,
    isBreaking: row.isBreaking,
    viewCount: row.viewCount,
    reactionCount: row.reactionCount,

    affiliateOffers: offers,
    // DERIVADO DA RELAÇÃO, e não da coluna `row.hasAffiliateLinks`.
    //
    // A coluna existe para filtrar listagens sem JOIN, mas quem manda na hora
    // de RENDERIZAR é o fato observado: existe oferta ativa vinculada? Se um dia
    // a coluna dessincronizar (bug, escrita manual no banco, restauração de
    // backup parcial), o selo de disclosure continua correto — e o pior cenário
    // vira "coluna errada num filtro" em vez de "link comercial sem aviso".
    hasAffiliateLinks: offers.length > 0,
    disclosureKind: resolveDisclosureKind(offers.map((o) => o.disclosureKind)),
  };
}
