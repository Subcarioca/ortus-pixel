/**
 * =============================================================================
 * PAINEL › MODERAÇÃO DE COMENTÁRIOS
 * =============================================================================
 *
 * Tela deliberadamente MÍNIMA. Ela responde a quatro perguntas e para por aí:
 *   1. O que os LEITORES denunciaram e o bot não removeu? (o que mais precisa
 *      de olho humano — ver a seção logo abaixo)
 *   2. O que está esperando aprovação? (fila da "escada de confiança")
 *   3. O que foi publicado recentemente? (para remover algo que passou)
 *   4. Quem está abusando? (bloquear autor)
 *
 * -----------------------------------------------------------------------------
 * POR QUE "DENUNCIADOS" VEM ANTES DE "AGUARDANDO APROVAÇÃO"
 * -----------------------------------------------------------------------------
 * Porque são filas com custos de espera OPOSTOS. Um comentário pendente está
 * FORA do ar: enquanto ninguém olha, o prejuízo é uma pessoa esperando para ser
 * lida. Um comentário denunciado está NO ar: enquanto ninguém olha, o prejuízo é
 * todo mundo lendo o que já foi apontado como grave.
 *
 * O QUE APARECE AQUI É O QUE O BOT NÃO RESOLVEU. A denúncia de conteúdo com
 * xingamento ou discurso de ódio já removeu o comentário sozinha (ver
 * `/api/comments/[id]/report` e o bot em core). O que sobra para esta seção é
 * justamente o que uma denylist não sabe ver — ameaça velada, assédio, spoiler
 * cruel, briga pessoal — e que só uma pessoa consegue julgar.
 *
 * O QUE NÃO TEM AQUI, E POR QUÊ: filtro por artigo, busca por texto, paginação,
 * estatísticas de moderação. Tudo isso é útil quando há volume — e volume de
 * comentário não existe no dia 1. Construir agora seria manter código que
 * ninguém usa, e adivinhar errado o que a redação vai precisar. Quando a fila
 * passar de uma tela, o próprio uso dirá qual filtro fazia falta.
 *
 * A ORDEM É: pendentes primeiro, mais antigos no topo. Comentário pendente é
 * alguém esperando — e quem espera mais tempo é atendido primeiro. Ordenar os
 * pendentes do mais novo para o mais velho criaria uma fila em que os primeiros
 * a comentar nunca são vistos.
 */

import Link from 'next/link';

