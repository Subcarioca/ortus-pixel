/**
 * =============================================================================
 * POST /api/comments — publicar um comentário
 * =============================================================================
 *
 * MODELO DE MODERAÇÃO: "ESCADA DE CONFIANÇA".
 *
 * As duas opções clássicas são ruins em pontas opostas:
 *   - pré-moderação total → todo comentário espera aprovação humana. A conversa
 *     morre (ninguém volta 6 horas depois para ver se respondeu) e a redação
 *     ganha uma fila infinita. É o modelo que faz portais desligarem os
 *     comentários depois de três meses.
 *   - pós-moderação total → tudo publica na hora. Funciona até o primeiro
 *     ataque coordenado, e aí o estrago já foi lido por milhares de pessoas.
 *
 * O que fazemos: o PRIMEIRO comentário de uma conta entra como 'pending'; a
 * partir do primeiro aprovado, os seguintes publicam direto.
 *
 * Por que isso resolve na prática: o abuso quase sempre vem de conta
 * descartável, criada para uma investida só. Essa conta esbarra na moderação
 * prévia e nunca chega à segunda mensagem. Já o leitor recorrente paga o
 * pedágio uma única vez na vida. O custo operacional fica proporcional a
 * CONTAS NOVAS, não a comentários — e contas novas são poucas por dia.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { validateCommentContent } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { getReaderSession } from '@/server/reader-session';
import { CACHE_TAGS } from '@/server/queries';
import { checkRateLimit, getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // 1) IDENTIDADE. Sem sessão, não há comentário — não existe caminho anônimo.
  const session = await getReaderSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, message: 'Entre com uma conta para comentar.' },
      { status: 401 },
    );
  }

  // 2) LIMITE POR AUTOR (não por IP).
  //
  // Limitar por IP puniria a rede inteira de uma escola ou empresa por causa de
  // uma pessoa, e um abusador com celular troca de IP em segundos. Como aqui
  // TODO comentário tem conta identificada, o limite por autor é ao mesmo tempo
  // mais justo e mais difícil de contornar (exige conta nova a cada rodada).
  const rateLimit = checkRateLimit(`comment:${session.authorId}`, {
    maxRequests: 5,
    windowSeconds: 600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Você comentou bastante em pouco tempo. Respire e volte em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as { articleId?: unknown; content?: unknown };

  if (typeof payload.articleId !== 'string' || !/^[a-z0-9-]{10,60}$/i.test(payload.articleId)) {
    return NextResponse.json({ ok: false, message: 'Artigo inválido.' }, { status: 400 });
  }

  const validation = validateCommentContent(payload.content);
  if (!validation.valid) {
    return NextResponse.json({ ok: false, message: validation.error }, { status: 400 });
  }

  // 3) O ARTIGO EXISTE E ESTÁ PUBLICADO?
  //
  // Sem esta checagem, seria possível pendurar comentário em rascunho ou em
  // artigo arquivado — que ninguém modera porque ninguém vê, e que reaparece
  // junto com o conteúdo se ele voltar ao ar.
  const article = await prisma.article.findFirst({
    where: { id: payload.articleId, status: 'published' },
    select: { id: true, slug: true },
  });

  if (!article) {
    return NextResponse.json({ ok: false, message: 'Artigo não encontrado.' }, { status: 404 });
  }

  // 4) ESCADA DE CONFIANÇA (ver comentário no topo).
  const status = session.approvedCount > 0 ? 'approved' : 'pending';

  await prisma.comment.create({
    data: {
      articleId: article.id,
      authorAccountId: session.authorId,
      // Snapshot do nome no momento da publicação: se a pessoa trocar o nome no
      // provedor para algo ofensivo, os comentários antigos não mudam junto.
      authorName: session.displayName,
      content: validation.content,
      status,
      ipHash: hashPersonalData(getClientIp(request.headers)),
    },
  });

  // Só invalidamos o cache do artigo quando o comentário JÁ está público. Um
  // comentário pendente não muda o HTML servido a ninguém — regenerar a página
  // por causa dele seria desperdício exatamente no momento de maior tráfego
  // (um breaking news atrai muito comentário de conta nova).
  if (status === 'approved') {
    revalidateTag(CACHE_TAGS.article(article.slug));
  }

  return NextResponse.json({
    ok: true,
    status,
    message:
      status === 'approved'
        ? 'Comentário publicado.'
        : 'Recebemos seu comentário. Como é o seu primeiro por aqui, ele passa por uma revisão rápida antes de aparecer.',
  });
}
