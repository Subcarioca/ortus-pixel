/**
 * =============================================================================
 * POST /api/admin/topics/[id]/prearticle — gera pré-matéria com IA
 * =============================================================================
 *
 * Ação editoria que transforma um tópico do curator numa pré-matéria pronta
 * para revisão, usando o modelo configurado (DeepSeek). Diferente das ações de
 * `route.ts` (claim/override/dismiss), esta NÃO grava nada no banco nem no
 * `AuditLog`: é uma leitura + chamada de IA, e o resultado volta para o painel
 * como JSON — o editor decide se publica, e essa decisão sim, fica auditada no
 * fluxo normal de publicação.
 *
 * A chave de API vive no servidor (`server/ai/deepseek.ts`) e nunca chega ao
 * navegador. O único dado do cliente é o id do tópico.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';

import { isAdminAuthenticated } from '@/server/admin-auth';
import { DEFAULT_REFERENCE_SOURCES, detectLanguage, generatePreArticle } from '@/server/ai/prearticle';

export const dynamic = 'force-dynamic';

/** Mesma regra de id do route.ts pai — rejeita malformado antes de consultar. */
const TOPIC_ID_RE = /^[a-z0-9]{20,40}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, message: 'Não autorizado.' }, { status: 401 });
  }

  const { id } = await params;
  if (!TOPIC_ID_RE.test(id)) {
    return NextResponse.json({ ok: false, message: 'Identificador inválido.' }, { status: 400 });
  }

  const topic = await prisma.topic.findUnique({
    where: { id },
    select: {
      title: true,
      summary: true,
      currentScore: true,
      sourceName: true,
      category: { select: { name: true } },
    },
  });

  if (!topic) {
    return NextResponse.json({ ok: false, message: 'Tópico não encontrado.' }, { status: 404 });
  }

  // A fonte real vem primeiro (é o sinal mais específico); os portais padrão
  // completam o contexto quando o tópico não tem fonte, ou reforçam quando tem.
  const fontes = [topic.sourceName, ...DEFAULT_REFERENCE_SOURCES]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(', ');

  try {
    const data = await generatePreArticle({
      pauta: [topic.title, topic.summary].filter(Boolean).join('. ').trim(),
      tituloOriginal: topic.title,
      idiomaOriginal: detectLanguage(topic.title),
      scorePopularidade: Math.round(topic.currentScore),
      nicho: topic.category?.name ?? 'cultura pop/geek',
      fontesReferencia: fontes,
    });

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    // A mensagem do erro já é legível (chave ausente, API fora, JSON inválido).
    // Não vazamos o corpo da resposta da API; só a causa resumida.
    console.error('[prearticle] falha ao gerar pré-matéria:', error);
    const message = error instanceof Error ? error.message : 'Falha ao gerar pré-matéria.';
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
