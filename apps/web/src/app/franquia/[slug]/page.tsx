/**
 * =============================================================================
 * HUB DE FRANQUIA — /franquia/{slug}
 * =============================================================================
 *
 * PEÇA CENTRAL DE RETENÇÃO do produto.
 *
 * A lógica de negócio: o leitor chega por uma notícia via Google (visita
 * única, sem vínculo) e FICA porque encontrou a casa do fandom dele. É a
 * principal alavanca de "% de visitantes recorrentes", um dos KPIs do briefing.
 *
 * Quatro blocos, na ordem definida pelo design:
 *   1. Cabeçalho de identidade com CONTAGEM REGRESSIVA para o lançamento
 *      (motivo de revisita diária).
 *   2. Últimas — o que mudou desde a última visita.
 *   3. Linha do tempo — resolve a dor real do fã: "perdi alguma coisa?".
 *   4. Essencial (evergreen) — porta de entrada para quem chega agora.
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .section__head/__title/__dek → .section-head/.section-title/.section-sub
 *   .timeline__item  → .tl-item      ·  .timeline__date → .tl-time
 *   .timeline__title → .tl-body h3   ·  .grid--ever     → .g-sm-2
 *
 * O caso mais grave estava na CONTAGEM REGRESSIVA. O markup usava
 * `<div class="countdown">` com um par <dt>/<dd> dentro. No design, `.countdown`
 * é só o contêiner flex, e quem desenha a caixinha é o `.cd-box` (fundo, borda,
 * `<b>` mono grande + `<span>` de unidade). Sem `.cd-box`, a contagem —
 * literalmente o motivo de o fã voltar todo dia — saía como texto corrido no
 * meio das estatísticas.
 *
 * Nota para quem vier depois: `.cd-box` significa COUNTDOWN box. Não é a caixa
 * genérica de sidebar (essa é `.side-box`). Os dois nomes existem no design e
 * são componentes diferentes.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { catClass, routes } from '@canalnerd/core';

import { DISCORD_INVITE_URL } from '@/lib/site';
import { ArticleCard } from '@/components/article-card';
import { BreadcrumbJsonLd, CollectionJsonLd } from '@/components/json-ld';
import { PushOptIn } from '@/components/push-opt-in';
import { getFranchiseHub } from '@/server/queries';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getFranchiseHub(slug);
  if (!data) return {};

  const { franchise } = data;

  /**
   * O padrão de título/descrição é o do protótipo `design/hub-franquia.html`,
   * com o nome da franquia interpolado — para GTA VI ele resolve exatamente na
   * copy homologada. Ele descreve os quatro blocos que a página realmente tem
   * (notícias, linha do tempo, trailers, data de lançamento), o que casa com as
   * buscas típicas de fandom ("gta 6 data de lançamento") melhor do que o
   * genérico "todas as notícias e novidades" que estava aqui.
   *
   * A descrição do banco continua tendo precedência: ela é o texto que a
   * redação escreveu para AQUELA franquia.
   */
  return {
    title: `${franchise.name} — Notícias, Trailers e Data de Lançamento`,
    description:
      franchise.description ||
      `Tudo sobre ${franchise.name} em um só lugar: últimas notícias, linha do tempo, trailers e data de lançamento.`,
    alternates: { canonical: routes.franchise(slug) },
    openGraph: {
      title: franchise.name,
      description: franchise.description,
      type: 'website',
      images: franchise.heroImageUrl ? [franchise.heroImageUrl] : undefined,
    },
  };
}

