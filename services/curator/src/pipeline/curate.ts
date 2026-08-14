/**
 * =============================================================================
 * CICLO DE CURADORIA — onde tudo se junta
 * =============================================================================
 *
 * Fluxo completo:
 *
 *   [1] DESCOBERTA        feeds RSS -> itens candidatos
 *   [2] DEDUPLICAÇÃO      5 veículos noticiando o mesmo fato -> 1 tópico
 *   [3] TRIAGEM (barata)  conectores 'discovery' -> score preliminar
 *   [4] CORTE             só quem passa do limiar segue para o estágio caro
 *   [5] ENRIQUECIMENTO    conectores 'enrichment' -> score final
 *   [6] AÇÕES             alerta / push / hero, conforme a faixa
 *   [7] INSTRUMENTAÇÃO    eventos internos para os KPIs editoriais
 *
 * A ETAPA [4] É O QUE TORNA O PRODUTO VIÁVEL FINANCEIRAMENTE.
 *
 * Sem ela, todo item descoberto acionaria as APIs pagas. Com ~800 itens/dia
 * vindos dos feeds e X cobrando por leitura, a conta passaria de US$ 70 mil/mês.
 * Com o corte, apenas ~5% dos candidatos chegam ao estágio caro, e a conta cai
 * para a casa das centenas de dólares.
 *
 * Repare que a decisão não está no código de nenhum conector: está na TOPOLOGIA
 * do pipeline. Foi por isso que `stage` virou parte do contrato de conector lá
 * em `core/signals.ts`.
 */

import {
  bandForScore,
  slugify,
  type EmotionalTrigger,
  type ScoreResult,
  type SignalContext,
} from '@subcarioca/core';
import { prisma, toStringArray } from '@subcarioca/db';
import { calculateScore, DEFAULT_WEIGHTS, isEligibleForAutomation } from '@subcarioca/scoring';

import { getAvailableConnectors } from '../connectors/registry';
import { detectTriggers } from '../connectors/emotional-triggers';
import { classifyDomain } from '../connectors/source-authority';
import { discoverFromFeeds, type DiscoveredItem } from '../discovery/rss-sources';
import { canonicalHash, findDuplicate } from './dedupe';
import { collectSignals } from './orchestrator';
import { onScoreCalculated } from '../actions/dispatcher';
import { logPipelineEvent } from '../actions/instrumentation';

/**
 * Limiar de triagem: score preliminar mínimo para gastar API paga.
 *
 * 35 é intencionalmente PERMISSIVO (abaixo da faixa RELEVANTE, que começa em
 * 40). O motivo é assimetria de custo: deixar passar um tópico morno custa
 * centavos; barrar um breaking news por engano custa a matéria — e o produto
 * inteiro existe para não perder breaking news. Na dúvida, enriquecemos.
 */
const ENRICHMENT_THRESHOLD = 35;

/** Teto de tópicos enriquecidos por ciclo. Trava dura contra estouro de custo. */
const MAX_ENRICHMENT_PER_CYCLE = 40;

export interface CurationCycleOptions {
  phase: 1 | 2 | 3;
  /** `true` = só descobre e pontua, sem gravar. Útil para depuração. */
  dryRun?: boolean;
  maxAgeHours?: number;
}

export interface CurationCycleResult {
  runId: string;
  discovered: number;
  deduplicated: number;
  screened: number;
  enriched: number;
  promotedToHot: number;
  failedConnectors: string[];
  durationMs: number;
}

/**
 * Executa um ciclo completo de curadoria.
 * Projetado para ser idempotente: rodar duas vezes seguidas não duplica tópicos
 * nem redispara alertas já enviados.
 */
