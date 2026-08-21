/**
 * =============================================================================
 * /api/category-follows — seguir e deixar de seguir CATEGORIAS (editorias)
 * =============================================================================
 *
 * ESPELHA `/api/follows` DE PROPÓSITO — mesmo racional de cache (a página de
 * categoria é cacheada, e ler cookie aqui tornaria essa rota dinâmica; ver o
 * cabeçalho de `/api/follows/route.ts` para a explicação completa), mesma
 * separação GET/POST/DELETE, mesmo cuidado de CSRF via `sameSite: 'lax'`.
 * Rota PRÓPRIA (e não um `kind` a mais dentro de `/api/follows`) porque o
 * corpo de cada uma valida um formato de identificador diferente (slug de
 * franquia x slug de categoria) e a lista de categorias é fechada
 * (`isCategorySlug`), o que barra entrada inválida ainda mais cedo do que a
 * regex usada para franquia.
 */

import { NextResponse } from 'next/server';

import { isCategorySlug } from '@subcarioca/core';

import {
  followCategory,
  getFollowedCategories,
  unfollowCategory,
} from '@/server/category-follows';
import { readVisitorId } from '@/server/follows';
import { getReaderSession } from '@/server/reader-session';
import { checkRateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Categorias que o leitor atual segue. Alimenta o estado inicial dos botões. */
export async function GET() {
  const follows = await getFollowedCategories();

  return NextResponse.json(
    { following: follows.map((follow) => follow.slug) },
    // Resposta PESSOAL — mesmo cuidado de `/api/follows`: nunca cacheável por
    // CDN ou proxy compartilhado.
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
  // Limite por SUJEITO (conta ou cookie) — mesmo raciocínio de `/api/follows`:
  // por IP puniria uma rede inteira por causa de uma pessoa.
  const session = await getReaderSession();
  const visitorId = await readVisitorId();
  const subject = session?.authorId ?? visitorId ?? 'novo-visitante';

  const rateLimit = checkRateLimit(`category-follow:${subject}`, {
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

  const slug = (body as { categorySlug?: unknown }).categorySlug;
  // Lista FECHADA (não regex de formato): categoria é um vocabulário pequeno e
  // conhecido em código (`core/taxonomy.ts`), então qualquer slug fora dela é
  // barrado aqui, antes de qualquer consulta ao banco.
  if (typeof slug !== 'string' || !isCategorySlug(slug)) {
    return NextResponse.json({ ok: false, message: 'Categoria inválida.' }, { status: 400 });
  }

  const outcome = action === 'follow' ? await followCategory(slug) : await unfollowCategory(slug);

  if (outcome === 'unknown-category') {
    return NextResponse.json({ ok: false, message: 'Categoria não encontrada.' }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true, following: outcome === 'followed' },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
