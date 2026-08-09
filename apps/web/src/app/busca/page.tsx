/**
 * =============================================================================
 * /busca — resultados
 * =============================================================================
 *
 * `noindex` NO ROBOTS, e isso é deliberado.
 *
 * Página de resultado de busca interna é o exemplo clássico de conteúdo de
 * baixo valor para buscador: existe uma URL por termo digitado (inclusive por
 * bot), todas com o mesmo gabarito e conteúdo recombinado do que já está
 * indexado em páginas melhores. O Google trata isso como "soft 404" e, em
 * volume, o excesso dessas URLs consome orçamento de rastreamento que deveria
 * ir para as matérias.
 *
 * A busca serve ao LEITOR que já está no site — não é porta de entrada de SEO.
 * As portas de entrada são categoria, franquia e artigo, todas indexáveis.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { routes } from '@subcarioca/core';

import { ArticleCard } from '@/components/article-card';
import { SearchForm } from '@/components/search-form';
import { searchContent } from '@/server/queries';

export const metadata: Metadata = {
  title: 'Busca',
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = await searchContent(q);

  return (
    <div className="container">
      <header className="hub-hero">
        <h1 className="article__title">Busca</h1>
        <SearchForm defaultValue={results?.term ?? ''} />
      </header>

      {/* Três estados distintos, com mensagens distintas. Colapsar "não digitou
          nada" e "não achei nada" na mesma tela é o erro que faz a pessoa achar
          que o site está quebrado. */}
      {!results ? (
        <p className="empty-state">
          Digite ao menos duas letras para buscar matérias, universos e editorias.
        </p>
      ) : (
        <SearchResults results={results} />
      )}
    </div>
  );
}

function SearchResults({
  results,
}: {
  results: NonNullable<Awaited<ReturnType<typeof searchContent>>>;
}) {
  const total =
    results.articles.length + results.franchises.length + results.categories.length;

  if (total === 0) {
    return (
      <p className="empty-state">
        Nada encontrado para <b>{results.term}</b>. Tente outra palavra, ou veja{' '}
        <Link href={routes.trending()}>o que está em alta agora</Link>.
      </p>
    );
  }

  return (
    <>
      {/* UNIVERSOS E EDITORIAS VÊM ANTES DAS MATÉRIAS, e não depois.
          Quem digita "Zelda" quase sempre quer o HUB da franquia — a página que
          reúne tudo — e não a notícia mais bem pontuada que menciona Zelda.
          Colocá-los no fim transformaria um atalho de navegação em achado por
          acaso. São poucos itens, então não empurram as matérias para longe. */}
      {(results.franchises.length > 0 || results.categories.length > 0) && (
        <section className="section" aria-labelledby="busca-atalhos">
          <div className="section-head">
            <h2 id="busca-atalhos" className="section-title">
              Universos e editorias
            </h2>
          </div>

          {/* `.filters` é o contêiner de chips do design (o mesmo da home).
              Não existe `.chips` na folha — inventá-lo daria uma fileira sem
              espaçamento nem quebra de linha. */}
          <div className="filters">
            {results.franchises.map((franchise) => (
              <Link key={franchise.slug} href={routes.franchise(franchise.slug)} className="chip">
                {franchise.name}
              </Link>
            ))}
            {results.categories.map((category) => (
              <Link key={category.slug} href={routes.category(category.slug)} className="chip">
                {category.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="busca-materias">
        <div className="section-head">
          <h2 id="busca-materias" className="section-title">
            Matérias
            {results.articles.length > 0 && (
              <span className="cmt__time"> · {results.articles.length}</span>
            )}
          </h2>
        </div>

        {results.articles.length === 0 ? (
          <p className="empty-state">
            Nenhuma matéria com esse termo — mas os atalhos acima podem ajudar.
          </p>
        ) : (
          <div className="grid g-sm-2">
            {results.articles.map((item) => (
              <ArticleCard key={item.id} item={item} variant="grid" />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