export async function runCurationCycle(
  options: CurationCycleOptions,
): Promise<CurationCycleResult> {
  const startedAt = Date.now();
  const { phase, dryRun = false, maxAgeHours = 6 } = options;

  const run = await prisma.pipelineRun.create({
    data: { stage: 'full', status: 'running' },
  });

  const result: CurationCycleResult = {
    runId: run.id,
    discovered: 0,
    deduplicated: 0,
    screened: 0,
    enriched: 0,
    promotedToHot: 0,
    failedConnectors: [],
    durationMs: 0,
  };

  try {
    // -------------------------------------------------------------------------
    // [1] DESCOBERTA
    // -------------------------------------------------------------------------
    const { items, failedSources } = await discoverFromFeeds({ phase, maxAgeHours });
    result.discovered = items.length;
    console.log(`[curate] ${items.length} itens descobertos em feeds (fase ${phase}).`);

    // -------------------------------------------------------------------------
    // [2] DEDUPLICAÇÃO E PERSISTÊNCIA DOS CANDIDATOS
    // -------------------------------------------------------------------------
    // Carregamos a janela de comparação UMA vez, fora do laço. Consultar o banco
    // por item seria N+1 clássico: com 800 itens, 800 queries.
    const recentTopics = await prisma.topic.findMany({
      where: { firstSeenAt: { gte: new Date(Date.now() - 48 * 3_600_000) } },
      select: { id: true, title: true, category: { select: { slug: true } } },
      take: 500,
    });

    const dedupeWindow = recentTopics.map((t) => ({
      id: t.id,
      title: t.title,
      categorySlug: t.category?.slug ?? null,
    }));

    const topicIds: string[] = [];

    for (const item of items) {
      const topicId = await upsertTopicFromItem(item, dedupeWindow, dryRun);
      if (topicId) {
        topicIds.push(topicId);
        // Alimenta a janela para que duplicatas DENTRO do mesmo ciclo também
        // sejam detectadas (5 veículos no mesmo lote é o caso mais comum).
        dedupeWindow.push({
          id: topicId,
          title: item.title,
          categorySlug: item.source.categorySlug,
        });
      }
    }

    result.deduplicated = items.length - topicIds.length;
    console.log(`[curate] ${topicIds.length} tópicos únicos (${result.deduplicated} duplicatas).`);

    // -------------------------------------------------------------------------
    // [3] TRIAGEM BARATA
    // -------------------------------------------------------------------------
    const discoveryConnectors = await getAvailableConnectors('discovery');
    const enrichmentConnectors = await getAvailableConnectors('enrichment');

    console.log(
      `[curate] conectores ativos: ${discoveryConnectors.length} de triagem, ${enrichmentConnectors.length} de enriquecimento.`,
    );

    const screened: { topicId: string; preliminaryScore: number }[] = [];
    const allFailedConnectors = new Set<string>(failedSources);

    for (const topicId of topicIds) {
      const scoring = await scoreTopic(topicId, discoveryConnectors, dryRun);
      if (!scoring) continue;

      screened.push({ topicId, preliminaryScore: scoring.score });
      scoring.failedConnectors.forEach((c) => allFailedConnectors.add(c));
    }
    result.screened = screened.length;

    // -------------------------------------------------------------------------
    // [4] CORTE — a etapa que define a viabilidade econômica
    // -------------------------------------------------------------------------
    const toEnrich = screened
      .filter((s) => s.preliminaryScore >= ENRICHMENT_THRESHOLD)
      .sort((a, b) => b.preliminaryScore - a.preliminaryScore)
      .slice(0, MAX_ENRICHMENT_PER_CYCLE);

    console.log(
      `[curate] ${toEnrich.length}/${screened.length} tópicos passaram do limiar de ${ENRICHMENT_THRESHOLD} e serão enriquecidos.`,
    );

    // -------------------------------------------------------------------------
    // [5] ENRIQUECIMENTO + [6] AÇÕES
    // -------------------------------------------------------------------------
    for (const candidate of toEnrich) {
      const scoring = await scoreTopic(
        candidate.topicId,
        [...discoveryConnectors, ...enrichmentConnectors],
        dryRun,
      );
      if (!scoring) continue;

      result.enriched++;
      scoring.failedConnectors.forEach((c) => allFailedConnectors.add(c));

      if (scoring.band === 'HOT') result.promotedToHot++;
    }

    result.failedConnectors = [...allFailedConnectors];
    result.durationMs = Date.now() - startedAt;

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        topicsDiscovered: result.discovered,
        topicsScored: result.screened,
        topicsPromoted: result.promotedToHot,
        connectorsRun: discoveryConnectors.length + enrichmentConnectors.length,
        connectorsFailed: result.failedConnectors.length,
        finishedAt: new Date(),
        durationMs: result.durationMs,
      },
    });

    console.log(
      `[curate] ciclo concluído em ${(result.durationMs / 1000).toFixed(1)}s — ${result.promotedToHot} tópico(s) QUENTE(S).`,
    );

    return result;
  } catch (error) {
    // Falha do CICLO (não de um conector): registramos e propagamos. O
    // agendador decide se tenta de novo; não é papel desta função insistir.
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}

