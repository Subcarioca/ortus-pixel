/**
 * =============================================================================
 * /api/follows — seguir e deixar de seguir franquias
 * =============================================================================
 *
 * POR QUE EXISTE UM `GET` AQUI, EM VEZ DE O SERVIDOR JÁ RENDERIZAR O BOTÃO NO
 * ESTADO CERTO — é a decisão de arquitetura desta funcionalidade:
 *
 * O hub de franquia é uma página CACHEADA (`revalidate: 300`), e é ela que
 * sustenta o pico de tráfego de um fandom. Para renderizar "Seguindo" no
 * servidor, a página precisaria ler o cookie do leitor, e ler cookie torna a
 * rota DINÂMICA no Next — ou seja, todo acesso passaria a bater no banco para
 * decidir o texto de um botão. Trocar o cache da página mais visitada de uma
 * franquia por isso seria um péssimo negócio.
 *
 * Então o HTML sai do cache igual para todo mundo, e só o botão (componente de
 * cliente) pergunta o próprio estado depois de montar. O custo é uma requisição
 * pequena e um instante de estado indefinido no botão; o ganho é a página
 * continuar servível pela CDN.
 *
 * CSRF: as três operações dependem de cookies com `sameSite: 'lax'`, que o
 * navegador NÃO envia em requisição de escrita vinda de outro site. É a mesma
 * proteção em que /api/comments já se apoia.
 */

import { NextResponse } from 'next/server';

import {
  followFranchise,
  getFollowedFranchises,
  readVisitorId,
  unfollowFranchise,
} from '@/server/follows';
import { getReaderSession } from '@/server/reader-session';
import { checkRateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Slug de franquia: minúsculas, números e hífen. Barra o resto na porta. */
const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

/** Franquias que o leitor atual segue. Alimenta o estado inicial dos botões. */
export async function GET() {
  const follows = await getFollowedFranchises();

  return NextResponse.json(
    { following: follows.map((follow) => follow.slug) },
    // Resposta PESSOAL: nunca pode ser guardada por CDN ou proxy compartilhado.
    // Sem este cabeçalho, um intermediário poderia servir a lista de follows de
    // um leitor para outro — um vazamento pequeno em dado, grande em confiança.
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}

export async function POST(request: Request) {
  return handleWrite(request, 'follow');
}

export async function DELETE(request: Request) {
  return handleWrite(request, 'unfollow');
}

async function handleWrite(request: Request, action: 'follow' | 'unfollow') {
  // O limite é por SUJEITO (conta quando há login, cookie quando não há), e não
  // por IP: limitar por IP puniria a rede inteira de uma escola por causa de uma
  // pessoa. Mesmo raciocínio já aplicado em /api/comments.
  const session = await getReaderSession();
  const visitorId = await readVisitorId();
  const subject = session?.authorId ?? visitorId ?? 'novo-visitante';

  const rateLimit = checkRateLimit(`follow:${subject}`, {
    maxRequests: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Muitas ações seguidas. Tente de novo em instantes.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const slug = (body as { franchiseSlug?: unknown }).franchiseSlug;
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ ok: false, message: 'Franquia inválida.' }, { status: 400 });
  }

  const outcome =
    action === 'follow' ? await followFranchise(slug) : await unfollowFranchise(slug);

  if (outcome === 'unknown-franchise') {
    return NextResponse.json({ ok: false, message: 'Franquia não encontrada.' }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true, following: outcome === 'followed' },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
