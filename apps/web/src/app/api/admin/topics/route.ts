/**
 * =============================================================================
 * POST /api/admin/topics — criar uma PAUTA à mão
 * =============================================================================
 *
 * O QUE ESTA ROTA DESTRAVA
 * -----------------------------------------------------------------------------
 * Até aqui, um `Topic` só nascia do `services/curator`. Quem tivesse uma pauta
 * própria — a entrevista marcada, o assunto que a concorrência não viu, a série
 * de reviews planejada para o mês — não tinha como colocá-la na fila. As opções
 * eram esperar o algoritmo achar (que pode nunca acontecer) ou abrir uma matéria
 * solta, sem tópico, perdendo junto a fila, o cronômetro de publicação e o
 * vínculo com franquia.
 *
 * A pauta manual entra na MESMA tabela e na MESMA fila. O que a distingue é uma
 * coluna (`origin`), e é isso que impede o produto de virar dois sistemas
 * paralelos de pauta convivendo na mesma tela. Ver `core/topic-origin.ts`.
 *
 * -----------------------------------------------------------------------------
 * DECISÃO: NENHUM SCORE É INVENTADO
 * -----------------------------------------------------------------------------
 * A tentação óbvia é dar uma nota inicial à pauta manual ("50, para ela aparecer
 * no meio da fila"). Seria mentira com aparência de medição: o score deste
 * projeto significa "isto foi MEDIDO em conectores externos", e é essa promessa
 * que faz a redação confiar no número. Uma pauta manual entra com score 0 e a
 * fila a identifica pela origem — quem quiser priorizá-la usa o override manual,
 * que é uma ação registrada, com justificativa e responsável.
 *
 * -----------------------------------------------------------------------------
 * SEGURANÇA
 * -----------------------------------------------------------------------------
 *   - Exige sessão de redação com a capacidade `criarPauta` (redator TEM, ver
 *     core/staff.ts: propor pauta é o trabalho; descartar e repontuar é que não).
 *   - Todo texto é limitado em tamanho ANTES de tocar no banco — as colunas são
 *     `VarChar(255)` e o MySQL desta hospedagem trunca em silêncio (ver o
 *     cabeçalho do schema).
 *   - `dedupeHash` é derivado do título e é `@unique`: duas pessoas criando a
 *     mesma pauta com poucos segundos de diferença resultam em UMA pauta e uma
 *     mensagem clara para a segunda, em vez de duas linhas idênticas na fila.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { prisma } from '@subcarioca/db';
import { isCategorySlug, slugify } from '@subcarioca/core';

import { requireStaffApi } from '@/server/staff-auth';
import { getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Tetos alinhados às colunas do schema (`VarChar(255)`) com folga de segurança. */
const MAX_TITLE = 200;
const MAX_SUMMARY = 2_000;
const MAX_FRANCHISES = 6;

