/**
 * =============================================================================
 * PÁGINA DE ARTIGO — /{categoria}/{slug}
 * =============================================================================
 *
 * É a página que recebe o tráfego de breaking news, push e busca orgânica.
 * Precisa ser a mais rápida do site e a mais bem estruturada para SEO.
 *
 * ORDEM DO TOPO (design §3), pensada para quem chegou por push no celular:
 *   1. Badge de temperatura -> 2. Editoria -> 3. Chip do fandom ->
 *   4. Manchete -> 5. Linha fina -> 6. Assinatura -> 7. Compartilhar ->
 *   8. Mídia -> 9. TL;DR -> 10. Cobertura ao vivo -> 11. Corpo
 *
 * O TL;DR ANTES DO TEXTO é contraintuitivo para pageviews e ótimo para tudo o
 * mais: resolve a intenção do leitor em 15 segundos, derruba a taxa de rejeição
 * e constrói confiança. Quem quer o detalhe rola a página.
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .article__media  → <figure> + .thumb   ·  .tldr__title  → .tldr__label
 *   .live-coverage   → <section> + .timeline ·  .timeline__* → .tl-item/.tl-time/.tl-body
 *   .byline__time    → dentro de .byline__meta ·  .cd-box__title → <h2> do .community
 *   .section__head/__title → .section-head/.section-title
 *
 * A `.byline` estava com a hierarquia trocada: `.byline__meta` (cinza, xs) era
 * o CONTÊINER e `.byline__name` (bold, sm) vinha dentro dele, ou seja, o nome
 * do autor herdava o tamanho do texto de sistema. No design são irmãos, um por
 * linha — assinatura em cima, metadados embaixo. Assinatura visível é item de
 * E-E-A-T, não decoração.
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  FORMAT_LABELS,
  HEAT_LABELS,
  absoluteUrl,
  blocksToToc,
  catClass,
  catToken,
  formatSealClass,
  hasBlocks,
  heatForBand,
  heatLevelForHeat,
  isCategorySlug,
  routes,
  schemaVideoFromBlocks,
  sensitivityNotice,
  trendForDelta,
} from '@subcarioca/core';

import { AdSlot } from '@/components/ad-slot';
import { AdsPaused } from '@/components/ads-paused';
import { AffiliateDisclosure } from '@/components/affiliate-disclosure';
import { AnalyticsTracker } from '@/components/analytics-tracker';
import { AffiliateOffers } from '@/components/affiliate-offers';
import { CommentSection } from '@/components/comments/comment-section';
import { ArticleBody, markdownToc } from '@/components/article-body';
import { ArticleBlocks } from '@/components/article-blocks';
import { ArticleToc } from '@/components/article-toc';
import { ArticleCard } from '@/components/article-card';
import { ArticleJsonLd, BreadcrumbJsonLd, ProductJsonLd } from '@/components/json-ld';
import { HeatBadge } from '@/components/heat-badge';
import { HeatBar, TrendTag } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { PushOptIn } from '@/components/push-opt-in';
import { RelativeTime } from '@/components/relative-time';
import { ShareBar } from '@/components/share-bar';
import { SpoilerBlock } from '@/components/spoiler-block';
import { commercePolicy } from '@/lib/ads';
import { DISCORD_INVITE_URL, SITE_NAME } from '@/lib/site';
import { availableProviders } from '@/server/oauth';
import { getReaderSession } from '@/server/reader-session';
import { getArticleBySlug, getArticleComments, getRelatedArticles } from '@/server/queries';

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

  const { article, liveUpdates, isLive, hasSpoiler, tldr, scoreDelta1h, format, contentSensitivity } =
    data;

  /**
   * O slug da URL precisa bater com a categoria REAL do artigo.
   *
   * Sem esta checagem, /tech/noticia-de-games responderia 200 com o mesmo
   * conteúdo de /games/noticia-de-games — conteúdo duplicado em N URLs, que o
   * Google penaliza e que dilui a autoridade entre elas.
   */
  if (article.category.slug !== categoria) notFound();

  // Comentários e sessão em paralelo com as relacionadas: são consultas
  // independentes, e em série a página esperaria a soma dos tempos.
  const [related, comments, session] = await Promise.all([
    getRelatedArticles({
      id: article.id,
      franchiseSlugs: article.franchises.map((f) => f.slug),
      categorySlug: article.category.slug,
      subcategorySlug: article.subcategorySlug,
    }),
    getArticleComments(article.id),
    getReaderSession(),
  ]);

  const articleUrl = absoluteUrl(routes.article(categoria, slug));
  const primaryFranchise = article.franchises[0];
  const heat = heatForBand(article.currentBand);

  /**
   * POLÍTICA COMERCIAL DESTA PÁGINA — resolvida uma vez, no servidor.
   *
   * Ela decide TRÊS coisas de uma vez só (quantos anúncios, se pode haver
   * afiliado, se cabe faixa ancorada), porque as regras dependem umas das
   * outras. Se estivessem espalhadas pelo JSX, seria fácil aplicar metade
   * delas — e a metade que falta é sempre a que protege o leitor.
   *
   * Ver apps/web/src/lib/ads.ts e design/README.md §7.1.
   */
  const policy = commercePolicy(heat, format, contentSensitivity);

  /**
   * AVISO DE CONTEÚDO — o texto vem do domínio, não da página.
   *
   * `null` em matéria comum, que é o caso da esmagadora maioria. Ver
   * `sensitivityNotice` em core/content-sensitivity.ts.
   *
   * ⚠ O TRATAMENTO VISUAL DISTO É DECISÃO DE DESIGN e está deliberadamente
   * simples aqui: uma nota antes do corpo, com a classe de aviso que o design
   * system já tem. Se o produto quiser um interstitial de verdade (cobrir o
   * conteúdo e exigir confirmação, como o bloco de spoiler já faz), isso é
   * trabalho de design — e a informação de que ele precisa já chega até aqui.
   */
  const contentNotice = sensitivityNotice(contentSensitivity);

  /**
   * O SELO DE DISCLOSURE E O BLOCO DE OFERTAS SAEM DA MESMA VARIÁVEL.
   *
   * Esta linha é o coração do sistema de disclosure: se as ofertas aparecem, o
   * aviso aparece. Não há checkbox no CMS, não há "o editor precisa lembrar" e
   * não existe estado em que uma coisa exista sem a outra.
   *
   * `article.hasAffiliateLinks` é derivado da relação no mapper (packages/db),
   * e `policy.affiliateAllowed` é falso em conteúdo urgente — em breaking news,
   * link comercial vira suspeita de motivação editorial.
   */
  const showOffers = policy.affiliateAllowed && article.hasAffiliateLinks;
  const midAdSlot = policy.adSlots.find((s) => s.placement === 'mid');
  const endAdSlot = policy.adSlots.find((s) => s.placement === 'end');
  const railAdSlot = policy.adSlots.find((s) => s.placement === 'rail');

  /**
   * O CORPO VEM DE UM DE DOIS LUGARES — e a matéria antiga não muda de lado.
   *
   * `blocks` vazio (que é o caso de todo o acervo publicado antes do editor de
   * blocos) cai no renderizador de Markdown de sempre, com o mesmo resultado
   * de antes. Só quem for editado no editor novo passa para o outro caminho, e
   * só quando alguém o fizer de propósito. É esta linha que faz a migração ser
   * incremental em vez de um evento.
   */
  const usaBlocos = hasBlocks(article.blocks);

  // O índice sai dos títulos, venham eles de blocos ou do Markdown legado.
  const toc = usaBlocos ? blocksToToc(article.blocks) : markdownToc(article.content);

  return (
    <>
      {/* O `VideoObject` sai do BLOCO de vídeo — o mesmo que a página renderiza
          logo abaixo. Ver `schemaVideoFromBlocks` para o bug que isto corrige. */}
      <ArticleJsonLd article={article} video={schemaVideoFromBlocks(article.blocks)} />

      {/* Product + Offer só em review e comparativo, e só com preço fresco —
          ver o comentário extenso em components/json-ld.tsx. Em notícia, um
          bloco de produto no dado estruturado seria incoerente com o conteúdo
          e o Google trata incoerência como sinal de spam. */}
      {showOffers && (format === 'review' || format === 'comparison') && (
        <ProductJsonLd
          article={article}
          offers={article.affiliateOffers}
          reviewData={data.reviewData}
        />
      )}
      {/*
        MEDIÇÃO DE AUDIÊNCIA — um único componente de cliente para a página
        inteira, sem interface.

        Ele instala UM ouvinte de clique e mede quatro coisas (visualização,
        clique para outra matéria, clique em anúncio, clique em afiliado). O
        motivo de ser um só, em vez de `onClick` nos componentes, está no
        cabeçalho de analytics-tracker.tsx: colocar o rastreamento dentro do
        bloco de ofertas transformaria um Server Component de JavaScript ZERO em
        componente de cliente hidratado, em toda matéria, para medir um clique
        que a maioria dos leitores não dá.
      */}
      <AnalyticsTracker articleId={article.id} />

      {/*
        SEGUNDA CAMADA da trava de conteúdo adulto. A primeira (nenhuma unidade
        de anúncio renderizada) já aconteceu no servidor, em `commercePolicy`.
        Esta impede que o "Auto ads" do AdSense — que é ligado NA CONTA, não no
        nosso código — injete anúncio por conta própria numa página onde o script
        do site está presente. Ver o cabeçalho de ads-paused.tsx.
      */}
      {contentSensitivity === 'adult' && <AdsPaused />}

      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: article.category.name, url: routes.category(categoria) },
          { name: article.title, url: routes.article(categoria, slug) },
        ]}
      />

      {/*
        `.article-page` — UMA COLUNA CENTRADA, E O PORQUÊ DA MUDANÇA.

        Até aqui esta página era `.container.layout-2col`: o corpo à esquerda
        (numa coluna de ~864px, com o texto travado em 44rem = 704px encostado
        na borda esquerda dela) e uma barra lateral de 320px à direita com
        índice fixo, convite de push e anúncio grudado na rolagem. O resultado
        era uma matéria DESCENTRALIZADA e três elementos disputando o olhar do
        leitor durante a leitura — o oposto do que uma página de matéria precisa
        entregar.

        Agora a página tem dois territórios, e a ordem entre eles é a hierarquia:

          1. `.article`      — a LEITURA. Coluna única de 44rem centrada na
                               página, sem nada ao lado. É o elemento dominante
                               da tela, do topo até o fim do texto.
          2. `.article-extras` — o DEPOIS DA LEITURA. Só começa quando o texto
                               acabou. Aqui, sim, volta a grade de duas colunas
                               (relacionadas/comunidade/comentários + trilho com
                               push e anúncio), porque nada disso compete mais
                               com a leitura: ela já terminou.

        Nada foi eliminado — nem o inventário de anúncio (`rail`), nem o convite
        de push, nem o índice (que virou uma cópia única acima do corpo, ver
        adiante). O que mudou foi QUANDO cada coisa aparece.
        Nielsen #8 (estético e minimalista) e §2 do design (hierarquia).
      */}
      <div className="container article-page">
        <article className="article">
          {/* ---------- 1 a 3: badges e contexto ---------- */}
          <div className="article__kicker">
            {/* `heatForBand` centraliza a regra de corte — o template nunca
                decide a temperatura por conta própria (design/README.md §2). */}
            <HeatBadge heat={heatForBand(article.currentBand)} size="lg" />
            <HeatBar
              heat={heatForBand(article.currentBand)}
              level={heatLevelForHeat(heatForBand(article.currentBand))}
            />
            <TrendTag trend={trendForDelta(scoreDelta1h, article.publishedAt)} />
            {/* Selo de FORMATO ao lado do de temperatura. Contorno × pílula
                preenchida: o leitor separa "isto é um vídeo" de "isto está
                bombando" antes mesmo de ler as palavras. Omitido em `breaking`,
                que é o formato padrão do site — ver `formatSealClass`. */}
            {format !== 'breaking' && (
              <span className={formatSealClass(format)}>{FORMAT_LABELS[format]}</span>
            )}
            <Link href={routes.category(categoria)} className={catClass(categoria)}>
              {article.category.name}
            </Link>
            {/* Chip do fandom logo acima da manchete: uma das TRÊS entradas
                para o hub, que é o motor de retenção. */}
            {primaryFranchise && (
              <Link href={routes.franchise(primaryFranchise.slug)} className="chip chip--hot">
                {primaryFranchise.name}
              </Link>
            )}
          </div>

          {/* ---------- 4 e 5: manchete e linha fina ---------- */}
          <h1 className="article__title">{article.title}</h1>
          <p className="article__dek">{article.excerpt}</p>

          {/* ---------- 6: assinatura (E-E-A-T) ---------- */}
          <div className="byline">
            {article.author.avatarUrl && (
              <Image
                src={article.author.avatarUrl}
                alt=""
                width={40}
                height={40}
                className="byline__avatar"
              />
            )}
            <div>
              <div className="byline__name">
                Por <Link href={routes.author(article.author.slug)}>{article.author.name}</Link>
                {article.author.role ? `, ${article.author.role}` : ''}
              </div>
              <div className="byline__meta">
                Publicado <RelativeTime date={article.publishedAt} />
                {article.updatedAt > (article.publishedAt ?? article.updatedAt) && (
                  <>
                    {' · '}
                    {/* `.updated-flag` é vermelho de SINAL com ponto pulsante:
                        "isto mudou desde que você viu" é informação de urgência,
                        e é o único lugar da assinatura que pode usar essa cor. */}
                    <span className="updated-flag">
                      <span className="live-dot" aria-hidden="true" />
                      atualizado <RelativeTime date={article.updatedAt} />
                    </span>
                  </>
                )}
                {article.readingMinutes ? ` · ${article.readingMinutes} min de leitura` : ''}
              </div>
            </div>
          </div>

          {/* ---------- 7: compartilhar (topo, no mobile) ---------- */}
          <ShareBar url={articleUrl} title={article.title} />

          {/* ---------- 8: mídia ----------
              A CAPA SUBIU PARA O TOPO DA ESCADA DE DESTAQUE.

              Ela era uma `<figure>` sem classe nenhuma: ocupava a largura da
              coluna de texto e ficava do mesmo tamanho de um parágrafo largo.
              Agora usa `media media--full` — as mesmas 68rem que um bloco de
              imagem "borda-a-borda" —, porque a capa é literalmente o caso que
              o dono descreveu: "se existir só uma imagem em cima, ela deve ter
              um destaque bem maior".

              A moldura 16:9 e o recorte continuam vindo do `.thumb`; a foto
              real entra pela ponte `.thumb > img` da seção 17 do CSS. */}
          {article.coverImageUrl && (
            <figure className="media media--full article__cover">
              <div className="thumb" data-c={catToken(categoria)}>
                <Image
                  src={article.coverImageUrl}
                  alt={article.coverImageAlt ?? ''}
                  width={1200}
                  height={675}
                  // Imagem de capa do artigo: é o elemento de LCP desta página.
                  priority
                  // O `sizes` acompanha a nova largura: abaixo de 1136px a foto
                  // ocupa a janela inteira (sangria no celular, teto de
                  // `100vw - 48px` no tablet); acima disso ela trava em 1088px,
                  // que é o valor de `--media-max` do `.media--full`. Errar
                  // este número é pedir ao navegador o arquivo errado — grande
                  // demais custa banda, pequeno demais borra a capa.
                  sizes="(min-width: 1136px) 1088px, 100vw"
                />
              </div>
              {article.coverImageAlt && <figcaption>{article.coverImageAlt}</figcaption>}
            </figure>
          )}

          {/* ---------- 8.5: AVISO DE CONTEÚDO SENSÍVEL ---------- */}
          {/*
            ANTES do TL;DR e do corpo, que é o único lugar em que um aviso presta
            serviço: depois do texto, ele vira desculpa. `role="note"` (e não
            `alert`) porque não é uma emergência que interrompe o leitor de tela
            — é uma informação sobre o que vem a seguir.

            ⚠ TRATAMENTO VISUAL PENDENTE DE DESIGN: hoje é uma faixa de texto.
            Se o produto quiser o conteúdo COBERTO até a confirmação (o padrão
            de interstitial), o componente `SpoilerBlock` já resolve mecânica
            parecida e a informação necessária já chega até esta página.
          */}
          {contentNotice && (
            <p className="form-hint" role="note">
              {contentNotice}
            </p>
          )}

          {/* ---------- 9: TL;DR ---------- */}
          {tldr.length > 0 && (
            <section className="tldr" aria-labelledby="tldr-titulo">
              {/* `.tldr__label` é o rótulo mono em carmim de marca. No protótipo
                  é um <p>; aqui precisa ser heading porque a seção é rotulada
                  por ele (`aria-labelledby`) e entra no sumário do leitor de
                  tela. A classe carrega a aparência; o elemento, a semântica. */}
              <h2 id="tldr-titulo" className="tldr__label">
                Resumo em 15 segundos
              </h2>
              <ul>
                {tldr.map((point: string, index: number) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </section>
          )}

          {/* ---------- 10: cobertura ao vivo ---------- */}
          {isLive && liveUpdates.length > 0 && (
            <section aria-labelledby="live-titulo">
              <h2 id="live-titulo" className="section-title">
                <span className="live-dot" aria-hidden="true" />
                Cobertura ao vivo
              </h2>
              <ol className="timeline">
                {liveUpdates.map((update, index) => (
                  // `.tl-item--new` só na atualização mais recente: bolinha
                  // vermelha com halo + horário em vermelho. Se todas fossem
                  // "novas", nenhuma seria.
                  <li
                    key={update.id}
                    className={`tl-item${index === 0 ? ' tl-item--new' : ''}`}
                  >
                    <time dateTime={update.createdAt.toISOString()} className="tl-time">
                      {update.createdAt.toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <div className="tl-body">
                      <p>{update.content}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- 10.5: DISCLOSURE — antes do corpo, sempre ----------

              O aviso vem ANTES do texto e antes de qualquer link comercial:
              divulgação depois do clique não é divulgação. A condição é a mesma
              que liga o bloco de ofertas lá embaixo (`showOffers`), então os
              dois nunca se separam. */}
          {showOffers && (
            <AffiliateDisclosure kind={article.disclosureKind ?? 'affiliate'} />
          )}

          {/* ---------- 10.7: índice ----------
              UM ÚNICO ELEMENTO NO HTML, EM DOIS LUGARES NA TELA.

              Este é o ponto mais fácil de errar desta página, então vale ser
              explícito: NÃO existem duas cópias do índice. Existe uma, aqui, e
              é o CSS que decide onde ela aparece:

                até 1479px  → em fluxo, exatamente onde está no HTML: logo
                              antes do texto, que é onde o leitor decide se lê
                              tudo ou pula para uma seção;
                a partir de 1480px → o trilho vira `position: absolute` na
                              margem direita da página e o índice passa a
                              acompanhar a rolagem.

              Duas cópias (uma "mobile" e uma "desktop", escondidas por
              `display:none`) seriam mais simples de escrever e piores de usar:
              um leitor de tela anuncia AS DUAS, porque `display:none` some da
              tela mas a lista continua no documento na outra media query — e o
              leitor ouve o mesmo sumário duas vezes seguidas. Foi assim que
              esta página funcionou até o redesenho.

              A posição do trilho é calculada para nunca encostar na imagem mais
              larga possível — a conta está em ortuspixel.css §19.2. */}
          {/* A guarda é do TRILHO, não do índice: `ArticleToc` já devolve
              `null` sem entradas, mas o trilho é um elemento posicionado —
              vazio, ele seria uma caixa absoluta invisível de 9rem pendurada na
              margem da página. Nada quebraria, e é exatamente por isso que
              alguém demoraria meses para descobrir. */}
          {toc.length > 0 && (
            <div className="article-toc-rail">
              <ArticleToc entries={toc} sticky />
            </div>
          )}

          {/* ---------- 11: corpo ---------- */}
          {(() => {
            const corpo = usaBlocos ? (
              <ArticleBlocks blocks={article.blocks} categoryToken={catToken(categoria)} />
            ) : (
              <ArticleBody markdown={article.content} />
            );

            // `hasSpoiler` continua embrulhando a matéria INTEIRA enquanto o
            // bloco `spoiler` por trecho (P1 do relatório do Weber) não existe.
            // Quando ele entrar, este campo passa a ser derivado ("existe algum
            // bloco spoiler?") e este ternário sai.
            return hasSpoiler ? <SpoilerBlock>{corpo}</SpoilerBlock> : corpo;
          })()}

          {/* Slot do meio: só existe em formato evergreen (guia, review,
              comparativo, listicle). Em breaking e cobertura ao vivo, a tabela
              de densidade não o prevê — e a política já devolve `undefined`. */}
          {midAdSlot && <AdSlot slot={midAdSlot} />}

          {/* ---------- BLOCO "ONDE COMPRAR" ----------
              Depois do corpo: quem chegou até aqui leu a análise. Antes das
              relacionadas: é a continuação natural da intenção de compra. */}
          {showOffers && (
            <AffiliateOffers
              offers={article.affiliateOffers}
              title={format === 'review' || format === 'comparison' ? 'Onde comprar' : 'Produtos citados'}
              variant={format === 'review' || format === 'comparison' ? 'buybox' : 'summary'}
            />
          )}

          {/* CTA de newsletter embutido no corpo, sem overlay: "não interrompe,
              não cobre texto, não muda o layout" (design §3).
              O `.cta-inline` que envolvia esta chamada saiu: o próprio
              componente já renderiza `.cta-inline` na variante `inline`, e o
              aninhamento duplicava os filetes de cima e de baixo. */}
          <NewsletterForm
            title="Gostou? Receba o resumo diário"
            description="Uma edição por dia com o que importou de verdade."
            source={`artigo-${categoria}`}
            variant="inline"
          />

          <ShareBar url={articleUrl} title={article.title} showCount />
        </article>

        {/*
          ---------- DEPOIS DA LEITURA ----------

          A partir daqui a página pode voltar a ser larga e a ter duas colunas:
          o texto acabou, então nada aqui rouba atenção de nada. É também o
          lugar onde a barra lateral antiga reaparece inteira — push e trilho de
          anúncio —, só que abaixo do conteúdo em vez de ao lado dele.
        */}
        <div className="article-extras">
          <div className="article-extras__main">
            {/* Discord CONTEXTUALIZADO pelo fandom do artigo — não um convite
                genérico "entre no nosso servidor". */}
            {primaryFranchise && (
              /* `.community__top` é a linha logo + texto do design. O <h2> não
                 leva classe: a ponte `.community :is(h2, h3, h5)` da seção 17 dá
                 a ele o tamanho que o protótipo pedia no <h4>, sem que o nível
                 do heading precise mentir sobre a hierarquia da página. */
              <section className="community">
                <div className="community__top">
                  <span className="community__logo" aria-hidden="true" />
                  <div>
                    <h2>Fala sobre {primaryFranchise.name} com a gente</h2>
                    {/* O protótipo tem aqui um `.online` ("293 pessoas online"),
                        que é um ponto VERDE de presença ao vivo. Não temos esse
                        dado do Discord, e um indicador de estado que não reflete
                        estado nenhum é pior que nenhum indicador: some. */}
                  </div>
                </div>
                <p>
                  A discussão sobre {primaryFranchise.name} continua no servidor — com
                  outros fãs e com a redação.
                </p>
                <a
                  href={DISCORD_INVITE_URL}
                  className="btn btn--discord"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Entrar no canal #{primaryFranchise.slug}
                </a>
              </section>
            )}

            {/* Relacionadas POR FRANQUIA: principal alavanca de páginas/sessão.
                `.stack-sm` + `.card--row` (e não uma grade): a lista compacta
                mantém o bloco legível mesmo agora que ele ficou mais largo que
                a coluna de leitura. */}
            {related.length > 0 && (
              <section className="section" aria-labelledby="relacionadas">
                <div className="section-head">
                  <h2 id="relacionadas" className="section-title">
                    Mais de {primaryFranchise?.name ?? article.category.name}
                  </h2>
                  {primaryFranchise && (
                    <Link href={routes.franchise(primaryFranchise.slug)} className="link-more">
                      Ver hub completo
                    </Link>
                  )}
                </div>
                <div className="stack-sm">
                  {related.map((item) => (
                    <ArticleCard key={item.id} item={item} variant="row" />
                  ))}
                </div>
              </section>
            )}

            {/* Último slot do corpo: depois de TODO o conteúdo, inclusive das
                relacionadas. É o único anúncio de um breaking news. */}
            {endAdSlot && <AdSlot slot={endAdSlot} />}

            {/* ---------- COMENTÁRIOS ---------- */}
            <CommentSection
              articleId={article.id}
              comments={comments}
              session={session ? { displayName: session.displayName, provider: session.provider } : null}
              providers={availableProviders()}
              returnTo={routes.article(categoria, slug)}
            />
          </div>

          <aside className="sidebar">
            {/* Prompt de push DEPOIS do conteúdo, com justificativa explícita e
                promessa de frequência. Pedir sem contexto é a razão nº 1 de
                bloqueio permanente de notificação. */}
            {/* A CONDIÇÃO continua usando o score (é regra de negócio no
                servidor); o TEXTO não o revela mais — ver ADR 0009. */}
            {article.currentScore >= 60 && (
              <PushOptIn
                headline="Quer saber primeiro?"
                reason={`Esta notícia está na faixa "${HEAT_LABELS[heatForBand(article.currentBand)]}". Avisamos quando algo assim acontecer.`}
                frequencyPromise="No máximo 2 por dia."
              />
            )}

            {/* Trilho lateral: continua existindo (o inventário não foi
                perdido), só que agora ele vive na área DEPOIS da leitura. Ele
                nasce abaixo da dobra por construção — a regra "nada comercial
                acima da dobra" fica ainda mais folgada do que era. */}
            {railAdSlot && <AdSlot slot={railAdSlot} sticky />}
          </aside>
        </div>
      </div>
    </>
  );
}
