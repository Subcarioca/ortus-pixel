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
import { revalidateTag } from 'next/cache';

import { JSON_COLUMN_NULL, prisma, toJsonColumn } from '@subcarioca/db';
import {
  blocksReadingMinutes,
  canEditArticleOf,
  canLowerSensitivity,
  estimateReadingMinutes,
  hasBlocks,
  sensitivityRank,
  summarizeRisk,
  toAuditFindings,
  toContentSensitivity,
} from '@subcarioca/core';

import { parseArticleInput } from '@/server/article-input';
import { editorialRiskGate } from '@/server/editorial-risk-gate';
import { syncArticleTaxonomy } from '@/server/article-taxonomy';
import { forbiddenArticleResponse, requireStaffApi } from '@/server/staff-auth';
import { getClientIp, hashPersonalData } from '@/server/security';
import { CACHE_TAGS } from '@/server/queries';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// PATCH — editar
// -----------------------------------------------------------------------------

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireStaffApi('verMaterias');
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

  // A existência vem ANTES da validação do formulário: se a matéria já foi
  // apagada, apontar vírgula no resumo é ruído — não há mais o que salvar.
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
      authorId: true,
      // Necessário para a trava de redução de sensibilidade, logo abaixo: a
      // regra depende do valor ANTERIOR, e não só do papel de quem edita.
      contentSensitivity: true,
      category: { select: { id: true, slug: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: ARTICLE_GONE_MESSAGE }, { status: 404 });
  }

  /**
   * A REGRA DE PROPRIEDADE, APLICADA NO SERVIDOR.
   *
   * Vem DEPOIS da leitura (é preciso saber quem assina) e ANTES da validação do
   * formulário: apontar vírgula no resumo de uma matéria que a pessoa não pode
   * editar seria responder à pergunta errada. Ver `canEditArticleOf` em
   * core/staff.ts — a mesma função que a tela usa para esconder o botão.
   */
  if (!canEditArticleOf(guard.user, existing.authorId)) {
    return forbiddenArticleResponse();
  }

  const parsed = await parseArticleInput(payload, guard.user);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
  }

  const input = parsed.data;
  const { publish, category } = input;

  /**
   * A ESCADA DE SENSIBILIDADE SÓ DESCE COM ADMINISTRADOR.
   *
   * Aplicada AQUI, e não no validador de formulário, por um motivo simples: o
   * validador não conhece a linha, e a regra não é sobre o valor novo — é sobre
   * a DIREÇÃO da mudança. Marcar como adulto é livre; desmarcar não.
   *
   * A tela do redator já vem sem a opção de baixar (ele vê o campo travado no
   * nível atual ou acima), mas isso é conforto, não proteção: um `<select>` é do
   * navegador dele. Quem recusa é esta comparação.
   */
  const previousSensitivity = toContentSensitivity(existing.contentSensitivity);
  if (
    !canLowerSensitivity(
      guard.user,
      sensitivityRank(previousSensitivity),
      sensitivityRank(input.contentSensitivity),
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'Só um administrador pode reduzir a classificação de conteúdo desta matéria. ' +
          'Marcar como mais restrito é liberado para toda a redação; afrouxar, não — ' +
          'é o que protege a conta de anúncios do site.',
      },
      { status: 403 },
    );
  }

  /**
   * O VERIFICADOR DE RISCO EDITORIAL — e por que ele precisa estar TAMBÉM aqui.
   *
   * Checar só na criação seria uma proteção de fachada: toda matéria publicada
   * continua editável, e nada impediria de reintroduzir a acusação sem fonte no
   * dia seguinte, num PATCH que ninguém verifica. Como o texto que sai daqui é o
   * mesmo texto que vai ao ar, a checagem tem de acompanhar o caminho, não o
   * momento.
   *
   * Vem DEPOIS das checagens de permissão de propósito: recusar por permissão é
   * definitivo, e mostrar um painel de revisão para quem não podia editar a
   * matéria seria responder à pergunta errada.
   */
  const riskGate = editorialRiskGate(payload, input);
  if (!riskGate.ok) return riskGate.response;

  const wasPublished = existing.status === 'published';
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.article.update({
        where: { id },
        data: {
          // `slug` deliberadamente ausente — ver o bloco no topo do arquivo.
          title: input.title,
          excerpt: input.excerpt,
          content: input.content,
          // `null` DESLIGA os blocos e devolve a matéria ao renderizador de
          // Markdown. É o caminho de volta, e ele precisa existir: sem ele, uma
          // conversão feita por engano seria irreversível pela interface.
          blocks: hasBlocks(input.blocks) ? toJsonColumn(input.blocks) : JSON_COLUMN_NULL,
          status: publish ? 'published' : 'draft',
          categoryId: category.id,
          subcategoryId: input.subcategoryId,
          authorId: input.authorId,
          format: input.format,
          tldr: input.tldr,
          coverImageUrl: input.coverImageUrl,
          coverImageAlt: input.coverImageAlt,
          // Ver `@/lib/cover-image`. `parseArticleInput` já garante que as
          // coordenadas só vêm preenchidas quando `coverImageFit === 'focal'`
          // — inclusive limpando um resíduo de quando a matéria esteve nesse
          // modo e o editor trocou para outro.
          coverImageFit: input.coverImageFit,
          coverImageFocalX: input.coverImageFocalX,
          coverImageFocalY: input.coverImageFocalY,
          isBreaking: input.isBreaking,
          hasSpoiler: input.hasSpoiler,
          contentSensitivity: input.contentSensitivity,
          readingMinutes: hasBlocks(input.blocks)
            ? blocksReadingMinutes(input.blocks)
            : estimateReadingMinutes(input.content),
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

      // SUBSTITUI a etiquetagem inteira pela que veio do formulário. Ver o
      // cabeçalho de `article-taxonomy.ts` para o motivo de ser substituição, e
      // não diferença incremental.
      await syncArticleTaxonomy(tx, id, {
        franchiseIds: input.franchiseIds,
        tags: input.tags,
      });

      await tx.auditLog.create({
        data: {
          action: publish ? 'article.updated_published' : 'article.updated_draft',
          entityType: 'Article',
          entityId: id,
          actorId: guard.user.id,
          before: {
            title: existing.title,
            status: existing.status,
            categorySlug: existing.category.slug,
            // A classificação de conteúdo entra na trilha porque é a única
            // decisão editorial deste formulário com consequência FORA do site
            // (a política do AdSense). "Quem tirou a marca de adulto daquela
            // matéria, e quando?" precisa ter resposta.
            contentSensitivity: previousSensitivity,
          },
          after: {
            title: input.title,
            status: publish ? 'published' : 'draft',
            categorySlug: category.slug,
            contentSensitivity: input.contentSensitivity,
          },
          ipHash: hashPersonalData(getClientIp(request.headers)),
        },
      });

      /**
       * LINHA PRÓPRIA PARA "PUBLIQUEI SABENDO DO AVISO".
       *
       * Poderia ser um campo dentro do `after` da linha acima. É uma linha
       * separada por uma razão de consulta: a pergunta que esta trilha precisa
       * responder um dia é "me mostre todas as publicações feitas apesar de um
       * alerta". Com uma ação própria, isso é um `where: { action }` com índice;
       * embutido no `after`, seria varredura de coluna Json em todas as edições
       * já feitas — na prática, uma pergunta que ninguém faz.
       */
      if (riskGate.acknowledgement) {
        await tx.auditLog.create({
          data: {
            action: 'article.risk_acknowledged',
            entityType: 'Article',
            entityId: id,
            actorId: guard.user.id,
            after: {
              resumo: summarizeRisk(riskGate.acknowledgement.findings),
              trechos: toAuditFindings(riskGate.acknowledgement.findings),
            },
            // Obrigatória quando há trecho de alto risco; opcional no resto.
            reason: riskGate.acknowledgement.reason,
            ipHash: hashPersonalData(getClientIp(request.headers)),
          },
        });
      }
    });
  } catch (error) {
    // A matéria pode ter sido apagada em outra aba entre a leitura acima e a
    // gravação. Sem este tratamento o editor recebia um 500 sem corpo, que a
    // tela traduzia como "Erro de conexão." — a pior mensagem possível, porque
    // sugere tentar de novo uma operação que nunca vai funcionar.
    if (isRecordNotFound(error)) {
      return NextResponse.json({ ok: false, message: ARTICLE_GONE_MESSAGE }, { status: 409 });
    }
    throw error;
  }

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
    /**
     * Os achados voltam mesmo no SUCESSO. É o caso do rascunho: nada foi
     * publicado, o portão deixou passar, e ainda assim quem está escrevendo
     * ganha o aviso agora em vez de ser surpreendido na hora de publicar.
     */
    riskFindings: input.riskFindings,
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
  const guard = await requireStaffApi('verMaterias');
  if (!guard.ok) return guard.response;

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
      authorId: true,
      category: { select: { slug: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ ok: false, message: ARTICLE_GONE_MESSAGE }, { status: 404 });
  }

  // Apagar é a ação irreversível: a checagem de propriedade vale aqui com ainda
  // mais força do que na edição.
  if (!canEditArticleOf(guard.user, existing.authorId)) {
    return forbiddenArticleResponse();
  }

  try {
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
          actorId: guard.user.id,
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
  } catch (error) {
    // Dois cliques em "Apagar definitivamente" vindos de abas diferentes (ou de
    // dois editores) chegam juntos: um apaga, o outro encontra a linha já
    // removida. O segundo não é uma falha do sistema — é a mesma intenção
    // cumprida duas vezes, e a resposta precisa dizer isso em vez de estourar.
    if (isRecordNotFound(error)) {
      return NextResponse.json({ ok: false, message: ARTICLE_GONE_MESSAGE }, { status: 409 });
    }
    throw error;
  }

  revalidateTag(CACHE_TAGS.article(existing.slug));
  revalidateTag(CACHE_TAGS.category(existing.category.slug));
  revalidateTag(CACHE_TAGS.home);
  revalidateTag(CACHE_TAGS.trending);
  revalidateTag(CACHE_TAGS.sitemap);

  return NextResponse.json({ ok: true, message: 'Matéria apagada.' });
}

/**
 * Uma frase só para "a matéria não está mais lá", usada tanto quando a leitura
 * inicial não a encontra quanto quando ela some no meio da gravação. Quem está
 * do outro lado da tela não distingue os dois casos — e nem precisa: o que
 * muda a ação dele é saber que outra aba já apagou.
 */
const ARTICLE_GONE_MESSAGE =
  'Esta matéria não existe mais — ela pode ter sido apagada em outra aba. Recarregue a lista.';

/**
 * P2025 é o código do Prisma para "o registro exigido pela operação não existe".
 * Só ele é convertido em resposta amigável; qualquer outro erro continua subindo
 * para virar 500 e aparecer no log, como deve ser.
 */
function isRecordNotFound(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2025';
}