export async function POST(request: Request) {
  const guard = await requireStaffApi('criarPauta');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title.length < 8 || title.length > MAX_TITLE) {
    return NextResponse.json(
      {
        ok: false,
        message: `O título da pauta precisa ter entre 8 e ${MAX_TITLE} caracteres (tem ${title.length}).`,
      },
      { status: 400 },
    );
  }

  const summary = typeof payload.summary === 'string' ? payload.summary.trim().slice(0, MAX_SUMMARY) : '';

  /**
   * A EDITORIA É OBRIGATÓRIA AQUI, embora a coluna aceite nulo.
   *
   * A coluna é opcional porque o pipeline às vezes descobre um assunto antes de
   * conseguir classificá-lo — é uma incerteza legítima de máquina. Um humano
   * criando pauta não tem essa desculpa: ele sabe se está escrevendo de games ou
   * de cinema, e uma pauta sem editoria não aparece direito em lugar nenhum
   * (nem na fila filtrada, nem herdando a categoria para a matéria depois).
   *
   * Este é o "nicho obrigatório" pedido pelo dono do site, aplicado no ponto em
   * que ele é barato de exigir: a criação.
   */
  const categorySlug = typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
  if (!isCategorySlug(categorySlug)) {
    return NextResponse.json(
      { ok: false, message: 'Escolha a editoria da pauta.' },
      { status: 400 },
    );
  }

  const franchiseIds = Array.isArray(payload.franchiseIds)
    ? [
        ...new Set(
          payload.franchiseIds.filter(
            (v): v is string => typeof v === 'string' && /^[a-z0-9]{10,40}$/i.test(v),
          ),
        ),
      ].slice(0, MAX_FRANCHISES)
    : [];

  const [category, franchises] = await Promise.all([
    prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } }),
    franchiseIds.length > 0
      ? prisma.franchise.findMany({ where: { id: { in: franchiseIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  if (!category) {
    return NextResponse.json(
      { ok: false, message: 'Editoria não encontrada. Recarregue a página.' },
      { status: 400 },
    );
  }

  /**
   * HASH DE DEDUPLICAÇÃO — a mesma coluna que o pipeline usa, com outra receita.
   *
   * O curator deriva o hash do conteúdo da notícia (ver pipeline/dedupe.ts).
   * Aqui derivamos do TÍTULO NORMALIZADO, com prefixo próprio. Duas
   * consequências, as duas desejadas:
   *
   *   1. Uma pauta manual jamais colide com um tópico do pipeline (prefixos
   *      diferentes), então criar pauta nunca "rouba" a identidade de um tópico
   *      descoberto.
   *   2. Duas pessoas criando "Nintendo Direct de setembro" no mesmo dia caem no
   *      MESMO hash, e a segunda recebe "esta pauta já está na fila" em vez de
   *      duplicá-la. Quem garante isso é o índice único do banco, e não uma
   *      consulta prévia — que teria uma janela entre ler e escrever.
   */
  const dedupeHash = createHash('sha256')
    .update(`manual:${slugify(title)}`)
    .digest('hex')
    .slice(0, 40);

  try {
    const topic = await prisma.$transaction(async (tx) => {
      const created = await tx.topic.create({
        data: {
          origin: 'manual',
          createdById: guard.user.id,
          title,
          summary,
          // `query` é o termo que os conectores usariam. Numa pauta manual ele
          // não consulta nada hoje, mas continua sendo o campo canônico do
          // model — preenchê-lo com o título mantém a linha coerente e deixa a
          // porta aberta para, um dia, o pipeline MEDIR uma pauta nossa.
          query: title.slice(0, 200),
          categoryId: category.id,
          sourceName: 'Redação',
          // 'official' seria mentira (não há fonte externa) e 'unverified'
          // sugeriria conteúdo duvidoso. A pauta é nossa: a proveniência
          // honesta é a própria redação, registrada acima em `sourceName`.
          sourceTier: 'unverified',
          dedupeHash,
          status: 'new',
          // Sem score inventado. Ver o bloco no topo do arquivo.
          currentScore: 0,
          currentBand: 'EVERGREEN',
          scoreSummary: 'Pauta criada pela redação — sem medição automática.',
          franchises: {
            create: franchises.map((f) => ({ franchiseId: f.id })),
          },
        },
        select: { id: true, title: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'topic.created_manual',
          entityType: 'Topic',
          entityId: created.id,
          actorId: guard.user.id,
          after: { title, categorySlug, franchises: franchises.length },
          ipHash: hashPersonalData(getClientIp(request.headers)),
        },
      });

      // O evento de pipeline mantém a instrumentação editorial completa: sem
      // ele, o relatório de "quantas pautas viraram matéria" contaria só as do
      // algoritmo e concluiria que a redação não produz pauta própria.
      await tx.pipelineEvent.create({
        data: {
          eventType: 'topic.discovered',
          topicId: created.id,
          actorId: guard.user.id,
          payload: { origin: 'manual' },
        },
      });

      return created;
    });

    return NextResponse.json({ ok: true, id: topic.id, message: 'Pauta criada e na fila.' });
  } catch (error) {
    if (isDuplicate(error)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'Já existe uma pauta com esse título na fila — provavelmente alguém acabou de criá-la. ' +
            'Recarregue a fila e assuma a que já está lá.',
        },
        { status: 409 },
      );
    }
    throw error;
  }
}

/** P2002 = violação de índice único. Aqui, só `dedupeHash` é único no model. */
function isDuplicate(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}
