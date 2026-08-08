/**
 * =============================================================================
 * DADOS ESTRUTURADOS (Schema.org)
 * =============================================================================
 *
 * Requisito obrigatório do briefing: NewsArticle, VideoObject, BreadcrumbList,
 * Organization e Person.
 *
 * POR QUE ISSO IMPORTA MAIS EM NOTÍCIA DO QUE EM QUALQUER OUTRO NICHO:
 *   - NewsArticle é pré-requisito para aparecer no Google Notícias e no carrossel
 *     "Principais notícias" — que é onde está o tráfego de breaking news.
 *   - VideoObject faz o trailer aparecer com miniatura na busca, elevando muito
 *     o CTR num nicho em que trailer é conteúdo central.
 *   - Person + Organization sustentam E-E-A-T. Em YMYL e em notícias, o Google
 *     avalia quem assina; autor sem entidade estruturada é autor invisível.
 *
 * SEGURANÇA — `dangerouslySetInnerHTML` e por que é seguro AQUI:
 *
 * Injetar JSON-LD exige escrever dentro de <script>. O risco real é um valor
 * de texto contendo `</script>`, que fecharia a tag e permitiria injeção de
 * script (XSS). A função `safeJsonLd()` abaixo neutraliza esse vetor escapando
 * os caracteres perigosos. Não é firula: título de notícia é conteúdo editável
 * e, portanto, entrada não confiável.
 */

import type { AffiliateOffer, Article } from '@subcarioca/core';
import {
  PRICE_FRESHNESS_HOURS,
  SCHEMA_AVAILABILITY,
  absoluteUrl,
  canDisplayPrice,
  routes,
} from '@subcarioca/core';

import { SITE_NAME, SOCIAL_PROFILES } from '@/lib/site';

/**
 * Serializa com escape dos caracteres que poderiam quebrar o contexto <script>.
 * `<` e `>` viram escapes Unicode válidos em JSON — o parser lê o mesmo valor,
 * mas o HTML não enxerga uma tag.
 */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function JsonLdScript({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

/** Organização — identidade editorial do site. */
export function OrganizationJsonLd({ siteName, siteUrl }: { siteName: string; siteUrl: string }) {
  return (
    <JsonLdScript
      data={{
        '@context': 'https://schema.org',
        // NewsMediaOrganization é mais específico que Organization e sinaliza
        // ao Google que somos um veículo jornalístico.
        '@type': 'NewsMediaOrganization',
        name: siteName,
        url: siteUrl,
        logo: {
          '@type': 'ImageObject',
          url: `${siteUrl}/logo.png`,
          width: 600,
          height: 60,
        },
        // `sameAs` é o que amarra o site aos perfis oficiais como UMA entidade
        // no Knowledge Graph. Handle único (@ortuspixel) em todas as redes.
        sameAs: [...SOCIAL_PROFILES],
      }}
    />
  );
}

/**
 * NewsArticle + VideoObject + Person.
 *
 * Emitimos um único grafo com `@graph` em vez de três blocos <script>
 * separados. Vantagem: as entidades podem se referenciar por `@id`, e o Google
 * entende que o autor do artigo É a pessoa descrita — em blocos soltos, essa
 * ligação se perde.
 */
export function ArticleJsonLd({
  article,
  video,
}: {
  article: Article;
  video: { url: string; thumbnailUrl: string; durationSeconds: number } | null;
}) {
  const articleUrl = absoluteUrl(routes.article(article.category.slug, article.slug));
  const authorId = absoluteUrl(routes.author(article.author.slug)) + '#person';

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'NewsArticle',
      '@id': `${articleUrl}#article`,
      headline: article.title.slice(0, 110), // limite recomendado pelo Google
      description: article.excerpt,
      url: articleUrl,
      // `datePublished` e `dateModified` são o que o Google usa para ordenar
      // notícias por recência. Sem eles, breaking news perde para conteúdo
      // antigo mais bem posicionado.
      datePublished: article.publishedAt?.toISOString(),
      dateModified: article.updatedAt.toISOString(),
      author: { '@id': authorId },
      publisher: {
        '@type': 'NewsMediaOrganization',
        name: SITE_NAME,
        logo: {
          '@type': 'ImageObject',
          url: absoluteUrl('/logo.png'),
        },
      },
      image: article.coverImageUrl ? [article.coverImageUrl] : undefined,
      articleSection: article.category.name,
      keywords: [
        ...article.franchises.map((f) => f.name),
        ...article.tags.map((t) => t.name),
      ].join(', '),
      inLanguage: 'pt-BR',
      isAccessibleForFree: true,
      mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
    },
    {
      // Person do autor: o coração do E-E-A-T.
      '@type': 'Person',
      '@id': authorId,
      name: article.author.name,
      description: article.author.bio,
      jobTitle: article.author.role,
      url: absoluteUrl(routes.author(article.author.slug)),
      image: article.author.avatarUrl ?? undefined,
      // `sameAs` conecta o autor a perfis verificáveis — é o que transforma um
      // nome em entidade reconhecida pelo buscador.
      sameAs: article.author.socialLinks.map((link) => link.url),
    },
  ];

  if (video) {
    graph.push({
      '@type': 'VideoObject',
      '@id': `${articleUrl}#video`,
      name: article.title,
      description: article.excerpt,
      thumbnailUrl: [video.thumbnailUrl],
      uploadDate: article.publishedAt?.toISOString(),
      // Formato ISO 8601 de duração. "PT2M8S" = 2 minutos e 8 segundos.
      duration: `PT${Math.floor(video.durationSeconds / 60)}M${video.durationSeconds % 60}S`,
      contentUrl: video.url,
      embedUrl: video.url,
    });
  }

  return <JsonLdScript data={{ '@context': 'https://schema.org', '@graph': graph }} />;
}

