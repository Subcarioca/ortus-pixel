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
  PRICE_FRESHNESS_HOURS,
  canDisplayPrice,
  formatPrice,
  type AffiliateOffer,
} from '@canalnerd/core';

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

  return (
    <section
      className={variant === 'summary' ? 'aff-summary' : 'buybox'}
      aria-labelledby="ofertas-titulo"
    >
      <div className="buybox__head">
        {/* RE-SKIN v0.3: o título não leva classe. No design quem o estiliza é
            `.buybox h4` / `.aff-summary h3`; a ponte da seção 17 estende esses
            seletores a qualquer nível de heading, para que o NÍVEL continue
            sendo ditado pela hierarquia do documento (aqui h2, porque o h1 é a
            manchete). `.cd-box__title` nunca existiu — e `.cd-box`, no design,
            é a caixinha da contagem regressiva do hub de franquia. */}
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
                  {offer.imageUrl && variant === 'buybox' && (
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
