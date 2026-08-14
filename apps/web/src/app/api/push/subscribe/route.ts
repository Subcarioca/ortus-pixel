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

import { isCategorySlug } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

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

  // 512 e não 1000: este número TEM que ser o mesmo de
  // `PushSubscription.endpoint @db.VarChar(512)` no schema.
  //
  // POR QUE 512 E NÃO O CONTRÁRIO (subir a coluna para 1000): a coluna é
  // `@unique`, ou seja, precisa caber num índice do InnoDB, cujo teto é 3.072
  // bytes. Com `utf8mb4` (4 bytes/caractere), 1000 caracteres dariam 4.000 —
  // não cabe. 512 dá 2.048 e cabe com folga. Logo, quem cede é o validador.
  //
  // E CEDER IMPORTA: o servidor não está em `sql_mode` estrito, então um
  // endpoint entre 513 e 1000 caracteres passaria pela validação e seria
  // TRUNCADO em silêncio no banco. O efeito seria pior do que uma recusa —
  // guardaríamos um endpoint inválido, o push falharia para sempre naquele
  // aparelho, e o `upsert` por endpoint criaria uma linha nova a cada visita.
  // Recusar na porta é honesto; truncar é uma inscrição que finge existir.
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 512) {
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

  // 191 para `p256dh` porque é o tamanho da coluna (o padrão do conector MySQL
  // do Prisma), e validador e coluna precisam concordar — mesmo raciocínio do
  // `endpoint` acima. Não aperta nada na prática: uma chave pública P-256 em
  // base64url tem 88 caracteres, então 191 é o dobro da folga necessária.
  // `auth` (16 bytes → 24 caracteres) já era mais estrito que a coluna: fica.
  if (
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string' ||
    keys.p256dh.length > 191 ||
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

    // Segmentação opcional, validada contra a LISTA FECHADA de editorias.
    //
    // ⚠ O `.filter(isCategorySlug)` é a linha que faz o comentário ser verdade.
    // Antes, este bloco dizia "validamos contra listas fechadas" mas só conferia
    // `typeof === 'string'` — ou seja, qualquer texto entrava. A auditoria de
    // segurança pegou; o registro fica porque comentário que promete mais do que
    // o código entrega é pior que comentário nenhum: ele desliga a desconfiança
    // de quem lê depois.
    //
    // O QUE ISSO FECHA, concretamente. Esta rota é PÚBLICA e não autenticada.
    // Sem a lista fechada, qualquer um podia gravar dez strings arbitrárias — e
    // arbitrariamente grandes, porque `preferredCategories` é coluna `Json`
    // (LONGTEXT), sem limite de tamanho por item. Essas strings são lidas
    // depois por `push-sender.ts`, num `findMany` SEM `take`, que carrega todos
    // os inscritos elegíveis na memória de uma vez. Um punhado de inscrições
    // forjadas com listas enormes vira consumo de memória do processo web no
    // momento do disparo — amplificação a partir de uma rota anônima.
    // Com a lista fechada, o pior caso por linha passa a ser 10 slugs curtos.
    //
    // `.slice(0, 10)` continua: são 6 editorias hoje, então 10 já é teto
    // generoso, e ele protege contra um payload com o mesmo slug repetido mil
    // vezes (que passaria em `isCategorySlug` sem problema nenhum).
    const categories = Array.isArray(payload?.preferredCategories)
      ? (payload.preferredCategories as unknown[])
          .filter((c): c is string => typeof c === 'string')
          .filter(isCategorySlug)
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