/**
 * Cria ou atualiza um tópico a partir de um item descoberto.
 * Retorna o id, ou `null` se foi descartado como duplicata.
 */
async function upsertTopicFromItem(
  item: DiscoveredItem,
  dedupeWindow: { id: string; title: string; categorySlug: string | null }[],
  dryRun: boolean,
): Promise<string | null> {
  const duplicate = findDuplicate(item.title, item.source.categorySlug, dedupeWindow);

  if (duplicate) {
    // Duplicata NÃO é lixo: é confirmação independente de que o assunto é real
    // e está repercutindo. Poderíamos usar a contagem de veículos como sinal
    // adicional (previsto para a Fase 3). Por ora, apenas registramos.
    if (!dryRun) {
      await logPipelineEvent({
        eventType: 'topic.duplicate_detected',
        topicId: duplicate.topicId,
        payload: {
          title: item.title,
          source: item.source.name,
          similarity: duplicate.similarity,
        },
      });
    }
    return null;
  }

  const hash = canonicalHash(item.title, item.source.categorySlug);
  if (dryRun) return null;

  const category = await prisma.category.findUnique({
    where: { slug: item.source.categorySlug },
    select: { id: true },
  });

  // A URL vem de fonte externa: classificamos o domínio em vez de confiar no
  // tier declarado pela fonte. Ver comentário de segurança em source-authority.
  const { tier } = classifyDomain(item.url);
  const effectiveTier = item.source.tier === 'official' ? 'official' : tier;

  const franchises = await matchFranchises(`${item.title} ${item.summary}`);

  const topic = await prisma.topic.upsert({
    where: { dedupeHash: hash },
    // Se o tópico já existe (mesmo hash), não sobrescrevemos título nem fonte:
    // a primeira versão registrada é a que chegou primeiro, e essa informação
    // de precedência tem valor editorial.
    update: {},
    create: {
      query: item.title.slice(0, 200),
      title: item.title,
      summary: item.summary,
      aliases: [],
      dedupeHash: hash,
      categoryId: category?.id ?? null,
      sourceUrl: item.url,
      sourceName: item.source.name,
      sourceTier: effectiveTier,
      firstSeenAt: item.publishedAt,
      status: 'new',
      franchises: {
        create: franchises.map((f) => ({ franchiseId: f.id })),
      },
    },
  });

  await logPipelineEvent({
    eventType: 'topic.discovered',
    topicId: topic.id,
    payload: { source: item.source.name, url: item.url, tier: effectiveTier },
  });

  return topic.id;
}

/**
 * Associa franquias ao texto por casamento de nome e apelidos.
 *
 * Simples de propósito. Um modelo de NER (reconhecimento de entidades) seria
 * mais preciso, mas as franquias do nosso catálogo têm nomes bastante
 * distintivos ("The Last of Us", "One Piece"), e o casamento por alias resolve
 * a maioria com custo zero e resultado auditável.
 */