/**
 * =============================================================================
 * Product + Offer — rich result de preço em review e comparativo
 * =============================================================================
 *
 * PESQUISA QUE EMBASOU ESTA DECISÃO (documentação do Google, ago/2026):
 *
 * Existem DUAS famílias de marcação de produto, e confundi-las é o erro que
 * rende aviso no Search Console:
 *
 *   - "Merchant listing"  → para quem VENDE. Exige política de devolução,
 *                            frete e outros campos que só uma loja tem.
 *   - "Product snippet"   → para páginas onde NÃO se compra: review editorial,
 *                            comparativo, "melhores X de 2026". É o nosso caso.
 *                            Aceita `review`, `aggregateRating` e `offers`, e é
 *                            a ÚNICA família elegível ao rich result de
 *                            prós e contras (`positiveNotes`/`negativeNotes`) —
 *                            reservado por política a conteúdo editorial.
 *
 * Como o projeto já guarda prós e contras em `reviewData` para o template de
 * review, emitir isso custa quase nada e habilita um resultado de busca que
 * nenhuma loja pode obter. É a marcação de melhor relação esforço/retorno do
 * projeto depois do NewsArticle.
 *
 * A REGRA MAIS IMPORTANTE DAQUI — PREÇO OBSOLETO NÃO É MARCADO:
 *
 * Só entram no `offers` as ofertas com preço dentro da janela de frescor de 24h
 * (mesma regra da UI, em core/monetization.ts). Declarar preço desatualizado em
 * dado estruturado não é um detalhe: é violação de política do Google (o preço
 * marcado precisa bater com o da página de destino) e caminho conhecido para
 * ação manual. Se nenhuma oferta estiver fresca, o bloco inteiro não é emitido —
 * falhar em silêncio aqui é melhor que publicar um número errado.
 */
