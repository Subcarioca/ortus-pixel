/**
 * =============================================================================
 * DELETE /api/account — o leitor apaga a própria conta
 * =============================================================================
 *
 * POR QUE ISTO EXISTE: a partir do momento em que o site guarda o que uma
 * pessoa SEGUE, ele mantém um registro de preferências ligado a uma identidade.
 * O direito de eliminação (LGPD, art. 18, VI) deixa de ser teórico — e um
 * "mande e-mail para pedir exclusão" é a forma de não atender a esse direito
 * mantendo a aparência de que se atende.
 *
 * O QUE É APAGADO, e por que a lista é exatamente esta:
 *
 *   CommentAuthor   → a identidade em si. Some.
 *   CommentSession  → em cascata pelo schema. O acesso morre no mesmo instante.
 *   FranchiseFollow → em cascata pelo schema. É o dado de preferência.
 *   CategoryFollow  → em cascata pelo schema. Mesmo dado, para editoria.
 *   ArticleReaction → em cascata pelo schema. Curtidas/descurtidas somem.
 *
 * O QUE **NÃO** É APAGADO, e por que isso está certo:
 *
 *   Os COMENTÁRIOS PUBLICADOS permanecem, com o `authorName` que já era um
 *   snapshot do momento da publicação. Três razões: (a) apagar a conta não pode
 *   abrir buracos numa conversa pública da qual outras pessoas participaram;
 *   (b) o vínculo com a conta é desfeito (`authorAccountId` fica nulo), então o
 *   texto deixa de estar ligado a uma identidade; (c) o que sobra é o nome
 *   público que a própria pessoa escolheu exibir ao publicar.
 *
 *   Isso é anonimização, não retenção disfarçada: depois da operação não existe
 *   mais nenhum caminho do comentário de volta para a conta de origem.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';

import { destroyReaderSession, getReaderSession } from '@/server/reader-session';
import { checkRateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  const session = await getReaderSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: 'Não autenticado.' }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`account-delete:${session.authorId}`, {
    maxRequests: 5,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Tente novamente em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  await prisma.$transaction(async (tx) => {
    // 1) Desfaz o vínculo dos comentários ANTES de apagar a conta.
    //
    // A ordem importa: `Comment.authorAccount` está declarado com
    // `onDelete: Cascade`, então apagar a conta primeiro levaria os comentários
    // junto — exatamente o que não queremos. Anular o vínculo aqui é o que
    // transforma "apagar a conta" em anonimização em vez de remoção de conversa
    // alheia.
    await tx.comment.updateMany({
      where: { authorAccountId: session.authorId },
      data: { authorAccountId: null },
    });

    // 2) Os follows de FRANQUIA precisam devolver o que somaram ao contador
    // desnormalizado, senão a franquia fica com seguidores fantasmas para
    // sempre. `CategoryFollow` não tem contador equivalente (ver o comentário
    // de `CategoryFollow` no schema) — nada a decrementar ali.
    const follows = await tx.franchiseFollow.findMany({
      where: { commentAuthorId: session.authorId },
      select: { franchiseId: true },
    });

    for (const follow of follows) {
      await tx.franchise.update({
        where: { id: follow.franchiseId },
        data: { followerCount: { decrement: 1 } },
      });
    }

    // 3) MESMO RACIOCÍNIO para as reações: `Article.reactionCount` é
    // desnormalizado (ver o comentário do campo no schema), então apagar a
    // conta sem tocar nele deixaria matérias com reação "fantasma" contada
    // para sempre — o mesmo bug que o passo 2 evita para franquias.
    const reactions = await tx.articleReaction.findMany({
      where: { commentAuthorId: session.authorId },
      select: { articleId: true },
    });

    for (const reaction of reactions) {
      await tx.article.update({
        where: { id: reaction.articleId },
        data: { reactionCount: { decrement: 1 } },
      });
    }

    // 4) A conta. Sessões, follows (franquia e categoria) e reações saem em
    // cascata, pelo schema.
    await tx.commentAuthor.delete({ where: { id: session.authorId } });
  });

  // O cookie também precisa sair: sem isso, o navegador continuaria enviando um
  // token que não resolve mais para nada, e a pessoa veria um estado ambíguo
  // ("estou logado?") até a expiração.
  await destroyReaderSession();

  return NextResponse.json(
    { ok: true, message: 'Conta apagada.' },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