async function matchFranchises(text: string): Promise<{ id: string; slug: string }[]> {
  const franchises = await prisma.franchise.findMany({
    select: { id: true, slug: true, name: true, aliases: true },
  });

  const lower = text.toLowerCase();

  return franchises
    .filter((franchise) => {
      // `toStringArray` porque `aliases` é coluna `Json` desde a migração para o
      // MySQL. Aqui a normalização não é só de tipo: um valor não-string caído
      // nesse array chegaria a `escapeRegex`/`new RegExp` mais abaixo e
      // derrubaria o ciclo inteiro de curadoria — num processo de fundo, onde
      // ninguém veria o erro até o score parar de atualizar.
      const terms = [franchise.name, ...toStringArray(franchise.aliases)];
      return terms.some((term) => {
        const normalized = term.toLowerCase();
        // Fronteira de palavra evita que "DC" case dentro de "DCEU" ou de
        // qualquer palavra que contenha as letras — falso positivo clássico
        // com siglas curtas.
        const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i');
        return pattern.test(lower);
      });
    })
    .map((f) => ({ id: f.id, slug: f.slug }));
}

/** Escapa metacaracteres antes de interpolar em RegExp (nome de franquia é dado externo). */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pontua um tópico com o conjunto de conectores informado.
 * Persiste o score, o histórico e as leituras brutas; dispara as ações da faixa.
 */
async function scoreTopic(
  topicId: string,
  connectors: Awaited<ReturnType<typeof getAvailableConnectors>>,
  dryRun: boolean,
): Promise<(ScoreResult & { failedConnectors: string[] }) | null> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: {
      category: { select: { slug: true } },
      franchises: { include: { franchise: { select: { slug: true } } } },
    },
  });

  if (!topic) return null;

  // O contexto é montado uma vez e compartilhado por todos os conectores.
  // Os campos extras (sourceUrl, analysisText) são lidos apenas pelos conectores
  // que os entendem, via interfaces estendidas — ver source-authority.ts.
  const context: Omit<SignalContext, 'signal'> & {
    sourceUrl: string | null;
    sourceTier: string | null;
    analysisText: string;
  } = {
    query: topic.query,
    // Coluna `Json` desde a migração para o MySQL. Este contexto é consumido
    // pelos conectores (youtube.ts, serp-competition.ts), que iteram os aliases
    // — normalizar aqui, na origem, evita repetir a checagem em cada um deles.
    aliases: toStringArray(topic.aliases),
    categorySlug: topic.category?.slug,
    franchiseSlugs: topic.franchises.map((f) => f.franchise.slug),
    firstSeenAt: topic.firstSeenAt,
    sourceUrl: topic.sourceUrl,
    sourceTier: topic.sourceTier,
    analysisText: `${topic.title} ${topic.summary}`,
  };

  const collection = await collectSignals(connectors, context);

  const triggers = detectTriggers(context.analysisText).map(
    (t) => t.trigger,
  ) as EmotionalTrigger[];

  const scoreResult = calculateScore({
    measurements: collection.measurements,
    firstSeenAt: topic.firstSeenAt,
    emotionalTriggers: triggers,
    weightSet: DEFAULT_WEIGHTS,
  });

  if (dryRun) {
    return { ...scoreResult, failedConnectors: collection.failedConnectors };
  }

  // --- Delta de 1h, para a seta "+38" do design ---
  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const previousSnapshot = await prisma.scoreSnapshot.findFirst({
    where: { topicId, calculatedAt: { lte: oneHourAgo }, isShadow: false },
    orderBy: { calculatedAt: 'desc' },
    select: { score: true },
  });
  const scoreDelta1h = previousSnapshot
    ? Math.round((scoreResult.score - previousSnapshot.score) * 10) / 10
    : 0;

  const previousBand = topic.currentBand;
  const becameHotNow = scoreResult.band === 'HOT' && previousBand !== 'HOT';

  // Persistimos tudo numa transação: score atual, histórico e leituras brutas
  // precisam ser consistentes entre si. Se gravássemos separadamente e o
  // processo caísse no meio, teríamos um tópico com score novo e histórico
  // velho — e a métrica de precisão passaria a mentir.
  await prisma.$transaction([
    prisma.topic.update({
      where: { id: topicId },
      data: {
        currentScore: scoreResult.score,
        currentBand: scoreResult.band,
        scoreDelta1h,
        seoOpportunity: scoreResult.seoOpportunity,
        confidence: scoreResult.confidence,
        termType: scoreResult.termType,
        emotionalTriggers: scoreResult.emotionalTriggers,
        requiresHumanReview: !isEligibleForAutomation(scoreResult).eligible,
        scoreSummary: scoreResult.summary,
        weightsVersion: scoreResult.weightsVersion,
        lastScoredAt: new Date(),
        // `becameHotAt` só é gravado UMA vez: é o T-zero do cronômetro de
        // time-to-publish. Sobrescrever a cada ciclo zeraria o KPI.
        ...(becameHotNow && !topic.becameHotAt ? { becameHotAt: new Date() } : {}),
      },
    }),

    prisma.scoreSnapshot.create({
      data: {
        topicId,
        score: scoreResult.score,
        band: scoreResult.band,
        seoOpportunity: scoreResult.seoOpportunity,
        confidence: scoreResult.confidence,
        // O `as unknown` é necessário porque o tipo Json do Prisma não aceita
        // diretamente nossa estrutura tipada. A conversão é segura: o objeto é
        // serializável por construção (só números, strings e arrays).
        contributions: scoreResult.contributions as unknown as object,
        weightsVersion: scoreResult.weightsVersion,
      },
    }),

    prisma.signalReading.createMany({
      data: collection.measurements.map((m) => ({
        topicId,
        connectorId: m.connectorId,
        dimension: m.dimension,
        value: m.value,
        rawValue: m.rawValue !== undefined ? String(m.rawValue) : null,
        confidence: m.confidence,
        explanation: m.explanation ?? null,
        observedAt: m.observedAt,
      })),
    }),
  ]);

  // --- [6] AÇÕES DA FAIXA ---
  await onScoreCalculated({
    topicId,
    topicTitle: topic.title,
    result: scoreResult,
    previousBand,
    becameHotNow,
    hasManualOverride: topic.manualScoreOverride !== null,
  });

  return { ...scoreResult, failedConnectors: collection.failedConnectors };
}

