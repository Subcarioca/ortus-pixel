/**
 * =============================================================================
 * DESCADASTRO — GET (clique no link) e POST (One-Click da RFC 8058)
 * =============================================================================
 *
 * POR QUE OS DOIS MÉTODOS:
 *   - GET: o usuário clica no link do rodapé do e-mail.
 *   - POST: Gmail, Yahoo e Outlook chamam automaticamente este endpoint quando
 *     o usuário aperta "Cancelar inscrição" na própria interface do webmail.
 *     Desde 2024 isso é EXIGIDO de remetentes em massa; sem suporte, as
 *     mensagens passam a ser filtradas.
 *
 * DECISÃO IMPORTANTE: o descadastro NUNCA falha por token expirado e nunca pede
 * confirmação adicional. Dificultar a saída é o caminho mais rápido para ser
 * marcado como spam — e uma marcação de spam prejudica a entrega para TODA a
 * base, enquanto um cancelamento afeta só uma pessoa.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';

import { hashToken } from '@/server/security';

export const dynamic = 'force-dynamic';

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || token.length > 200) return false;

  const subscriber = await prisma.subscriber.findFirst({
    where: { unsubscribeTokenHash: hashToken(token) },
    select: { id: true, status: true },
  });

  if (!subscriber) return false;

  // Idempotente: já descadastrado continua sendo sucesso.
  if (subscriber.status === 'unsubscribed') return true;

  await prisma.subscriber.update({
    where: { id: subscriber.id },
    data: { status: 'unsubscribed', unsubscribedAt: new Date() },
  });

  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ok = await unsubscribe(url.searchParams.get('token'));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(
    `${siteUrl}/newsletter/descadastro?status=${ok ? 'sucesso' : 'invalido'}`,
    { status: 303 },
  );
}

/**
 * One-Click do provedor de e-mail.
 * Responde 200 mesmo em caso de token desconhecido: o provedor só quer saber se
 * o endpoint funcionou, e devolver erro pode fazê-lo penalizar o remetente.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  await unsubscribe(url.searchParams.get('token'));
  return new NextResponse(null, { status: 200 });
}
