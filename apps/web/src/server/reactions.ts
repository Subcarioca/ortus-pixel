import 'server-only';

import { prisma } from '@subcarioca/db';

import { getReaderSession } from './reader-session';

/**
 * =============================================================================
 * CURTIR / DESCURTIR MATÉRIA — mesmo peso, toggle/replace
 * =============================================================================
 *
 * DECISÃO DE PRODUTO (dono do site): curtir e descurtir SOMAM na popularidade,
 * com o MESMO PESO. Isto não é um "like menos deslike" — é uma medida de
 * ENGAJAMENTO total, e uma matéria polêmica que gera muito deslike é, para este
 * critério, tão relevante quanto uma que gera muito like. Quem quiser saber a
 * PROPORÇÃO (like vs dislike) tem os dois números brutos disponíveis; o que o
 * produto usa para ranquear popularidade é a SOMA, guardada em
 * `Article.reactionCount` (ver o comentário longo junto daquele campo no
 * schema para o racional da desnormalização).
 *
 * SÓ LEITOR LOGADO reage — ao contrário de seguir franquia/categoria, que aceita
 * visitante anônimo. A diferença de tratamento é deliberada: reagir altera um
 * número que decide destaque na home (Tarefa D), e abrir essa ação para
 * qualquer cookie tornaria trivial inflar a popularidade de uma matéria com um
 * script batendo `/api/reactions` sem identidade nenhuma por trás. Seguir não
 * tem esse risco — não move nenhum ranking público.
 *
 * TOGGLE/REPLACE, NUNCA ACUMULA (garantido pelo `@@unique([articleId,
 * commentAuthorId])` no schema, e não só pela lógica abaixo — a restrição é a
 * última linha de defesa se dois cliques concorrentes escaparem da checagem em
 * memória):
 *   - sem reação prévia            → cria, conta +1.
 *   - reação prévia IGUAL           → remove (toggle-off), conta -1.
 *   - reação prévia DIFERENTE       → troca o tipo, conta não muda (ainda é uma
 *                                     reação só, só mudou de lado).
 */

export type ReactionType = 'like' | 'dislike';

export function isReactionType(value: unknown): value is ReactionType {
  return value === 'like' || value === 'dislike';
}

/**
 * Reação do leitor ATUAL nesta matéria (para o estado inicial do botão).
 * `null` tanto para "não reagiu" quanto para "sem sessão" — de propósito: a UI
 * trata os dois casos do mesmo jeito (nenhum botão marcado).
 */
export async function getCurrentReaction(articleId: string): Promise<ReactionType | null> {
  const session = await getReaderSession();
  if (!session) return null;

  const row = await prisma.articleReaction.findUnique({
    where: { articleId_commentAuthorId: { articleId, commentAuthorId: session.authorId } },
    select: { type: true },
  });

  return row && isReactionType(row.type) ? row.type : null;
}

export type ReactionResult =
  // `slug` sai junto do sucesso para o CHAMADOR invalidar o cache de
  // `CACHE_TAGS.article(slug)` sem precisar de uma segunda consulta — o
  // mesmo dado que a transação já buscou para confirmar que o artigo existe.
  | { ok: true; current: ReactionType | null; reactionCount: number; slug: string }
  | { ok: false; reason: 'unauthenticated' | 'unknown-article' };

/**
 * Aplica a reação pedida (toggle/replace — ver cabeçalho do arquivo).
 *
 * TRANSAÇÃO: a escrita em `ArticleReaction` e o ajuste de
 * `Article.reactionCount` precisam ser atômicos, pelo mesmo motivo de
 * `followFranchise`/`unfollowFranchise` em `server/follows.ts` — sem isso, um
 * erro entre as duas operações deixa o contador desnormalizado mentindo para
 * sempre, e nada no sistema o corrige depois.
 */
export async function setReaction(articleId: string, type: ReactionType): Promise<ReactionResult> {
  const session = await getReaderSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };

  return prisma.$transaction(async (tx) => {
    // Confere a existência do artigo DENTRO da transação: evita a corrida de
    // reagir a uma matéria apagada entre a checagem e a escrita. `slug` sai
    // junto porque o chamador precisa dele para invalidar o cache da página.
    const article = await tx.article.findUnique({
      where: { id: articleId },
      select: { id: true, slug: true },
    });
    if (!article) return { ok: false, reason: 'unknown-article' };

    const existing = await tx.articleReaction.findUnique({
      where: { articleId_commentAuthorId: { articleId, commentAuthorId: session.authorId } },
    });

    // Sem reação prévia: cria e soma.
    if (!existing) {
      await tx.articleReaction.create({
        data: { articleId, commentAuthorId: session.authorId, type },
      });
      const updated = await tx.article.update({
        where: { id: articleId },
        data: { reactionCount: { increment: 1 } },
        select: { reactionCount: true },
      });
      return { ok: true, current: type, reactionCount: updated.reactionCount, slug: article.slug };
    }

    // Clicou de novo no MESMO botão: desfaz (toggle-off) e subtrai.
    if (existing.type === type) {
      await tx.articleReaction.delete({ where: { id: existing.id } });
      const updated = await tx.article.update({
        where: { id: articleId },
        data: { reactionCount: { decrement: 1 } },
        select: { reactionCount: true },
      });
      return { ok: true, current: null, reactionCount: updated.reactionCount, slug: article.slug };
    }

    // Tinha uma reação do OUTRO tipo: troca. O total de reações não muda — é a
    // mesma pessoa, ainda uma reação só, só mudou de lado.
    await tx.articleReaction.update({ where: { id: existing.id }, data: { type } });
    const current = await tx.article.findUnique({
      where: { id: articleId },
      select: { reactionCount: true },
    });
    return {
      ok: true,
      current: type,
      reactionCount: current?.reactionCount ?? 0,
      slug: article.slug,
    };
  });
}
