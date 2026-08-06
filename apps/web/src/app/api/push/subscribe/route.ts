/**
 * =============================================================================
 * POST /api/push/subscribe — registra uma inscrição de Web Push
 * =============================================================================
 *
 * O navegador gera um objeto `PushSubscription` contendo:
 *   - endpoint: URL única no serviço de push do navegador (FCM, Mozilla, WNS)
 *   - keys.p256dh: chave pública para criptografia da carga
 *   - keys.auth: segredo de autenticação
 *
 * Precisamos dos três para enviar notificações criptografadas.
 *
 * NOTA DE SEGURANÇA SOBRE ESSES DADOS: as chaves são específicas do par
 * navegador+origem e inúteis fora dele — quem as roubar não consegue enviar
 * push em nosso nome (isso exige a chave VAPID privada, que fica só no
 * servidor). Ainda assim, o endpoint é um identificador estável do dispositivo,
 * o que o torna dado pessoal para efeitos de LGPD. Tratamos com o mesmo
 * cuidado do restante.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@canalnerd/db';

import { checkRateLimit, getClientIp } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Valida a forma do objeto vindo do navegador. Entrada externa é hostil. */
function parseSubscription(input: unknown): {
  endpoint: string;
  p256dh: string;
  auth: string;
} | null {
  if (typeof input !== 'object' || input === null) return null;

  const sub = input as Record<string, unknown>;
  const endpoint = sub.endpoint;
  const keys = sub.keys as Record<string, unknown> | undefined;

  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 1000) {
    return null;
  }

  // O endpoint DEVE ser HTTPS e de um domínio de serviço de push conhecido.
  // Sem essa checagem, um atacante registraria um endpoint apontando para um
  // servidor próprio e transformaria nosso worker de push num agente de
  // requisições arbitrárias — uma SSRF (Server-Side Request Forgery) clássica.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;

  // Domínios-raiz dos serviços de push dos navegadores. O casamento é por
  // sufixo COM ponto separador (ou igualdade exata), para que
  // "fcm.googleapis.com.evil.com" não seja aceito — o erro clássico de quem
  // valida host com `includes()`.
  const ALLOWED_PUSH_DOMAINS = [
    'googleapis.com', // Chrome / Edge (FCM)
    'mozilla.com', // Firefox
    'windows.com', // Edge legado (WNS)
    'apple.com', // Safari
  ];

  const hostAllowed = ALLOWED_PUSH_DOMAINS.some(
    (domain) => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`),
  );
  if (!hostAllowed) return null;

  if (
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string' ||
    keys.p256dh.length > 200 ||
    keys.auth.length > 100
  ) {
    return null;
  }

  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request.headers);
    const rateLimit = checkRateLimit(`push:${ip}`, { maxRequests: 10, windowSeconds: 3600 });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, message: 'Muitas tentativas.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
    }

    const payload = body as Record<string, unknown> | null;
    const subscription = parseSubscription(payload?.subscription);

    if (!subscription) {
      return NextResponse.json(
        { ok: false, message: 'Dados de inscrição inválidos.' },
        { status: 400 },
      );
    }

    // Segmentação opcional. Validamos contra listas fechadas em vez de aceitar
    // qualquer string — evita poluir o banco e travar consultas futuras.
    const categories = Array.isArray(payload?.preferredCategories)
      ? (payload.preferredCategories as unknown[])
          .filter((c): c is string => typeof c === 'string')
          .slice(0, 10)
      : [];

    // `upsert` pelo endpoint: reinstalar o app ou reconceder a permissão gera o
    // mesmo endpoint, e não queremos linhas duplicadas (que causariam
    // notificação em dobro — a forma mais rápida de perder um assinante).
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        isActive: true,
        // Reativar zera o contador de falhas: o endpoint voltou a funcionar.
        failureCount: 0,
        preferredCategories: categories,
      },
      create: {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: request.headers.get('user-agent')?.slice(0, 255) ?? null,
        preferredCategories: categories,
        // Padrão 80 = só recebe notificação de faixa QUENTE. Conservador de
        // propósito: a promessa feita ao usuário é "no máximo 2 por dia".
        minScoreThreshold: 80,
      },
    });

    return NextResponse.json({ ok: true, message: 'Alertas ativados.' });
  } catch (error) {
    console.error('[push] erro ao registrar inscrição:', error);
    return NextResponse.json({ ok: false, message: 'Erro interno.' }, { status: 500 });
  }
}
