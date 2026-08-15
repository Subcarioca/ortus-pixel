/**
 * =============================================================================
 * PÁGINA DE ARTIGO — /{categoria}/{slug}
 * =============================================================================
 *
 * É a página que recebe o tráfego de breaking news, push e busca orgânica.
 * Precisa ser a mais rápida do site e a mais bem estruturada para SEO.
 *
 * -----------------------------------------------------------------------------
 * ONDE FOI PARAR O TEMPLATE (leia isto antes de procurar o JSX)
 * -----------------------------------------------------------------------------
 * Todo o corpo visível da matéria — badges, manchete, assinatura, capa, TL;DR,
 * cobertura ao vivo, índice, texto, anúncios, ofertas, relacionadas, comunidade
 * e comentários — vive em `components/article-view.tsx`. Esta página ficou com
 * o que é DELA e de mais ninguém: rota, validação dos parâmetros da URL, cache
 * e metadados.
 *
 * A extração aconteceu por causa do PREVIEW do painel (`/admin/preview/[id]`),
 * onde o redator vê o rascunho exatamente como o leitor veria. Um segundo
 * template para o preview funcionaria por duas semanas e depois passaria a
 * mentir sobre a página real — o racional completo está no cabeçalho do
 * componente. Se você veio mexer na aparência da matéria, é lá.
 *
 * A ORDEM DO TOPO (design §3), pensada para quem chegou por push no celular, e
 * o restante das decisões de layout também estão documentados lá.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { absoluteUrl, isCategorySlug, routes } from '@subcarioca/core';

import { ArticleView } from '@/components/article-view';
import { SITE_NAME } from '@/lib/site';
import { getArticleBySlug } from '@/server/queries';

/**
 * Cache LONGO (1h) + invalidação por evento na edição.
 *
 * É esta linha que sustenta o requisito de picos de tráfego: 50 mil leitores
 * simultâneos num breaking news são servidos da CDN, sem tocar no banco.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categoria: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getArticleBySlug(slug);
  if (!data) return {};

  const { article } = data;
  const url = routes.article(article.category.slug, article.slug);

  return {
    /**
     * Artigo é a única rota com separador de TRAVESSÃO em vez de barra vertical
     * ("Manchete — Ortus Pixel", e não "Manchete | Ortus Pixel"), conforme os
     * protótipos `design/artigo.html` e `design/artigo-review.html`.
     *
     * Não é capricho tipográfico: manchete é texto longo, e a barra vertical
     * grudada no fim de uma frase de 70 caracteres lê-se como ruído na SERP. O
     * travessão é lido como continuação, e é o padrão que veículos de notícia
     * usam. Por isso `absolute` — ele desliga o template `%s | Ortus Pixel` do
     * layout raiz, que se aplica ao resto do site.
     */
    title: { absolute: `${article.title} — ${SITE_NAME}` },
    description: article.excerpt,
    alternates: { canonical: url },
    openGraph: {
      title: article.title,
      description: article.excerpt,
      // `article` (e não `website`) habilita os metadados de publicação nas
      // redes sociais: data, autor e seção.
      type: 'article',
      url: absoluteUrl(url),
      publishedTime: article.publishedAt?.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      authors: [article.author.name],
      section: article.category.name,
      images: article.coverImageUrl
        ? [{ url: article.coverImageUrl, width: 1200, height: 630, alt: article.coverImageAlt ?? article.title }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.excerpt,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ categoria: string; slug: string }>;
}) {
  const { categoria, slug } = await params;

  if (!isCategorySlug(categoria)) notFound();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();

  const data = await getArticleBySlug(slug);
  if (!data) notFound();

  /**
   * O slug da URL precisa bater com a categoria REAL do artigo.
   *
   * Sem esta checagem, /tech/noticia-de-games responderia 200 com o mesmo
   * conteúdo de /games/noticia-de-games — conteúdo duplicado em N URLs, que o
   * Google penaliza e que dilui a autoridade entre elas.
   *
   * Fica AQUI, e não no componente compartilhado, porque é uma regra da ROTA:
   * o preview do painel não tem categoria na URL para conferir.
   */
  if (data.article.category.slug !== categoria) notFound();

  return <ArticleView data={data} />;
}
