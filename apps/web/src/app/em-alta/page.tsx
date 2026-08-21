/**
 * =============================================================================
 * PÁGINA "EM ALTA" — o ranking ao vivo por score
 * =============================================================================
 *
 * É a página-manifesto do produto: mostra o que está bombando agora, com cara
 * de seleção editorial — não de saída de algoritmo. Também atende ao requisito
 * do briefing de "página/API de Trending" (a ORDEM ao vivo é a informação),
 * sem nunca framear isso como "ranking calculado por score" pro leitor.
 *
 * DECISÃO DE PRODUTO (ver ADR 0009 + decisão posterior de reposicionamento): o
 * número de 0 a 100 nunca é exibido publicamente, e a própria PALAVRA
 * "algoritmo"/"score"/"cálculo" também não aparece nesta página — só em
 * /admin, de uso interno. A ordem é apresentada como "o que está bombando
 * agora", curada e atualizada pela redação, não como resultado de fórmula.
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .trending-head  → .hub-hero      (o mesmo cabeçalho-cartão do hub de franquia)
 *   .trending-stats → .hub-stats     (+ .hub-stat__num / .hub-stat__lbl)
 *   .cd-box         → .side-box      (`.cd-box` no design é a caixinha da
 *                                     CONTAGEM REGRESSIVA do hub, não uma caixa
 *                                     de sidebar — os dois nomes coexistem e são
 *                                     coisas diferentes)
 *   .divider__label → .divider--step (o degrau "fim do em alta · fluxo normal")
 *   .rank-list__*   → .rank__*
 *
 * REGRA COMERCIAL DESTA PÁGINA, que o markup precisa continuar respeitando:
 * o fluxo do ranking é ZONA LIVRE DE ANÚNCIO. Nada comercial entre as
 * posições — nem in-feed, nem ancorado. Um bloco pago no meio da lista seria
 * lido como posição comprada, e a credibilidade da ordem é o produto.
 *
 * -----------------------------------------------------------------------------
 * REFORMA v0.4 — o ranking sempre existe
 * -----------------------------------------------------------------------------
 * A lista era montada com `score >= 60`. Num dia calmo — que num site novo é
 * todo dia — a página de ranking ficava sem ranking, exibindo um aviso de que
 * não havia nada na faixa de urgência e, logo acima, três contadores zerados em
 * números enormes. Era uma prova pública de site parado, produzida por decisão
 * nossa e não pelos dados.
 *
 * O erro conceitual: ranking é ORDEM RELATIVA, e ordem relativa não depende de
 * limiar absoluto. Com dois artigos publicados, o primeiro ainda é o primeiro.
 * O corte em 60 continua existindo — virou um DEGRAU VISUAL dentro da lista
 * (`.divider--step`), que era, aliás, exatamente o que o design já previa para
 * marcar a mudança de critério.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { catClass, heatClass, routes, type ContentCardData } from '@subcarioca/core';

import { ArticleCard } from '@/components/article-card';
import { HeatBadge } from '@/components/heat-badge';
import { HeatBar, TrendTag } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { PushOptIn } from '@/components/push-opt-in';
import { RelativeTime } from '@/components/relative-time';
import { getTrendingRanking } from '@/server/queries';

/**
 * Renderização sob demanda (SSR) — mesmo motivo de `app/page.tsx` (a home):
 * sem parâmetro dinâmico, esta página é sempre incluída no pré-render do
 * `next build`, que roda no GitHub Actions e não alcança o MariaDB interno
 * da Hostinger (`localhost:3306`). `getTrendingRanking()` falhava no build,
 * `safeQuery` devolvia listas vazias, e essa versão estática e vazia era o
 * HTML publicado. `force-dynamic` tira a página do pré-render; o cache de
 * dados (`unstable_cache({ revalidate: 60 })`, dentro de `getTrendingRanking`
 * em server/queries.ts) continua valendo, independente disto.
 */
export const dynamic = 'force-dynamic';

