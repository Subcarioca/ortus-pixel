/**
 * =============================================================================
 * HOME
 * =============================================================================
 *
 * Estrutura (design/README.md §3):
 *   1. Ticker vermelho (só score >= 90)
 *   2. Hero — ocupa a dobra inteira no mobile
 *   3. "Em alta agora" — LISTA NUMERADA, não carrossel
 *   4. Feed cronológico por editoria
 *   5. "Seus universos" (chips de fandom) — ANTES da newsletter
 *   6. Newsletter
 *   7. Evergreen
 *
 * A ordem 5 antes de 6 é deliberada: "o convite mais fácil de aceitar (seguir
 * Zelda) vem antes do mais caro (me dá seu e-mail)".
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3 — o que mudou de vocabulário nesta página
 * -----------------------------------------------------------------------------
 * O markup usava nomes BEM inventados aqui (`.section__head`, `.rank-list__item`,
 * `.fandom-list`, `.hero-secondary`, `.grid--ever`) que NUNCA existiram na folha
 * de estilo do design. Como o produto carrega o CSS do design como fonte da
 * verdade, cada um desses nomes era um elemento sem estilo nenhum: o cabeçalho
 * de seção não era uma linha flex com o "ver mais" à direita, o ranking não era
 * uma grade de 3 colunas, os chips de fandom eram links soltos.
 *
 *   .section__head  → .section-head        .rank-list__item  → <li> + <a class="rank">
 *   .section__title → .section-title       .rank-list__num   → .rank__pos
 *   .section__dek   → .section-sub         .rank-list__title → .rank__title
 *   .hero__head     → .card__head          .rank-list__meta  → .rank__meta.meta
 *   .hero-secondary → .stack               .fandom-list      → .fandoms
 *   .grid--ever     → .g-sm-2.g-lg-4       .fandom__count    → .fandom__n
 *
 * Detalhe fácil de passar batido: `.grid` sozinho NÃO tem colunas no design —
 * ele é só `display:grid; gap`. As colunas vêm de `.g-sm-2` / `.g-md-3` /
 * `.g-lg-4`, que são utilitários com media query. Sem eles, todo feed do site
 * renderizava em uma coluna só, inclusive no desktop.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

import { CATEGORIES, catClass, catToken, heatClass, routes } from '@subcarioca/core';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';
import { homeAdSlots } from '@/lib/ads';
import { AdSlot } from '@/components/ad-slot';
import { ArticleCard } from '@/components/article-card';
import { HeatBadge } from '@/components/heat-badge';
import { HeatBar, TrendTag } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { RelativeTime } from '@/components/relative-time';
import { getHomeData, getTickerItems, getTopFranchises } from '@/server/queries';

/**
 * A home é dinâmica por natureza (o score muda), mas servida de cache.
 * `revalidate` aqui é a rede de segurança; o caminho principal de atualização
 * é a invalidação por evento disparada pelo curator. Ver server/queries.ts.
 */
export const revalidate = 60;

/**
 * Metadados da home.
 *
 * `title.absolute` — e não uma string simples — porque o layout raiz define o
 * template `%s | Ortus Pixel`. Com string simples, a home sairia como
 * "Ortus Pixel — As Notícias Nerd Mais Quentes, Primeiro | Ortus Pixel": a
 * marca duplicada, ocupando o espaço útil da SERP (~60 caracteres) duas vezes.
 * `absolute` diz ao Next para ignorar o template nesta rota.
 */
