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
  HEAT_LABELS,
  absoluteUrl,
  catClass,
  catToken,
  heatForBand,
  heatLevelForHeat,
  isCategorySlug,
  routes,
  trendForDelta,
} from '@canalnerd/core';

import { AdSlot } from '@/components/ad-slot';
import { AffiliateDisclosure } from '@/components/affiliate-disclosure';
import { AffiliateOffers } from '@/components/affiliate-offers';
import { CommentSection } from '@/components/comments/comment-section';
import { ArticleBody } from '@/components/article-body';
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

  const { article, liveUpdates, isLive, hasSpoiler, tldr, scoreDelta1h, format } = data;

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
    getRelatedArticles(
      article.id,
      article.franchises.map((f) => f.slug),
    ),
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
  const policy = commercePolicy(heat, format);

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

  return (
    <>
      <ArticleJsonLd article={article} video={article.video} />

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
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: article.category.name, url: routes.category(categoria) },
          { name: article.title, url: routes.article(categoria, slug) },
        ]}
      />

      {/*
        `.layout-2col` (conteúdo + 320px), e NÃO `.article-layout`.

        Este era um bug de layout de verdade, e vale entender o mecanismo porque
        ele é fácil de reintroduzir. `.article-layout` é uma grade de TRÊS
        colunas a partir de 1180px — `56px | 1fr | 320px` —, e a primeira é o
        trilho vertical de compartilhamento (`.share-rail`) do protótipo. Como
        `.share-rail` é `display:none` abaixo de 1180px, ele desaparece da grade
        e tudo funciona; a partir de 1180px ele reaparece. Só que o produto
        nunca renderizou esse trilho: com apenas dois filhos, era o `<article>`
        que caía na coluna de 56px. Em telas grandes — as do desktop, as da
        redação, as de quem revisa o site — o texto da matéria virava uma tira
        de uma palavra por linha.

        Por que não simplesmente adicionar o trilho: no protótipo ele é uma
        pilha de botões CIRCULARES de 48px, e o CSS esconde o rótulo textual
        (`.share-rail .share__btn span { display:none }`) porque cada botão
        mostra o ícone da rede. O produto ainda não tem sistema de ícones, então
        o trilho sairia como cinco círculos vazios. Enquanto os ícones não
        existirem, a resposta certa é usar o componente de duas colunas que o
        design também oferece — e não fingir uma terceira coluna.
      */}
      <div className="container layout-2col">
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

          {/* ---------- 8: mídia ---------- */}
          {article.coverImageUrl && (
            // `<figure>` solta (sem classe) é o markup do protótipo. A moldura
            // 16:9 e o recorte vêm do `.thumb`; a foto real entra pela ponte
            // `.thumb > img` da seção 17 do CSS.
            <figure>
              <div className="thumb" data-c={catToken(categoria)}>
                <Image
                  src={article.coverImageUrl}
                  alt={article.coverImageAlt ?? ''}
                  width={1200}
                  height={675}
                  // Imagem de capa do artigo: é o elemento de LCP desta página.
                  priority
                  sizes="(max-width: 1024px) 100vw, 720px"
                />
              </div>
              {article.coverImageAlt && <figcaption>{article.coverImageAlt}</figcaption>}
            </figure>
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

          {/* ---------- 11: corpo ---------- */}
          {hasSpoiler ? (
            <SpoilerBlock>
              <ArticleBody markdown={article.content} />
            </SpoilerBlock>
          ) : (
            <ArticleBody markdown={article.content} />
          )}

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

          {/* Discord CONTEXTUALIZADO pelo fandom do artigo — não um convite
              genérico "entre no nosso servidor". */}
          {primaryFranchise && (
            /* `.community__top` é a linha logo + texto do design. O <h2> não
               leva classe: a ponte `.community :is(h2, h3, h5)` da seção 17 dá
               a ele o tamanho que o protótipo pedia no <h4>, sem que o nível do
               heading precise mentir sobre a hierarquia da página. */
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
              `.stack-sm` + `.card--row` (e não uma grade): dentro da coluna de
              texto do artigo, a lista compacta cabe sem competir com o corpo. */}
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
        </article>

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

          {/* Trilho lateral: só existe a partir de 1024px e é o ÚLTIMO box da
              sidebar. Nessa posição ele começa abaixo da dobra por construção,
              o que mantém a regra "nada comercial acima da dobra". */}
          {railAdSlot && <AdSlot slot={railAdSlot} sticky />}
        </aside>
      </div>
    </>
  );
}
