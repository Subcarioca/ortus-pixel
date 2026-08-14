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
import { headers } from 'next/headers';
import Link from 'next/link';

import { routes } from '@subcarioca/core';

import { ArticleCard } from '@/components/article-card';
import { SearchForm } from '@/components/search-form';
import { searchContent } from '@/server/queries';
import { checkRateLimit, getClientIp } from '@/server/security';

export const metadata: Metadata = {
  title: 'Busca',
  robots: { index: false, follow: true },
};

/**
 * TETO DE BUSCAS POR IP.
 *
 * POR QUE UMA PÁGINA DE LEITURA PRECISA DE RATE LIMIT — o resto do site é
 * cacheado (`unstable_cache`), então mil requisições à home custam quase nada. A
 * busca é a EXCEÇÃO declarada: ela não passa pelo cache de propósito, porque o
 * espaço de chaves é "tudo que um humano pode digitar" (ver o comentário de
 * `searchContent`). Cada requisição aqui vira consulta ao banco, sempre.
 *
 * Some-se a isso o que a busca faz quando o full-text não acha nada: cai no
 * fallback `LIKE '%termo%'`, que é varredura sem índice. Um termo escolhido para
 * nunca casar (`zzqx`) força esse caminho a cada chamada. Sem teto, uma aba
 * recarregando em laço ocupa o pool de conexões — que neste ambiente é de 3 por
 * processo (ver a `DATABASE_URL`) — e a home cai junto.
 *
 * 30 por minuto: um leitor refinando busca faz umas 5; 30 dá folga de 6x para
 * uso legítimo e ainda assim corta o laço automatizado.
 */
const BUSCA_MAX_POR_MINUTO = 30;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  // A checagem vem ANTES de `searchContent` — cobrar o custo da consulta para só
  // então recusar seria proteger o leitor e não o banco, que é quem precisa.
  const ip = getClientIp(await headers());
  const limite = checkRateLimit(`busca:${ip}`, {
    maxRequests: BUSCA_MAX_POR_MINUTO,
    windowSeconds: 60,
  });

  // Sem consultar o banco quando estourou. Nota honesta sobre a força disto: o
  // `checkRateLimit` guarda estado em memória do processo, e o LiteSpeed sobe até
  // 6 processos — o teto real é, no pior caso, 6x o configurado. É a limitação já
  // registrada em `server/security.ts`, e a saída prevista lá (Redis) vale aqui
  // igual. Mesmo assim, 6x30 continua sendo um teto, e um teto frouxo protege
  // muito mais do que teto nenhum.
  const results = limite.allowed ? await searchContent(q) : null;

  return (
    <div className="container">
      <header className="hub-hero">
        <h1 className="article__title">Busca</h1>
        <SearchForm defaultValue={results?.term ?? ''} />
      </header>

      {/* Quatro estados distintos, com mensagens distintas. Colapsá-los na mesma
          tela é o erro que faz a pessoa achar que o site está quebrado — e, no
          caso do limite, achar que a busca não funciona quando ela só precisa
          esperar. */}
      {!limite.allowed ? (
        <p className="empty-state">
          Muitas buscas seguidas. Aguarde {limite.resetInSeconds} segundos e tente de novo.
        </p>
      ) : !results ? (
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