export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — As Notícias Nerd Mais Quentes, Primeiro` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: routes.home() },
};

export default async function HomePage() {
  // Paralelizamos: são três consultas independentes. Em série, a página
  // esperaria a soma dos tempos em vez do maior deles.
  const [home, tickerItems, franchises] = await Promise.all([
    getHomeData(),
    getTickerItems(),
    getTopFranchises(),
  ]);

  const [leadStory, ...secondaryHot] = home.hero;

  // Resolvido uma vez, no topo: a política comercial da home não muda no meio
  // da renderização, e consultá-la em dois pontos do JSX abriria espaço para
  // aplicar metade dela.
  const homeAds = homeAdSlots();

  return (
    <>
      {/* ---------- TICKER: só com score >= 90 ---------- */}
      {tickerItems.length > 0 && (
        <div className="ticker" role="region" aria-label="Últimas notícias urgentes">
          <div className="container ticker__inner">
            <span className="ticker__label">
              <span className="live-dot" aria-hidden="true" />
              Urgente
            </span>
            <ul className="ticker__list">
              {tickerItems.map((item) => (
                <li key={item.id}>
                  <Link href={item.url}>{item.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="container">
        {/* ---------- HERO ---------- */}
        {leadStory ? (
          // `.hero-layout` é uma grade de duas colunas (1.62fr / 1fr) a partir
          // de 1024px. Com uma única notícia quente — que é o estado NORMAL do
          // site, não a exceção — a segunda coluna ficaria vazia e o hero
          // ocuparia 62% da largura com um buraco ao lado. Sem os secundários,
          // o hero simplesmente ocupa a linha inteira.
          <section
            className={secondaryHot.length > 0 ? 'hero-layout' : undefined}
            aria-labelledby="hero-titulo"
          >
            <article className="hero">
              {leadStory.coverImageUrl && (
                <div className="hero__media">
                  {/*
                    `.thumb` é o contêiner de imagem do design — é ele que traz
                    a razão de aspecto e o recorte. Dentro do `.hero__media` ele
                    perde o 16:9 e passa a ocupar a altura toda (4:3 no mobile,
                    21:9 no desktop). A foto real entra pela ponte
                    `.thumb > img` da seção 17 do CSS. `data-c` pinta o
                    gradiente da editoria enquanto a foto não chega.
                  */}
                  <div className="thumb" data-c={catToken(leadStory.category.slug)}>
                    <Image
                      src={leadStory.coverImageUrl}
                      alt={leadStory.coverImageAlt ?? ''}
                      width={1280}
                      height={720}
                      // ÚNICA imagem com `priority` na página: é o elemento de LCP.
                      // Marcar outras competiria por banda e pioraria a métrica.
                      priority
                      sizes="(max-width: 1024px) 100vw, 66vw"
                    />
                  </div>
                  <div className="hero__overlay" aria-hidden="true" />
                </div>
              )}

              <div className="hero__body">
                {/* `.card__head` é a linha de badges do design, reaproveitada
                    pelo hero no protótipo — não existe `.hero__head`. */}
                <div className="card__head">
                  <HeatBadge heat={leadStory.heat} size="lg" />
                  <HeatBar heat={leadStory.heat} level={leadStory.heatLevel} />
                  <TrendTag trend={leadStory.trend} />
                  <Link
                    href={routes.category(leadStory.category.slug)}
                    className={catClass(leadStory.category.slug)}
                  >
                    {leadStory.category.label}
                  </Link>
                </div>

                <h1 id="hero-titulo" className="hero__title">
                  <Link href={leadStory.url}>{leadStory.title}</Link>
                </h1>

                <p className="hero__dek">{leadStory.excerpt}</p>

                <footer className="hero__foot">
                  <span className="meta">
                    <RelativeTime date={leadStory.publishedAt} />
                  </span>
                  {leadStory.franchises[0] && (
                    <Link
                      href={routes.franchise(leadStory.franchises[0].slug)}
                      className="chip chip--hot"
                    >
                      {leadStory.franchises[0].label}
                    </Link>
                  )}
                </footer>
              </div>
            </article>

            {/* Demais "quentes" (o teto de 3 já foi aplicado no servidor).
                No protótipo esta coluna é `.stack` — o utilitário de empilhar
                com espaçamento do design. `.hero-secondary` não existia. */}
            {secondaryHot.length > 0 && (
              <div className="stack">
                {secondaryHot.map((item) => (
                  <ArticleCard key={item.id} item={item} variant="grid" />
                ))}
              </div>
            )}
          </section>
        ) : (
          // ESTADO VAZIO — o mais comum do dia, e por isso previsto no layout.
          // Um portal sem notícia quente agora é normal; a página não pode
          // parecer quebrada por causa disso.
          <section className="empty-state">
            <h1>Nada urgente no momento</h1>
            <p>
              Nenhuma notícia cruzou o limiar de urgência agora. Veja o que está subindo em{' '}
              <Link href={routes.trending()}>Em alta</Link>.
            </p>
          </section>
        )}

        {/* ---------- EM ALTA AGORA: lista numerada ---------- */}
        {home.trending.length > 0 && (
          <section className="section" aria-labelledby="em-alta-titulo">
            <div className="section-head">
              <div>
                <h2 id="em-alta-titulo" className="section-title">
                  Em alta agora
                </h2>
                <p className="section-sub">
                  <span className="live-dot" aria-hidden="true" /> Ranking recalculado
                  continuamente
                </p>
              </div>
              <Link href={routes.trending()} className="link-more">
                Ver ranking completo
              </Link>
            </div>

            {/*
              Lista ORDENADA (<ol>), não uma grade de cards. Decisão do design:
              "Lista ranqueada comunica competição e movimento, cabe 6 itens em
              uma tela de celular e é muito mais barata de escanear."
              O <ol> também é semanticamente correto: a ordem tem significado.

              ANATOMIA DO DESIGN (`.rank`): três colunas fixas —
              posição (34px) · título+meta (1fr) · termômetro (auto). O <li>
              existe só pela semântica de lista ordenada e é `display:contents`
              (ponte da seção 17), então quem desenha a linha é o `.rank`. Sem
              isso, o <li> viraria uma caixa entre a grade e o conteúdo e as
              três colunas colapsariam em uma.
            */}
            <ol className="rank-list">
              {home.trending.map((item, index) => (
                <li key={item.id}>
                  {/* `heatClass` porque `.rank` só tem modificador para as duas
                      faixas quentes: no design, "relevante" e "guia" usam a
                      linha neutra. `rank--${item.heat}` gerava `.rank--base` e
                      `.rank--ever`, que não existem. */}
                  <Link href={item.url} className={heatClass('rank', item.heat)}>
                    {/* Posição em mono, com zero à esquerda: é o único número
                        público da página e precisa parecer "medida", não texto. */}
                    <span className="rank__pos">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="rank__title">{item.title}</span>
                      <span className="rank__meta meta">
                        <span className={catClass(item.category.slug)}>
                          {item.category.label}
                        </span>
                        <span className="meta__sep" aria-hidden="true" />
                        <RelativeTime date={item.publishedAt} />
                      </span>
                    </span>
                    {/* `.score` agrupa termômetro + tendência à direita. O
                        NÚMERO (`.score__num`) não entra aqui: é /admin. */}
                    <span className={heatClass('score', item.heat)}>
                      <HeatBar heat={item.heat} level={item.heatLevel} />
                      <TrendTag trend={item.trend} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Leaderboard DEPOIS do ranking (design §7.1, linha "Home").
            Fica fora da <section> do ranking de propósito: dentro dela, o
            anúncio seria lido como parte do bloco editorial — exatamente o que
            a §7 existe para impedir. */}
        {homeAds.afterTrending && <AdSlot slot={homeAds.afterTrending} />}

        {/* ---------- FEED CRONOLÓGICO ---------- */}
        {home.feed.length > 0 && (
          <section className="section" aria-labelledby="ultimas-titulo">
            <div className="section-head">
              <h2 id="ultimas-titulo" className="section-title">
                Últimas notícias
              </h2>
            </div>
            {/* `g-sm-2 g-md-3`: 1 coluna no celular, 2 a partir de 640px e 3 a
                partir de 900px — a mesma grade das editorias da home no
                protótipo. */}
            <div className="grid g-sm-2 g-md-3">
              {home.feed.map((item) => (
                <ArticleCard key={item.id} item={item} variant="grid" />
              ))}
            </div>

            {/* Retângulo no FIM da grade — nunca no meio dela. Um slot entre
                cards quebraria a leitura da grade e competiria com o conteúdo
                que a pessoa veio ver; aqui, ela já rolou a home inteira. */}
            {homeAds.endOfFeed && <AdSlot slot={homeAds.endOfFeed} />}
          </section>
        )}

        {/* ---------- SEUS UNIVERSOS (antes da newsletter) ---------- */}
        {franchises.length > 0 && (
          <section className="section" aria-labelledby="universos-titulo">
            <div className="section-head">
              <div>
                <h2 id="universos-titulo" className="section-title">
                  Seus universos
                </h2>
                <p className="section-sub">
                  Siga uma franquia e receba só o que importa dela.
                </p>
              </div>
              <Link href={routes.trending()} className="link-more">
                Ver todos os hubs
              </Link>
            </div>
            {/*
              `.fandoms` é o contêiner (flex + wrap) e `.fandom` é a pílula. A
              versão anterior invertia os papéis do miolo: usava `.fandom__n`
              (que no design é o CONTADOR, em mono e cinza) para o NOME da
              franquia, e um `.fandom__count` inexistente para o número. O
              resultado era o nome em cinza-mono minúsculo e o contador com o
              peso do nome — hierarquia exatamente ao contrário.
            */}
            <div className="fandoms">
              {franchises.map((franchise) => (
                <Link
                  key={franchise.slug}
                  href={routes.franchise(franchise.slug)}
                  className="fandom"
                >
                  {/* Sigla no disco colorido. O protótipo escolhe a cor pela
                      editoria da franquia; o dado de `getTopFranchises` não
                      traz categoria, então fica o neutro (`--ink-2`, o valor
                      padrão de `--f`) em vez de inventarmos uma cor. */}
                  <span className="fandom__ico" aria-hidden="true">
                    {abbreviate(franchise.name)}
                  </span>
                  {franchise.name}
                  <span className="fandom__n">
                    {franchise.followerCount.toLocaleString('pt-BR')}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ---------- NEWSLETTER ---------- */}
        <section className="section">
          <NewsletterForm
            title="O resumo do dia nerd no seu e-mail"
            description="Uma edição por dia, com o que realmente importou. Sem spam."
            source="home"
          />
        </section>

        {/* ---------- EVERGREEN ---------- */}
        {home.evergreen.length > 0 && (
          <section className="section" aria-labelledby="guias-titulo">
            <div className="section-head">
              <div>
                <h2 id="guias-titulo" className="section-title">
                  Guias e essenciais
                </h2>
                <p className="section-sub">
                  Conteúdo que não vence: listas definitivas, explicações e comparativos.
                </p>
              </div>
            </div>
            {/* Evergreen usa 4 colunas a partir de 1100px: os cards são só
                filete + título, então cabem mais por linha sem apertar. */}
            <div className="grid g-sm-2 g-lg-4">
              {home.evergreen.map((item) => (
                <ArticleCard key={item.id} item={item} variant="grid" />
              ))}
            </div>
          </section>
        )}

        {/* Ordem das editorias = ordem das personas (design §3).
            `.filters` é o carrossel de chips do design: rola na horizontal no
            celular (sem barra visível) e quebra em linhas no desktop. */}
        <nav className="section" aria-label="Todas as editorias">
          <h2 className="section-title">Editorias</h2>
          <div className="filters">
            {CATEGORIES.map((category) => (
              <Link
                key={category.slug}
                href={routes.category(category.slug)}
                className="chip"
              >
                {/*
                  CLASSE INERTE REMOVIDA, COR RECUPERADA DE OUTRO JEITO.

                  Antes o chip levava `chip cat--${category.slug}`, e isso estava
                  errado por dois motivos independentes:

                  1. O slug da URL não é o token do design (`cinema-e-series` vs
                     `cinema`), então metade dos modificadores apontava para uma
                     classe inexistente.
                  2. Mesmo com o token certo, não adiantaria: `.cat--*` só
                     DECLARA a variável `--c`, e `.chip` não lê `--c` em lugar
                     nenhum. A classe era decorativa sem decorar nada — o pior
                     tipo de código, porque parece intencional.

                  O protótipo tem um idioma pronto para "marcador colorido da
                  editoria": um `.cat` VAZIO, que renderiza só o filete de 14×3px
                  do `::before` (index.html usa exatamente isso ao lado do título
                  de seção). Reaproveitamos esse idioma aqui em vez de inventar
                  um modificador de chip que o design não tem.

                  `aria-hidden` porque é redundante: o nome da editoria vem
                  escrito ao lado, em texto.
                */}
                <span className={catClass(category.slug)} aria-hidden="true" />
                {category.name}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}

/**
 * Sigla de até 3 letras para o disco do `.fandom__ico`.
 *
 * Regra: com duas ou mais palavras, as iniciais ("One Piece" → "OP"); com uma
 * só, as três primeiras letras ("Zelda" → "ZEL"). Numerais romanos e algarismos
 * ("GTA VI") caem naturalmente no primeiro caso. É apresentação pura, então
 * mora aqui e não no domínio.
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
