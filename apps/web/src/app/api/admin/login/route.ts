/**
 * POST /api/admin/login — autenticação provisória do painel.
 *
 * Ver o aviso em components/admin/admin-login.tsx sobre a substituição
 * planejada por autenticação individual.
 */

import { NextResponse } from 'next/server';

import { ADMIN_SESSION_COOKIE } from '@/server/admin-auth';
import { checkRateLimit, getClientIp, safeCompare } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const expected = process.env.ADMIN_ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  // Rate limit AGRESSIVO: é um endpoint de autenticação, alvo natural de
  // força bruta. 5 tentativas a cada 15 minutos por IP.
  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`admin-login:${ip}`, {
    maxRequests: 5,
    windowSeconds: 900,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const token = (body as { token?: unknown }).token;
  if (typeof token !== 'string' || !safeCompare(token, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });

  response.cookies.set(ADMIN_SESSION_COOKIE, expected, {
    // `httpOnly` impede que JavaScript leia o cookie — se houver um XSS em
    // qualquer parte do site, a sessão do admin não é roubada.
    httpOnly: true,
    // `secure` só envia por HTTPS. Desligado em dev, onde não há TLS.
    secure: process.env.NODE_ENV === 'production',
    // `strict` impede que o cookie seja enviado em requisições vindas de outro
    // site — é a defesa de CSRF para as ações do painel.
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 horas: um turno de trabalho.
  });

  return response;
}
