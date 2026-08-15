/**
 * =============================================================================
 * INSTRUMENTAÇÃO INTERNA — os KPIs que o GA4 não sabe medir
 * =============================================================================
 *
 * O briefing é explícito sobre isso, e a razão merece ser entendida:
 *
 *   "os KPIs editoriais (precisão do score, time-to-publish) não vêm de
 *    analytics padrão — precisam de instrumentação própria no seu pipeline"
 *
 * O GA4 mede o LEITOR: sessões, origem, scroll, rejeição. Ele não tem como
 * saber que o score de um tópico cruzou 80 às 14h03 e que a matéria foi
 * publicada às 14h31 — esses fatos acontecem dentro do nosso pipeline e nunca
 * chegam ao navegador de ninguém.
 *
 * Este módulo é o registrador desses fatos. Ele responde a três perguntas que
 * nenhuma ferramenta de mercado responde:
 *   1. Quanto tempo levamos para publicar depois que algo esquentou?
 *   2. Que percentual dos QUENTES saiu dentro da meta de 30 minutos?
 *   3. O score previsto teve alguma relação com o tráfego real?
 *
 * PRINCÍPIO DE PROJETO: registrar evento NUNCA pode derrubar o pipeline.
 * Toda função aqui engole os próprios erros. Perder uma linha de métrica é
 * ruim; perder um breaking news porque o log falhou é inaceitável.
 */

import { prisma } from '@subcarioca/db';

export interface PipelineEventInput {
  eventType: string;
  topicId?: string;
  articleId?: string;
  connectorId?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  durationMs?: number;
}

/** Registra um evento. Falha silenciosa e observável (log no console). */
export async function logPipelineEvent(input: PipelineEventInput): Promise<void> {
  try {
    await prisma.pipelineEvent.create({
      data: {
        eventType: input.eventType,
        topicId: input.topicId ?? null,
        articleId: input.articleId ?? null,
        connectorId: input.connectorId ?? null,
        actorId: input.actorId ?? null,
        payload: (input.payload ?? {}) as object,
        durationMs: input.durationMs ?? null,
      },
    });
  } catch (error) {
    // Só loga. Ver princípio de projeto no topo do arquivo.
    console.error('[instrumentation] falha ao registrar evento:', error);
  }
}

/**
 * Registra VÁRIOS eventos de uma vez. Falha silenciosa, como a versão singular.
 *
 * POR QUE EXISTE, sendo que `logPipelineEvent` já resolve: há um caso — a
 * expiração de pautas (`pipeline/expire-topics.ts`) — em que a quantidade é
 * conhecidamente grande na PRIMEIRA execução (o passivo acumulado, centenas de
 * linhas). Chamar a versão singular num laço seria uma ida ao banco por evento,
 * ou seja, o N+1 clássico, dentro de um ciclo que já tem trabalho de verdade
 * para fazer. `createMany` é um `INSERT` só.
 *
 * NÃO é a versão "preferida": para 1 evento, use `logPipelineEvent` — a
 * assinatura é mais simples e a intenção fica mais legível na chamada.
 *
 * Lista vazia não vai ao banco: um `createMany` com zero linhas é uma viagem de
 * ida e volta para não fazer nada, e o caso é comum aqui (ciclo sem nenhuma
 * pauta vencida é o normal depois da primeira semana).
 */
export async function logPipelineEvents(inputs: PipelineEventInput[]): Promise<void> {
  if (inputs.length === 0) return;

  try {
    await prisma.pipelineEvent.createMany({
      data: inputs.map((input) => ({
        eventType: input.eventType,
        topicId: input.topicId ?? null,
        articleId: input.articleId ?? null,
        connectorId: input.connectorId ?? null,
        actorId: input.actorId ?? null,
        payload: (input.payload ?? {}) as object,
        durationMs: input.durationMs ?? null,
      })),
    });
  } catch (error) {
    // Só loga. Ver princípio de projeto no topo do arquivo.
    console.error('[instrumentation] falha ao registrar lote de eventos:', error);
  }
}

/**
 * KPI: TIME-TO-PUBLISH.
 *
 * Mede o intervalo entre "o score cruzou 80" (`becameHotAt`) e "a matéria foi
 * publicada". É o KPI operacional mais importante da redação, porque traduz
 * diretamente a promessa do produto: detectar cedo e publicar rápido.
 *
 * Chamado quando um artigo é publicado a partir de um tópico.
 */
