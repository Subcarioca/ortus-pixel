/**
 * =============================================================================
 * POST /api/revalidate — invalidação de cache acionada pelo pipeline
 * =============================================================================
 *
 * O curator chama esta rota quando um score muda de faixa ou um artigo é
 * publicado. É o que mantém a home fresca sem revalidação por tempo curto.
 *
 * ESTE ENDPOINT É UM ALVO DE ALTO VALOR.
 *
 * Quem conseguir chamá-lo em laço destrói a taxa de acerto do cache e força
 * regeneração contínua de páginas — uma negação de serviço barata, que derruba
 * o site exatamente durante um pico de tráfego. As proteções:
 *
 *   1. Segredo compartilhado em CABEÇALHO (não em query string, que vaza para
 *      logs de servidor, proxy e CDN).
 *   2. Comparação em TEMPO CONSTANTE, contra timing attack.
 *   3. Lista fechada de superfícies válidas: nada de invalidar caminho
 *      arbitrário enviado pelo cliente.
 *   4. Rate limiting, como defesa em profundidade caso o segredo vaze.
 */

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { CACHE_TAGS } from '@/server/queries';
import { checkRateLimit, getClientIp, safeCompare } from '@/server/security';

export const dynamic = 'force-dynamic';

/**
 * Mapa de superfícies para tags de cache.
 *
 * A lista fechada é essencial: se aceitássemos a tag diretamente do corpo da
 * requisição, um atacante com o segredo poderia invalidar qualquer coisa. Além
 * disso, o mapa é a documentação viva de o que existe para ser invalidado.
 */
const SURFACE_TO_TAGS: Record<string, string[]> = {
  home: [CACHE_TAGS.home],
  trending: [CACHE_TAGS.trending],
  ticker: [CACHE_TAGS.ticker],
  sitemap: [CACHE_TAGS.sitemap],
};

/** Superfícies parametrizadas: "category:games", "article:meu-slug". */
function resolveDynamicSurface(surface: string): string | null {
  const [kind, value] = surface.split(':');
  if (!value) return null;

  // Slug precisa ser seguro: sem isso, "category:../../etc" viraria uma tag
  // esquisita e, pior, indicaria que aceitamos entrada não validada.
  if (!/^[a-z0-9-]{1,80}$/.test(value)) return null;

  switch (kind) {
    case 'category':
      return CACHE_TAGS.category(value);
    case 'article':
      return CACHE_TAGS.article(value);
    case 'franchise':
      return CACHE_TAGS.franchise(value);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const configuredSecret = process.env.REVALIDATE_SECRET;

  // Sem segredo configurado, o endpoint fica DESLIGADO. Falha fechada: nunca
  // "aberto por padrão" — a falha insegura mais comum em endpoints internos.
  if (!configuredSecret) {
    console.error('[revalidate] REVALIDATE_SECRET não configurado: rota desabilitada.');
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`revalidate:${ip}`, {
    maxRequests: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const providedSecret = request.headers.get('x-revalidate-secret');

  if (!providedSecret || !safeCompare(providedSecret, configuredSecret)) {
    // 401 sem detalhe algum. Mensagens do tipo "segredo incorreto" ajudam o
    // atacante a saber que encontrou o cabeçalho certo.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as { surfaces?: unknown; reason?: unknown } | null;

  if (!Array.isArray(payload?.surfaces)) {
    return NextResponse.json({ ok: false, message: 'surfaces é obrigatório.' }, { status: 400 });
  }

  const surfaces = payload.surfaces
    .filter((s): s is string => typeof s === 'string')
    // Teto de itens: impede que uma requisição peça 10 mil invalidações.
    .slice(0, 20);

  const revalidated: string[] = [];

  for (const surface of surfaces) {
    const staticTags = SURFACE_TO_TAGS[surface];
    if (staticTags) {
      staticTags.forEach((tag) => {
        revalidateTag(tag);
        revalidated.push(tag);
      });
      continue;
    }

    const dynamicTag = resolveDynamicSurface(surface);
    if (dynamicTag) {
      revalidateTag(dynamicTag);
      revalidated.push(dynamicTag);
    }
    // Superfície desconhecida é ignorada em silêncio — não é erro do chamador
    // legítimo, e responder "tag inválida" ajudaria um atacante a mapear o site.
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 200) : 'sem motivo';
  console.log(`[revalidate] ${revalidated.length} tag(s) invalidada(s): ${reason}`);

  return NextResponse.json({ ok: true, revalidated: revalidated.length });
}
