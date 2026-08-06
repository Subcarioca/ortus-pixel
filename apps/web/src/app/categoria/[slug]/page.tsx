/**
 * =============================================================================
 * PÁGINA DE CATEGORIA — /categoria/{slug}
 * =============================================================================
 *
 * Categorias são entidades de primeira classe com URL estável (requisito de
 * SEO do briefing).
 *
 * DECISÃO DE ORDENAÇÃO: a grade é CRONOLÓGICA, não por score. Justificativa do
 * design: "Ordenar por score dentro da categoria confundiria o leitor que vai
 * lá justamente para ver o que saiu hoje." Quem quer ordem por score tem a
 * página /em-alta e a sidebar "Em alta em Games".
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .section__dek → .section-sub    ·  .cd-box → .side-box
 *   .cd-box__list → .side-list      ·  .rank-list__* → .rank__*
 *
 * A sub-navegação (Tudo / Hardware) deixou de ser uma fileira de `.chip` e
 * passou a ser `.tabs`, que é o componente do protótipo para este papel. Não é
 * troca de gosto: `.chip` é um FILTRO (estado ligado/desligado dentro da mesma
 * página, `aria-pressed`) e `.tabs` é NAVEGAÇÃO entre páginas distintas
 * (`aria-current="page"`, com filete de marca embaixo do item ativo). Aqui
 * cada item é uma URL própria — logo, aba. Usar chip ensinava a gramática
 * errada ao leitor: ele esperaria filtrar sem sair do lugar.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { CATEGORIES, isCategorySlug, routes, subcategoriesOf } from '@canalnerd/core';

import { ArticleCard } from '@/components/article-card';
import { BreadcrumbJsonLd, CollectionJsonLd } from '@/components/json-ld';
import { HeatBar } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { getCategoryPage } from '@/server/queries';

export const revalidate = 300;

/**
 * Gera as rotas estáticas no build.
 *
 * Como as categorias são poucas e fixas, pré-renderizar todas custa quase nada
 * e garante que a primeira visita já venha da CDN — sem cold start, sem query.
 */
export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ slug: category.slug }));
}