export async function recordTimeToPublish(topicId: string, articleId: string): Promise<void> {
  try {
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      select: { becameHotAt: true, currentBand: true, claimedAt: true, title: true },
    });

    // Sem `becameHotAt`, o tópico nunca esteve na faixa QUENTE e a meta de 30
    // minutos não se aplica. Registrar mesmo assim poluiria o KPI com matérias
    // de fluxo normal, que não tinham prazo nenhum.
    if (!topic?.becameHotAt) return;

    const publishedAt = new Date();
    const timeToPublishMs = publishedAt.getTime() - topic.becameHotAt.getTime();
    const minutes = timeToPublishMs / 60_000;

    // A meta de 30 min vem da definição da faixa HOT.
    const withinTarget = minutes <= 30;

    await logPipelineEvent({
      eventType: 'topic.published',
      topicId,
      articleId,
      durationMs: timeToPublishMs,
      payload: {
        minutesToPublish: Math.round(minutes * 10) / 10,
        withinTarget,
        targetMinutes: 30,
        band: topic.currentBand,
        // Separar "tempo até alguém assumir" de "tempo escrevendo" é o que
        // permite descobrir ONDE está o gargalo: se o alerta demora a ser visto
        // ou se a redação demora a escrever. São problemas diferentes, com
        // soluções diferentes.
        minutesToClaim: topic.claimedAt
          ? Math.round(((topic.claimedAt.getTime() - topic.becameHotAt.getTime()) / 60_000) * 10) / 10
          : null,
      },
    });

    console.log(
      `[kpi] time-to-publish: ${minutes.toFixed(1)}min ${withinTarget ? '(dentro da meta)' : '(FORA da meta de 30min)'} — "${topic.title}"`,
    );
  } catch (error) {
    console.error('[instrumentation] falha ao medir time-to-publish:', error);
  }
}

/**
 * KPI: PRECISÃO DO SCORE.
 *
 * Congela os pageviews reais das primeiras 24h de um artigo, para comparar com
 * o `scoreAtPublish`. Executado por job agendado sobre artigos que completaram
 * a janela.
 *
 * A fonte dos pageviews é o GA4 (ou o coletor próprio). Aqui recebemos o número
 * já apurado, porque este módulo não deve saber de onde ele veio — trocar o
 * provedor de analytics não pode exigir mudança na lógica de KPI.
 */
export async function recordPageviews24h(articleId: string, pageviews: number): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { scoreAtPublish: true, pageviews24h: true, title: true, topicId: true },
    });

    if (!article) return;

    // Idempotência: uma vez congelado, não sobrescrevemos. A janela de 24h
    // fechou e o número é histórico.
    if (article.pageviews24h !== null) return;

    await prisma.article.update({
      where: { id: articleId },
      data: { pageviews24h: pageviews },
    });

    await logPipelineEvent({
      eventType: 'article.pageviews_recorded',
      articleId,
      topicId: article.topicId ?? undefined,
      payload: {
        predictedScore: article.scoreAtPublish,
        actualPageviews24h: pageviews,
      },
    });
  } catch (error) {
    console.error('[instrumentation] falha ao registrar pageviews:', error);
  }
}

/**
 * Calcula o percentual de QUENTES publicados dentro da meta de 30 minutos.
 * Consumido pelo painel editorial.
 */
export async function getHotPublishRate(
  daysBack = 30,
): Promise<{ total: number; withinTarget: number; rate: number; avgMinutes: number }> {
  const since = new Date(Date.now() - daysBack * 86_400_000);

  const events = await prisma.pipelineEvent.findMany({
    where: { eventType: 'topic.published', createdAt: { gte: since } },
    select: { payload: true, durationMs: true },
  });

  // Filtro defensivo: `payload` é Json e pode ter qualquer forma. Validamos
  // antes de confiar, porque um evento antigo com formato diferente não pode
  // quebrar o dashboard inteiro.
  const valid = events.filter((e) => {
    const payload = e.payload as Record<string, unknown> | null;
    return payload !== null && typeof payload.withinTarget === 'boolean';
  });

  if (valid.length === 0) {
    return { total: 0, withinTarget: 0, rate: 0, avgMinutes: 0 };
  }

  const withinTarget = valid.filter(
    (e) => (e.payload as Record<string, unknown>).withinTarget === true,
  ).length;

  const totalMinutes = valid.reduce((acc, e) => acc + (e.durationMs ?? 0) / 60_000, 0);

  return {
    total: valid.length,
    withinTarget,
    rate: withinTarget / valid.length,
    avgMinutes: Math.round((totalMinutes / valid.length) * 10) / 10,
  };
}