import { COMMENT_PROVIDER_LABELS, isCommentProvider } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminNav } from '@/components/admin/admin-nav';
import { AdminActionButton } from '@/components/admin/admin-action-button';
import { RelativeTime } from '@/components/relative-time';
import { requireStaffPage } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export default async function AdminCommentsPage() {
  const guard = await requireStaffPage('moderarComentarios');
  if (guard.state === 'anonymous') return <AdminLogin />;
  if (guard.state === 'forbidden') {
    return <AdminForbidden user={guard.user} what="A moderação de comentários" />;
  }

  /**
   * A CONTAGEM DE DENÚNCIAS ENTRA NO `include` DAS TRÊS CONSULTAS.
   *
   * `_count` vira um subselect na mesma ida ao banco. A alternativa — contar por
   * linha depois de montar a lista — seria N+1 na abertura da tela, e o número
   * de denúncias é justamente o dado que muda a ordem em que o moderador lê a
   * fila: ele precisa estar lá antes de a tela existir, não depois.
   */
  const MODERATION_INCLUDE = {
    article: { select: { title: true, slug: true, category: { select: { slug: true } } } },
    authorAccount: { select: { provider: true, approvedCount: true, isBlocked: true } },
    _count: { select: { reports: true } },
  } as const;

  const [reported, pending, recent] = await Promise.all([
    prisma.comment.findMany({
      // `some: {}` = "tem pelo menos uma denúncia". O recorte por status é o que
      // dá sentido à seção: o que o bot removeu já está em 'rejected' e não
      // precisa de ninguém; o que continua de pé é o que espera julgamento.
      where: { status: { in: ['approved', 'pending'] }, reports: { some: {} } },
      // MAIS DENUNCIADO PRIMEIRO, e só depois o mais recente. É a única fila
      // desta tela ordenada por gravidade em vez de por relógio: cinco pessoas
      // apontando o mesmo comentário é um sinal mais forte do que o horário em
      // que ele foi escrito.
      orderBy: [{ reports: { _count: 'desc' } }, { createdAt: 'desc' }],
      take: 50,
      include: MODERATION_INCLUDE,
    }),
    prisma.comment.findMany({
      where: { status: 'pending' },
      // Mais ANTIGO primeiro: quem espera há mais tempo é atendido antes.
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: MODERATION_INCLUDE,
    }),
    prisma.comment.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: MODERATION_INCLUDE,
    }),
  ]);

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Comentários</h1>
        <p className="section-sub">
          O primeiro comentário de cada conta passa por aqui. Depois de aprovado uma
          vez, os seguintes daquela pessoa publicam direto.
        </p>
        <AdminNav user={guard.user} current="comentarios" />
      </header>

      {/* ---------- DENUNCIADOS PELOS LEITORES ---------- */}
      {/* Só é desenhada quando há algo: uma seção "Denunciados (0)" fixa no topo
          todos os dias é como um aviso deixa de ser lido. */}
      {reported.length > 0 && (
        <section aria-labelledby="denunciados">
          <h2 id="denunciados" className="section-title">
            Denunciados pelos leitores ({reported.length})
          </h2>
          <p className="form-hint">
            O filtro automático não encontrou xingamento nem discurso de ódio nestes — por
            isso eles continuam no ar. Ameaça velada, assédio e briga pessoal são
            justamente o que o robô não sabe ver.
          </p>

          <ul className="cmt-list">
            {reported.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                showApprove={comment.status === 'pending'}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ---------- FILA DE PENDENTES ---------- */}
      <section aria-labelledby="pendentes">
        <h2 id="pendentes" className="section-title">
          Aguardando aprovação ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <p className="empty-state">Nada na fila. Tudo em dia.</p>
        ) : (
          <ul className="cmt-list">
            {pending.map((comment) => (
              <CommentRow key={comment.id} comment={comment} showApprove />
            ))}
          </ul>
        )}
      </section>

      {/* ---------- PUBLICADOS RECENTES ---------- */}
      <section aria-labelledby="recentes">
        <h2 id="recentes" className="section-title">
          Publicados recentemente
        </h2>
        <p className="form-hint">
          Para remover algo que passou pela escada de confiança.
        </p>

        {recent.length === 0 ? (
          <p className="empty-state">Nenhum comentário publicado ainda.</p>
        ) : (
          <ul className="cmt-list">
            {recent.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface CommentRowProps {
  comment: {
    id: string;
    content: string;
    createdAt: Date;
    authorName: string;
    authorAccountId: string | null;
    article: { title: string; slug: string; category: { slug: string } };
    authorAccount: { provider: string; approvedCount: number; isBlocked: boolean } | null;
    /** Denúncias recebidas. Ver `CommentReport` no schema. */
    _count: { reports: number };
  };
  showApprove?: boolean;
}

function CommentRow({ comment, showApprove = false }: CommentRowProps) {
  const provider = comment.authorAccount?.provider;

  return (
    <li className="cmt">
      <span className="cmt__avatar" aria-hidden="true">
        {comment.authorName.charAt(0).toUpperCase()}
      </span>

      <div>
        <div className="cmt__head">
          <span className="cmt__name">{comment.authorName}</span>
          {isCommentProvider(provider) && (
            <span className="cmt__provider">{COMMENT_PROVIDER_LABELS[provider]}</span>
          )}
          {/* Contador de aprovados = "é reincidente ou é a primeira vez?". É a
              informação que muda a decisão do moderador em 90% dos casos. */}
          <span className="cmt__time">
            {comment.authorAccount?.approvedCount ?? 0} aprovado(s)
          </span>
          {/* A contagem aparece em TODA fila, e não só na de denunciados: um
              comentário pendente que já chegou com denúncia é outro caso — e
              descobrir isso só depois de aprová-lo é o pior momento possível.
              Some quando é zero, que é o normal e não informa nada. */}
          {comment._count.reports > 0 && (
            <span className="chip chip--sm" title="Denúncias recebidas de leitores.">
              {comment._count.reports} denúncia{comment._count.reports > 1 ? 's' : ''}
            </span>
          )}
          <RelativeTime date={comment.createdAt} className="cmt__time" />
        </div>

        <p className="form-hint">
          em{' '}
          <Link href={`/${comment.article.category.slug}/${comment.article.slug}#comentarios`}>
            {comment.article.title}
          </Link>
        </p>

        {/* Interpolação JSX: o React escapa. Mesmo no painel — um comentário
            com HTML não pode executar nada na tela de quem modera, que é
            justamente quem está autenticado. */}
        <p className="cmt__body">{comment.content}</p>

        <div className="admin-actions">
          {showApprove && (
            <AdminActionButton
              endpoint="/api/admin/comments"
              payload={{ action: 'approve', commentId: comment.id }}
              label="Aprovar"
              variant="primary"
            />
          )}
          <AdminActionButton
            endpoint="/api/admin/comments"
            payload={{ action: 'reject', commentId: comment.id }}
            label="Remover"
            confirmMessage="Remover este comentário? Ele sai do site, mas fica registrado para auditoria."
          />
          <AdminActionButton
            endpoint="/api/admin/comments"
            payload={{ action: 'spam', commentId: comment.id }}
            label="Spam"
            confirmMessage="Marcar como spam?"
          />
          {comment.authorAccountId && (
            <AdminActionButton
              endpoint="/api/admin/comments"
              payload={{ action: 'block-author', commentId: comment.id }}
              label="Bloquear autor"
              variant="danger"
              confirmMessage="Bloquear o autor encerra as sessões dele agora e remove TODOS os comentários já publicados por ele. Continuar?"
            />
          )}
        </div>
      </div>
    </li>
  );
}
