/**
 * =============================================================================
 * POST /api/admin/login — entrada da redação (e-mail + senha)
 * =============================================================================
 *
 * Substituiu a autenticação por segredo compartilhado. O racional completo da
 * troca está em `server/staff-auth.ts`; aqui ficam as decisões da BORDA, que são
 * três e todas de segurança.
 */

import { NextResponse } from 'next/server';

import { authenticateStaff, setStaffSessionCookie } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, validateEmail } from '@/server/security';

export const dynamic = 'force-dynamic';

/**
 * Mensagem ÚNICA para toda falha de credencial.
 *
 * Nunca dizemos qual metade errou. "Este e-mail não existe" transforma a rota de
 * login num verificador de contas: o atacante descobre quem trabalha na redação
 * sem acertar uma senha sequer, e usa isso para phishing dirigido. O mesmo vale
 * para "conta desativada", que confirma que a conta existiu.
 */
const CREDENTIALS_MESSAGE = 'E-mail ou senha incorretos.';

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  /**
   * RATE LIMIT EM DOIS EIXOS — e o segundo é o que costuma faltar.
   *
   * Por IP (5 em 15 min) barra a força bruta clássica: uma máquina martelando
   * uma conta. Mas o ataque comum hoje é o inverso — "password spraying": mil
   * IPs diferentes tentando a MESMA senha óbvia em várias contas. Contra ele, o
   * limite por IP não faz nada, porque cada IP tenta uma vez só.
   *
   * O segundo limitador é GLOBAL na rota (60 tentativas por minuto no processo
   * inteiro). Em uma redação de poucas pessoas, 60 logins por minuto já é
   * absurdo: o teto não incomoda ninguém real e derruba o spray.
   *
   * Limitação conhecida e aceita (a mesma já documentada em `security.ts`): o
   * contador vive na memória do processo. Com várias instâncias, o limite real
   * vira N vezes o configurado. A troca por Redis é de uma função só.
   */
  const perIp = checkRateLimit(`staff-login:${ip}`, { maxRequests: 5, windowSeconds: 900 });
  const global = checkRateLimit('staff-login:global', { maxRequests: 60, windowSeconds: 60 });

  if (!perIp.allowed || !global.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.max(perIp.resetInSeconds, global.resetInSeconds)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  const email = validateEmail(payload.email);
  const password = typeof payload.password === 'string' ? payload.password : '';

  // E-mail malformado e senha vazia devolvem a MESMA mensagem do erro de
  // credencial, e não um erro de validação específico: um "e-mail inválido"
  // distinto já é meio caminho para o atacante mapear o formato aceito.
  if (!email.valid || password.length === 0) {
    return NextResponse.json({ ok: false, message: CREDENTIALS_MESSAGE }, { status: 401 });
  }

  const session = await authenticateStaff({
    email: email.email,
    password,
    userAgent: request.headers.get('user-agent'),
    ip,
  });

  if (!session) {
    return NextResponse.json({ ok: false, message: CREDENTIALS_MESSAGE }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    message: `Bem-vindo, ${session.user.name}.`,
    // Devolvemos nome e nível para a tela poder se ajustar sem uma segunda
    // requisição. Nada aqui é segredo: é o que o painel já exibe no cabeçalho.
    user: { name: session.user.name, accessLevel: session.user.accessLevel },
  });

  setStaffSessionCookie(response, session.token);

  return response;
}