/**
 * O título NÃO leva sufixo de marca escrito à mão: o template do layout raiz
 * (`%s | Ortus Pixel`) já o acrescenta. Escrever "| Ortus Pixel" aqui produziria
 * a marca duas vezes no mesmo <title>.
 *
 * CORREÇÃO DE CONFORMIDADE (ADR 0009) junto com o reposicionamento: a descrição
 * evita qualquer linguagem de "ranking calculado"/"score" — não é uma promessa
 * que a página deva cumprir pro leitor. O que a descrição vende é o que a
 * página de fato entrega pra quem lê: o que está bombando, ao vivo, selecionado
 * pela redação.
 */
export const metadata: Metadata = {
  title: 'Em Alta — O Que Está Bombando no Universo Nerd',
  description:
    'O que está bombando agora no universo nerd: games, cinema, animes e tech, selecionado e atualizado pela redação em tempo real. Sem clickbait — só o que importa.',
  alternates: { canonical: routes.trending() },
};

export default async function TrendingPage() {
  const { ranking, hotZoneCount, stats } = await getTrendingRanking();

  const [podium, ...rest] = ranking;

  // A lista é uma só; o degrau parte ela em duas para o olho. `hotZoneCount`
  // conta o pódio, por isso o -1.
  const hotRest = rest.slice(0, Math.max(0, hotZoneCount - 1));
  const normalRest = rest.slice(hotRest.length);

  // O degrau só faz sentido quando há os dois lados: uma faixa quente acima e
  // fluxo normal abaixo. Sem nada quente, a lista inteira JÁ é fluxo normal e
  // anunciar "fim do em alta" no primeiro item seria uma piada de mau gosto.
  const showStep = hotZoneCount > 0 && normalRest.length > 0;

  /*
    OS CONTADORES NUNCA MOSTRAM TRÊS ZEROS.

    O trio original ("Urgentes agora / Em alta / Publicadas hoje") mede
    PICO — e é o certo num dia agitado. Num domingo de manhã, os três zeram ao
    mesmo tempo e a página anuncia em mono, com 1.25rem, que não há nada
    acontecendo em lugar nenhum. É verdade sobre o pico e mentira sobre o site,
    que continua monitorando pautas e tem acervo publicado.

    Quando isso acontece, trocamos a MÉTRICA, não o número: as três de baixo são
    igualmente verdadeiras e dizem algo útil ("o site está de olho em N assuntos,
    N subiram, N saíram na semana"). Preferimos isso a esconder os contadores —
    esconder o painel num dia parado é o mesmo instinto de esconder o feed, que é
    justamente o que esta reforma está corrigindo.
  */
  const isCalm = stats.hotCount + stats.risingCount + stats.todayCount === 0;
  const counters = isCalm
    ? [
        { label: 'Acompanhando agora', value: stats.trackedCount },
        { label: 'Subindo no momento', value: stats.movingCount },
        { label: 'Publicadas na semana', value: stats.weekCount },
      ]
    : [
        { label: 'Urgentes agora', value: stats.hotCount },
        { label: 'Em alta', value: stats.risingCount },
        { label: 'Publicadas hoje', value: stats.todayCount },
      ];

  return (
    <div className="container layout-2col">
      <div>
        {/* ---------- CABEÇALHO COM CONTADORES ---------- */}
        {/*
          "É a prova de que o site está antenado" (Nielsen: visibilidade do
          status do sistema). Sem esses números, um ranking é só uma lista.

          O <dl> é mantido porque a estrutura É de pares rótulo/valor, e o
          leitor de tela anuncia "Quentes: 2" em vez de dois textos soltos. Os
          `<div>` intermediários são HTML válido dentro de <dl> desde o HTML 5.2
          e são o que permite ao `.hub-stats` (flex) tratar cada par como uma
          coluna — exatamente como as `<div>` do protótipo.
        */}
        <header className="hub-hero">
          <div className="card__head">
            {/* O selo acompanha a realidade do dia. "Ao vivo" em vermelho num
                dia sem nada quente promete uma agitação que a lista abaixo não
                confirma — e o leitor confere em dois segundos. "Ritmo calmo"
                é a mesma informação, dita sem inflação. */}
            {stats.hotCount > 0 ? (
              <span className="heat heat--hot heat--lg">Ao vivo</span>
            ) : (
              <span className="heat heat--rise heat--lg">Ritmo calmo</span>
            )}
            {stats.lastUpdatedAt && (
              <span className="meta">
                atualizado há {minutesSince(stats.lastUpdatedAt)} min
              </span>
            )}
          </div>

          <h1 className="article__title">Em alta agora</h1>
          <p className="hub-hero__desc">
            Selecionado e atualizado continuamente pela redação, acompanhando buscas, redes
            sociais e repercussão em tempo real.
          </p>

          {/* Sem NADA publicado, até o trio alternativo zera — e três zeros
              gigantes ao lado de "ainda não há matérias" não acrescentam
              informação nenhuma, só repetem a má notícia em mono. O painel
              inteiro sai; quem responde por esse estado é a mensagem abaixo. */}
          {ranking.length > 0 && (
            <dl className="hub-stats">
              {counters.map((counter) => (
                <div key={counter.label}>
                  <dt className="hub-stat__lbl">{counter.label}</dt>
                  <dd className="hub-stat__num">{counter.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {/* ---------- PÓDIO: o #1 vira card grande ---------- */}
        {podium ? (
          <>
            {/* `showHeatBar`: aqui, e só aqui, o termômetro fica — o pódio abre
                a SEQUÊNCIA de barras que continua nas linhas do ranking logo
                abaixo (cada `RankRow` desenha a sua própria via `HeatBar`
                direto, sem passar por `ArticleCard`). É a comparação lado a
                lado que o card do feed não tem. Ver o comentário de
                `showHeatBar` em `article-card.tsx`. */}
            <ArticleCard item={podium} variant="lead" rank={1} priority showHeatBar />

            {/* Do #2 em diante: lista densa. "Ranking sem hierarquia de tamanho
                vira planilha." */}
            {hotRest.length > 0 && (
              <ol className="rank-list" start={2}>
                {hotRest.map((item, index) => (
                  <RankRow key={item.id} item={item} position={index + 2} />
                ))}
              </ol>
            )}

            {/* ---------- DEGRAU EXPLÍCITO ENTRE AS FAIXAS ----------
                O olho precisa perceber que dali para baixo o critério mudou. No
                protótipo é um rótulo mono seguido de um filete; `.divider--step`
                é essa linha com um <h2> de verdade dentro (o leitor de tela
                precisa ouvir a mudança de faixa, não só vê-la). O rótulo não
                cita o corte numérico — ver ADR 0009.

                Ele vive DENTRO da lista agora, e não mais como cabeçalho de uma
                grade de cards separada: as duas faixas são o mesmo ranking, e
                mudar a forma do item no meio do caminho sugeria que a segunda
                metade era outra coisa qualquer. */}
            {showStep && (
              <div className="divider divider--step">
                <h2 id="abaixo-titulo">Fim do &ldquo;em alta&rdquo; · fluxo normal</h2>
              </div>
            )}

            {normalRest.length > 0 && (
              <ol
                className="rank-list"
                start={hotRest.length + 2}
                aria-labelledby={showStep ? 'abaixo-titulo' : undefined}
              >
                {normalRest.map((item, index) => (
                  <RankRow key={item.id} item={item} position={hotRest.length + index + 2} />
                ))}
              </ol>
            )}
          </>
        ) : (
          /* O ÚNICO vazio possível desta página agora: nada publicado. Enquanto
             houver um artigo no ar, existe um ranking — mesmo que de um item. */
          <p className="empty-state">
            Ainda não há matérias publicadas. O ranking aparece com a primeira delas —
            e a newsletter aqui do lado avisa quando isso acontecer.
          </p>
        )}

        {/* A promessa da página, escrita: sem isso, o leitor precisa confiar
            que não há posição comprada. Com isso, ele lê a regra. */}
        <p className="note">
          Nenhum anúncio ou link de afiliado entra entre as posições do ranking — nem
          in-feed, nem ancorado. A ordem aqui é 100% temperatura.
        </p>
      </div>

      {/* ---------- SIDEBAR ---------- */}
      <aside className="sidebar">
        {/*
          Transparência de MÉTODO (não de nota individual) continua sendo
          diferencial editorial e reforço de E-E-A-T. Com o número escondido,
          esta caixa passa a ser ainda mais importante: ela é o que explica ao
          leitor por que a ordem da página é o que é.
        */}
        <section className="side-box">
          {/* Sem classe no <h2>: no design quem estiliza o título da caixa é o
              seletor `.side-box h3`, e a ponte da seção 17 estende isso a h2/h4
              para que o NÍVEL do heading continue sendo escolhido pela
              hierarquia do documento, não pelo tamanho da fonte desejado. */}
          <h2>Como montamos este ranking</h2>
          <p className="form-hint">
            Cada notícia é avaliada continuamente por velocidade de busca,
            repercussão em redes, autoridade da fonte, proximidade de lançamentos e
            concorrência já publicada. A combinação desses sinais define a posição e
            a faixa de urgência abaixo.
          </p>
          {/* As faixas continuam explicadas — pelo NOME, não pelo intervalo
              numérico. O leitor entende a hierarquia; o concorrente não ganha a
              régua de corte de graça. */}
          <ul className="side-list">
            <li>
              <span className="heat heat--hot">Urgente</span> vai ao ar agora
            </li>
            <li>
              <span className="heat heat--rise">Em alta</span> subindo rápido
            </li>
            <li>
              <span className="heat heat--base">Relevante</span> fluxo normal
            </li>
            <li>
              <span className="heat heat--ever">Guia</span> vale a qualquer momento
            </li>
          </ul>
          <p className="form-hint">
            O que <em>nunca</em> influencia essa seleção: anúncio, link de afiliado e parceria
            comercial.
          </p>
          <Link href={routes.methodology()} className="link-more">
            Como escolhemos o que publicar
          </Link>
        </section>

        {/*
          Opt-in de push CONTEXTUALIZADO aqui: "quem abre esta página é, por
          definição, quem quer saber primeiro". Pedir permissão no contexto
          certo é o que separa aceitação de bloqueio permanente.
        */}
        <PushOptIn
          headline="Não perca a próxima urgente"
          reason="Avisamos assim que uma notícia entrar na faixa Urgente."
          frequencyPromise="No máximo 2 por dia."
        />

        <NewsletterForm
          title="Receba o resumo diário"
          description="O que subiu no ranking, uma vez por dia."
          source="trending-sidebar"
          variant="sidebar"
        />
      </aside>
    </div>
  );
}

function minutesSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
}

/**
 * Uma linha do ranking.
 *
 * Virou componente porque a lista agora é renderizada em dois trechos (antes e
 * depois do degrau) — e duas cópias do mesmo markup é como uma delas envelhece
 * sozinha. A POSIÇÃO vem por parâmetro, e não do índice do `map`, justamente
 * porque o segundo trecho não recomeça do 1.
 */
function RankRow({ item, position }: { item: ContentCardData; position: number }) {
  return (
    <li>
      <Link href={item.url} className={heatClass('rank', item.heat)}>
        <span className="rank__pos">{String(position).padStart(2, '0')}</span>
        <span>
          {/* Aqui, ao contrário da home, o badge textual entra na linha: esta
              página é o manifesto do termômetro, e o rótulo ("Urgente", "Em
              alta") é o que ela está justamente explicando. */}
          <span className="card__head">
            <HeatBadge heat={item.heat} />
          </span>
          <span className="rank__title">{item.title}</span>
          <span className="rank__meta meta">
            <span className={catClass(item.category.slug)}>{item.category.label}</span>
            <span className="meta__sep" aria-hidden="true" />
            <RelativeTime date={item.publishedAt} />
          </span>
        </span>
        <span className={heatClass('score', item.heat)}>
          <HeatBar heat={item.heat} level={item.heatLevel} />
          <TrendTag trend={item.trend} />
        </span>
      </Link>
    </li>
  );
}
