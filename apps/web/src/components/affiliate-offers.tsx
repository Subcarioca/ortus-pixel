/**
 * =============================================================================
 * BLOCO "ONDE COMPRAR" — ofertas de afiliado
 * =============================================================================
 *
 * Server Component. Zero JavaScript enviado ao navegador: são links e texto.
 *
 * TRÊS REGRAS DE PRODUTO CODIFICADAS AQUI (e não deixadas para a disciplina de
 * quem escreve a matéria):
 *
 * 1. PREÇO VELHO NÃO APARECE. Passadas 24 horas da última verificação, o número
 *    some e sobra "ver preço na loja". Preço de e-commerce muda várias vezes ao
 *    dia; uma página cacheada por 1 hora exibindo "R$ 4.299" que já não existe
 *    queima a confiança do leitor no clique seguinte — e, no Brasil, anunciar
 *    preço que não se pratica é publicidade enganosa (CDC art. 37), mesmo sendo
 *    preço de terceiro. Ver `priceFreshness` em core/monetization.ts.
 *
 * 2. A ORDEM É EDITORIAL, NÃO COMERCIAL. As ofertas saem na `position` definida
 *    pelo editor. Ordenar por comissão seria deixar a monetização governar o
 *    conteúdo — exatamente o que a arquitetura deste projeto separa.
 *
 * 3. TODO LINK LEVA `rel="sponsored nofollow noopener"` E ETIQUETA VISÍVEL.
 *    O `rel` é exigência do Google desde 2019; a etiqueta é exigência do leitor.
 *
 * SOBRE O VISUAL (design §7.2): o bloco é cinza/grafite e o botão é `.btn--buy`.
 * Nenhum elemento comercial pode usar vermelho ou laranja, que pertencem à
 * escala de temperatura. Um "compre agora" vermelho seria lido como sinal de
 * urgência editorial — a confusão mais cara possível entre conteúdo e anúncio.
 */

import Image from 'next/image';

import {
  AFFILIATE_PROGRAM_LABELS,
  ANALYTICS_ATTR,
  PRICE_FRESHNESS_HOURS,
  canDisplayPrice,
  formatPrice,
  type AffiliateOffer,
} from '@subcarioca/core';

import { AFFILIATE_REL, safeAffiliateUrl } from '@/lib/safe-url';
import { AffiliateDisclosure } from './affiliate-disclosure';

interface AffiliateOffersProps {
  offers: AffiliateOffer[];
  /** Título do bloco. Varia com o formato ("Onde comprar" / "Produtos citados"). */
  title?: string;
  /** `summary` é a variante compacta do fim de guias e listicles. */
  variant?: 'buybox' | 'summary';
}