/**
 * RECÁLCULO DE CONTEÚDO JÁ PUBLICADO.
 *
 * Atende ao requisito: "permitir que uma notícia suba de posição na home
 * automaticamente se ganhar tração DEPOIS da publicação (ex.: um trailer que
 * viraliza 3h depois)".
 *
 * Roda com frequência maior que o ciclo de descoberta (a cada 5 min, contra
 * 15), porque é ele que mantém a home viva. E é bem mais barato: opera sobre
 * dezenas de artigos publicados, não sobre centenas de candidatos.
 */
export async function rescorePublished(options: { hoursBack?: number } = {}): Promise<number> {
  const { hoursBack = 48 } = options;

  const articles = await prisma.article.findMany({
    where: {
      status: 'published',
      publishedAt: { gte: new Date(Date.now() - hoursBack * 3_600_000) },
      topicId: { not: null },
    },
    select: { id: true, topicId: true, currentScore: true },
  });

  const connectors = await getAvailableConnectors('discovery');
  let updated = 0;

  for (const article of articles) {
    if (!article.topicId) continue;

    const scoring = await scoreTopic(article.topicId, connectors, false);
    if (!scoring) continue;

    const delta = scoring.score - article.currentScore;

    await prisma.article.update({
      where: { id: article.id },
      data: {
        currentScore: scoring.score,
        currentBand: scoring.band,
        scoreDelta1h: Math.round(delta * 10) / 10,
        scoreUpdatedAt: new Date(),
        // NOTA CRÍTICA: `scoreAtPublish` NÃO é tocado aqui. Ele é o "previsto"
        // do KPI de precisão e precisa permanecer congelado para sempre.
        // Atualizá-lo destruiria a capacidade de avaliar o algoritmo.
      },
    });

    // Variação relevante para cima: vale registrar, porque é o caso do
    // "trailer que viralizou depois" e alimenta o gráfico do painel.
    if (Math.abs(delta) >= 5) {
      await logPipelineEvent({
        eventType: 'article.score_changed',
        articleId: article.id,
        topicId: article.topicId,
        payload: { from: article.currentScore, to: scoring.score, delta },
      });
      updated++;
    }
  }

  return updated;
}
