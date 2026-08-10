/**
 * =============================================================================
 * POST /api/admin/comments — moderação
 * =============================================================================
 *
 * Ações: `approve`, `reject`, `spam`, `block-author`.
 *
 * DUAS DECISÕES QUE PARECEM DETALHE E SÃO ESTRUTURAIS:
 *
 * 1. REMOVER NÃO APAGA A LINHA. O comentário rejeitado continua no banco, com o
 *    conteúdo original, quem removeu e quando. Sem isso, uma remoção contestada
 *    ("por que apagaram o meu comentário?") vira palavra contra palavra, e não
 *    há como identificar reincidência de quem foi removido cinco vezes.
 *
 * 2. BLOQUEAR O AUTOR REVOGA AS SESSÕES DELE NA HORA. Sem revogar, o banimento
 *    só valeria no próximo login — e o abusador, já logado, continuaria
 *    postando. É a operação que justifica termos escolhido sessão opaca no
 *    banco em vez de JWT (ver server/reader-session.ts).
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { prisma } from '@subcarioca/db';

import { requireStaffApi } from '@/server/staff-auth';
import { revokeAllSessions } from '@/server/reader-session';
import { CACHE_TAGS } from '@/server/queries';
import { getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

const ID_PATTERN = /^[a-z0-9-]{10,60}$/i;

export async function POST(request: Request) {
  const guard = await requireStaffApi('moderarComentarios');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as { action?: unknown; commentId?: unknown; note?: unknown };
  const action = typeof payload.action === 'string' ? payload.action : '';
  const commentId = typeof payload.commentId === 'string' ? payload.commentId : '';

  if (!ID_PATTERN.test(commentId)) {
    return NextResponse.json({ ok: false, message: 'Comentário inválido.' }, { status: 400 });
  }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      status: true,
      content: true,
      authorAccountId: true,
      article: { select: { slug: true } },
    },
  });

  if (!comment) {
    return NextResponse.json({ ok: false, message: 'Comentário não encontrado.' }, { status: 404 });
  }

  const ipHash = hashPersonalData(getClientIp(request.headers));
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 200) : null;

  switch (action) {
    // -------------------------------------------------------------------------
    case 'approve': {
      await prisma.$transaction([
        prisma.comment.update({
          where: { id: commentId },
          data: { status: 'approved', moderatedAt: new Date(), moderationNote: note },
        }),
        // Subir o contador do autor é o que promove a conta na "escada de
        // confiança": a partir daqui, os comentários dela publicam direto. É a
        // engrenagem que impede a fila de moderação de crescer sem limite.
        ...(comment.authorAccountId
          ? [
              prisma.commentAuthor.update({
                where: { id: comment.authorAccountId },
                data: { approvedCount: { increment: 1 } },
              }),
            ]
          : []),
      ]);

      revalidateTag(CACHE_TAGS.article(comment.article.slug));
      await audit('comment.approved', commentId, comment.status, 'approved', ipHash, note);

      return NextResponse.json({ ok: true, message: 'Comentário aprovado.' });
    }

    // -------------------------------------------------------------------------
    case 'reject':
    case 'spam': {
      const status = action === 'spam' ? 'spam' : 'rejected';

      // 'spam' e 'rejected' são estados SEPARADOS de propósito: são decisões
      // diferentes ("isto é lixo automatizado" x "isto viola a regra da casa").
      // Contá-las juntas esconderia um ataque de spam em andamento no meio da
      // moderação editorial normal.
      await prisma.comment.update({
        where: { id: commentId },
        data: { status, moderatedAt: new Date(), moderationNote: note },
      });

      // Invalidamos mesmo quando o comentário estava pendente: custa pouco e
      // evita o caso em que ele havia sido aprovado antes e continuaria no HTML
      // cacheado depois de removido — que é o pior resultado possível aqui.
      revalidateTag(CACHE_TAGS.article(comment.article.slug));
      await audit(`comment.${status}`, commentId, comment.status, status, ipHash, note);

      return NextResponse.json({ ok: true, message: 'Comentário removido.' });
    }

    // -------------------------------------------------------------------------
    case 'block-author': {
      if (!comment.authorAccountId) {
        return NextResponse.json(
          { ok: false, message: 'Comentário sem conta associada (legado).' },
          { status: 400 },
        );
      }

      await prisma.$transaction([
        prisma.commentAuthor.update({
          where: { id: comment.authorAccountId },
          data: { isBlocked: true, blockedAt: new Date(), blockReason: note },
        }),
        // Todo o histórico dessa conta sai do ar de uma vez. Quem foi banido
        // por um comentário abusivo raramente tem os outros dignos de manter, e
        // varrer a linha do tempo à mão é trabalho que a redação não vai fazer.
        prisma.comment.updateMany({
          where: { authorAccountId: comment.authorAccountId, status: 'approved' },
          data: { status: 'rejected', moderatedAt: new Date(), moderationNote: note },
        }),
      ]);

      // Revogação imediata — ver o comentário no topo do arquivo.
      const revoked = await revokeAllSessions(comment.authorAccountId);

      revalidateTag(CACHE_TAGS.article(comment.article.slug));
      await audit('comment.author_blocked', comment.authorAccountId, null, { revoked }, ipHash, note);

      return NextResponse.json({
        ok: true,
        message: `Autor bloqueado. ${revoked} sessão(ões) encerrada(s) e comentários anteriores removidos.`,
      });
    }

    default:
      return NextResponse.json({ ok: false, message: 'Ação desconhecida.' }, { status: 400 });
  }
}

async function audit(
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  ipHash: string,
  reason: string | null,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action,
      entityType: 'Comment',
      entityId,
      before: before === null ? undefined : ({ status: before } as object),
      after: after === null ? undefined : ({ status: after } as object),
      reason,
      ipHash,
    },
  });
}
