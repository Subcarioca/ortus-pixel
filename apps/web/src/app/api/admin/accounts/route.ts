/**
 * =============================================================================
 * /api/admin/accounts — criar conta da redação (POST)
 * =============================================================================
 *
 * Só administrador. A checagem é `requireStaffApi('gerenciarContas')`, que lê a
 * tabela de permissões única de `core/staff.ts` — nenhuma rota decide sozinha o
 * que um nível pode fazer.
 *
 * CRIAR CONTA CRIA UM `Author`, e não uma entidade separada de "usuário". É a
 * decisão de arquitetura central desta parte: a pessoa que entra no painel é a
 * MESMA linha que assina a matéria. Ver o comentário do model `Author` no schema.
 */

import { NextResponse } from 'next/server';

import { hashPassword, prisma, validateStaffPassword } from '@subcarioca/db';
import { isAccessLevel, slugify } from '@subcarioca/core';

import { requireStaffApi } from '@/server/staff-auth';
import { getClientIp, hashPersonalData, validateEmail } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await requireStaffApi('gerenciarContas');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (name.length < 3 || name.length > 80) {
    return NextResponse.json(
      { ok: false, message: 'O nome precisa ter entre 3 e 80 caracteres.' },
      { status: 400 },
    );
  }

  const email = validateEmail(payload.email);
  if (!email.valid) {
    return NextResponse.json({ ok: false, message: 'E-mail inválido.' }, { status: 400 });
  }

  const password = validateStaffPassword(payload.password);
  if (!password.ok) {
    return NextResponse.json({ ok: false, message: password.message }, { status: 400 });
  }

  /**
   * O NÍVEL VEM DO CORPO, MAS PASSA PELO VALIDADOR DA UNION.
   *
   * `isAccessLevel` recusa qualquer coisa fora de 'admin'/'redator'. Sem ele,
   * um `systemRole: "superadmin"` gravado por requisição forjada viraria um
   * nível que `toAccessLevel` rebaixa para redator na leitura — o que por acaso
   * é seguro, mas por ACASO. Recusar na entrada é a garantia; cair no menos
   * privilegiado na leitura é a rede de segurança. As duas existem.
   */
  const accessLevel = isAccessLevel(payload.accessLevel) ? payload.accessLevel : 'redator';

  // Título editorial: texto livre, é o que sai na assinatura da matéria.
  const editorialRole =
    typeof payload.editorialRole === 'string' && payload.editorialRole.trim().length > 0
      ? payload.editorialRole.trim().slice(0, 60)
      : 'Redator';

  /**
   * O SLUG DO AUTOR É A URL PÚBLICA DELE (/autor/marina-alves) — precisa ser
   * único. Colisão de nome é normal numa redação que cresce ("Ana Silva" e "Ana
   * Silva"), então o sufixo numérico resolve em vez de recusar o cadastro por um
   * motivo que não é culpa de ninguém.
   */
  const baseSlug = slugify(name) || 'redacao';
  let slug = baseSlug;
  for (let attempt = 2; attempt <= 20; attempt += 1) {
    const taken = await prisma.author.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const passwordHash = await hashPassword(password.password);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const author = await tx.author.create({
        data: {
          name,
          slug,
          email: email.email,
          role: editorialRole,
          systemRole: accessLevel,
          passwordHash,
        },
        select: { id: true, name: true, email: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'staff.account_created',
          entityType: 'Author',
          entityId: author.id,
          // `actorId` é a conta de quem CRIOU — este campo existe desde sempre e
          // só agora tem como ser preenchido de verdade. Era exatamente o que o
          // segredo compartilhado impedia.
          actorId: guard.user.id,
          // O `after` NUNCA carrega a senha nem o hash dela. Auditoria é um lugar
          // onde dado sensível costuma vazar por generosidade: quem tem acesso ao
          // log não precisa ter acesso à credencial.
          after: { name, email: email.email, accessLevel, editorialRole },
          ipHash: hashPersonalData(getClientIp(request.headers)),
        },
      });

      return author;
    });

    return NextResponse.json({
      ok: true,
      message: `Conta de ${created.name} criada. Passe a senha para a pessoa por um canal seguro e peça que ela troque no primeiro acesso.`,
    });
  } catch (error) {
    // P2002 = violação de índice único. O único único que o formulário alcança é
    // o e-mail (o slug já foi resolvido acima).
    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json(
        { ok: false, message: 'Já existe uma conta com este e-mail.' },
        { status: 409 },
      );
    }
    throw error;
  }
}
