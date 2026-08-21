/**
 * =============================================================================
 * HOME
 * =============================================================================
 *
 * Estrutura (design/README.md §3):
 *   1. Ticker vermelho (só score >= 90)
 *   2. Hero — ocupa a dobra inteira no mobile
 *   3. "Em alta agora" — LISTA NUMERADA, não carrossel
 *   4. Feed cronológico por editoria  ← SUPERADO: ver "ordenada por repercussão"
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
 *
 * -----------------------------------------------------------------------------
 * REFORMA v0.4 — "o score determina a hierarquia, nunca a existência"
 * -----------------------------------------------------------------------------
 * Todas as seções desta página eram condicionadas a uma faixa de score, e o
 * resultado é que a home ficava vazia no estado NORMAL do site: um portal que
 * publica poucas matérias por dia quase nunca tem algo acima do limiar de
 * urgência, e mesmo assim tem o que mostrar.
 *
 * Três mudanças, todas de seleção — nenhuma de layout:
 *
 *  1. HERO EM CASCATA. Urgente → em alta ("Destaque de hoje") → mais recente
 *     ("Última publicada") → estado vazio de verdade. O rótulo muda junto com o
 *     degrau porque cada nível é uma afirmação diferente sobre a matéria, e
 *     chamar de "Urgente" o que não é seria mentir para o leitor (Nielsen #2).
 *  2. "MAIS REPERCUTIDO AGORA" É A SEÇÃO-ÂNCORA, sem filtro de faixa. Com UMA
 *     matéria publicada a home já é um portal.
 *  3. "GUIAS E ESSENCIAIS" seleciona por FORMATO. Antes selecionava por score
 *     baixo, e por isso um breaking que não repercutiu aparecia rotulado como
 *     "Guia" — incorreção editorial, não questão de gosto.
 *
 * O que NÃO entrou, e por quê: os blocos "3 cards por editoria" da proposta.
 * Com menos de 5 publicações por dia, as mesmas matérias que já estão no hero e
 * na seção-âncora reapareceriam pela terceira vez — a home pareceria maior e
 * seria mais pobre.
 *
 * -----------------------------------------------------------------------------
 * A HOME INTEIRA É ORDENADA POR REPERCUSSÃO (decisão do dono do produto)
 * -----------------------------------------------------------------------------
 * A seção-âncora nasceu CRONOLÓGICA, seguindo a regra antiga do design ("a
 * temperatura muda o peso, não a ordem cronológica"). Essa regra foi revista: a
 * home estampa a matéria de maior popularidade no topo e segue em score
 * decrescente até o fim da grade, com a data servindo só de desempate.
 *
 * A página passou a ser, de cima a baixo, UMA lista ordenada por repercussão:
 * hero (1º) → "Em alta agora" (a faixa quente, em lista numerada) → a grade
 * (todo o resto). É por isso que a grade exclui os itens do ranking: com a
 * ordem igual nos dois blocos, os primeiros cards seriam uma cópia da lista
 * imediatamente acima.
 *
 * O corte cronológico não desapareceu do site — ele vive nas páginas de
 * editoria, que continuam ordenadas por data de publicação.
 */

import type { CSSProperties } from 'react';
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
import { getHomeData, getMostPopularWeekly, getTickerItems, getTopFranchises } from '@/server/queries';

/**
 * =============================================================================
 * SLOTS COMERCIAIS DA HOME
 * =============================================================================
 *
 * A REGRA QUE MANDA AQUI: o hero é ZONA LIVRE DE ANÚNCIO, seja qual for o nível
 * da cascata que o produziu. Nada comercial antes dele, ao lado dele ou logo
 * depois dele. Quem chega na home vê primeiro o que o site considera a matéria
 * do momento — se a primeira coisa entre o topo e o conteúdo for um retângulo,
 * a hierarquia editorial que a página inteira defende deixa de ser crível.
 *
 * Os specs em si vêm de `homeAdSlots()` (`lib/ads.ts`), que já devolve `null`
 * sem Publisher ID configurado. As duas guardas que impedem o anúncio de
 * escorregar para debaixo do hero vivem no JSX, não aqui:
 *
 *  - o leaderboard só renderiza com `home.trending.length > 0` — sem ranking,
 *    sem slot;
 *  - o retângulo do fim da grade exige uma grade com corpo (`MIN_CARDS`). Num
 *    dia de 2 cards, o "fim da grade" fica a um palmo do hero.
 */

