/**
 * =============================================================================
 * POST /api/auth/logout — encerra a sessão do leitor
 * =============================================================================
 *
 * POST, e não GET, por um motivo específico: um `GET /logout` pode ser
 * disparado por qualquer `<img src="...">` numa página de terceiros, e o
 * resultado é um site em que o leitor "desloga sozinho" sem entender por quê.
 * Não é grave como um CSRF de escrita, mas é uma ação com efeito colateral —
 * e ação com efeito colateral não vai em GET.
 *
 * O cookie de sessão é `sameSite=lax`, o que já impede que uma requisição POST
 * de outro site venha autenticada.
 */

import { NextResponse } from 'next/server';

import { destroyReaderSession } from '@/server/reader-session';

export const dynamic = 'force-dynamic';

export async function POST() {
  await destroyReaderSession();
  return NextResponse.json({ ok: true });
}