export default async function FranchiseHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Slug de franquia é criado por editores (não é lista fechada como categoria),
  // então validamos o FORMATO antes de consultar o banco.
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();

  const data = await getFranchiseHub(slug);
  if (!data) notFound();

  const { franchise, latest, evergreen, nextRelease, timeline } = data;

  const daysUntilRelease = nextRelease
    ? Math.ceil((nextRelease.releaseDate.getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: franchise.categoryName, url: routes.category(franchise.categorySlug) },
          { name: franchise.name, url: routes.franchise(slug) },
        ]}
      />
      <CollectionJsonLd
        name={franchise.name}
        description={franchise.description}
        url={routes.franchise(slug)}
        items={latest.map((a) => ({ title: a.title, url: a.url }))}
      />

      {/* ---------- 1. CABEÇALHO DE IDENTIDADE ----------
          `.hub-hero` é um CARTÃO (borda, cantos arredondados, gradiente de
          marca), então ele vai DENTRO do `.container` — antes era o contrário,
          e o cartão sangrava de borda a borda da janela, sem margem lateral. */}
      <div className="container">
        <header className="hub-hero">
          <div className="hub-hero__row">
            {/* Sigla da franquia no quadrado de identidade: é o que dá "cara"
                ao hub sem depender de um logo que talvez não exista. */}
            <div className="hub-hero__logo" aria-hidden="true">
              {abbreviate(franchise.name)}
            </div>
            {/* Sem `style` inline aqui (o protótipo usa `flex:1;min-width:220px`):
                com as estatísticas movidas para a faixa de baixo, este bloco é o
                único irmão do logo e já ocupa o espaço restante sozinho. */}
            <div>
              <Link
                href={routes.category(franchise.categorySlug)}
                className={catClass(franchise.categorySlug)}
              >
                {franchise.categoryName}
              </Link>
              <h1 className="article__title">{franchise.name}</h1>
              {franchise.description && (
                <p className="hub-hero__desc">{franchise.description}</p>
              )}
            </div>
          </div>

          {/* `.hub-stats` é uma FAIXA abaixo da identidade, com filete no topo
              separando "quem é esta franquia" de "como ela está agora" — não
              uma terceira coluna dentro do `.hub-hero__row`. */}
          <dl className="hub-stats">
              <div>
                <dt className="hub-stat__lbl">Seguidores</dt>
                <dd className="hub-stat__num">
                  {franchise.followerCount.toLocaleString('pt-BR')}
                </dd>
              </div>
              {/* CONTAGEM REGRESSIVA: motivo de revisita diária e conexão direta
                  com o sinal de "proximidade de lançamento" do score.

                  `aria-label` no `.countdown` porque a caixinha visual quebra o
                  número da unidade ("113" / "dias") em dois elementos: lido em
                  voz alta, sairia "cento e treze, dias, lançamento". A frase
                  inteira no rótulo resolve — e o conteúdo visual fica
                  `aria-hidden` para não ser anunciado duas vezes. */}
              {nextRelease && daysUntilRelease !== null && daysUntilRelease >= 0 && (
                <div>
                  <dt className="hub-stat__lbl">{nextRelease.title}</dt>
                  <dd>
                    <span
                      className="countdown"
                      aria-label={
                        daysUntilRelease === 0
                          ? 'Lançamento é hoje'
                          : `Faltam ${daysUntilRelease} dias para o lançamento`
                      }
                    >
                      <span className="cd-box" aria-hidden="true">
                        <b>{daysUntilRelease === 0 ? '0' : daysUntilRelease}</b>
                        <span>{daysUntilRelease === 1 ? 'dia' : 'dias'}</span>
                      </span>
                    </span>
                  </dd>
                </div>
              )}
          </dl>

          {/*
            Três ações de retenção lado a lado, do degrau mais barato ao mais
            caro do funil: Seguir (grátis) -> Push (permissão) -> Discord
            (comunidade). Colocá-las juntas deixa o próximo passo sempre visível.
          */}
          <div className="hub-actions">
            <button type="button" className="btn btn--primary">
              Seguir {franchise.name}
            </button>
            <a
              href={DISCORD_INVITE_URL}
              className="btn btn--discord"
              // `noopener` impede que a página de destino acesse `window.opener`
              // e redirecione a nossa aba (ataque de tabnabbing). `noreferrer`
              // evita vazar a URL de origem.
              rel="noopener noreferrer"
              target="_blank"
            >
              Canal #{slug} no Discord
            </a>
          </div>
        </header>
      </div>

      <div className="container layout-2col">
        <div>
          {/* ---------- 2. ÚLTIMAS ---------- */}
          <section className="section" aria-labelledby="ultimas-hub">
            <div className="section-head">
              <h2 id="ultimas-hub" className="section-title">
                Últimas de {franchise.name}
              </h2>
            </div>

            {latest.length === 0 ? (
              <p className="empty-state">Ainda não há notícias desta franquia.</p>
            ) : (
              <div className="grid g-sm-2">
                {latest.map((item, index) => (
                  <ArticleCard key={item.id} item={item} variant="grid" priority={index === 0} />
                ))}
              </div>
            )}
          </section>

          {/* ---------- 3. LINHA DO TEMPO ---------- */}
          {timeline.length > 0 && (
            <section className="section" aria-labelledby="timeline-hub">
              <div className="section-head">
                <div>
                  <h2 id="timeline-hub" className="section-title">
                    Linha do tempo
                  </h2>
                  <p className="section-sub">
                    Do anúncio até agora — para você não perder nada.
                  </p>
                </div>
              </div>

              {/*
                Anatomia da `.timeline` no design: `.tl-item` é a grade de duas
                colunas (74px de data + corpo), `.tl-time` é a data em mono
                alinhada à direita e `.tl-body` é o bloco que carrega a bolinha
                e o fio vertical (ambos em `::before`). Sem `.tl-body`, o fio
                simplesmente não existe — e uma "linha do tempo" sem linha é só
                uma lista com datas.
              */}
              <ol className="timeline">
                {timeline.map((entry) => (
                  <li key={entry.id} className="tl-item">
                    <time dateTime={entry.publishedAt?.toISOString()} className="tl-time">
                      {entry.publishedAt?.toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </time>
                    <div className="tl-body">
                      {/* h3 (e não h4) porque o cabeçalho da seção acima é h2:
                          o nível segue a hierarquia do documento; o TAMANHO
                          vem da ponte `.tl-body :is(h3, h5)` da seção 17. */}
                      <h3>
                        <Link href={`/${entry.category.slug}/${entry.slug}`}>
                          {entry.title}
                        </Link>
                      </h3>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- 4. ESSENCIAL (evergreen fixado) ---------- */}
          {evergreen.length > 0 && (
            <section className="section" aria-labelledby="essencial-hub">
              <div className="section-head">
                <div>
                  <h2 id="essencial-hub" className="section-title">
                    Essencial
                  </h2>
                  <p className="section-sub">
                    Chegando agora em {franchise.name}? Comece por aqui.
                  </p>
                </div>
              </div>
              <div className="grid g-sm-2">
                {evergreen.map((item) => (
                  <ArticleCard key={item.id} item={item} variant="grid" />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="sidebar">
          <PushOptIn
            headline={`Alertas de ${franchise.name}`}
            reason={`Avisamos quando algo grande acontecer com ${franchise.name}.`}
            frequencyPromise="Só o que for realmente urgente."
          />
        </aside>
      </div>
    </>
  );
}

/**
 * Sigla de até 3 letras para o `.hub-hero__logo`.
 *
 * Mesma regra da home (iniciais quando há mais de uma palavra, três primeiras
 * letras quando há só uma). São duas cópias curtas de propósito: é formatação
 * de apresentação, e um util compartilhado entre duas páginas para 6 linhas
 * custaria mais em indireção do que economiza em duplicação. Se aparecer um
 * terceiro uso, aí sim vale extrair.
 */
function abbreviate(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 3)
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase();
  }
  return (words[0] ?? '').slice(0, 3).toUpperCase();
}