/**
 * No Next 15, `params` é uma Promise (mudança para suportar renderização
 * parcial). Por isso o `await` antes de usar.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isCategorySlug(slug)) return {};

  const data = await getCategoryPage(slug);
  if (!data) return {};

  const { category } = data;

  return {
    title: category.seoTitle ?? `${category.name} — notícias, lançamentos e novidades`,
    description: category.seoDescription ?? category.description,
    // Canonical explícito evita que variações com query string (?formato=...,
    // ?utm_source=...) sejam indexadas como páginas distintas e diluam a
    // autoridade entre duplicatas.
    alternates: { canonical: routes.category(slug) },
    openGraph: {
      title: category.name,
      description: category.description,
      type: 'website',
      url: routes.category(slug),
    },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Valida o slug contra a lista fechada ANTES de tocar no banco. Barra
  // qualquer string vinda da URL de saída.
  if (!isCategorySlug(slug)) notFound();

  const data = await getCategoryPage(slug);
  if (!data) notFound();

  const { category, articles, trending, upcomingReleases } = data;
  const subcategories = subcategoriesOf(slug);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: category.name, url: routes.category(slug) },
        ]}
      />
      <CollectionJsonLd
        name={category.name}
        description={category.description}
        url={routes.category(slug)}
        items={articles.map((a) => ({ title: a.title, url: a.url }))}
      />

      <div className="container">
        {/* Filete de 3px na cor da editoria (design §3). */}
        <header className={`editoria-head cat--${slug}`}>
          <div>
            <h1 className="article__title">{category.name}</h1>
            <p className="section-sub">{category.description}</p>
          </div>
        </header>

        {/*
          ABAS DE SUB-SEÇÃO (hoje: Hardware dentro de Tech).

          São LINKS para URLs próprias, e não filtros por query string. A
          distinção está explicada em core/routes.ts: sub-seção é acervo
          próprio com intenção de busca distinta; formato é recorte do mesmo
          acervo. A aba só aparece nas editorias que têm sub-seção — nas
          demais, `subcategoriesOf` devolve lista vazia e nada é renderizado.

          O item ativo é um <a> para a própria página, e não um <span>: manter o
          elemento clicável em todos os estados evita que a linha "pule" de
          largura ao navegar e dá ao leitor um caminho de volta previsível.
        */}
        {subcategories.length > 0 && (
          <nav className="tabs" aria-label={`Seções de ${category.name}`}>
            <Link href={routes.category(slug)} aria-current="page">
              Tudo
            </Link>
            {subcategories.map((sub) => (
              <Link key={sub.slug} href={routes.subcategory(slug, sub.slug)}>
                {sub.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="container layout-2col">
        <div>
          {articles.length === 0 ? (
            <p className="empty-state">
              Ainda não publicamos nada nesta editoria. Volte em breve.
            </p>
          ) : (
            // Duas colunas a partir de 640px — a grade de categoria do
            // protótipo. Antes era `.grid` puro, que no design não define
            // coluna nenhuma: a categoria inteira saía empilhada no desktop.
            <div className="grid g-sm-2">
              {articles.slice(0, 6).map((item, index) => (
                <ArticleCard
                  key={item.id}
                  item={item}
                  variant="grid"
                  // Só a primeira imagem é prioritária: é a candidata a LCP.
                  priority={index === 0}
                />
              ))}
            </div>
          )}

          {/* Newsletter SEGMENTADA no meio da grade: proposta específica
              converte melhor que a genérica (design §3). */}
          {articles.length > 6 && (
            <>
              <div className="section">
                <NewsletterForm
                  title={`Só o que importa de ${category.name}`}
                  description={`Receba as novidades de ${category.name} direto no seu e-mail.`}
                  source={`categoria-${slug}`}
                  variant="inline"
                />
              </div>

              <div className="grid g-sm-2">
                {articles.slice(6).map((item) => (
                  <ArticleCard key={item.id} item={item} variant="grid" />
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="sidebar">
          {trending.length > 0 && (
            /* `.side-sticky` acompanha a rolagem: é a caixa que o leitor usa
               para pular para outra matéria da mesma editoria, e ela só serve
               se continuar ao alcance enquanto ele desce a grade. */
            <section className="side-box side-sticky">
              <h2>Em alta em {category.name}</h2>
              {/* `--dense` é a variante de sidebar do ranking: sem fundo
                  próprio (a caixa já tem um) e com padding reduzido. */}
              <ol className="rank-list rank-list--dense">
                {trending.map((item, index) => (
                  <li key={item.id}>
                    <Link href={item.url} className={`rank rank--${item.heat}`}>
                      <span className="rank__pos">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <span className="rank__title">{item.title}</span>
                      </span>
                      {/* Só o termômetro à direita: na largura de 320px da
                          sidebar, badge + tendência + barra brigariam pelo
                          espaço e quebrariam a linha do título. */}
                      <HeatBar heat={item.heat} level={item.heatLevel} size="sm" />
                    </Link>
                  </li>
                ))}
              </ol>
              <Link href={routes.trending()} className="link-more">
                Ranking geral
              </Link>
            </section>
          )}

          {/* Conecta a categoria ao calendário de lançamentos — o MESMO dado
              que alimenta o sinal de sazonalidade do score. Um insumo, dois usos. */}
          {upcomingReleases.length > 0 && (
            <section className="side-box">
              <h2>Próximos lançamentos</h2>
              <ul className="side-list side-list--rows">
                {upcomingReleases.map((release) => (
                  <li key={release.title}>
                    <span>
                      {release.title}
                      {!release.isConfirmed && (
                        <span className="form-hint"> data não confirmada</span>
                      )}
                    </span>
                    <time dateTime={release.releaseDate.toISOString()}>
                      {release.releaseDate.toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
