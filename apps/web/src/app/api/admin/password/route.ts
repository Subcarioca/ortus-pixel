/**
 * =============================================================================
 * POST /api/admin/password — a pessoa troca a PRÓPRIA senha
 * =============================================================================
 *
 * Rota separada de `/api/admin/accounts/[id]`, e não uma ação a mais lá, por uma
 * razão de segurança e não de organização: aquela rota exige a permissão
 * `gerenciarContas` e opera sobre um id vindo da URL. Acomodar "trocar a própria"
 * ali significaria abrir uma exceção do tipo "…ou se o id for o seu" — e exceção
 * dentro de guard de permissão é onde mora a escalada de privilégio. Aqui não há
 * id nenhum: o alvo é SEMPRE quem está logado, e não existe parâmetro capaz de
 * apontar para outra conta.
 *
 * Sem esta rota, um redator dependeria de um admin para trocar a senha que o
 * próprio admin criou — ou seja, a senha de todo mundo seria conhecida por uma
 * segunda pessoa para sempre. É o cenário que o OWASP chama de credencial
 * compartilhada por construção, e ele derrota o propósito de ter contas
 * individuais.
 */

import { NextResponse } from 'next/server';

import { hashPassword, prisma, validateStaffPassword, verifyPassword } from '@subcarioca/db';

import { requireStaffApi, revokeStaffSessions } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await requireStaffApi();
  if (!guard.ok) return guard.response;

  // Rate limit por CONTA (e não por IP): o alvo aqui não é força bruta de fora,
  // é alguém com acesso momentâneo à máquina de outra pessoa tentando adivinhar
  // a senha atual para trocá-la.
  const limit = checkRateLimit(`staff-password:${guard.user.id}`, {
    maxRequests: 5,
    windowSeconds: 900,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Muitas tentativas. Espere alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(limit.resetInSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const current = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';

  /**
   * A SENHA ATUAL É EXIGIDA MESMO COM A SESSÃO VÁLIDA.
   *
   * Parece redundante — a pessoa já provou quem é ao entrar. Não é: sem isso,
   * qualquer sessão momentaneamente sequestrada (computador destravado, XSS que
   * escape em outra parte do site, cookie roubado) vira posse PERMANENTE da
   * conta, porque o atacante troca a senha e expulsa a dona. Pedir a senha atual
   * é o que mantém o dano de uma sessão comprometida limitado à duração dela.
   */
  const account = await prisma.author.findUnique({
    where: { id: guard.user.id },
    select: { passwordHash: true },
  });

  if (!account?.passwordHash || !(await verifyPassword(current, account.passwordHash))) {
    return NextResponse.json({ ok: false, message: 'A senha atual está incorreta.' }, { status: 401 });
  }

  const next = validateStaffPassword(payload.newPassword);
  if (!next.ok) {
    return NextResponse.json({ ok: false, message: next.message }, { status: 400 });
  }

  if (next.password === current) {
    return NextResponse.json(
      { ok: false, message: 'A senha nova precisa ser diferente da atual.' },
      { status: 400 },
    );
  }

  await prisma.author.update({
    where: { id: guard.user.id },
    data: { passwordHash: await hashPassword(next.password) },
  });

  await prisma.auditLog.create({
    data: {
      action: 'staff.password_changed',
      entityType: 'Author',
      entityId: guard.user.id,
      actorId: guard.user.id,
      ipHash: hashPersonalData(getClientIp(request.headers)),
    },
  });

  // Derruba TODAS as sessões, inclusive esta. É o comportamento esperado de uma
  // troca de senha ("expulse quem estiver logado como eu") e o motivo pelo qual
  // a resposta avisa que será preciso entrar de novo.
  await revokeStaffSessions(guard.user.id);

  return NextResponse.json({
    ok: true,
    message: 'Senha trocada. Entre de novo com a senha nova.',
  });
}
