/**
 * =============================================================================
 * POST /api/newsletter/subscribe — passo 1 do double opt-in
 * =============================================================================
 *
 * FLUXO:
 *   1. Valida e limita a taxa.
 *   2. Cria (ou reaproveita) o registro com status 'pending'.
 *   3. Gera token de confirmação, guarda o HASH e envia o token por e-mail.
 *   4. Responde SEMPRE a mesma coisa — ver "enumeração" abaixo.
 *
 * POR QUE DOUBLE OPT-IN (e não inscrição direta):
 *   a) LGPD: é a prova de consentimento. Sem ela, não há como demonstrar que o
 *      titular autorizou o envio.
 *   b) Antiabuso: impede cadastrar o e-mail de terceiros sem consentimento.
 *   c) Entregabilidade: sem confirmação, bots enchem a base de endereços
 *      inválidos, os bounces disparam e o domínio inteiro vai para spam. Esse
 *      dano é lento e caro de reverter.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';

import { buildConfirmationEmail, sendEmail } from '@/server/email';
import {
  checkRateLimit,
  generateToken,
  getClientIp,
  hashPersonalData,
  hashToken,
  sanitizeSource,
  validateEmail,
} from '@/server/security';

/** Esta rota escreve no banco e nunca pode ser pré-renderizada. */
export const dynamic = 'force-dynamic';

/**
 * Resposta ÚNICA para sucesso e para "e-mail já cadastrado".
 *
 * ISSO É INTENCIONAL E IMPORTANTE — previne ENUMERAÇÃO DE USUÁRIOS. Se
 * respondêssemos "esse e-mail já está inscrito", qualquer pessoa poderia testar
 * endereços e descobrir quem é assinante do site. Isso é vazamento de dado
 * pessoal (LGPD) e insumo para phishing direcionado.
 *
 * O usuário legítimo não perde nada: ele recebe (ou não) o e-mail de confirmação
 * e o fluxo funciona igual.
 */
const GENERIC_SUCCESS = {
  ok: true,
  message: 'Enviamos um e-mail de confirmação. Verifique sua caixa de entrada e o spam.',
};

export async function POST(request: Request) {
  try {
    // -------------------------------------------------------------------------
    // 1. RATE LIMITING
    // -------------------------------------------------------------------------
    const ip = getClientIp(request.headers);
    const rateLimit = checkRateLimit(`newsletter:${ip}`, {
      // 5 inscrições por hora por IP. Generoso para o uso legítimo (uma família
      // ou um escritório atrás do mesmo IP), restritivo para bot.
      maxRequests: 5,
      windowSeconds: 3600,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, message: 'Muitas tentativas. Tente novamente mais tarde.' },
        {
          status: 429,
          // `Retry-After` é o cabeçalho padrão para o cliente saber quando voltar.
          headers: { 'Retry-After': String(rateLimit.resetInSeconds) },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 2. VALIDAÇÃO DA ENTRADA
    // -------------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // JSON malformado é entrada inválida, não erro de servidor.
      return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
    }

    const payload = body as Record<string, unknown> | null;
    const emailCheck = validateEmail(payload?.email);

    if (!emailCheck.valid) {
      return NextResponse.json(
        { ok: false, message: emailCheck.error ?? 'E-mail inválido.' },
        { status: 400 },
      );
    }

    const email = emailCheck.email;
    const source = sanitizeSource(payload?.source);

    // -------------------------------------------------------------------------
    // 3. PERSISTÊNCIA
    // -------------------------------------------------------------------------
    const existing = await prisma.subscriber.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    // Já confirmado: não reenviamos nada, mas respondemos a mensagem genérica.
    // Reenviar confirmação para quem já é assinante seria um vetor de spam
    // (alguém digita o e-mail da vítima repetidamente para incomodá-la).
    if (existing?.status === 'confirmed') {
      return NextResponse.json(GENERIC_SUCCESS);
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    // 48h para confirmar. Prazo curto reduz a janela de uso de um token vazado;
    // prazo longo demais faz o usuário voltar dias depois e falhar.
    const expiresAt = new Date(Date.now() + 48 * 3_600_000);

    await prisma.subscriber.upsert({
      where: { email },
      update: {
        confirmationTokenHash: tokenHash,
        confirmationExpiresAt: expiresAt,
        status: 'pending',
      },
      create: {
        email,
        status: 'pending',
        confirmationTokenHash: tokenHash,
        confirmationExpiresAt: expiresAt,
        signupSource: source,
        // Auditoria de consentimento (LGPD), com o IP em HASH — comprova o
        // consentimento sem armazenar o dado pessoal em claro.
        signupIpHash: hashPersonalData(ip),
        signupUserAgent: request.headers.get('user-agent')?.slice(0, 255) ?? null,
      },
    });

    // -------------------------------------------------------------------------
    // 4. ENVIO
    // -------------------------------------------------------------------------
    const result = await sendEmail(buildConfirmationEmail(email, token));

    if (!result.ok) {
      // O registro ficou 'pending' e o usuário pode tentar de novo. Logamos o
      // erro para monitoramento, mas não expomos o detalhe: mensagem de erro de
      // provedor pode revelar infraestrutura interna.
      console.error('[newsletter] falha ao enviar confirmação:', result.error);
      return NextResponse.json(
        { ok: false, message: 'Não conseguimos enviar o e-mail agora. Tente em alguns minutos.' },
        { status: 502 },
      );
    }

    return NextResponse.json(GENERIC_SUCCESS);
  } catch (error) {
    // Erro inesperado: log completo no servidor, mensagem genérica para fora.
    // Vazar stack trace entrega estrutura de código e versões de dependências.
    console.error('[newsletter] erro inesperado:', error);
    return NextResponse.json(
      { ok: false, message: 'Erro interno. Tente novamente.' },
      { status: 500 },
    );
  }
}