/** Abaixo disso, "fim da grade" ainda é perto demais do hero. */
const GRID_END_AD_MIN_CARDS = 4;

/**
 * Renderização sob demanda (SSR), pelo mesmo motivo de `categoria/[slug]`:
 * sem rota dinâmica nos parâmetros, a home é uma das páginas SEMPRE incluídas
 * no pré-render do `next build` — e esse build roda no GitHub Actions, que
 * não alcança o MariaDB interno da Hostinger (`localhost:3306`, só acessível
 * de dentro da rede da Hostinger). Toda consulta de `getHomeData()` falhava
 * no build, `safeQuery` (queries.ts) engolia o erro e devolvia listas vazias,
 * e essa home ESTÁTICA E VAZIA — "Estamos preparando as primeiras matérias" —
 * era o HTML que ia para produção, sem nenhum aviso: o estado vazio de
 * verdade e o estado de build-sem-banco são visualmente idênticos de
 * propósito (é o "site novo" da página), o que tornou o bug invisível.
 *
 * Forçar dinâmico tira a home do pré-render: a query só roda a cada request,
 * já dentro da rede da Hostinger, onde o banco responde normalmente. O cache
 * de DADOS continua existindo — é o `unstable_cache({ revalidate: 60 })` de
 * `getHomeData` em server/queries.ts, uma camada independente da renderização
 * da página. `force-dynamic` não substitui aquele cache; só impede que a
 * PÁGINA em si fique congelada no HTML gerado no build.
 */
