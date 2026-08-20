/**
 * =============================================================================
 * POST /api/admin/topics/[id] — ações editoriais sobre um tópico
 * =============================================================================
 *
 * Ações: `claim` (assumir), `override` (sobrepor score), `create-article`
 * (virar matéria), `ai-suggestion` (pré-preencher o formulário com um rascunho
 * gerado por modelo de linguagem), `prearticle` (gerar a pré-matéria estruturada
 * do REDATOR-CHEFE, via DeepSeek) e `dismiss` (descartar).
 *
 * TODA ação é registrada em `AuditLog` com autor, valor anterior, valor novo e
 * justificativa. Isso não é burocracia: é o que permite, semanas depois,
 * responder "o algoritmo errou ou o editor discordou?" — pergunta central para
 * recalibrar os pesos sem cair no achismo.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import type { Prisma } from '@prisma/client';

import { prisma, toJsonColumn, toStringArray } from '@subcarioca/db';
import {
  blocksReadingMinutes,
  estimateReadingMinutes,
  hasBlocks,
  slugify,
  summarizeRisk,
  toAuditFindings,
  toContentOrigin,
} from '@subcarioca/core';

import { generateArticleDraft, isAiDraftConfigured } from '@/server/ai-draft';
import {
  DEFAULT_REFERENCE_SOURCES,
  detectLanguage,
  generatePreArticle,
  isPreArticleConfigured,
  preArticleModel,
} from '@/server/ai/prearticle';
import type { PreArticleOutput } from '@/server/ai/prearticle-types';
import { parseArticleInput } from '@/server/article-input';
import { editorialRiskGate } from '@/server/editorial-risk-gate';
import { syncArticleTaxonomy } from '@/server/article-taxonomy';
import { requireStaffApi } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, hashPersonalData } from '@/server/security';
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
    case 'ai-suggestion': {
      /**
       * PRÉ-PREENCHE o formulário de matéria com um rascunho gerado a partir do
       * que a fila já sabe sobre a pauta. NÃO grava nada: a resposta é o
       * rascunho, que o navegador joga nos campos do MESMO formulário de sempre.
       *
       * -----------------------------------------------------------------------
       * POR QUE ESTA AÇÃO MORA AQUI, e não numa rota `/api/admin/ai/...` própria
       * -----------------------------------------------------------------------
       * Porque ela é uma ação SOBRE UM TÓPICO, como as outras quatro: precisa do
       * mesmo guard, da mesma validação de id, da mesma checagem de existência e
       * do mesmo tópico carregado. Uma rota nova duplicaria esses quatro passos —
       * e duplicar guard de permissão é como se perde permissão.
       *
       * -----------------------------------------------------------------------
       * PERMISSÃO: A MESMA DE `create-article`. NENHUMA CAPACIDADE NOVA.
       * -----------------------------------------------------------------------
       * Quem pode transformar a pauta em matéria pode pedir a sugestão — porque
       * é exatamente o mesmo trabalho, com um ponto de partida diferente.
       * Restringir a geração a administrador foi considerado e descartado: o
       * argumento a favor seria o custo por chamada, e ele não se sustenta
       * (centavos por rascunho, com teto de tokens na chamada). O argumento
       * contra é forte: quem está às 23h com uma pauta quente e um formulário
       * vazio é justamente o redator, e uma ferramenta de redação que o
       * administrador precisa acionar não é uma ferramenta de redação.
       *
       * O custo é controlado onde ele de fato nasce — no VOLUME de chamadas —,
       * pelo limitador logo abaixo. Uma trava por nível de acesso não impediria
       * um administrador de clicar cem vezes; o limitador impede os dois.
       */
      if (!isAiDraftConfigured()) {
        // A tela já esconde o botão neste caso. Isto aqui é a verificação que
        // vale: esconder botão nunca foi proteção (ver core/staff.ts).
        return NextResponse.json(
          {
            ok: false,
            message:
              'A geração por IA não está configurada neste servidor. ' +
              'Use "Criar matéria" e escreva normalmente.',
          },
          { status: 503 },
        );
      }

      // Tópico já coberto não deve gastar uma chamada paga: o rascunho seria
      // descartado no salvamento pela trava de matéria duplicada.
      if (topic.status === 'published') {
        return NextResponse.json(
          {
            ok: false,
            message: 'Este tópico já virou matéria. Edite a matéria existente em Matérias.',
          },
          { status: 409 },
        );
      }

      /**
       * LIMITE DE VOLUME POR CONTA — 8 gerações a cada 10 minutos.
       *
       * É a única defesa de CUSTO desta funcionalidade, e o número saiu do uso
       * real: escrever e revisar uma matéria leva bem mais de um minuto, então 8
       * em 10 minutos já é generoso para trabalho de verdade e baixo o bastante
       * para que um botão clicado em looping (por engano, por impaciência ou por
       * uma sessão roubada) não vire uma fatura.
       *
       * A chave é a CONTA, não o IP: a redação inteira pode estar atrás do mesmo
       * IP do escritório, e limitar por IP puniria o colega ao lado. A limitação
       * conhecida do contador em memória (uma cópia por instância) está
       * documentada em `security.ts` e é aceitável aqui — o teto real vira N×8, o
       * que continua sendo um teto.
       */
      const limite = checkRateLimit(`ai-draft:${guard.user.id}`, {
        maxRequests: 8,
        windowSeconds: 600,
      });

      if (!limite.allowed) {
        return NextResponse.json(
          {
            ok: false,
            message:
              `Você já pediu várias sugestões seguidas. Espere ${Math.ceil(limite.resetInSeconds / 60)} ` +
              'minuto(s) ou escreva a matéria pelo formulário.',
          },
          { status: 429 },
        );
      }

      // O contexto da pauta é buscado AQUI, e não no `findUnique` do topo: são
      // dois JOINs e um snapshot de score que as outras quatro ações não usam, e
      // que sairiam caro em toda ação de "assumir pauta" da fila.
      const contexto = await prisma.topic.findUnique({
        where: { id },
        select: {
          title: true,
          summary: true,
          sourceName: true,
          sourceUrl: true,
          sourceTier: true,
          scoreSummary: true,
          emotionalTriggers: true,
          category: { select: { name: true } },
          franchises: { include: { franchise: { select: { name: true } } } },
        },
      });

      if (!contexto) {
        return NextResponse.json({ ok: false, message: 'Tópico não encontrado.' }, { status: 404 });
      }

      const resultado = await generateArticleDraft({
        title: contexto.title,
        summary: contexto.summary,
        sourceName: contexto.sourceName,
        sourceUrl: contexto.sourceUrl,
        sourceTier: contexto.sourceTier,
        categoryName: contexto.category?.name ?? null,
        franchises: contexto.franchises.map((f) => f.franchise.name),
        scoreSummary: contexto.scoreSummary || null,
        // Coluna `Json` desde a migração para o MySQL — normalizada na borda,
        // como no resto do projeto.
        emotionalTriggers: toStringArray(contexto.emotionalTriggers),
      });

      if (!resultado.ok) {
        // O status vem do módulo, e nunca é 401: ver o comentário de
        // `AiDraftFailure` em `ai-draft.ts`.
        return NextResponse.json(
          { ok: false, message: resultado.message },
          { status: resultado.status },
        );
      }

      /**
       * REGISTRO DA GERAÇÃO — no `AuditLog`, e mesmo que o rascunho seja jogado
       * fora em seguida.
       *
       * A coluna `contentOrigin` da matéria só existe se o rascunho virar
       * matéria. Este registro responde a outra pergunta, que a coluna não
       * responde: "quanto a redação está PEDINDO ao modelo, e o que ela pediu?".
       * É o que permite, no fim do mês, cruzar volume de geração com a fatura da
       * API e com quantas sugestões viraram matéria de fato.
       *
       * O TEXTO GERADO NÃO É GRAVADO AQUI de propósito: ele ainda não é conteúdo
       * editorial — é um rascunho na tela de alguém, que pode ser inteiramente
       * reescrito. Guardá-lo encheria a tabela de auditoria de texto morto.
       */
      await prisma.auditLog.create({
        data: {
          action: 'topic.ai_suggestion',
          entityType: 'Topic',
          entityId: id,
          actorId: guard.user.id,
          after: {
            model: resultado.draft.model,
            blocos: resultado.draft.blocks.length,
            caracteres: resultado.draft.content.length,
            pendencias: resultado.draft.pendencias.length,
          },
          ipHash,
        },
      });

      return NextResponse.json({
        ok: true,
        message: 'Rascunho gerado. Revise tudo antes de publicar.',
        draft: resultado.draft,
      });
    }

    // -------------------------------------------------------------------------
    case 'prearticle': {
      /**
       * PRÉ-MATÉRIA DO REDATOR-CHEFE — a pauta vira um pacote editorial
       * estruturado (contextualização, análise do hype, modelo de popularidade,
       * pré-matéria e otimização de captação) via DeepSeek.
       *
       * -----------------------------------------------------------------------
       * COMO ISTO SE RELACIONA COM `ai-suggestion`
       * -----------------------------------------------------------------------
       * São duas funcionalidades vizinhas e INTENCIONALMENTE separadas. A
       * sugestão preenche o formulário de matéria com um rascunho e devolve o
       * conteúdo que o editor edita no MESMO formulário de sempre. A pré-matéria
       * devolve um JSON ESTRUTURADO — com análise de hype, modelo de
       * popularidade e otimização de captação — que o editor revisa na PRÓPRIA
       * fila, antes de decidir abrir o formulário. A permissão é a mesma (quem
       * vê a fila pode pedir), mas o custo, o contrato de saída e o raio de
       * injeção de prompt são diferentes o bastante para justificar duas ações.
       */
      if (!isPreArticleConfigured()) {
        // A tela já esconde o botão neste caso. Isto é a verificação que vale:
        // esconder botão nunca foi proteção.
        return NextResponse.json(
          {
            ok: false,
            message:
              'A pré-matéria por IA não está configurada neste servidor. ' +
              'Use "Criar matéria" e escreva normalmente.',
          },
          { status: 503 },
        );
      }

      // Tópico já coberto não deve gastar uma chamada paga: a pré-matéria seria
      // descartada no salvamento pela trava de matéria duplicada.
      if (topic.status === 'published') {
        return NextResponse.json(
          {
            ok: false,
            message: 'Este tópico já virou matéria. Edite a matéria existente em Matérias.',
          },
          { status: 409 },
        );
      }

      /**
       * LIMITE DE VOLUME — o MESMO teto da sugestão (8 a cada 10 minutos), porém
       * com CHAVE PRÓPRIA. Pedir pré-matéria e pedir sugestão são gestos de
       * custo independentes: um não deve comer a cota do outro, e somar os dois
       * no mesmo contador puniria justamente quem está testando os dois fluxos.
       */
      const limite = checkRateLimit(`prearticle:${guard.user.id}`, {
        maxRequests: 8,
        windowSeconds: 600,
      });

      if (!limite.allowed) {
        return NextResponse.json(
          {
            ok: false,
            message:
              `Você já pediu várias pré-matérias seguidas. Espere ${Math.ceil(limite.resetInSeconds / 60)} ` +
              'minuto(s) ou escreva a matéria pelo formulário.',
          },
          { status: 429 },
        );
      }

      // Contexto mínimo da pauta — título, resumo, fonte e categoria. Só é
      // buscado AQUI, nesta ação, porque as outras cinco não usam esses campos.
      //
      // `category` traz também `id` e `slug` (e não só `name`, como antes): é o
      // que o passo seguinte — criar o RASCUNHO automático — precisa para
      // preencher `Article.categoryId` e para a auditoria. Um tópico sem
      // categoria (`category: null`) é possível (`Topic.categoryId` é opcional)
      // e tratado mais abaixo: a pré-matéria ainda é gerada, só o rascunho
      // automático que não pode nascer sem editoria.
      const contexto = await prisma.topic.findUnique({
        where: { id },
        select: {
          title: true,
          summary: true,
          sourceName: true,
          category: { select: { id: true, name: true, slug: true } },
        },
      });

      if (!contexto) {
        return NextResponse.json({ ok: false, message: 'Tópico não encontrado.' }, { status: 404 });
      }

      // A fonte original encabeça a lista de referência (é ela quem deu a
      // pauta), seguida dos portais de referência padrão. Entradas vazias/nulas
      // são descartadas para não sujar o prompt.
      const fontes = [contexto.sourceName, ...DEFAULT_REFERENCE_SOURCES]
        .filter((fonte): fonte is string => typeof fonte === 'string' && fonte.trim().length > 0)
        .join(', ');

      const resultado = await generatePreArticle({
        pauta: contexto.summary ?? contexto.title,
        tituloOriginal: contexto.title,
        idiomaOriginal: detectLanguage(contexto.title),
        scorePopularidade: Math.round(topic.currentScore),
        nicho: contexto.category?.name ?? 'Cultura pop/geek',
        fontesReferencia: fontes,
      });

      if (!resultado.ok) {
        // O status vem do módulo, e nunca é 401: ver o comentário de
        // `DeepSeekFailure` em `deepseek.ts`.
        return NextResponse.json(
          { ok: false, message: resultado.message },
          { status: resultado.status },
        );
      }

      const dados = resultado.data;
      const caracteres =
        dados.contextualizacao.length +
        dados.analise_hype.join('').length +
        dados.pre_materia.titulo.length +
        dados.pre_materia.subtitulo.length +
        dados.pre_materia.abertura.length +
        dados.pre_materia.corpo.join('').length +
        dados.pre_materia.fechamento_cta.length;

      // Registro da geração, no mesmo espírito de `topic.ai_suggestion`: o TEXTO
      // GERADO NÃO É GRAVADO (ainda é rascunho na tela de alguém), mas o volume
      // e o modelo são — é o que permite cruzar custo com o que de fato virou
      // matéria no fim do mês.
      await prisma.auditLog.create({
        data: {
          action: 'topic.ai_prearticle',
          entityType: 'Topic',
          entityId: id,
          actorId: guard.user.id,
          after: {
            model: preArticleModel(),
            corpo: dados.pre_materia.corpo.length,
            caracteres,
            modelo_popularidade: dados.modelo_popularidade.categoria,
          },
          ipHash,
        },
      });

      /**
       * O RASCUNHO NASCE JUNTO — a pré-matéria deixa de ser só texto solto na
       * fila e passa a ser um ponto de partida de verdade: uma `Article` com
       * `status: 'draft'`, pronta para o redator abrir em Matérias, editar (ou
       * não) e publicar quando quiser.
       *
       * -----------------------------------------------------------------------
       * MESMA TRAVA, MESMO LAÇO DE RETENTATIVA DE `create-article`
       * -----------------------------------------------------------------------
       * `createArticleWithUniqueSlug` (definida no fim do arquivo) é a extração
       * dessa lógica: a mesma trava atômica contra tópico duplicado e o mesmo
       * laço de slug com retentativa. Duplicar as ~30 linhas aqui era o jeito
       * mais rápido de as duas cópias divergirem no dia em que uma delas fosse
       * corrigida e a outra, esquecida.
       *
       * -----------------------------------------------------------------------
       * O QUE FICA DE FORA, DE PROPÓSITO
       * -----------------------------------------------------------------------
       * Franquia, tag e o portão de risco editorial NÃO entram aqui: o rascunho
       * nasce sem etiquetas (o redator adiciona ao editar) e sem publicação —
       * portanto sem nada para o portão de risco barrar. A checagem de risco já
       * roda no fluxo de EDIÇÃO/publicação existente
       * (`/api/admin/articles/[id]`, PATCH), que é por onde este rascunho
       * obrigatoriamente passa antes de ir ao ar.
       *
       * -----------------------------------------------------------------------
       * AUTORIA DO RASCUNHO
       * -----------------------------------------------------------------------
       * `guard.user.id` — quem pediu a pré-matéria —, e não um campo de
       * formulário: esta ação não passa por nenhum formulário (é um clique só),
       * então não existe um autor "escolhido" para resolver. É a MESMA
       * identidade que `parseArticleInput` usa como padrão para quem não tem a
       * capacidade `atribuirOutroAutor` (ver `article-input.ts`), e o redator
       * pode trocar o autor livremente ao editar o rascunho, como em qualquer
       * matéria.
       */
      let draft: { id: string; slug: string } | 'already-covered' | 'slug-exhausted' | 'skipped' = 'skipped';
      let draftSkipReason = '';

      const fields = draftFieldsFromPreArticle(dados, contexto.title);

      if (!contexto.category) {
        // `Topic.categoryId` é opcional; a `Article` exige categoria. Sem uma,
        // não há como preencher `categoryId` — a pré-matéria continua útil como
        // leitura, só o rascunho automático que não pode nascer.
        draftSkipReason =
          'este tópico não tem categoria definida. Abra "Criar matéria" e preencha manualmente.';
      } else if (!fields) {
        // Geração degenerada (texto curto demais mesmo com os fallbacks) — caso
        // raro, mas `parsePreArticle` só garante texto NÃO VAZIO, não texto
        // dentro dos limites de gravação. Melhor devolver a pré-matéria "só
        // para leitura" do que gravar uma matéria com título ou corpo inválido.
        draftSkipReason =
          'o texto gerado veio curto demais para virar rascunho automaticamente. Copie o conteúdo para "Criar matéria".';
      } else {
        const category = contexto.category;
        const baseSlug = slugify(fields.title) || 'materia';

        const outcome = await createArticleWithUniqueSlug({
          topicId: id,
          baseSlug,
          buildData: (slug) => ({
            slug,
            title: fields.title,
            excerpt: fields.excerpt,
            content: fields.content,
            contentOrigin: 'ai-assisted',
            status: 'draft',
            categoryId: category.id,
            authorId: guard.user.id,
            topicId: id,
            readingMinutes: estimateReadingMinutes(fields.content),
            currentScore: topic.currentScore,
          }),
          afterCreate: async (tx, created) => {
            await tx.auditLog.create({
              data: {
                action: 'article.drafted',
                entityType: 'Article',
                entityId: created.id,
                actorId: guard.user.id,
                after: {
                  title: fields.title,
                  slug: created.slug,
                  categorySlug: category.slug,
                  contentOrigin: 'ai-assisted',
                  // Diferencia, na trilha de auditoria, o rascunho nascido de
                  // pré-matéria do rascunho escrito à mão em "Criar matéria" —
                  // os dois usam a mesma ação (`article.drafted`), e é este
                  // campo que responde "veio de onde?" sem precisar cruzar com
                  // `topic.ai_prearticle` por horário.
                  source: 'prearticle',
                },
                ipHash,
              },
            });
          },
        });

        if (outcome === 'already-covered') {
          draft = 'already-covered';
        } else if (outcome === null) {
          draft = 'slug-exhausted';
        } else {
          draft = outcome;
        }
      }

      // Colisão esgotada ou corrida perdida contra outra aba: a pré-matéria já
      // foi gerada (e já custou a chamada), mas o rascunho não pôde ser salvo.
      // Isto é diferente de "sem categoria"/"texto curto": ali o rascunho nunca
      // chegou a ser TENTADO, então devolver a pré-matéria para leitura é a
      // resposta certa. Aqui a tentativa falhou de um jeito que repetir o clique
      // resolve — o 409 é o mesmo padrão de `create-article`.
      if (draft === 'already-covered') {
        return NextResponse.json(
          {
            ok: false,
            message:
              'Este tópico já virou matéria — provavelmente em outra aba. Recarregue a fila e edite a matéria existente em Matérias.',
          },
          { status: 409 },
        );
      }

      if (draft === 'slug-exhausted') {
        return NextResponse.json(
          {
            ok: false,
            message:
              'A pré-matéria foi gerada, mas não foi possível criar um endereço único para o rascunho. Tente de novo.',
          },
          { status: 409 },
        );
      }

      if (draft === 'skipped') {
        return NextResponse.json({
          ok: true,
          message: `Pré-matéria gerada, mas o rascunho não foi salvo automaticamente: ${draftSkipReason}`,
          prearticle: dados,
        });
      }

      return NextResponse.json({
        ok: true,
        message: 'Pré-matéria gerada e salva como rascunho. Revise antes de publicar.',
        prearticle: dados,
        // Só existem quando o rascunho foi criado: o painel usa a presença
        // destes campos para decidir se mostra "Abrir rascunho para editar".
        articleId: draft.id,
        articleSlug: draft.slug,
      });
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

      /**
       * VERIFICADOR DE RISCO EDITORIAL — a mesma regra da rota de edição, vinda
       * do mesmo módulo (`editorial-risk-gate.ts`).
       *
       * Fica ANTES do laço de gravação, e isso importa: o laço marca o tópico
       * como coberto e cria a matéria. Chamar o portão lá dentro faria a
       * primeira tentativa de publicação (a que só existe para MOSTRAR o aviso)
       * consumir o tópico — e o redator voltaria de um aviso para descobrir que
       * a pauta virou "já coberta" sem que nada tivesse sido escrito.
       */
      const riskGate = editorialRiskGate(payload, input);
      if (!riskGate.ok) return riskGate.response;

      /**
       * PROCEDÊNCIA DO TEXTO INICIAL — 'human' ou 'ai-assisted'.
       *
       * Fica FORA de `parseArticleInput` de propósito: aquele módulo é a
       * validação do FORMULÁRIO, compartilhada com a rota de EDIÇÃO, e este
       * campo é gravado uma única vez, no nascimento da matéria. Passar por lá
       * abriria a porta para a edição reescrever a procedência — que é
       * exatamente o que ele não pode permitir.
       *
       * O valor é uma DECLARAÇÃO do formulário (o navegador o envia depois de
       * uma geração bem-sucedida), e isso é suficiente para o que ele serve:
       * rastreabilidade editorial, não controle de acesso. Quem quisesse mentir
       * aqui — omitindo a marca — ainda deixaria a linha `topic.ai_suggestion` no
       * `AuditLog`, gravada no servidor, no momento da geração. As duas fontes
       * juntas é que fecham a auditoria; nenhuma delas sozinha depende da
       * honestidade do cliente.
       */
      const contentOrigin = toContentOrigin(payload.contentOrigin);

      // Título sem NENHUMA letra ou número latino (só emoji, pontuação ou
      // escrita não-latina) faz `slugify` devolver string vazia — e uma matéria
      // com slug vazio é publicada com sucesso e fica inalcançável: a URL
      // resultante é a da categoria. O sufixo do laço dentro de
      // `createArticleWithUniqueSlug` cuida da unicidade.
      const baseSlug = slugify(input.title) || 'materia';
      const now = new Date();

      // TRAVA CONTRA MATÉRIA DUPLICADA + RETENTATIVA DE SLUG — extraídas para
      // `createArticleWithUniqueSlug` (fim do arquivo) porque `prearticle`
      // também precisa delas, para o rascunho automático que a pré-matéria
      // agora cria. Ver o comentário completo da trava (isolamento do InnoDB,
      // gap locks) na própria função.
      const outcome = await createArticleWithUniqueSlug({
        topicId: id,
        baseSlug,
        buildData: (slug) => ({
          slug,
          title: input.title,
          excerpt: input.excerpt,
          content: input.content,
          // `null` (e não `[]`) quando não há blocos: a coluna significa "esta
          // matéria foi escrita no editor de blocos?", e um array vazio
          // responderia "sim, e está vazia" — que é outra coisa.
          blocks: hasBlocks(input.blocks) ? toJsonColumn(input.blocks) : undefined,
          // Ver o bloco de comentário de `contentOrigin`, acima.
          contentOrigin,
          status: publish ? 'published' : 'draft',
          categoryId: category.id,
          subcategoryId: input.subcategoryId,
          authorId: input.authorId,
          topicId: id,
          format: input.format,
          tldr: input.tldr,
          coverImageUrl: input.coverImageUrl,
          coverImageAlt: input.coverImageAlt,
          // Ver `@/lib/cover-image`. `parseArticleInput` já garante que as
          // coordenadas só vêm preenchidas quando `coverImageFit === 'focal'`.
          coverImageFit: input.coverImageFit,
          coverImageFocalX: input.coverImageFocalX,
          coverImageFocalY: input.coverImageFocalY,
          isBreaking: input.isBreaking,
          hasSpoiler: input.hasSpoiler,
          // Na CRIAÇÃO não há valor anterior, então não há o que "reduzir":
          // qualquer nível é aceito de qualquer conta. A trava de permissão
          // (`canLowerSensitivity`) só existe na edição, que é onde a redução
          // acontece. Ver core/staff.ts.
          contentSensitivity: input.contentSensitivity,
          // Com blocos, o tempo de leitura conta imagem e vídeo além das
          // palavras (ver `blocksReadingMinutes`). Sem blocos, continua a
          // estimativa de sempre sobre o Markdown.
          readingMinutes: hasBlocks(input.blocks)
            ? blocksReadingMinutes(input.blocks)
            : estimateReadingMinutes(input.content),
          currentScore: topic.currentScore,
          scoreAtPublish: publish ? topic.currentScore : null,
          publishedAt: publish ? now : null,
        }),
        afterCreate: async (tx, created) => {
          // Franquias e tags entram na MESMA transação da matéria: uma matéria
          // publicada com metade das etiquetas não daria erro nenhum e sumiria
          // dos hubs de fandom sem ninguém notar.
          await syncArticleTaxonomy(tx, created.id, {
            franchiseIds: input.franchiseIds,
            tags: input.tags,
          });

          await tx.auditLog.create({
            data: {
              action: publish ? 'article.published' : 'article.drafted',
              entityType: 'Article',
              entityId: created.id,
              // `actorId` finalmente diz QUEM. Era o campo que o segredo
              // compartilhado deixava vazio e que tornava a auditoria inútil.
              actorId: guard.user.id,
              after: {
                title: input.title,
                slug: created.slug,
                categorySlug: category.slug,
                publish,
                // Repetido aqui (além da coluna da matéria) porque a auditoria
                // precisa responder "como esta matéria NASCEU?" mesmo que a
                // linha do artigo seja apagada depois.
                contentOrigin,
              },
              ipHash,
            },
          });

          // Ver o comentário equivalente na rota de edição: ação PRÓPRIA para
          // que "quais matérias foram publicadas apesar do alerta?" seja uma
          // consulta por índice, e não uma varredura de coluna Json.
          if (riskGate.acknowledgement) {
            await tx.auditLog.create({
              data: {
                action: 'article.risk_acknowledged',
                entityType: 'Article',
                entityId: created.id,
                actorId: guard.user.id,
                after: {
                  resumo: summarizeRisk(riskGate.acknowledgement.findings),
                  trechos: toAuditFindings(riskGate.acknowledgement.findings),
                },
                reason: riskGate.acknowledgement.reason,
                ipHash,
              },
            });
          }
        },
      });

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
        // Aviso passivo do rascunho — ver o comentário na rota de edição.
        riskFindings: input.riskFindings,
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

/** O tipo do cliente transacional do Prisma. Ver a mesma definição, com a
 *  mesma justificativa, em `server/article-taxonomy.ts`. */
type Tx = Prisma.TransactionClient;

/**
 * =============================================================================
 * CRIA UMA `Article` COM SLUG ÚNICO, sob a trava contra tópico duplicado
 * =============================================================================
 *
 * Extraída de `create-article` para `prearticle` poder reusar exatamente a
 * mesma lógica ao criar o rascunho automático: duplicar as ~30 linhas do laço
 * de retentativa era o jeito mais rápido de as duas cópias divergirem no dia
 * em que uma delas fosse corrigida e a outra, esquecida.
 *
 * O QUE FICA DE FORA DE PROPÓSITO: etiquetagem (`syncArticleTaxonomy`) e
 * reconhecimento de risco editorial são exclusivos de `create-article` (só ele
 * publica) — quem precisar deles grava por conta própria dentro de
 * `afterCreate`, que roda NA MESMA transação da criação da matéria.
 */
async function createArticleWithUniqueSlug(params: {
  topicId: string;
  baseSlug: string;
  buildData: (slug: string) => Prisma.ArticleUncheckedCreateInput;
  afterCreate: (tx: Tx, created: { id: string; slug: string }) => Promise<void>;
}): Promise<{ id: string; slug: string } | 'already-covered' | null> {
  const { topicId, baseSlug, buildData, afterCreate } = params;

  let outcome: { id: string; slug: string } | 'already-covered' | null = null;

  for (let attempt = 0; attempt < 5 && outcome === null; attempt += 1) {
    // Primeira tentativa com o slug limpo; as seguintes com sufixo curto —
    // mais amigável para o editor do que rejeitar e pedir outro título.
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      outcome = await prisma.$transaction(async (tx) => {
        // TRAVA CONTRA MATÉRIA DUPLICADA — quem garante é o banco, não a tela.
        // A fila esconde os botões de um tópico já coberto, mas isso só vale
        // para a aba que recarregou: com duas abas abertas (ou dois editores
        // no mesmo tópico), o segundo envio criava uma SEGUNDA matéria do
        // mesmo assunto, sem nenhum aviso.
        //
        // O `updateMany` com a condição no `where` resolve isso em uma
        // operação atômica: o segundo UPDATE espera o primeiro terminar e
        // então reavalia o filtro contra a linha já atualizada, encontrando
        // zero registros. Um `findUnique` seguido de `update` teria uma janela
        // entre ler e escrever — que é exatamente onde as duas requisições
        // simultâneas passavam.
        //
        // ESTA GARANTIA NÃO É DO POSTGRES — foi conferida também para o
        // MySQL/MariaDB na migração de banco, e vale nos dois:
        //
        //   1. NÍVEL DE ISOLAMENTO. O padrão do InnoDB é REPEATABLE READ, e não
        //      READ COMMITTED como no Postgres. Isso NÃO afeta este trecho:
        //      `UPDATE` é leitura CORRENTE (locking read), não leitura de
        //      snapshot. Ao destravar, o InnoDB relê a versão mais recente já
        //      comitada e reaplica o `WHERE` — exatamente o mesmo
        //      comportamento que o Postgres tem aqui.
        //
        //   2. GAP LOCKS. A preocupação legítima com REPEATABLE READ é que o
        //      InnoDB trava intervalos, e não só linhas — o que muda o perfil
        //      de deadlock. Também não se aplica aqui: o `where` casa a CHAVE
        //      PRIMÁRIA com um valor exato, e esse é justamente o caso
        //      documentado em que o InnoDB trava só o registro encontrado, sem
        //      o intervalo anterior.
        //
        // O que continua valendo, e é o que de fato acontece na disputa: o
        // segundo pedido recebe `count === 0` e devolve 'already-covered'.
        const claimed = await tx.topic.updateMany({
          where: { id: topicId, status: { not: 'published' } },
          data: { status: 'published' },
        });

        if (claimed.count === 0) return 'already-covered' as const;

        const created = await tx.article.create({ data: buildData(slug) });

        await afterCreate(tx, created);

        return { id: created.id, slug: created.slug };
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

  return outcome;
}

/**
 * Traduz a pré-matéria gerada pela IA para os três campos textuais que a
 * `Article` exige — respeitando os MESMOS limites de `server/article-input.ts`
 * (título 8–180, resumo 20–300, corpo mín. 40), para não gravar um rascunho
 * que a EDIÇÃO depois recusaria como inválido.
 *
 * Cada campo tem um FALLBACK para quando o gerador devolve algo curto demais
 * (acontece: o modelo às vezes resume o subtítulo demais). O fallback nunca é
 * texto inventado — é outro pedaço da MESMA geração, sempre mais completo. Só
 * quando nem o fallback alcança o mínimo é que a função devolve `null`: melhor
 * a pré-matéria virar "só para leitura" do que uma `Article` com título ou
 * corpo vazio.
 */
function draftFieldsFromPreArticle(
  dados: PreArticleOutput,
  topicTitle: string,
): { title: string; excerpt: string; content: string } | null {
  const title = boundedOrFallback(dados.pre_materia.titulo, topicTitle, 8, 180);
  if (!title) return null;

  const excerpt = boundedOrFallback(dados.pre_materia.subtitulo, dados.contextualizacao, 20, 300);
  if (!excerpt) return null;

  // Markdown simples: parágrafos separados por linha em branco. É o mesmo
  // formato que `content` sempre teve (ver ADR 0005) — o redator pode
  // converter para blocos ao editar, como em qualquer matéria escrita direto
  // no campo de texto.
  const content = [
    dados.pre_materia.abertura,
    dados.pre_materia.corpo.join('\n\n'),
    dados.pre_materia.fechamento_cta,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
    .trim()
    .slice(0, 20_000);

  if (content.length < 40) return null;

  return { title, excerpt, content };
}

/** `primary` se alcançar o mínimo; senão `fallback`. `null` se nem esse alcançar. */
function boundedOrFallback(primary: string, fallback: string, min: number, max: number): string | null {
  const candidate = primary.trim().length >= min ? primary.trim() : fallback.trim();
  return candidate.length >= min ? candidate.slice(0, max) : null;
}
