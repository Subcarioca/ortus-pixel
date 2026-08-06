/**
 * =============================================================================
 * REPOSITÓRIO DE AFILIADOS — o único lugar que escreve o vínculo artigo↔oferta
 * =============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE (e por que ele é curto de propósito):
 *
 * `Article.hasAffiliateLinks` é um dado DERIVADO. Dado derivado tem um modo de
 * falha clássico: alguém escreve a relação num lugar e esquece de atualizar a
 * coluna em outro. O sistema não quebra, nenhum teste falha — e o site passa a
 * exibir link de afiliado sem selo de disclosure. É o pior tipo de bug: silencioso
 * e com consequência legal.
 *
 * A defesa é estrutural, em duas camadas:
 *
 *   1. LEITURA — o mapper (mappers.ts) calcula `hasAffiliateLinks` a partir da
 *      relação carregada. Renderização nunca depende da coluna.
 *   2. ESCRITA — toda mutação de vínculo passa por AQUI, dentro de uma
 *      TRANSAÇÃO que atualiza a relação e a coluna juntas. Ou as duas coisas
 *      acontecem, ou nenhuma.
 *
 * Se você precisa vincular uma oferta a um artigo, use estas funções. Chamar
 * `prisma.articleAffiliateOffer.create()` direto de uma rota de API é o começo
 * do bug descrito acima.
 */

import { prisma } from './client';

/**
 * Recalcula a coluna desnormalizada a partir da verdade (a relação).
 *
 * Recebe um `client` para poder rodar DENTRO de uma transação — em Prisma, o
 * cliente transacional é um objeto diferente do global, e usar o global dentro
 * de uma transação executaria a escrita fora dela (perdendo a atomicidade que é
 * justamente o ponto).
 */
export async function syncAffiliateFlag(
  articleId: string,
  client: Pick<typeof prisma, 'articleAffiliateOffer' | 'article'> = prisma,
): Promise<boolean> {
  const activeLinks = await client.articleAffiliateOffer.count({
    where: { articleId, offer: { isActive: true } },
  });

  const hasAffiliateLinks = activeLinks > 0;

  await client.article.update({
    where: { id: articleId },
    data: { hasAffiliateLinks },
  });

  return hasAffiliateLinks;
}

/** Vincula uma oferta a um artigo (ação humana, feita no painel editorial). */
export async function linkOfferToArticle(params: {
  articleId: string;
  offerId: string;
  position?: number;
  isHighlighted?: boolean;
  label?: string | null;
  addedById?: string | null;
}): Promise<{ hasAffiliateLinks: boolean }> {
  const { articleId, offerId } = params;

  return prisma.$transaction(async (tx) => {
    await tx.articleAffiliateOffer.upsert({
      where: { articleId_offerId: { articleId, offerId } },
      update: {
        position: params.position ?? 0,
        isHighlighted: params.isHighlighted ?? false,
        label: params.label ?? null,
      },
      create: {
        articleId,
        offerId,
        position: params.position ?? 0,
        isHighlighted: params.isHighlighted ?? false,
        label: params.label ?? null,
        addedById: params.addedById ?? null,
      },
    });

    const hasAffiliateLinks = await syncAffiliateFlag(articleId, tx);
    return { hasAffiliateLinks };
  });
}

/** Desvincula uma oferta de um artigo. */
export async function unlinkOfferFromArticle(
  articleId: string,
  offerId: string,
): Promise<{ hasAffiliateLinks: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.articleAffiliateOffer.deleteMany({ where: { articleId, offerId } });
    const hasAffiliateLinks = await syncAffiliateFlag(articleId, tx);
    return { hasAffiliateLinks };
  });
}

/**
 * Ativa/desativa uma oferta e ressincroniza TODOS os artigos afetados.
 *
 * Este é o caso que mais facilmente escaparia: desativar uma oferta remove o
 * link do site, mas a coluna `hasAffiliateLinks` dos artigos que a exibiam
 * continuaria `true` — e o selo apareceria numa página que já não tem link
 * comercial nenhum. Divulgar demais é menos grave que divulgar de menos, mas
 * continua sendo dado errado, e dado errado corrói a confiança no painel.
 */
export async function setOfferActive(offerId: string, isActive: boolean): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.affiliateOffer.update({ where: { id: offerId }, data: { isActive } });

    const links = await tx.articleAffiliateOffer.findMany({
      where: { offerId },
      select: { articleId: true },
    });

    for (const link of links) {
      await syncAffiliateFlag(link.articleId, tx);
    }

    return links.length;
  });
}

/**
 * Atualiza o preço de uma oferta.
 *
 * `priceUpdatedAt` é carimbado AQUI, e não deixado para quem chama. Se cada
 * rota de API precisasse lembrar de carimbar, a primeira que esquecesse
 * produziria uma oferta com preço novo e carimbo velho — que a UI esconderia
 * por "obsoleta" sem ninguém entender o motivo.
 *
 * Detalhe importante: o carimbo só se move quando o preço EFETIVAMENTE muda ou
 * quando o editor confirma o valor. Ver `confirmPrice` abaixo.
 */
export async function updateOfferPrice(
  offerId: string,
  priceCents: number | null,
  now: Date = new Date(),
): Promise<void> {
  await prisma.affiliateOffer.update({
    where: { id: offerId },
    data: { priceCents, priceUpdatedAt: now, lastCheckedAt: now },
  });
}

/**
 * "Confere" o preço sem alterá-lo: o editor abriu a loja, o valor continua o
 * mesmo, e a oferta volta a ser considerada fresca.
 *
 * Sem esta ação, a única forma de renovar o carimbo seria digitar de novo o
 * mesmo preço — e o editor acabaria digitando errado ou desistindo de conferir.
 * Facilitar a ação correta é o que faz a regra de frescor sobreviver ao dia a dia.
 */
export async function confirmOfferPrice(offerId: string, now: Date = new Date()): Promise<void> {
  await prisma.affiliateOffer.update({
    where: { id: offerId },
    data: { priceUpdatedAt: now, lastCheckedAt: now },
  });
}
