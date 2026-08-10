/**
 * =============================================================================
 * PATCH /api/admin/accounts/[id] — ativar, desativar, mudar nível, trocar senha
 * =============================================================================
 *
 * NÃO EXISTE DELETE, e a ausência é deliberada. `Article.authorId` é obrigatório:
 * apagar uma conta exigiria decidir o que fazer com tudo que ela assinou, e as
 * duas saídas possíveis são ruins — apagar as matérias junto (perda de acervo) ou
 * reatribuir a assinatura a outra pessoa (falsificação de autoria num veículo
 * jornalístico). Desativar resolve o problema real ("esta pessoa não entra
 * mais") sem tocar no que ela publicou.
 */

import { NextResponse } from 'next/server';

import { hashPassword, prisma, validateStaffPassword } from '@subcarioca/db';
import { isAccessLevel } from '@subcarioca/core';

import { requireStaffApi, revokeStaffSessions } from '@/server/staff-auth';
import { getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffApi('gerenciarContas');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Identificador inválido.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  const target = await prisma.author.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true, systemRole: true },
  });

  if (!target) {
    return NextResponse.json({ ok: false, message: 'Conta não encontrada.' }, { status: 404 });
  }

  const action = typeof payload.action === 'string' ? payload.action : '';

  switch (action) {
    // -------------------------------------------------------------------------
    case 'set-active': {
      const isActive = payload.isActive === true;

      /**
       * A TRAVA QUE IMPEDE O SITE DE FICAR SEM DONO.
       *
       * Sem ela, um admin desativa a própria conta (ou a do colega) por engano e
       * o painel fica INACESSÍVEL: não há mais ninguém que possa reativar
       * ninguém, e a saída passa a ser mexer no banco à mão — exatamente o
       * cenário que este sistema existe para eliminar.
       *
       * A contagem é feita DENTRO da transação, com a escrita, pelo mesmo motivo
       * que o `updateMany` condicional do fluxo de tópicos: dois admins clicando
       * ao mesmo tempo em "desativar" no outro passariam os dois por uma
       * verificação feita antes, e o site ficaria com zero administradores
       * ativos. Ver o comentário em api/admin/topics/[id]/route.ts.
       */
      if (!isActive) {
        const blocked = await prisma.$transaction(async (tx) => {
          const remaining = await tx.author.count({
            where: { systemRole: 'admin', isActive: true, id: { not: id } },
          });
          if (remaining === 0) return true;

          await tx.author.update({ where: { id }, data: { isActive: false } });
          return false;
        });

        if (blocked) {
          return NextResponse.json(
            {
              ok: false,
              message:
                'Esta é a última conta de administrador ativa. Crie ou promova outra antes de desativá-la — senão ninguém consegue entrar no painel.',
            },
            { status: 409 },
          );
        }

        // A revogação vem DEPOIS de a linha estar gravada: revogar antes deixaria
        // uma janela em que a pessoa não tem sessão mas a conta ainda está ativa
        // (ela simplesmente reentraria).
        await revokeStaffSessions(id);
      } else {
        await prisma.author.update({ where: { id }, data: { isActive: true } });
      }

      await writeAudit(request, guard.user.id, id, 'staff.account_active_changed', {
        before: { isActive: target.isActive },
        after: { isActive },
      });

      return NextResponse.json({
        ok: true,
        message: isActive
          ? `Conta de ${target.name} reativada.`
          : `Conta de ${target.name} desativada. As sessões abertas dela foram encerradas.`,
      });
    }

    // -------------------------------------------------------------------------
    case 'set-level': {
      if (!isAccessLevel(payload.accessLevel)) {
        return NextResponse.json({ ok: false, message: 'Nível inválido.' }, { status: 400 });
      }
      const accessLevel = payload.accessLevel;

      // Mesma trava da desativação, pelo mesmo motivo: rebaixar o último admin a
      // redator tranca o painel de forma idêntica a desativá-lo.
      if (accessLevel !== 'admin' && target.systemRole === 'admin') {
        const blocked = await prisma.$transaction(async (tx) => {
          const remaining = await tx.author.count({
            where: { systemRole: 'admin', isActive: true, id: { not: id } },
          });
          if (remaining === 0) return true;
          await tx.author.update({ where: { id }, data: { systemRole: accessLevel } });
          return false;
        });

        if (blocked) {
          return NextResponse.json(
            {
              ok: false,
              message:
                'Esta é a última conta de administrador ativa. Promova outra pessoa antes de rebaixar esta.',
            },
            { status: 409 },
          );
        }
      } else {
        await prisma.author.update({ where: { id }, data: { systemRole: accessLevel } });
      }

      /**
       * MUDANÇA DE NÍVEL ENCERRA AS SESSÕES DA PESSOA.
       *
       * Não é rigor excessivo: `getStaffUser` relê a conta a cada requisição, então
       * o nível novo já valeria. O motivo é a UI — o painel decide o que mostrar no
       * momento em que a página renderiza, e alguém rebaixado no meio de uma sessão
       * continuaria com a tela de admin aberta, clicando em botões que passam a
       * responder 403 sem explicação. Reentrar devolve uma tela coerente.
       */
      await revokeStaffSessions(id);

      await writeAudit(request, guard.user.id, id, 'staff.account_level_changed', {
        before: { accessLevel: target.systemRole },
        after: { accessLevel },
      });

      return NextResponse.json({
        ok: true,
        message: `${target.name} agora é ${accessLevel === 'admin' ? 'administrador' : 'redator'}.`,
      });
    }

    // -------------------------------------------------------------------------
    case 'reset-password': {
      const password = validateStaffPassword(payload.password);
      if (!password.ok) {
        return NextResponse.json({ ok: false, message: password.message }, { status: 400 });
      }

      await prisma.author.update({
        where: { id },
        data: { passwordHash: await hashPassword(password.password) },
      });

      // Trocar a senha DERRUBA todas as sessões da conta. É o caso de uso número
      // um da troca ("acho que alguém pegou meu acesso") — se as sessões antigas
      // sobrevivessem, a troca não resolveria nada.
      await revokeStaffSessions(id);

      await writeAudit(request, guard.user.id, id, 'staff.password_reset', {
        // Nenhuma senha, nenhum hash, nem antes nem depois. O log registra que a
        // troca ACONTECEU e por quem — que é tudo o que a auditoria precisa saber.
        after: { by: guard.user.email },
      });

      return NextResponse.json({
        ok: true,
        message: `Senha de ${target.name} trocada. As sessões abertas foram encerradas.`,
      });
    }

    // -------------------------------------------------------------------------
    default:
      return NextResponse.json({ ok: false, message: 'Ação desconhecida.' }, { status: 400 });
  }
}

async function writeAudit(
  request: Request,
  actorId: string,
  entityId: string,
  action: string,
  data: { before?: unknown; after?: unknown },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action,
      entityType: 'Author',
      entityId,
      actorId,
      before: (data.before ?? undefined) as never,
      after: (data.after ?? undefined) as never,
      ipHash: hashPersonalData(getClientIp(request.headers)),
    },
  });
}
