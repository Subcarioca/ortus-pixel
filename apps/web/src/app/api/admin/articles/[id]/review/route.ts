/**
 * =============================================================================
 * POST /api/admin/articles/[id]/review — aprovar ou devolver conteúdo sensível
 * =============================================================================
 *
 * A segunda metade do pedágio criado em `requiresSensitiveApproval`
 * (core/staff.ts): lá a matéria sensível de um redator para em
 * `status: 'in-review'`; aqui o administrador diz "pode subir" ou "ajuste isto
 * antes".
 *
 * -----------------------------------------------------------------------------
 * POR QUE UMA ROTA PRÓPRIA, E NÃO UM `action` DENTRO DO PATCH DE `[id]`
 * -----------------------------------------------------------------------------
 * Porque são duas autorizações diferentes sobre o mesmo recurso, e misturá-las
 * num arquivo só faria a mais frouxa valer para as duas. O PATCH é a EDIÇÃO:
 * exige `verMaterias` e a regra de propriedade (`canEditArticleOf`) — um redator
 * legitimamente entra ali. Esta rota é a DECISÃO EDITORIAL: exige
 * `aprovarConteudoSensivel`, que é privativa de administrador, e não olha
 * propriedade nenhuma (o administrador aprova matéria de qualquer pessoa; é
 * justamente o ponto).
 *
 * Também são payloads sem interseção: o PATCH recebe o formulário inteiro, esta
 * rota recebe duas palavras. Um `case` no meio do PATCH obrigaria a validação do
 * formulário a ser opcional — e validação opcional é validação que um dia deixa
 * de rodar.
 *
 * -----------------------------------------------------------------------------
 * REJEITAR NÃO APAGA
 * -----------------------------------------------------------------------------
 * Devolver manda a matéria para 'draft', com o texto intacto, e grava o motivo
 * no `AuditLog`. É a mesma escolha já feita na moderação de comentários (remover
 * mantém a linha): sem o registro, "por que a minha matéria não subiu?" vira
 * palavra contra palavra, e o redator refaz o mesmo erro na semana seguinte
 * porque ninguém escreveu qual era o erro.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { prisma } from '@subcarioca/db';
import { toContentSensitivity } from '@subcarioca/core';

import { requireStaffApi } from '@/server/staff-auth';
import { getClientIp, hashPersonalData } from '@/server/security';
import { CACHE_TAGS } from '@/server/queries';

export const dynamic = 'force-dynamic';

/** Limites do motivo da devolução. Os mesmos do override de score, por coerência
 *  de painel: curto o bastante para caber numa linha, longo o bastante para
 *  dizer o que precisa mudar. */
