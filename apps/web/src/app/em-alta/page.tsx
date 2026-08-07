/**
 * =============================================================================
 * PÁGINA "EM ALTA" — o ranking ao vivo por score
 * =============================================================================
 *
 * É a página-manifesto do produto: expõe publicamente o mecanismo de curadoria.
 * Também atende ao requisito do briefing de "página/API de Trending que exponha
 * o ranking ao vivo por score".
 *
 * DECISÃO DE PRODUTO RESOLVIDA (era a pendência §7.3 do design; ver ADR 0009):
 * o score numérico NÃO é mais exibido publicamente. Esta página continua sendo
 * o ranking ao vivo — a ORDEM é a informação, e ela permanece intacta —, mas o
 * número de 0 a 100 ficou restrito ao /admin.
 *
 * O que se perde: um pouco de transparência ("por que este está em 1º?").
 * O que se compensa: a caixa "Como calculamos o score" e a página /metodologia
 * continuam explicando o MÉTODO. A diferença é entre publicar a receita e
 * publicar o resultado de cada prova — a primeira constrói E-E-A-T, a segunda
 * entrega calibração de graça para o concorrente.
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
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { catClass, heatClass, routes } from '@canalnerd/core';

import { ArticleCard } from '@/components/article-card';
import { HeatBadge } from '@/components/heat-badge';
import { HeatBar, TrendTag } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { PushOptIn } from '@/components/push-opt-in';
import { RelativeTime } from '@/components/relative-time';
import { getTrendingRanking } from '@/server/queries';

export const revalidate = 60;

/**
 * O título NÃO leva sufixo de marca escrito à mão: o template do layout raiz
 * (`%s | Ortus Pixel`) já o acrescenta. Escrever "| Ortus Pixel" aqui produziria
 * a marca duas vezes no mesmo <title>.
 *
 * CORREÇÃO DE CONFORMIDADE (ADR 0009) junto com o reposicionamento: a descrição
 * anterior dizia que o ranking era "ordenado pelo nosso score de popularidade".
 * Era uma promessa que a página não cumpre mais — e não deve cumprir: o número
 * de 0 a 100 é interno ao /admin, e anunciá-lo na SERP criaria a expectativa de
 * encontrá-lo na página (frustração do leitor) além de entregar ao concorrente
 * a informação de que existe um número calibrável. O que a descrição vende
 * agora é o que a página de fato entrega: a ORDEM, ao vivo.
 */
export const metadata: Metadata = {
  title: 'Em Alta — O Que Está Bombando no Universo Nerd',
  description:
    'Ranking ao vivo do que está bombando agora: games, cinema, animes e tech, atualizado em tempo real. Sem número de score exposto, sem clickbait — só o que importa.',
  alternates: { canonical: routes.trending() },
};

export default async function TrendingPage() {
  const { ranking, belowThreshold, stats } = await getTrendingRanking();

  const [podium, ...rest] = ranking;

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
            <span className="heat heat--hot heat--lg">Ao vivo</span>
            {stats.lastUpdatedAt && (
              <span className="meta">
                atualizado há {minutesSince(stats.lastUpdatedAt)} min
              </span>
            )}
          </div>

          <h1 className="article__title">Em alta agora</h1>
          <p className="hub-hero__desc">
            Ranking recalculado continuamente a partir de buscas, redes sociais e
            repercussão. <Link href={routes.methodology()}>Entenda o cálculo</Link>.
          </p>

          <dl className="hub-stats">
            <div>
              <dt className="hub-stat__lbl">Urgentes agora</dt>
              <dd className="hub-stat__num">{stats.hotCount}</dd>
            </div>
            <div>
              <dt className="hub-stat__lbl">Em alta</dt>
              <dd className="hub-stat__num">{stats.risingCount}</dd>
            </div>
            <div>
              <dt className="hub-stat__lbl">Publicadas hoje</dt>
              <dd className="hub-stat__num">{stats.todayCount}</dd>
            </div>
          </dl>
        </header>

        {/* ---------- PÓDIO: o #1 vira card grande ---------- */}
        {podium ? (
          <>
            <ArticleCard item={podium} variant="lead" rank={1} priority />

            {/* Do #2 em diante: lista densa. "Ranking sem hierarquia de tamanho
                vira planilha." */}
            <ol className="rank-list">
              {rest.map((item, index) => (
                <li key={item.id}>
                  <Link href={item.url} className={heatClass('rank', item.heat)}>
                    <span className="rank__pos">{String(index + 2).padStart(2, '0')}</span>
                    <span>
                      {/* Aqui, ao contrário da home, o badge textual entra na
                          linha: esta página é o manifesto do termômetro, e o
                          rótulo ("Urgente", "Em alta") é o que ela está
                          justamente explicando. */}
                      <span className="card__head">
                        <HeatBadge heat={item.heat} />
                      </span>
                      <span className="rank__title">{item.title}</span>
                      <span className="rank__meta meta">
                        <span className={catClass(item.category.slug)}>
                          {item.category.label}
                        </span>
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
              ))}
            </ol>
          </>
        ) : (
          <p className="empty-state">
            Nenhuma notícia na faixa de urgência no momento. O ritmo está calmo —
            aproveite para ver os <Link href={routes.home()}>destaques do dia</Link>.
          </p>
        )}

        {/* ---------- DEGRAU EXPLÍCITO ENTRE AS FAIXAS ----------
            O olho precisa perceber que dali para baixo o critério mudou. No
            protótipo é um rótulo mono seguido de um filete; `.divider--step`
            é essa linha com um <h2> de verdade dentro (a seção precisa de
            cabeçalho para o `aria-labelledby` e para o sumário do leitor de
            tela). O rótulo não cita o corte numérico — ver ADR 0009. */}
        {belowThreshold.length > 0 && (
          <section className="section" aria-labelledby="abaixo-titulo">
            <div className="divider divider--step">
              <h2 id="abaixo-titulo">Fim do &ldquo;em alta&rdquo; · fluxo normal</h2>
            </div>
            <div className="grid g-sm-2">
              {belowThreshold.map((item) => (
                <ArticleCard key={item.id} item={item} variant="grid" />
              ))}
            </div>
          </section>
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
            O que <em>não</em> entra na conta: anúncio, link de afiliado e parceria
            comercial. Nunca.
          </p>
          <Link href={routes.methodology()} className="link-more">
            Metodologia completa
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
