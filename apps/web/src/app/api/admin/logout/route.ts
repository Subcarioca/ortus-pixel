/**
 * POST /api/admin/logout — encerra a sessão do painel.
 *
 * POST, e não GET, por um motivo prático de segurança: um `<img src="/api/admin/logout">`
 * numa página qualquer deslogaria quem estivesse com o painel aberto. É o ataque
 * mais inofensivo do mundo (o pior que acontece é a pessoa reentrar), mas o
 * princípio vale para toda rota que muda estado — e escrever a exceção aqui
 * ensinaria a gramática errada para a próxima rota, que não será inofensiva.
 */

import { NextResponse } from 'next/server';

import { destroyStaffSession } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Sem guard de sessão de propósito: sair não exige estar dentro. Se a sessão
  // já caiu, o efeito desejado (não ter sessão) já aconteceu, e responder 401
  // para quem pediu para sair seria um erro sobre um sucesso.
  await destroyStaffSession();
  return NextResponse.json({ ok: true, message: 'Sessão encerrada.' });
}