const REASON_MIN = 5;
const REASON_MAX = 200;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // A capacidade nova. Note que NÃO há checagem de propriedade da matéria: quem
  // aprova conteúdo sensível aprova o de toda a redação — inclusive, e
  // principalmente, o que não é dele.
  const guard = await requireStaffApi('aprovarConteudoSensivel');
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Identificador inválido.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : '';
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';

  const existing = await prisma.article.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      currentScore: true,
      scoreAtPublish: true,
      contentSensitivity: true,
      authorId: true,
      author: { select: { name: true } },
      category: { select: { slug: true } },
    },
  });

  if (!existing) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Esta matéria não existe mais — ela pode ter sido apagada. Recarregue a lista.',
      },
      { status: 404 },
    );
  }

  // A fila só age sobre o que ESTÁ na fila. Fora isso, a resposta é 409 e não
  // 400: não é um pedido malformado, é um pedido que chegou tarde — outra aba
  // (ou o outro administrador) já decidiu.
  if (existing.status !== 'in-review') {
    return NextResponse.json(
      {
        ok: false,
        message:
          'Esta matéria não está mais aguardando aprovação — alguém já decidiu sobre ela. Recarregue a lista.',
      },
      { status: 409 },
    );
  }

  const ipHash = hashPersonalData(getClientIp(request.headers));
  const sensitivity = toContentSensitivity(existing.contentSensitivity);
  const now = new Date();

  switch (action) {
    // -------------------------------------------------------------------------
    case 'approve': {
      /**
       * A GRAVAÇÃO É CONDICIONAL AO ESTADO, e não um `update` simples.
       *
       * Dois administradores com a fila aberta clicam "Aprovar" no mesmo
       * segundo. Com `update`, os dois passam: o segundo reescreveria
       * `publishedAt` e o `AuditLog` registraria duas aprovações da mesma
       * matéria. Com `updateMany` filtrando por `status: 'in-review'`, o segundo
       * encontra zero linhas — é a mesma trava atômica usada contra matéria
       * duplicada na rota de tópicos (ver o comentário longo lá sobre por que
       * isto vale também no InnoDB).
       */
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.article.updateMany({
          where: { id, status: 'in-review' },
          data: {
            status: 'published',
            // `?? now` e não `now` seco: a matéria pode já ter estado no ar
            // antes (é o caso da que voltou para a fila por escalar a
            // classificação). Reescrever a data a republicaria como novidade no
            // feed cronológico, para quem já a tinha lido.
            publishedAt: existing.publishedAt ?? now,
            // O "previsto" do KPI de precisão é congelado UMA vez. Se já existe,
            // não se toca: ele é a foto do momento em que a matéria estreou.
            scoreAtPublish: existing.scoreAtPublish ?? existing.currentScore,
          },
        });

        if (claimed.count === 0) return 'lost-race' as const;

        await tx.auditLog.create({
          data: {
            action: 'article.review_approved',
            entityType: 'Article',
            entityId: id,
            actorId: guard.user.id,
            before: { status: 'in-review', contentSensitivity: sensitivity },
            after: { status: 'published', contentSensitivity: sensitivity },
            // Opcional na aprovação (ao contrário da devolução): "pode subir"
            // raramente precisa de justificativa, e exigir uma transformaria o
            // campo em "ok" digitado no automático.
            reason: reason.length > 0 ? reason.slice(0, REASON_MAX) : null,
            ipHash,
          },
        });

        return 'ok' as const;
      });

      if (result === 'lost-race') {
        return NextResponse.json(
          {
            ok: false,
            message:
              'Outra pessoa decidiu sobre esta matéria enquanto você olhava a fila. Recarregue a lista.',
          },
          { status: 409 },
        );
      }

      // As MESMAS invalidações que `create-article` dispara ao publicar. Não é
      // coincidência nem cópia: do ponto de vista do site, este clique É a
      // publicação daquela matéria — a home, o /em-alta, a editoria e a página
      // dela passam a ter conteúdo diferente neste instante.
      revalidateTag(CACHE_TAGS.home);
      revalidateTag(CACHE_TAGS.trending);
      revalidateTag(CACHE_TAGS.category(existing.category.slug));
      revalidateTag(CACHE_TAGS.article(existing.slug));

      return NextResponse.json({
        ok: true,
        message: `“${existing.title}” foi aprovada e está no ar.`,
      });
    }

    // -------------------------------------------------------------------------
    case 'reject': {
      // Motivo OBRIGATÓRIO. É a única informação que faz o redator conseguir
      // corrigir em vez de adivinhar — e, sem ela, a devolução vira um "não" sem
      // endereço, que é como um fluxo de aprovação morre em duas semanas.
      if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
        return NextResponse.json(
          {
            ok: false,
            message: `Escreva o que precisa mudar (entre ${REASON_MIN} e ${REASON_MAX} caracteres). É o que o redator vai ler para corrigir.`,
          },
          { status: 400 },
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.article.updateMany({
          where: { id, status: 'in-review' },
          // Volta para 'draft', e NÃO para 'archived': o texto continua na mesa
          // de trabalho de quem escreveu, na primeira seção de /admin/materias,
          // pronto para ser corrigido e reenviado. Arquivar seria esconder.
          //
          // `publishedAt` e `scoreAtPublish` ficam como estão de propósito: se a
          // matéria nunca subiu, ambos são `null` e continuam nulos; se ela já
          // esteve no ar, os valores originais são o histórico dela.
          data: { status: 'draft' },
        });

        if (claimed.count === 0) return 'lost-race' as const;

        await tx.auditLog.create({
          data: {
            action: 'article.review_rejected',
            entityType: 'Article',
            entityId: id,
            actorId: guard.user.id,
            before: { status: 'in-review', contentSensitivity: sensitivity },
            after: { status: 'draft', contentSensitivity: sensitivity },
            reason: reason.slice(0, REASON_MAX),
            ipHash,
          },
        });

        return 'ok' as const;
      });

      if (result === 'lost-race') {
        return NextResponse.json(
          {
            ok: false,
            message:
              'Outra pessoa decidiu sobre esta matéria enquanto você olhava a fila. Recarregue a lista.',
          },
          { status: 409 },
        );
      }

      /**
       * INVALIDAÇÃO MESMO NA DEVOLUÇÃO — e não é desperdício.
       *
       * A matéria devolvida pode ter estado no ar (o caso da classificação que
       * subiu depois de publicada). Nesse cenário, o HTML cacheado ainda a
       * mostra, e deixar de invalidar manteria no site exatamente o conteúdo que
       * o administrador acabou de recusar. Quando ela nunca subiu, o custo é
       * regenerar páginas que vão sair idênticas — barato perto do contrário.
       */
      revalidateTag(CACHE_TAGS.home);
      revalidateTag(CACHE_TAGS.trending);
      revalidateTag(CACHE_TAGS.category(existing.category.slug));
      revalidateTag(CACHE_TAGS.article(existing.slug));

      return NextResponse.json({
        ok: true,
        message: `“${existing.title}” voltou para ${existing.author.name} como rascunho, com o seu motivo anexado.`,
      });
    }

    // -------------------------------------------------------------------------
    default:
      return NextResponse.json({ ok: false, message: 'Ação desconhecida.' }, { status: 400 });
  }
}
