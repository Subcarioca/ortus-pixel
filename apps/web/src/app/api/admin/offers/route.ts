/**
 * =============================================================================
 * POST /api/admin/offers — CRUD de ofertas de afiliado (ação humana)
 * =============================================================================
 *
 * Ações: `create`, `update-price`, `confirm-price`, `link`, `unlink`,
 * `toggle-active`.
 *
 * POR QUE ISTO É SEPARADO DO `services/curator`:
 *
 * O curator é curadoria AUTOMÁTICA: ele descobre tópicos, calcula score e
 * sugere pauta. Vincular uma oferta comercial a um artigo é o oposto disso —
 * é uma decisão editorial com consequência de credibilidade e de conformidade
 * legal. Um robô que decide sozinho em quais matérias entra link de compra é
 * exatamente o desenho que faz a monetização contaminar o conteúdo.
 *
 * A fronteira é física: o curator não tem código que escreva em
 * `ArticleAffiliateOffer`, e esta rota exige sessão de painel.
 *
 * TODA mutação de vínculo passa pelo repositório (`packages/db/affiliate-repo`),
 * que atualiza a relação e a coluna derivada `hasAffiliateLinks` na MESMA
 * transação. É o que impede um artigo de ter link sem selo de disclosure.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import {
  AFFILIATE_PROGRAM_CATEGORIES,
  DISCLOSURE_KINDS,
  OFFER_AVAILABILITY,
} from '@subcarioca/core';
import {
  confirmOfferPrice,
  linkOfferToArticle,
  prisma,
  setOfferActive,
  unlinkOfferFromArticle,
  updateOfferPrice,
} from '@subcarioca/db';

import { isAdminAuthenticated } from '@/server/admin-auth';
import { CACHE_TAGS } from '@/server/queries';
import { safeAffiliateUrl } from '@/lib/safe-url';
import { getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

const ID_PATTERN = /^[a-z0-9-]{10,60}$/i;

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, message: 'Não autorizado.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : '';
  const ipHash = hashPersonalData(getClientIp(request.headers));

  switch (action) {
    // -------------------------------------------------------------------------
    case 'create': {
      const productName = text(payload.productName, 2, 160);
      const retailerName = text(payload.retailerName, 2, 80);

      if (!productName || !retailerName) {
        return NextResponse.json(
          { ok: false, message: 'Produto e loja são obrigatórios.' },
          { status: 400 },
        );
      }

      // A URL é validada com a MESMA função que sanitiza links do corpo do
      // artigo, na variante de afiliado (só https). Rejeitar aqui, no cadastro,
      // é muito melhor do que descobrir na renderização: o editor recebe a
      // mensagem na hora, em vez de a oferta sumir misteriosamente do site.
      const { href, reason } = safeAffiliateUrl(payload.offerUrl);
      if (!href) {
        return NextResponse.json(
          {
            ok: false,
            message:
              reason === 'insecure'
                ? 'O link precisa ser https. Link de afiliado em http pode ser adulterado no caminho.'
                : 'Link inválido.',
          },
          { status: 400 },
        );
      }

      const priceCents = priceInCents(payload.priceCents);
      if (priceCents === undefined) {
        return NextResponse.json(
          { ok: false, message: 'Preço inválido. Use centavos inteiros (ex.: 429900).' },
          { status: 400 },
        );
      }

      const offer = await prisma.affiliateOffer.create({
        data: {
          productName,
          retailerName,
          brand: text(payload.brand, 1, 60),
          priceCents,
          offerUrl: href,
          programCategory: pick(payload.programCategory, AFFILIATE_PROGRAM_CATEGORIES, 'outro'),
          availability: pick(payload.availability, OFFER_AVAILABILITY, 'unknown'),
          disclosureKind: pick(payload.disclosureKind, DISCLOSURE_KINDS, 'affiliate'),
          network: text(payload.network, 1, 60),
          // O carimbo de preço nasce AGORA — o editor acabou de conferir o
          // valor na loja. Ver o racional de `priceUpdatedAt` no schema.
          priceUpdatedAt: priceCents === null ? null : new Date(),
          lastCheckedAt: new Date(),
        },
      });

      await audit('offer.created', offer.id, null, { productName, retailerName }, ipHash);

      return NextResponse.json({ ok: true, id: offer.id, message: 'Oferta cadastrada.' });
    }

    // -------------------------------------------------------------------------
    case 'update-price': {
      const offerId = id(payload.offerId);
      if (!offerId) {
        return NextResponse.json({ ok: false, message: 'Oferta inválida.' }, { status: 400 });
      }

      const priceCents = priceInCents(payload.priceCents);
      if (priceCents === undefined) {
        return NextResponse.json({ ok: false, message: 'Preço inválido.' }, { status: 400 });
      }

      const before = await prisma.affiliateOffer.findUnique({
        where: { id: offerId },
        select: { priceCents: true },
      });

      await updateOfferPrice(offerId, priceCents);
      await audit('offer.price_updated', offerId, before, { priceCents }, ipHash);
      await revalidateArticlesOf(offerId);

      return NextResponse.json({ ok: true, message: 'Preço atualizado.' });
    }

    // -------------------------------------------------------------------------
    case 'confirm-price': {
      // "Conferi na loja e continua o mesmo." Sem esta ação, renovar o carimbo
      // exigiria redigitar o mesmo preço — e o editor acabaria digitando errado
      // ou desistindo de conferir. Facilitar a ação correta é o que faz a regra
      // de frescor sobreviver ao dia a dia.
      const offerId = id(payload.offerId);
      if (!offerId) {
        return NextResponse.json({ ok: false, message: 'Oferta inválida.' }, { status: 400 });
      }

      await confirmOfferPrice(offerId);
      await audit('offer.price_confirmed', offerId, null, null, ipHash);
      await revalidateArticlesOf(offerId);

      return NextResponse.json({ ok: true, message: 'Preço confirmado.' });
    }

    // -------------------------------------------------------------------------
    case 'link':
    case 'unlink': {
      const offerId = id(payload.offerId);
      const articleId = id(payload.articleId);

      if (!offerId || !articleId) {
        return NextResponse.json(
          { ok: false, message: 'Artigo ou oferta inválidos.' },
          { status: 400 },
        );
      }

      const article = await prisma.article.findUnique({
        where: { id: articleId },
        select: { slug: true },
      });
      if (!article) {
        return NextResponse.json({ ok: false, message: 'Artigo não encontrado.' }, { status: 404 });
      }

      const result =
        action === 'link'
          ? await linkOfferToArticle({
              articleId,
              offerId,
              position: positiveInt(payload.position) ?? 0,
              isHighlighted: payload.isHighlighted === true,
              label: text(payload.label, 1, 40),
            })
          : await unlinkOfferFromArticle(articleId, offerId);

      await audit(`offer.${action}`, offerId, null, { articleId }, ipHash);

      // Vínculo mudou => o artigo passa (ou deixa) de exibir bloco comercial e
      // selo de disclosure. Invalidar aqui é o que faz o site refletir a
      // mudança em segundos, sem esperar a hora de cache.
      revalidateTag(CACHE_TAGS.article(article.slug));

      return NextResponse.json({
        ok: true,
        hasAffiliateLinks: result.hasAffiliateLinks,
        message: action === 'link' ? 'Oferta vinculada.' : 'Vínculo removido.',
      });
    }

    // -------------------------------------------------------------------------
    case 'toggle-active': {
      const offerId = id(payload.offerId);
      if (!offerId) {
        return NextResponse.json({ ok: false, message: 'Oferta inválida.' }, { status: 400 });
      }

      const isActive = payload.isActive === true;
      // `setOfferActive` ressincroniza TODOS os artigos afetados: desativar uma
      // oferta tem de apagar o selo dos artigos que só a exibiam.
      const affected = await setOfferActive(offerId, isActive);

      await audit('offer.toggle_active', offerId, null, { isActive, affected }, ipHash);
      await revalidateArticlesOf(offerId);

      return NextResponse.json({
        ok: true,
        message: isActive
          ? 'Oferta reativada.'
          : `Oferta desativada em ${affected} artigo(s).`,
      });
    }

    default:
      return NextResponse.json({ ok: false, message: 'Ação desconhecida.' }, { status: 400 });
  }
}

// =============================================================================
// AUXILIARES
// =============================================================================

/**
 * Invalida o cache de todos os artigos que exibem uma oferta.
 *
 * É o mecanismo que permite manter o cache de 1 hora do artigo mesmo com preço
 * mudando várias vezes ao dia (ADR 0013): em vez de encurtar o TTL para todo o
 * site, regeneramos exatamente as páginas afetadas, no instante em que o dado
 * muda. Mesma filosofia da invalidação por evento já usada pelo curator.
 */
async function revalidateArticlesOf(offerId: string): Promise<void> {
  const links = await prisma.articleAffiliateOffer.findMany({
    where: { offerId },
    select: { article: { select: { slug: true } } },
  });

  for (const link of links) {
    revalidateTag(CACHE_TAGS.article(link.article.slug));
  }
}

async function audit(
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  ipHash: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action,
      entityType: 'AffiliateOffer',
      entityId,
      before: before === null ? undefined : (before as object),
      after: after === null ? undefined : (after as object),
      ipHash,
    },
  });
}

function id(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function pick<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < 1000 ? parsed : null;
}

/**
 * Valida preço em CENTAVOS.
 *
 * Devolve `undefined` para entrada inválida e `null` para "sem preço", que são
 * casos diferentes: o primeiro é erro do editor (precisa de mensagem), o
 * segundo é um estado legítimo ("oferta cadastrada, preço ainda não conferido").
 *
 * Teto de R$ 1 milhão: preço absurdo é quase sempre dedo escorregando no
 * teclado, e uma oferta de "R$ 4.299.000,00" no ar é vexame garantido.
 */
function priceInCents(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000_000) return undefined;

  return parsed;
}
