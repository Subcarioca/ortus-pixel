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
import { cookies } from 'next/headers';
import { revalidateTag } from 'next/cache';

import { prisma } from '@subcarioca/db';
import {
  CONTENT_FORMATS,
  estimateReadingMinutes,
  isCategorySlug,
  slugify,
  validateTldrRequirement,
  type ContentFormat,
} from '@subcarioca/core';

import { ADMIN_SESSION_COOKIE } from '@/server/admin-auth';
import { getClientIp, hashPersonalData, safeCompare } from '@/server/security';
import { CACHE_TAGS } from '@/server/queries';

export const dynamic = 'force-dynamic';

async function isAuthenticated(): Promise<boolean> {
  const expected = process.env.ADMIN_ACCESS_TOKEN;
  if (!expected) return false;

  const cookieStore = await cookies();
  const provided = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  return Boolean(provided) && safeCompare(provided!, expected);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: 'Não autorizado.' }, { status: 401 });
  }

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
      const title = text(payload.title, 8, 180);
      const excerpt = text(payload.excerpt, 20, 300);
      const content = text(payload.content, 40, 20_000);
      const categorySlugValue = typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
      const format: ContentFormat = CONTENT_FORMATS.includes(payload.format as ContentFormat)
        ? (payload.format as ContentFormat)
        : 'breaking';
      const publish = payload.publish === true;

      const tldr = Array.isArray(payload.tldr)
        ? payload.tldr.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
        : [];

      if (!title || !excerpt || !content) {
        return NextResponse.json(
          { ok: false, message: 'Título (8-180), resumo (20-300) e corpo (mín. 40 caracteres) são obrigatórios.' },
          { status: 400 },
        );
      }

      if (!isCategorySlug(categorySlugValue)) {
        return NextResponse.json({ ok: false, message: 'Categoria inválida.' }, { status: 400 });
      }

      const authorId = validId(payload.authorId);
      if (!authorId) {
        return NextResponse.json({ ok: false, message: 'Selecione um autor.' }, { status: 400 });
      }

      const tldrCheck = validateTldrRequirement(format, tldr);
      if (!tldrCheck.valid) {
        return NextResponse.json({ ok: false, message: tldrCheck.message }, { status: 400 });
      }

      const [category, author] = await Promise.all([
        prisma.category.findUnique({ where: { slug: categorySlugValue }, select: { id: true, slug: true } }),
        prisma.author.findUnique({ where: { id: authorId }, select: { id: true } }),
      ]);

      if (!category) {
        return NextResponse.json({ ok: false, message: 'Categoria não encontrada.' }, { status: 400 });
      }
      if (!author) {
        return NextResponse.json({ ok: false, message: 'Autor não encontrado.' }, { status: 400 });
      }

      // Slug único: tenta o direto, senão anexa um sufixo curto — mais
      // amigável pro editor do que rejeitar e pedir pra digitar de novo.
      const baseSlug = slugify(title);
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await prisma.article.findUnique({ where: { slug }, select: { id: true } });
        if (!clash) break;
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const now = new Date();
      const article = await prisma.$transaction(async (tx) => {
        const created = await tx.article.create({
          data: {
            slug,
            title,
            excerpt,
            content,
            status: publish ? 'published' : 'draft',
            categoryId: category.id,
            authorId: author.id,
            topicId: id,
            format,
            tldr,
            coverImageUrl: text(payload.coverImageUrl, 1, 2000),
            coverImageAlt: text(payload.coverImageAlt, 1, 200),
            isBreaking: payload.isBreaking === true,
            hasSpoiler: payload.hasSpoiler === true,
            readingMinutes: estimateReadingMinutes(content),
            currentScore: topic.currentScore,
            scoreAtPublish: publish ? topic.currentScore : null,
            publishedAt: publish ? now : null,
          },
        });

        await tx.topic.update({
          where: { id },
          data: { status: 'published' },
        });

        await tx.auditLog.create({
          data: {
            action: publish ? 'article.published' : 'article.drafted',
            entityType: 'Article',
            entityId: created.id,
            after: { title, slug, categorySlug: category.slug, publish },
            ipHash,
          },
        });

        return created;
      });

      if (publish) {
        revalidateTag(CACHE_TAGS.home);
        revalidateTag(CACHE_TAGS.trending);
        revalidateTag(CACHE_TAGS.category(category.slug));
        revalidateTag(CACHE_TAGS.article(slug));
      }

      return NextResponse.json({
        ok: true,
        slug,
        categorySlug: category.slug,
        message: publish ? 'Matéria publicada.' : 'Rascunho salvo.',
      });
    }

    // -------------------------------------------------------------------------
    case 'dismiss': {
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

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function validId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9]{10,40}$/i.test(value) ? value : null;
}