export const dynamic = 'force-dynamic';

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
  // Paralelizamos: são quatro consultas independentes. Em série, a página
  // esperaria a soma dos tempos em vez do maior deles.
  const [home, tickerItems, franchises, popularWeek] = await Promise.all([
    getHomeData(),
    getTickerItems(),
    getTopFranchises(),
    getMostPopularWeekly(),
  ]);

  const [leadStory, ...secondaryHot] = home.hero;

  /**
   * O HERO TEM COLUNA LATERAL NESTA RENDERIZAÇÃO?
   *
   * Extraído para uma constante porque a resposta governa DUAS coisas que
   * precisam concordar, e que até aqui eram decididas em pontos distantes do
   * JSX: a classe `.hero-layout` (que divide a linha em 1.62fr / 1fr a partir
   * de 1024px) e o `sizes` da foto do hero. Ver o comentário do `<Image>`
   * adiante para o bug que a discordância entre as duas causava.
   */
  const heroHasSideColumn = secondaryHot.length > 0;

  /**
   * ===========================================================================
   * QUAL IMAGEM DESTA PÁGINA É A CANDIDATA A LCP — resolvido UMA vez
   * ===========================================================================
   *
   * O ACHADO DO PAGESPEED: "Prioridade da imagem LCP inconsistente", com o
   * seletor `article.hero > div.hero__media > div.thumb > img` aparecendo sem
   * `fetchpriority=high`. Auditando os quatro degraus de `heroKind` ('hot',
   * 'rise', 'latest', 'none'), o resultado foi este:
   *
   *   - os TRÊS primeiros degraus renderizam o MESMO `<article class="hero">`, e
   *     ele sempre passou `priority`. Nenhum deles é o buraco.
   *   - o buraco é ORTOGONAL ao `heroKind`: é `leadStory.coverImageUrl` vazio.
   *     Uma matéria publicada sem capa (acontece: nota rápida, texto de agência,
   *     capa que o editor ainda vai trocar) faz o `.hero__media` inteiro deixar
   *     de existir — e aí a primeira imagem da página passa a ser a do card
   *     seguinte, que NUNCA recebia `priority` de ninguém.
   *
   * Ou seja: existe um estado real em que a home carrega sem UMA ÚNICA imagem
   * prioritária, e o elemento de LCP entra na fila com prioridade baixa e
   * `loading` preguiçoso — exatamente o sintoma relatado.
   *
   * A CORREÇÃO É ESCOLHER O ALVO, E NÃO ESPALHAR `priority`. Marcar vários
   * `<Image>` anularia o efeito: o navegador baixaria tudo ao mesmo tempo e o
   * LCP pioraria. Então resolvemos aqui, uma vez, QUAL id ganha a prioridade —
   * e o JSX abaixo só compara. A ordem da busca é a ordem VISUAL da página, de
   * cima para baixo, considerando apenas os blocos que renderizam foto:
   *
   *   1. o hero (quando tem capa) — o caso normal;
   *   2. o primeiro "quente" secundário — no desktop ele fica na coluna da
   *      direita, na mesma altura do hero, portanto acima da dobra;
   *   3. "Mais popular da semana" — o primeiro card com foto depois do hero;
   *   4. o primeiro card de "Mais repercutido agora".
   *
   * `undefined` (nenhum candidato) é um resultado legítimo e não um erro: é a
   * home do dia zero, ou um dia inteiro sem nenhuma capa. Como a comparação é
   * `item.id === lcpCandidateId`, um `undefined` simplesmente não casa com
   * nada — nenhum `priority` é emitido, que é o correto quando não há imagem.
   *
   * "Guias e essenciais" e "Acabou de sair" não entram na busca porque, por
   * construção, nenhum dos dois renderiza imagem (ver `ArticleCard` na variante
   * `ever` e a lista `.just-out__list`).
   */
  /*
    GENÉRICA E COM A RESTRIÇÃO MÍNIMA (`id` + `coverImageUrl`), em vez de
    tipada em `ContentCardData`: as três listas que ela recebe vêm de origens
    diferentes de `queries.ts` e nem todas são declaradas com aquele nome exato
    (a lista pontuada, por exemplo, é `ContentCardData` mais o campo `heat`
    recalculado). Amarrar a função ao nome do tipo faria uma refatoração
    inofensiva lá quebrar esta página aqui, por uma exigência que a função não
    tem: ela só precisa saber ler dois campos.
  */
  function firstCardWithCover<T extends { id: string; coverImageUrl?: string | null }>(
    items: readonly T[],
  ): T | undefined {
    return items.find((item) => Boolean(item.coverImageUrl));
  }

  const lcpCandidateId: string | undefined = leadStory?.coverImageUrl
    ? leadStory.id
    : (firstCardWithCover(secondaryHot)?.id ??
      (popularWeek && popularWeek.id !== leadStory?.id && popularWeek.coverImageUrl
        ? popularWeek.id
        : undefined) ??
      firstCardWithCover(home.feed)?.id);

  // Resolvido uma vez, no topo: a política comercial da home não muda no meio
  // da renderização, e consultá-la em dois pontos do JSX abriria espaço para
  // aplicar metade dela.
  const homeAds = homeAdSlots();

  // O único vazio legítimo do site: nada publicado. Todos os outros "vazios"
  // que a home exibia até aqui eram vazios FABRICADOS por filtro de score.
  const isFirstDay = home.heroKind === 'none';

  // Siglas do "Seus universos" resolvidas UMA vez para a lista inteira, e não
  // franquia por franquia dentro do `.map()`: unicidade só faz sentido em
  // relação às outras franquias que estão na MESMA tela (ver o comentário de
  // `resolveFranchiseAbbreviations`).
  const franchiseAbbreviations = resolveFranchiseAbbreviations(
    franchises.map((franchise) => franchise.name),
  );

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
            className={heroHasSideColumn ? 'hero-layout' : undefined}
            aria-labelledby="hero-titulo"
          >
            {/*
              `.hero-glow` (Tarefa A de UI) — halo ambiente FORA do cartão do
              hero, não dentro dele: `.hero` tem `overflow: hidden` (é o que dá
              os cantos arredondados e sustenta o recorte de rosto documentado
              logo abaixo), então um desfoque nascido dentro do cartão ficaria
              atrás da própria foto e nunca apareceria. Este `<Image>` extra é
              a MESMA foto (mesmo `src`/`width`/`height`/`sizes` do `<Image>`
              nítido dentro do `.hero__media`), decorativa e sem `priority` —
              o Next gera a mesma URL otimizada para os dois, e o navegador
              reaproveita o download em vez de duplicá-lo. Racional completo
              (incluindo por que o vazamento é pequeno e contido, ao contrário
              da capa da matéria) em ortuspixel.css §21.
            */}
            <div className="hero-glow">
              {leadStory.coverImageUrl && (
                <Image
                  src={leadStory.coverImageUrl}
                  alt=""
                  aria-hidden="true"
                  width={1280}
                  height={720}
                  sizes="(max-width: 1024px) 100vw, 66vw"
                  className="hero-glow__bg"
                />
              )}
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
                      // ÚNICA imagem com `priority` na página: é o elemento de
                      // LCP. Marcar outras competiria por banda e pioraria a
                      // métrica. Quando o hero NÃO tem capa, quem herda esta
                      // prioridade é o próximo card com foto — ver
                      // `lcpCandidateId`, no topo do componente.
                      priority
                      // O `sizes` ACOMPANHA O LAYOUT — e antes ele não acompanhava.
                      //
                      // O valor anterior era fixo em `66vw` acima de 1024px, o
                      // que descreve o hero DENTRO da grade de duas colunas
                      // (`.hero-layout`, 1.62fr de 2.62fr ≈ 62% da linha). Só
                      // que essa grade só existe quando há "quentes"
                      // secundários — e o comentário logo acima registra que o
                      // estado NORMAL do site é ter uma única matéria quente.
                      // Nesse estado o hero ocupa a LINHA INTEIRA do container
                      // (teto de 1280px, `--maxw`), e o navegador continuava
                      // ouvindo "isto vai ocupar 66% da janela": numa tela de
                      // 1440px ele pedia ~950px para um espaço de ~1232px e
                      // esticava o resultado em 1,3×. Esta é a SEGUNDA causa da
                      // queixa de imagem pixelada, e ela vivia justamente na
                      // foto mais visível do site.
                      //
                      // Agora são dois valores, um por layout:
                      //   · com coluna lateral → 62vw (a fração real da grade;
                      //     66 era arredondamento para cima);
                      //   · sem coluna lateral → 100vw até a janela alcançar o
                      //     teto do container e 1232px daí para cima (`--maxw`
                      //     de 1280 menos os 2×24px de recuo do `.container` a
                      //     partir de 768px). Abaixo de 1280 o `100vw`
                      //     superestima em ~48px, e superestimar é o lado
                      //     seguro de errar: sobra nitidez, não falta.
                      //
                      // Abaixo de 1024px a grade colapsa em uma coluna nos dois
                      // casos, e os dois valores dizem `100vw` — que é o certo.
                      sizes={
                        heroHasSideColumn
                          ? '(max-width: 1024px) 100vw, 62vw'
                          : '(max-width: 1280px) 100vw, 1232px'
                      }
                    />
                  </div>
                  <div className="hero__overlay" aria-hidden="true" />
                </div>
              )}

              <div className="hero__body">
                {/* `.card__head` é a linha de badges do design, reaproveitada
                    pelo hero no protótipo — não existe `.hero__head`. */}
                <div className="card__head">
                  {/*
                    O RÓTULO DA CASCATA.

                    "Urgente" é o badge padrão de temperatura e vem do
                    componente. Os outros dois são texto próprio desta página,
                    porque nomeiam a POSIÇÃO na home ("é o destaque de hoje"),
                    não a faixa do artigo — `HeatBadge` diria "Em alta", que é
                    verdade sobre o score e falso sobre o papel dele aqui.

                    "Última publicada" usa a cor neutra (`base`) de propósito:
                    quando não há temperatura para mostrar, inventar uma seria
                    exatamente o clickbait que o resto do design evita.
                  */}
                  {home.heroKind === 'hot' ? (
                    <HeatBadge heat={leadStory.heat} size="lg" />
                  ) : (
                    <span
                      className={`${heatClass('heat', home.heroKind === 'rise' ? 'rise' : 'base')} heat--lg`}
                    >
                      {home.heroKind === 'rise' ? 'Destaque de hoje' : 'Última publicada'}
                    </span>
                  )}

                  {/* Termômetro e tendência só aparecem quando MEDEM alguma
                      coisa. No degrau "mais recente" não há movimento medido —
                      um termômetro no mínimo ao lado do destaque principal diz
                      "isto aqui é irrelevante", que não é a mensagem. */}
                  {home.heroKind !== 'latest' && (
                    <>
                      <HeatBar heat={leadStory.heat} level={leadStory.heatLevel} />
                      <TrendTag trend={leadStory.trend} />
                    </>
                  )}

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
            </div>

            {/* Demais "quentes" (o teto de 3 já foi aplicado no servidor).
                No protótipo esta coluna é `.stack` — o utilitário de empilhar
                com espaçamento do design. `.hero-secondary` não existia. */}
            {heroHasSideColumn && (
              <div className="stack">
                {secondaryHot.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    variant="grid"
                    // Normalmente `false` — o hero é quem carrega a prioridade.
                    // Só vira `true` quando o hero saiu sem capa e este card é
                    // a primeira foto da página (ver `lcpCandidateId`).
                    priority={item.id === lcpCandidateId}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          /*
            ESTADO VAZIO DE VERDADE — só quando não há NENHUMA matéria publicada.

            A mensagem anterior ("Nenhuma notícia cruzou o limiar de urgência")
            errava duas vezes. Primeiro porque aparecia com o site cheio de
            conteúdo, escondendo o acervo atrás de um filtro. Segundo porque
            falava a língua do SISTEMA: "limiar de urgência" é vocabulário do
            nosso pipeline, e o leitor não faz ideia do que é — só entende que
            algo não deu certo (Nielsen #2 e #9).

            Aqui a página assume o que de fato acontece — o site é novo — e
            oferece DUAS saídas reais: a newsletter logo abaixo (que continua
            renderizada, incondicionalmente) e a lista de editorias no fim, que
            mostra o escopo da cobertura. Nenhum link para outra página que
            também estaria vazia; isso seria trocar um beco sem saída por outro.
          */
          <section className="empty-state">
            <h1>Estamos preparando as primeiras matérias</h1>
            <p>
              O {SITE_NAME} acabou de entrar no ar. A cobertura de games, cinema, anime e
              tech começa nos próximos dias: deixe seu e-mail aqui embaixo para receber a
              primeira edição, ou veja <Link href="#editorias">o que vamos cobrir</Link>.
            </p>
          </section>
        )}

        {/* ---------- MAIS POPULAR DA SEMANA ----------
            SEÇÃO ADICIONAL, NÃO SUBSTITUI O HERO. O hero acima é sobre o
            ALGORITMO (score do curator: HOT/RISING/mais recente); esta seção é
            sobre o LEITOR — a matéria dos últimos 7 dias com mais curtida +
            descurtida somadas (mesmo peso, ver Tarefa B). Ver o cabeçalho de
            `getMostPopularWeekly` em `server/queries.ts` para o racional
            completo, inclusive do porquê as duas fontes podem divergir.

            Escondida quando coincide com o próprio hero: mostrar a MESMA
            matéria duas vezes seguidas, uma vez como "destaque do momento" e
            de novo como "mais popular da semana", pareceria erro de layout em
            vez de dois critérios diferentes concordando por acaso. */}
        {popularWeek && popularWeek.id !== leadStory?.id && (
          <section className="section" aria-labelledby="popular-semana-titulo">
            <div className="section-head">
              <div>
                <h2 id="popular-semana-titulo" className="section-title">
                  Mais popular da semana
                </h2>
                <p className="section-sub">
                  Eleita pelos leitores — a matéria com mais reações nos últimos 7 dias.
                </p>
              </div>
            </div>
            {/* `.spotlight-panel` (Tarefa C de UI): esta é a única seção do
                feed movida pelo LEITOR, não pelo algoritmo — reaproveita o
                degradê de `.cta-news` (ortuspixel.css §23) para dar a ela mais
                peso visual que um card solto dentro de `.section`, sem
                inventar um quarto tom de destaque no vocabulário do site. */}
            <div className="spotlight-panel">
              <ArticleCard
                item={popularWeek}
                variant="lead"
                showReactionCount
                // Ver `lcpCandidateId`: só entra em cena quando nem o hero nem os
                // quentes secundários renderizaram foto nenhuma acima daqui.
                priority={popularWeek.id === lcpCandidateId}
              />
            </div>
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
            a §7 existe para impedir. Ainda assim, guardado por
            `home.trending.length > 0`: sem ranking, sem slot — o mesmo motivo
            que já valia quando o slot vivia dentro da seção. */}
        {home.trending.length > 0 && homeAds.afterTrending && (
          <AdSlot slot={homeAds.afterTrending} />
        )}

        {/* ---------- ACABOU DE SAIR: a única superfície cronológica ----------
            Fica ENTRE o ranking e a grade e não muda a ordenação de nenhum dos
            dois. Sem imagem e com horário: a home já tem dois blocos de cards
            competindo pelo mesmo olhar, e um terceiro com capa transformaria a
            página numa disputa. Como lista de títulos, ela é lida em dois
            segundos e responde a pergunta de quem volta ao site três vezes por
            dia — "o que mudou desde que eu saí?". Ver `home:newest`. */}
        {home.justOut.length > 0 && (
          <section className="section" aria-labelledby="acabou-de-sair">
            <div className="section-head">
              <h2 id="acabou-de-sair" className="section-title">
                Acabou de sair
              </h2>
              <Link href={routes.trending()} className="link-more">
                Ranking ao vivo
              </Link>
            </div>
            <ul className="just-out__list">
              {home.justOut.map((item) => (
                <li key={item.id}>
                  {/* O HORÁRIO vem primeiro e é `<time>`: é o dado que dá sentido
                      à faixa, e alinhado à esquerda em mono ele funciona como
                      coluna — o olho desce pelos horários e para no que interessa.
                      `RelativeTime` já resolve o fuso no cliente (o servidor não
                      sabe o do leitor) e degrada para a data absoluta sem JS. */}
                  <RelativeTime date={item.publishedAt} className="just-out__time" />
                  <Link href={item.url}>{item.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------- MAIS REPERCUTIDO AGORA: a seção-âncora ----------
            Incondicional em relação à FAIXA (entra tudo o que foi publicado,
            de qualquer temperatura) e ordenada por REPERCUSSÃO, do maior score
            para o menor. É a seção que garante que a home nunca fique sem
            conteúdo — a única condição que sobrou é a trivial: existir ao menos
            um card depois de tirar o hero e o ranking.

            O nome mudou junto com a ordem, e não é preciosismo: "Últimas
            notícias" acima de uma lista que não está em ordem cronológica é uma
            promessa que a seção não cumpre — o leitor lê o título, assume que o
            primeiro card é o mais recente e forma uma ideia errada do que
            acabou de sair (Nielsen #2). O subtítulo diz o critério em uma linha,
            porque ordem de lista é informação invisível até ser explicada. */}
        {home.feed.length > 0 && (
          <section className="section" aria-labelledby="repercussao-titulo">
            <div className="section-head">
              <div>
                <h2 id="repercussao-titulo" className="section-title">
                  Mais repercutido agora
                </h2>
                <p className="section-sub">
                  Ordenado pela repercussão do momento, não pelo horário de publicação.
                </p>
              </div>
            </div>
            {/* `g-sm-2 g-md-3`: 1 coluna no celular, 2 a partir de 640px e 3 a
                partir de 900px — a mesma grade das editorias da home no
                protótipo. */}
            <div className="grid g-sm-2 g-md-3">
              {home.feed.map((item) => (
                <ArticleCard
                  key={item.id}
                  item={item}
                  variant="grid"
                  // Último degrau da cascata de prioridade (ver
                  // `lcpCandidateId`): num dia em que NENHUM bloco acima tenha
                  // foto, o primeiro card desta grade é o elemento de LCP.
                  priority={item.id === lcpCandidateId}
                />
              ))}
            </div>

            {/* Retângulo no FIM da grade — nunca no meio dela. Um slot entre
                cards quebraria a leitura da grade e competiria com o conteúdo
                que a pessoa veio ver; aqui, ela já rolou a home inteira.
                `GRID_END_AD_MIN_CARDS`: abaixo disso, "fim da grade" ainda
                fica perto demais do hero. */}
            {home.feed.length >= GRID_END_AD_MIN_CARDS && homeAds.endOfFeed && (
              <AdSlot slot={homeAds.endOfFeed} />
            )}
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
                  {/* Sigla no disco colorido, sem colidir com as outras siglas
                      DESTA MESMA lista (ver `franchiseAbbreviations` acima) —
                      e cor própria por franquia (`franchiseAccentColor`), no
                      lugar do cinza `--ink-2` fixo que todo disco tinha antes
                      (o dado de `getTopFranchises` não traz categoria, então
                      a cor não pode vir da editoria de verdade; ver o
                      comentário de `franchiseAccentColor`). */}
                  <span
                    className="fandom__ico"
                    aria-hidden="true"
                    style={{ '--f': franchiseAccentColor(franchise.slug) } as CSSProperties}
                  >
                    {franchiseAbbreviations.get(franchise.name)}
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

        {/* ---------- NEWSLETTER ----------
            No dia zero ela é a ÚNICA saída útil da página, então o texto muda:
            prometer "uma edição por dia, com o que importou" antes de existir
            uma edição é uma promessa que o site ainda não pode cumprir. */}
        <section className="section">
          <NewsletterForm
            title={
              isFirstDay
                ? 'Seja avisado quando a cobertura começar'
                : 'O resumo do dia nerd no seu e-mail'
            }
            description={
              isFirstDay
                ? 'Deixe seu e-mail e receba a primeira edição assim que ela sair.'
                : 'Uma edição por dia, com o que realmente importou. Sem spam.'
            }
            source="home"
          />
        </section>

        {/* ---------- GUIAS E ESSENCIAIS ----------
            Seleção por FORMATO (guia, lista, comparativo), não por faixa de
            score — ver o cabeçalho do arquivo e core/presentation.ts. */}
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
                filete + título, então cabem mais por linha sem apertar.
                `variant="ever"` força essa anatomia mesmo quando o guia está
                quente — aqui o card promete perenidade, não temperatura. */}
            <div className="grid g-sm-2 g-lg-4">
              {home.evergreen.map((item) => (
                <ArticleCard key={item.id} item={item} variant="ever" />
              ))}
            </div>
          </section>
        )}

        {/* Ordem das editorias = ordem das personas (design §3).
            `.filters` é o carrossel de chips do design: rola na horizontal no
            celular (sem barra visível) e quebra em linhas no desktop. */}
        <nav className="section" id="editorias" aria-label="Todas as editorias">
          {/* No dia zero o título muda de rótulo de navegação para promessa de
              escopo: sem acervo, "Editorias" é um menu de páginas vazias; "O
              que vamos cobrir" é a informação que o visitante de fato procura
              — e é a segunda saída do estado vazio lá de cima. */}
          <h2 className="section-title">{isFirstDay ? 'O que vamos cobrir' : 'Editorias'}</h2>
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
 * =============================================================================
 * SIGLA E COR DO DISCO DE FRANQUIA (`.fandom__ico`) — relatório de UI
 * =============================================================================
 *
 * DOIS PROBLEMAS SEPARADOS, DUAS CORREÇÕES SEPARADAS:
 *
 *  1. COLISÃO DE SIGLA. A regra antiga (iniciais das 3 primeiras palavras)
 *     gerava a MESMA sigla "TLO" para "The Legend Of Zelda" e "The Last Of
 *     Us" — duas franquias populares que podem aparecer juntas em "Seus
 *     universos". O motivo é que "The" e "Of" não carregam identidade
 *     nenhuma; são a parte que MAIS se repete entre nomes em inglês.
 *
 *  2. DISCO SEMPRE CINZA. `--f` nunca era definido porque `getTopFranchises`
 *     não traz a categoria da franquia (a franquia não tem categoria única e
 *     estável no schema — ver comentário original no JSX), então todo disco
 *     caía no neutro `var(--ink-2)`.
 */

/**
 * Palavras sem identidade própria — ignoradas ao montar a sigla. Cobre os
 * casos mais comuns em nomes de franquia em português e inglês; não precisa
 * ser exaustivo, só parar de deixar "The"/"Of" dominarem a sigla.
 */
const ABBREVIATION_STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'the',
  'of',
  'an',
  'and',
]);

/** Palavras que sobram depois de descartar as sem identidade (nunca vazio). */
function meaningfulWords(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const filtered = words.filter((word) => !ABBREVIATION_STOPWORDS.has(word.toLowerCase()));
  // Nome feito só de palavras "descartáveis" é o caso de borda: melhor usar a
  // lista original do que devolver uma sigla vazia.
  return filtered.length > 0 ? filtered : words;
}

/**
 * Candidatos de sigla para UM nome, do mais natural ao mais específico.
 * "The Legend Of Zelda" → meaningfulWords = ["Legend", "Zelda"] → ["LZ", ...].
 * "The Last Of Us"      → meaningfulWords = ["Last", "Us"]      → ["LU", ...].
 * Já não colidem — o filtro de stopword resolve o caso citado no relatório
 * sozinho; os candidatos seguintes só entram em cena para o caso mais raro de
 * duas franquias diferentes começando pelas mesmas palavras relevantes.
 */
function abbreviationCandidates(name: string): string[] {
  const words = meaningfulWords(name);
  const initialsOf = (count: number) =>
    words
      .slice(0, count)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();

  if (words.length > 1) {
    const first = words[0] ?? '';
    const second = words[1] ?? '';
    return [initialsOf(3), initialsOf(4), `${first.slice(0, 3)}${second.charAt(0)}`.toUpperCase()];
  }

  const solo = words[0] ?? '';
  return [solo.slice(0, 3).toUpperCase(), solo.slice(0, 4).toUpperCase()];
}

/**
 * Resolve a sigla de cada nome de uma lista garantindo que nenhuma repita
 * DENTRO da mesma lista — é só aí que a repetição atrapalha o leitor (duas
 * franquias exibidas lado a lado com o mesmo disco). Não tenta garantir
 * unicidade GLOBAL entre todas as franquias do site: isso exigiria estado
 * compartilhado por uma diferença que ninguém nunca vê ao mesmo tempo.
 */
function resolveFranchiseAbbreviations(names: string[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();

  for (const name of names) {
    const candidates = abbreviationCandidates(name);
    let chosen = candidates.find((candidate) => !used.has(candidate));

    // Esgotou os candidatos naturais (caso raro: 3+ franquias com o mesmo
    // radical, tipo duas variações do mesmo jogo). Sufixo numérico garante
    // unicidade de qualquer forma — feio é melhor que enganoso.
    if (!chosen) {
      const base = candidates[candidates.length - 1] ?? name.slice(0, 3).toUpperCase();
      let suffix = 2;
      let attempt = `${base}${suffix}`;
      while (used.has(attempt)) {
        suffix += 1;
        attempt = `${base}${suffix}`;
      }
      chosen = attempt;
    }

    used.add(chosen);
    result.set(name, chosen);
  }

  return result;
}

/**
 * Paleta de cor por franquia: as 6 `accentColor` de `CATEGORIES`, escolhida
 * de forma determinística pelo slug (mesmo hash → mesma cor sempre, para a
 * mesma franquia, em toda visita).
 *
 * Por que não é a cor da categoria REAL da franquia: `getTopFranchises` não
 * carrega esse dado (a relação franquia → categoria não é 1:1 estável o
 * bastante no schema para virar coluna simples — franquias cross-mídia como
 * "Star Wars" têm matéria em Cinema E em Games). Mudar isso é trabalho de
 * modelagem, não de front. Reaproveitar a paleta das 6 editorias — em vez de
 * inventar cores novas — mantém o disco dentro da linguagem visual do site
 * mesmo sem a categoria de verdade.
 */
const FRANCHISE_COLOR_PALETTE = CATEGORIES.map((category) => category.accentColor);

function franchiseAccentColor(slug: string): string {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return FRANCHISE_COLOR_PALETTE[hash % FRANCHISE_COLOR_PALETTE.length] ?? 'var(--ink-2)';
}