export function ProductJsonLd({
  article,
  offers,
  reviewData,
}: {
  article: Article;
  offers: AffiliateOffer[];
  reviewData: unknown;
}) {
  const now = new Date();

  const fresh = offers.filter(
    (offer) => offer.priceCents !== null && canDisplayPrice(offer, now),
  );

  // Sem preço confiável, não há Product a declarar. O NewsArticle do artigo
  // continua sendo emitido normalmente pelo `ArticleJsonLd`.
  if (fresh.length === 0) return null;

  const articleUrl = absoluteUrl(routes.article(article.category.slug, article.slug));
  const review = parseReviewData(reviewData);

  // O nome do produto vem da PRIMEIRA oferta, que é a que o editor colocou em
  // primeiro lugar. É a mesma hierarquia mostrada ao leitor no bloco "Onde
  // comprar" — o dado estruturado não pode contar uma história diferente da
  // que está na tela.
  const primary = fresh[0]!;

  const prices = fresh.map((offer) => (offer.priceCents ?? 0) / 100);

  const product: Record<string, unknown> = {
    '@type': 'Product',
    '@id': `${articleUrl}#product`,
    name: primary.productName,
    ...(primary.brand ? { brand: { '@type': 'Brand', name: primary.brand } } : {}),
    ...(primary.imageUrl ? { image: [primary.imageUrl] } : {}),

    // AggregateOffer quando há mais de uma loja: é o que produz a faixa "de
    // R$ X a R$ Y" na busca, e é honesto — nós de fato listamos várias.
    offers:
      fresh.length > 1
        ? {
            '@type': 'AggregateOffer',
            offerCount: fresh.length,
            lowPrice: Math.min(...prices).toFixed(2),
            highPrice: Math.max(...prices).toFixed(2),
            priceCurrency: primary.currency,
            offers: fresh.map((offer) => buildOffer(offer, articleUrl)),
          }
        : buildOffer(primary, articleUrl),
  };

  if (review) {
    product.review = {
      '@type': 'Review',
      // O autor da avaliação é a PESSOA que assina, não a organização: é o que
      // sustenta o E-E-A-T do review ("quem testou isso?").
      author: { '@type': 'Person', name: article.author.name },
      datePublished: article.publishedAt?.toISOString(),
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.score,
        bestRating: 10,
        worstRating: 0,
      },
      // Prós e contras: exclusivos de conteúdo editorial (ver nota acima).
      ...(review.pros.length > 0
        ? {
            positiveNotes: {
              '@type': 'ItemList',
              itemListElement: review.pros.map((item, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: item,
              })),
            },
          }
        : {}),
      ...(review.cons.length > 0
        ? {
            negativeNotes: {
              '@type': 'ItemList',
              itemListElement: review.cons.map((item, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                name: item,
              })),
            },
          }
        : {}),
    };
  }

  return <JsonLdScript data={{ '@context': 'https://schema.org', '@graph': [product] }} />;
}

function buildOffer(offer: AffiliateOffer, articleUrl: string): Record<string, unknown> {
  const availability = SCHEMA_AVAILABILITY[offer.availability];

  return {
    '@type': 'Offer',
    price: ((offer.priceCents ?? 0) / 100).toFixed(2),
    priceCurrency: offer.currency,
    // `priceValidUntil` declara ao Google até quando confiamos no número —
    // exatamente a janela de frescor que a UI usa. Sem ele, o buscador assume
    // validade indefinida e nos cobra por um preço que já mudou.
    priceValidUntil: new Date(
      (offer.priceUpdatedAt?.getTime() ?? Date.now()) + PRICE_FRESHNESS_HOURS * 3_600_000,
    )
      .toISOString()
      .slice(0, 10),
    // A URL declarada é a NOSSA página, e não o link de afiliado. Apontar o
    // dado estruturado para um link de rastreio comercial é pedido de
    // penalidade — e a página do review é, de fato, onde a oferta é descrita.
    url: articleUrl,
    seller: { '@type': 'Organization', name: offer.retailerName },
    ...(availability ? { availability } : {}),
  };
}

/** Valida o `reviewData` (Json do banco) antes de confiar nele. */
function parseReviewData(
  value: unknown,
): { score: number; pros: string[]; cons: string[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const data = value as Record<string, unknown>;

  const score = typeof data.score === 'number' ? data.score : null;
  if (score === null || score < 0 || score > 10) return null;

  const toStringList = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];

  return { score, pros: toStringList(data.pros), cons: toStringList(data.cons) };
}

/**
 * BreadcrumbList.
 *
 * Além de gerar a trilha na SERP (que aumenta o CTR), ele comunica ao Google a
 * hierarquia do site — informação que ajuda a distribuir autoridade entre
 * home, categoria e artigo.
 */
export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  return (
    <JsonLdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: absoluteUrl(item.url),
        })),
      }}
    />
  );
}

/**
 * CollectionPage com ItemList — usado em categorias e hubs de franquia.
 * Ajuda o Google a entender que a página é um agregador curado, e não conteúdo
 * duplicado dos artigos que ela lista.
 */
export function CollectionJsonLd({
  name,
  description,
  url,
  items,
}: {
  name: string;
  description: string;
  url: string;
  items: { title: string; url: string }[];
}) {
  return (
    <JsonLdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name,
        description,
        url: absoluteUrl(url),
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: items.length,
          itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.title,
            url: absoluteUrl(item.url),
          })),
        },
      }}
    />
  );
}
