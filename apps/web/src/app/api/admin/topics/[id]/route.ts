/**
 * =============================================================================
 * POST /api/admin/topics/[id] — ações editoriais sobre um tópico
 * =============================================================================
 *
 * Ações: `claim` (assumir), `override` (sobrepor score), `dismiss` (descartar).
 *
 * TODA ação é registrada em `AuditLog` com autor, valor anterior, valor novo e
 * justificativa. Isso não é burocracia: é o que permite, semanas depois,
 * responder "o algoritmo errou ou o editor discordou?" — pergunta central para
 * recalibrar os pesos sem cair no achismo.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { prisma, toJsonColumn } from '@subcarioca/db';
import { blocksReadingMinutes, estimateReadingMinutes, hasBlocks, slugify } from '@subcarioca/core';

import { parseArticleInput } from '@/server/article-input';
import { requireStaffApi } from '@/server/staff-auth';
import { getClientIp, hashPersonalData } from '@/server/security';
import { CACHE_TAGS } from '@/server/queries';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Ver a fila é o piso: qualquer conta ativa passa aqui. As ações que exigem
  // mais (`override`, `dismiss`) são checadas uma a uma dentro do `switch` —
  // porque três das quatro ações desta rota têm exigências diferentes, e um
  // guard único no topo teria de usar a mais frouxa das quatro.
  const guard = await requireStaffApi('verFilaDePautas');
  if (!guard.ok) return guard.response;

  const { id } = await params;

  // O id vem da URL: validamos o formato antes de consultar o banco.
  // (O Prisma já protege contra injeção SQL, mas rejeitar entrada malformada
  // cedo evita consultas inúteis e mensagens de erro confusas.)
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

  const topic = await prisma.topic.findUnique({
    where: { id },
    select: { id: true, status: true, currentScore: true, manualScoreOverride: true, becameHotAt: true },
  });

  if (!topic) {
    return NextResponse.json({ ok: false, message: 'Tópico não encontrado.' }, { status: 404 });
  }

  const ipHash = hashPersonalData(getClientIp(request.headers));

  switch (action) {
    // -------------------------------------------------------------------------
    case 'claim': {
      // `claimedAt` é o marco intermediário do KPI de time-to-publish: separa
      // "demoramos a VER o alerta" de "demoramos a ESCREVER". São gargalos
      // diferentes, com soluções diferentes.
      await prisma.$transaction([
        prisma.topic.update({
          where: { id },
          data: { status: 'assigned', claimedAt: new Date() },
        }),
        prisma.pipelineEvent.create({
          data: {
            eventType: 'topic.claimed',
            topicId: id,
            payload: {
              minutesSinceHot: topic.becameHotAt
                ? Math.round((Date.now() - topic.becameHotAt.getTime()) / 60_000)
                : null,
            },
          },
        }),
      ]);

      return NextResponse.json({ ok: true, message: 'Pauta assumida.' });
    }

    // -------------------------------------------------------------------------
    case 'override': {
      // Sobrepor score reordena a home e o /em-alta para TODOS os leitores. É
      // curadoria, e curadoria é do administrador (ver STAFF_CAPABILITIES).
      const curation = await requireStaffApi('curarFilaDePautas');
      if (!curation.ok) return curation.response;

      const score = Number(payload.score);
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';

      // Validação estrita: score fora de 0-100 corromperia as faixas e o
      // ranking da home.
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return NextResponse.json(
          { ok: false, message: 'Score deve ser um número entre 0 e 100.' },
          { status: 400 },
        );
      }

      // Justificativa OBRIGATÓRIA. Sem ela, o override vira ruído sem
      // explicação e perde todo o valor para a recalibração futura.
      if (reason.length < 5 || reason.length > 200) {
        return NextResponse.json(
          { ok: false, message: 'A justificativa deve ter entre 5 e 200 caracteres.' },
          { status: 400 },
        );
      }

      const band =
        score >= 80 ? 'HOT' : score >= 60 ? 'RISING' : score >= 40 ? 'RELEVANT' : 'EVERGREEN';

      await prisma.$transaction([
        prisma.topic.update({
          where: { id },
          data: {
            manualScoreOverride: score,
            manualOverrideReason: reason,
            manualOverrideAt: new Date(),
            currentBand: band,
            // A partir daqui, as automações são suspensas para este tópico:
            // quem manda é o humano (ver actions/dispatcher.ts).
            requiresHumanReview: true,
          },
        }),
        prisma.auditLog.create({
          data: {
            action: 'topic.score_override',
            entityType: 'Topic',
            entityId: id,
            // Guardamos o ANTES e o DEPOIS. É o par que torna a auditoria útil.
            before: { score: topic.currentScore, override: topic.manualScoreOverride },
            after: { score, band },
            reason,
            ipHash,
          },
        }),
        prisma.pipelineEvent.create({
          data: {
            eventType: 'override.applied',
            topicId: id,
            payload: { from: topic.currentScore, to: score, reason },
          },
        }),
      ]);

      return NextResponse.json({ ok: true, message: `Score sobreposto para ${score}.` });
    }

    // -------------------------------------------------------------------------
    case 'create-article': {
      // Transforma um tópico da fila numa matéria de verdade. É a peça que
      // faltava entre "o pipeline descobriu e pontuou" e "o leitor consegue
      // ler" — até aqui, esse passo só existia manualmente, direto no banco.
      const parsed = await parseArticleInput(payload, guard.user);
      if (!parsed.ok) {
        return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
      }

      const input = parsed.data;
      const { publish, category } = input;

      // Título sem NENHUMA letra ou número latino (só emoji, pontuação ou
      // escrita não-latina) faz `slugify` devolver string vazia — e uma matéria
      // com slug vazio é publicada com sucesso e fica inalcançável: a URL
      // resultante é a da categoria. O sufixo do laço abaixo cuida da unicidade.
      const baseSlug = slugify(input.title) || 'materia';
      const now = new Date();

      let outcome: { slug: string } | 'already-covered' | null = null;

      for (let attempt = 0; attempt < 5 && outcome === null; attempt += 1) {
        // Primeira tentativa com o slug limpo; as seguintes com sufixo curto —
        // mais amigável para o editor do que rejeitar e pedir outro título.
        const slug =
          attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

        try {
          outcome = await prisma.$transaction(async (tx) => {
            // TRAVA CONTRA MATÉRIA DUPLICADA — quem garante é o banco, não a
            // tela. A fila esconde o botão "Criar matéria" de um tópico já
            // coberto, mas isso só vale para a aba que recarregou: com o
            // formulário aberto em duas abas (ou dois editores no mesmo
            // tópico), o segundo envio criava uma SEGUNDA matéria do mesmo
            // assunto, publicada, sem nenhum aviso.
            //
            // O `updateMany` com a condição no `where` resolve isso em uma
            // operação atômica: no Postgres, o segundo UPDATE espera o primeiro
            // terminar e então reavalia o filtro contra a linha já atualizada,
            // encontrando zero registros. Um `findUnique` seguido de `update`
            // teria uma janela entre ler e escrever — que é exatamente onde as
            // duas requisições simultâneas passavam.
            const claimed = await tx.topic.updateMany({
              where: { id, status: { not: 'published' } },
              data: { status: 'published' },
            });

            if (claimed.count === 0) return 'already-covered' as const;

            const created = await tx.article.create({
              data: {
                slug,
                title: input.title,
                excerpt: input.excerpt,
                content: input.content,
                // `null` (e não `[]`) quando não há blocos: a coluna significa
                // "esta matéria foi escrita no editor de blocos?", e um array
                // vazio responderia "sim, e está vazia" — que é outra coisa.
                blocks: hasBlocks(input.blocks) ? toJsonColumn(input.blocks) : undefined,
                status: publish ? 'published' : 'draft',
                categoryId: category.id,
                authorId: input.authorId,
                topicId: id,
                format: input.format,
                tldr: input.tldr,
                coverImageUrl: input.coverImageUrl,
                coverImageAlt: input.coverImageAlt,
                isBreaking: input.isBreaking,
                hasSpoiler: input.hasSpoiler,
                // Com blocos, o tempo de leitura conta imagem e vídeo além das
                // palavras (ver `blocksReadingMinutes`). Sem blocos, continua a
                // estimativa de sempre sobre o Markdown.
                readingMinutes: hasBlocks(input.blocks)
                  ? blocksReadingMinutes(input.blocks)
                  : estimateReadingMinutes(input.content),
                currentScore: topic.currentScore,
                scoreAtPublish: publish ? topic.currentScore : null,
                publishedAt: publish ? now : null,
              },
            });

            await tx.auditLog.create({
              data: {
                action: publish ? 'article.published' : 'article.drafted',
                entityType: 'Article',
                entityId: created.id,
                // `actorId` finalmente diz QUEM. Era o campo que o segredo
                // compartilhado deixava vazio e que tornava a auditoria inútil.
                actorId: guard.user.id,
                after: { title: input.title, slug, categorySlug: category.slug, publish },
                ipHash,
              },
            });

            return { slug: created.slug };
          });
        } catch (error) {
          // Duas matérias com o mesmo título enviadas ao mesmo tempo passam as
          // duas por qualquer verificação prévia de slug e colidem só na
          // gravação. Aqui a colisão vira uma nova tentativa com outro sufixo;
          // antes, virava um 500 sem corpo e um "Erro de conexão." na tela.
          if (isSlugTaken(error)) continue;
          throw error;
        }
      }

      if (outcome === 'already-covered') {
        return NextResponse.json(
          {
            ok: false,
            message:
              'Este tópico já virou matéria — provavelmente em outra aba. Recarregue a fila e edite a matéria existente em Matérias.',
          },
          { status: 409 },
        );
      }

      if (outcome === null) {
        return NextResponse.json(
          {
            ok: false,
            message: 'Não foi possível gerar um endereço único para esta matéria. Tente outro título.',
          },
          { status: 409 },
        );
      }

      if (publish) {
        revalidateTag(CACHE_TAGS.home);
        revalidateTag(CACHE_TAGS.trending);
        revalidateTag(CACHE_TAGS.category(category.slug));
        revalidateTag(CACHE_TAGS.article(outcome.slug));
      }

      return NextResponse.json({
        ok: true,
        slug: outcome.slug,
        categorySlug: category.slug,
        message: publish ? 'Matéria publicada.' : 'Rascunho salvo.',
      });
    }

    // -------------------------------------------------------------------------
    case 'dismiss': {
      // Descartar um tópico o tira da fila de TODA a redação — é decisão de
      // pauta, não de redação.
      const curation = await requireStaffApi('curarFilaDePautas');
      if (!curation.ok) return curation.response;

      await prisma.$transaction([
        prisma.topic.update({ where: { id }, data: { status: 'dismissed' } }),
        prisma.auditLog.create({
          data: {
            action: 'topic.dismissed',
            entityType: 'Topic',
            entityId: id,
            before: { status: topic.status },
            after: { status: 'dismissed' },
            ipHash,
          },
        }),
      ]);

      return NextResponse.json({ ok: true, message: 'Tópico descartado.' });
    }

    // -------------------------------------------------------------------------
    default:
      return NextResponse.json({ ok: false, message: 'Ação desconhecida.' }, { status: 400 });
  }
}

/**
 * O slug candidato já pertence a outra matéria?
 *
 * P2002 é o código do Prisma para violação de índice único. Checamos também o
 * campo: um P2002 em outra coluna não pode ser confundido com colisão de slug e
 * repetido cinco vezes em silêncio — ele precisa subir e virar erro de verdade.
 */
function isSlugTaken(error: unknown): boolean {
  const known = error as { code?: string; meta?: { target?: unknown } };
  if (known?.code !== 'P2002') return false;

  const target = known.meta?.target;
  return Array.isArray(target)
    ? target.includes('slug')
    : typeof target === 'string' && target.includes('slug');
}