export function AffiliateOffers({
  offers,
  title = 'Onde comprar',
  variant = 'buybox',
}: AffiliateOffersProps) {
  const now = new Date();

  // Validamos a URL de CADA oferta antes de renderizar. Uma oferta com URL
  // inválida (ou http, ou com esquema perigoso) é descartada silenciosamente
  // para o leitor e continua visível para o editor no painel — nunca vira um
  // link quebrado nem, pior, um link perigoso.
  const renderable = offers
    .map((offer) => ({ offer, href: safeAffiliateUrl(offer.offerUrl).href }))
    .filter((item): item is { offer: AffiliateOffer; href: string } => item.href !== null);

  // Se nada sobrou, o bloco inteiro desaparece — INCLUSIVE a disclosure. É o
  // comportamento correto: sem link comercial na tela, não há o que divulgar.
  if (renderable.length === 0) return null;

  const anySponsored = renderable.some((item) => item.offer.disclosureKind === 'sponsored');

  /*
    RE-SKIN v0.3 — as duas variantes deixaram de compartilhar o mesmo markup.

    Antes, `summary` trocava só a classe do contêiner (`.aff-summary` no lugar
    de `.buybox`) e reaproveitava `.buybox__head` + `.buybox__list` + `.store`
    por dentro. O resultado não quebrava, e é por isso que passou: `.store` é
    uma linha genérica e continuava renderizando. Mas era o componente errado.

    No design os dois blocos respondem a perguntas diferentes:

      .buybox  → "ONDE comprar ESTE produto". Uma linha por LOJA, comparando
                 preço entre lojas. A unidade é a loja (`.store`).
      .aff-summary → "QUAIS produtos apareceram nesta matéria". Um cartão por
                 PRODUTO, com foto, especificação e preço. A unidade é o
                 produto (`.prod`, dentro de `.aff-summary__list`).

    Um guia de "os 8 melhores headsets" saía como oito linhas de texto com
    preço à direita, quando o design prevê oito cartões com foto — que é o que
    faz o leitor reconhecer o produto sem ler.

    Outra diferença que só o protótipo revela: em `.aff-summary` a divulgação
    de afiliado vem LOGO ABAIXO DO TÍTULO, antes dos produtos; na `.buybox` ela
    fecha o bloco. As duas posições cumprem a mesma regra ("antes do clique"),
    e cada uma segue o seu protótipo.
  */
  if (variant === 'summary') {
    return (
      <section className="aff-summary" aria-labelledby="ofertas-titulo">
        {/* Sem classe no heading: `.aff-summary h3` é quem estiliza no design, e
            a ponte da seção 17 estende o seletor a h2/h4 para que o NÍVEL siga
            a hierarquia do documento (h2, porque o h1 é a manchete). */}
        <h2 id="ofertas-titulo">{title}</h2>

        <AffiliateDisclosure kind={anySponsored ? 'sponsored' : 'affiliate'} variant="mini" />

        <div className="aff-summary__list">
          {renderable.map(({ offer, href }) => {
            const showPrice = canDisplayPrice(offer, now);

            return (
              <article key={offer.id} className="prod">
                {/* `.prod__img` é uma caixa 1:1 que no protótipo carrega só o
                    rótulo "1:1". Com foto real, a ponte `.prod__img > img` da
                    seção 17 faz a imagem preencher a caixa sem alterar a razão
                    de aspecto — mesmo mecanismo do `.thumb`. Sem foto, a caixa
                    permanece: some o produto da linha, não o alinhamento da
                    grade. */}
                <div className="prod__img">
                  {offer.imageUrl && (
                    <Image
                      src={offer.imageUrl}
                      // Alt vazio: o nome do produto vem em texto ao lado.
                      alt=""
                      width={120}
                      height={120}
                    />
                  )}
                </div>

                <div className="prod__body">
                  <h3 className="prod__name">
                    {offer.productName}
                    <span className="aff-tag">afiliado</span>
                  </h3>

                  <p className="prod__spec">
                    {offer.brand ? `${offer.brand} · ` : ''}
                    {AFFILIATE_PROGRAM_LABELS[offer.programCategory]}
                    {offer.availability === 'out-of-stock' && ' · indisponível'}
                  </p>

                  <div className="prod__foot">
                    <span className="prod__price">
                      {showPrice && offer.priceCents !== null ? (
                        formatPrice(offer.priceCents, offer.currency)
                      ) : (
                        <small>preço não confirmado hoje</small>
                      )}
                      {/* `.prod__price small` é a linha de baixo, menor e cinza:
                          no design é onde vai a loja. Só entra quando existe um
                          preço em cima — senão haveria dois `<small>` empilhados
                          e nenhum preço. */}
                      {showPrice && offer.priceCents !== null && (
                        <small>{offer.retailerName}</small>
                      )}
                    </span>

                    <a
                      href={href}
                      className="btn btn--buy btn--sm"
                      rel={AFFILIATE_REL}
                      target="_blank"
                      // Marca lida pelo rastreador de audiência. É SÓ um
                      // atributo: este componente continua sendo Server
                      // Component com zero JavaScript, e quem escuta o clique é
                      // um ouvinte único da página (ver analytics-tracker.tsx).
                      {...{ [ANALYTICS_ATTR.offerId]: offer.id }}
                    >
                      Ver
                      <span className="sr-only">
                        {' '}
                        {offer.productName} em {offer.retailerName} (link de afiliado)
                      </span>
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="buybox" aria-labelledby="ofertas-titulo">
      <div className="buybox__head">
        {/* RE-SKIN v0.3: o título não leva classe. No design quem o estiliza é
            `.buybox h4`; a ponte da seção 17 estende o seletor a qualquer nível
            de heading, para que o NÍVEL continue sendo ditado pela hierarquia
            do documento (aqui h2, porque o h1 é a manchete). `.cd-box__title`
            nunca existiu — e `.cd-box`, no design, é a caixinha da contagem
            regressiva do hub de franquia. */}
        <h2 id="ofertas-titulo">{title}</h2>
        <span className="buybox__stamp">
          preços verificados nas últimas {PRICE_FRESHNESS_HOURS}h
        </span>
      </div>

      <div className="buybox__list">
        {renderable.map(({ offer, href }) => {
          const showPrice = canDisplayPrice(offer, now);

          return (
            <article key={offer.id} className="store">
              <div className="store__main">
                <h3 className="store__name">
                  {/* A checagem de variante saiu daqui: este ramo do componente
                      já É a `buybox`. Condição que nunca é falsa é ruído. */}
                  {offer.imageUrl && (
                    <Image
                      src={offer.imageUrl}
                      // Alt vazio: o nome do produto vem logo ao lado, em texto.
                      // Repetir faria o leitor de tela anunciar duas vezes.
                      alt=""
                      width={30}
                      height={30}
                      className="store__logo"
                    />
                  )}
                  {offer.productName}
                  {/* Etiqueta textual de afiliado, ao lado do link e ANTES do
                      clique — regra 5 do design §7. */}
                  <span className="aff-tag">afiliado</span>
                </h3>

                <p className="store__note">
                  {offer.retailerName}
                  {offer.brand ? ` · ${offer.brand}` : ''} ·{' '}
                  {AFFILIATE_PROGRAM_LABELS[offer.programCategory]}
                  {offer.availability === 'out-of-stock' && ' · indisponível no momento'}
                </p>
              </div>

              <div className="store__buy">
                <span className="store__price">
                  {showPrice && offer.priceCents !== null ? (
                    formatPrice(offer.priceCents, offer.currency)
                  ) : (
                    /* Preço vencido ou ausente: dizemos POR QUE não há número.
                       Um espaço vazio pareceria bug; a frase explica e ainda
                       reforça que conferimos. */
                    <small>preço não confirmado hoje</small>
                  )}
                </span>

                <a
                  href={href}
                  className="btn btn--buy"
                  // `sponsored nofollow noopener` — ver lib/safe-url.ts para o
                  // motivo de `noreferrer` NÃO entrar em link de afiliado.
                  rel={AFFILIATE_REL}
                  target="_blank"
                  {...{ [ANALYTICS_ATTR.offerId]: offer.id }}
                >
                  Ver na loja
                  <span className="sr-only"> {offer.retailerName} (link de afiliado)</span>
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {/* Aviso curto colado ao bloco. O aviso COMPLETO fica no topo do artigo,
          renderizado pela própria página quando `hasAffiliateLinks` é true. */}
      <AffiliateDisclosure kind={anySponsored ? 'sponsored' : 'affiliate'} variant="mini" />
    </section>
  );
}
