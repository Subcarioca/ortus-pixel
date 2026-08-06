/**
 * =============================================================================
 * GET /api/newsletter/confirm — passo 2 do double opt-in
 * =============================================================================
 *
 * O usuário chega aqui clicando no link do e-mail. Por isso é GET (e não POST):
 * cliente de e-mail não envia POST.
 *
 * CONSEQUÊNCIA DE SEGURANÇA DISSO: como é um GET acionado por clique, não há
 * proteção de CSRF possível nem necessária — a ação é idempotente e o token
 * secreto no link É a autenticação. O que importa então é:
 *   - token de uso ÚNICO (invalidado após o uso);
 *   - token com EXPIRAÇÃO;
 *   - comparação por HASH (o banco nunca teve o token em claro).
 */

import { NextResponse } from 'next/server';

import { prisma } from '@canalnerd/db';

import { buildWelcomeEmail, sendEmail } from '@/server/email';
import { generateToken, hashToken } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Redireciona para uma página de resultado, em vez de devolver JSON cru. */
function redirectTo(status: 'sucesso' | 'expirado' | 'invalido'): NextResponse {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(`${siteUrl}/newsletter/confirmado?status=${status}`, {
    // 303 força o navegador a fazer GET no destino, que é o correto após
    // processar uma ação.
    status: 303,
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || token.length > 200) {
      return redirectTo('invalido');
    }

    // Buscamos pelo HASH do token apresentado. Nunca comparamos strings em
    // claro, e nunca precisamos descriptografar nada.
    const tokenHash = hashToken(token);

    const subscriber = await prisma.subscriber.findFirst({
      where: { confirmationTokenHash: tokenHash },
      select: { id: true, email: true, status: true, confirmationExpiresAt: true },
    });

    if (!subscriber) {
      return redirectTo('invalido');
    }

    // Já confirmado: tratamos como sucesso (idempotência). O usuário pode ter
    // clicado duas vezes ou o cliente de e-mail pode ter pré-carregado o link —
    // mostrar erro nesse caso seria confuso e alarmante sem motivo.
    if (subscriber.status === 'confirmed') {
      return redirectTo('sucesso');
    }

    if (
      !subscriber.confirmationExpiresAt ||
      subscriber.confirmationExpiresAt.getTime() < Date.now()
    ) {
      return redirectTo('expirado');
    }

    // Token de descadastro, gerado agora e válido enquanto a inscrição existir.
    const unsubscribeToken = generateToken();

    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        // USO ÚNICO: limpamos o token de confirmação. Sem isso, o mesmo link
        // continuaria válido para sempre — e links de e-mail vazam com
        // frequência (encaminhamento, histórico, extensões de navegador).
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
        unsubscribeTokenHash: hashToken(unsubscribeToken),
      },
    });

    // Boas-vindas com o link de descadastro de um clique (RFC 8058).
    // Falha aqui não invalida a confirmação: o cadastro já está feito.
    const result = await sendEmail(buildWelcomeEmail(subscriber.email, unsubscribeToken));
    if (!result.ok) {
      console.error('[newsletter] falha ao enviar boas-vindas:', result.error);
    }

    return redirectTo('sucesso');
  } catch (error) {
    console.error('[newsletter] erro na confirmação:', error);
    return redirectTo('invalido');
  }
}
