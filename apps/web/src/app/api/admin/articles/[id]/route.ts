/**
 * =============================================================================
 * /api/admin/articles/[id] — EDITAR (PATCH) e APAGAR (DELETE) uma matéria
 * =============================================================================
 *
 * Fecha o ciclo do painel: até aqui só existia CRIAR (a partir de um tópico da
 * fila). Uma redação que só sabe criar obriga o editor a abrir o banco para
 * corrigir uma vírgula — que é exatamente onde acidentes acontecem.
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO MAIS IMPORTANTE DESTE ARQUIVO: O SLUG NUNCA MUDA NA EDIÇÃO
 * -----------------------------------------------------------------------------
 * Corrigir o título de uma matéria publicada é rotina. Se o slug acompanhasse o
 * título, cada correção geraria uma URL nova e mataria a antiga: os links já
 * compartilhados quebrariam, o Google teria de reindexar do zero e a autoridade
 * acumulada iria embora — tudo isso como efeito colateral invisível de arrumar
 * uma palavra.
 *
 * Slug é IDENTIDADE, título é APRESENTAÇÃO. Se um dia for preciso trocar a URL
 * de propósito, isso pede uma operação própria, com redirecionamento 301 — e
 * não um efeito colateral de salvar o formulário.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revalidateTag } from 'next/cache';

import { prisma } from '@subcarioca/db';
import {
  CONTENT_FORMATS,
  estimateReadingMinutes,
  isCategorySlug,
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

// -----------------------------------------------------------------------------
// PATCH — editar
// -----------------------------------------------------------------------------

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: 'Não autorizado.' }, { status: 401 });
  }

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
      category: { select: { id: true, slug: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: 'Matéria não encontrada.' }, { status: 404 });
  }

  const title = text(payload.title, 8, 180);
  const excerpt = text(payload.excerpt, 20, 300);
  const content = text(payload.content, 40, 20_000);
  const categorySlugValue = typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
  const format: ContentFormat = CONTENT_FORMATS.includes(payload.format as ContentFormat)
    ? (payload.format as ContentFormat)
    : 'breaking';
  const publish = payload.publish === true;

  const tldr = Array.isArray(payload.tldr)
    ? payload.tldr
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
    : [];

  if (!title || !excerpt || !content) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'Título (8-180), resumo (20-300) e corpo (mín. 40 caracteres) são obrigatórios.',
      },
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

  const wasPublished = existing.status === 'published';
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.article.update({
      where: { id },
      data: {
        // `slug` deliberadamente ausente — ver o bloco no topo do arquivo.
        title,
        excerpt,
        content,
        status: publish ? 'published' : 'draft',
        categoryId: category.id,
        authorId: author.id,
        format,
        tldr,
        coverImageUrl: text(payload.coverImageUrl, 1, 2000),
        coverImageAlt: text(payload.coverImageAlt, 1, 200),
        isBreaking: payload.isBreaking === true,
        hasSpoiler: payload.hasSpoiler === true,
        readingMinutes: estimateReadingMinutes(content),
        // `publishedAt` só é definido na PRIMEIRA publicação. Reescrevê-lo a
        // cada save faria uma correção de texto "republicar" a matéria: ela
        // pularia para o topo do feed cronológico e reapareceria como novidade
        // para quem já tinha lido.
        publishedAt: publish ? (existing.publishedAt ?? now) : existing.publishedAt,
        // Mesma lógica para o score congelado: ele é o "previsto" do KPI de
        // precisão e, uma vez gravado, não pode ser reescrito (ver schema).
        scoreAtPublish:
          publish && existing.scoreAtPublish === null
            ? existing.currentScore
            : existing.scoreAtPublish,
      },
    });

    await tx.auditLog.create({
      data: {
        action: publish ? 'article.updated_published' : 'article.updated_draft',
        entityType: 'Article',
        entityId: id,
        before: { title: existing.title, status: existing.status, categorySlug: existing.category.slug },
        after: { title, status: publish ? 'published' : 'draft', categorySlug: category.slug },
        ipHash: hashPersonalData(getClientIp(request.headers)),
      },
    });
  });

  // INVALIDAÇÃO — inclui a categoria ANTIGA, e é aí que mora o detalhe:
  // se o editor moveu a matéria de Games para Tech, a listagem de Games
  // continuaria exibindo uma matéria que não é mais dela até o cache expirar.
  revalidateTag(CACHE_TAGS.article(existing.slug));
  revalidateTag(CACHE_TAGS.category(category.slug));
  revalidateTag(CACHE_TAGS.category(existing.category.slug));
  revalidateTag(CACHE_TAGS.home);
  revalidateTag(CACHE_TAGS.trending);

  return NextResponse.json({
    ok: true,
    slug: existing.slug,
    categorySlug: category.slug,
    message: publish
      ? wasPublished
        ? 'Matéria atualizada.'
        : 'Matéria publicada.'
      : wasPublished
        ? 'Matéria despublicada e salva como rascunho.'
        : 'Rascunho salvo.',
  });
}

// -----------------------------------------------------------------------------
// DELETE — apagar
// -----------------------------------------------------------------------------

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ ok: false, message: 'Não autorizado.' }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) {
    return NextResponse.json({ ok: false, message: 'Identificador inválido.' }, { status: 400 });
  }

  const existing = await prisma.article.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      topicId: true,
      category: { select: { slug: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: 'Matéria não encontrada.' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    // A auditoria é gravada ANTES da remoção e guarda o conteúdo essencial da
    // linha. `AuditLog` não tem chave estrangeira para `Article` justamente
    // para sobreviver a este momento: sem isso, apagar a matéria apagaria
    // também o registro de que ela existiu, e "quem apagou aquela matéria?"
    // ficaria sem resposta.
    await tx.auditLog.create({
      data: {
        action: 'article.deleted',
        entityType: 'Article',
        entityId: id,
        before: {
          title: existing.title,
          slug: existing.slug,
          status: existing.status,
          categorySlug: existing.category.slug,
        },
        ipHash: hashPersonalData(getClientIp(request.headers)),
      },
    });

    // Comentários, notificações e vínculos de oferta saem em cascata (schema).
    await tx.article.delete({ where: { id } });

    // O tópico de origem volta para a fila.
    //
    // Ele foi marcado como 'published' quando a matéria foi criada. Se a
    // matéria some e nenhuma outra derivada dele resta, deixá-lo 'published'
    // significaria um tópico que se declara coberto sem nenhuma cobertura — ele
    // sumiria da fila da redação e o assunto seria perdido em silêncio.
    if (existing.topicId) {
      const remaining = await tx.article.count({ where: { topicId: existing.topicId } });
      if (remaining === 0) {
        await tx.topic.update({
          where: { id: existing.topicId },
          data: { status: 'assigned' },
        });
      }
    }
  });

  revalidateTag(CACHE_TAGS.article(existing.slug));
  revalidateTag(CACHE_TAGS.category(existing.category.slug));
  revalidateTag(CACHE_TAGS.home);
  revalidateTag(CACHE_TAGS.trending);
  revalidateTag(CACHE_TAGS.sitemap);

  return NextResponse.json({ ok: true, message: 'Matéria apagada.' });
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function validId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9]{10,40}$/i.test(value) ? value : null;
}
