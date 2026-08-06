import 'server-only';

/**
 * =============================================================================
 * MÉTRICAS DO PAINEL EDITORIAL
 * =============================================================================
 *
 * Reimplementa aqui (em vez de importar do curator) as consultas de KPI que o
 * painel precisa. Motivo: o pacote `@canalnerd/curator` é um SERVIÇO, não uma
 * biblioteca — importá-lo no app web traria junto conectores, agendador e
 * dependências de rede que não têm nada a ver com renderizar uma página.
 *
 * A fonte da verdade continua sendo a mesma tabela (`PipelineEvent`), então não
 * há divergência de dado: há apenas dois leitores do mesmo registro.
 */

import { buildAccuracyReport, type AccuracySample } from '@canalnerd/scoring';
import { prisma } from '@canalnerd/db';

/**
 * Percentual de QUENTES publicados dentro da meta de 30 minutos.
 * "Safe" no nome porque nunca lança: um painel que quebra por causa de um
 * widget de métrica é pior que um painel com um widget vazio.
 */
export async function getHotPublishRateSafe(daysBack = 30): Promise<{
  total: number;
  withinTarget: number;
  rate: number;
  avgMinutes: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 86_400_000);

    const events = await prisma.pipelineEvent.findMany({
      where: { eventType: 'topic.published', createdAt: { gte: since } },
      select: { payload: true, durationMs: true },
    });

    const valid = events.filter((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      return payload !== null && typeof payload.withinTarget === 'boolean';
    });

    if (valid.length === 0) {
      return { total: 0, withinTarget: 0, rate: 0, avgMinutes: 0 };
    }

    const withinTarget = valid.filter(
      (event) => (event.payload as Record<string, unknown>).withinTarget === true,
    ).length;

    const totalMinutes = valid.reduce((acc, e) => acc + (e.durationMs ?? 0) / 60_000, 0);

    return {
      total: valid.length,
      withinTarget,
      rate: withinTarget / valid.length,
      avgMinutes: Math.round((totalMinutes / valid.length) * 10) / 10,
    };
  } catch (error) {
    console.error('[admin-metrics] falha ao calcular taxa de publicação:', error);
    return { total: 0, withinTarget: 0, rate: 0, avgMinutes: 0 };
  }
}

/**
 * Relatório de PRECISÃO DO SCORE — o KPI que fecha o ciclo de aprendizado.
 *
 * Compara o `scoreAtPublish` (congelado na publicação) com os pageviews reais
 * das 24h seguintes. Só entram artigos que já completaram a janela E que têm os
 * dois valores; sem isso a correlação seria calculada sobre dados pela metade.
 */
export async function getAccuracyReportSafe(daysBack = 90) {
  try {
    const since = new Date(Date.now() - daysBack * 86_400_000);

    const articles = await prisma.article.findMany({
      where: {
        status: 'published',
        publishedAt: { gte: since },
        scoreAtPublish: { not: null },
        pageviews24h: { not: null },
      },
      select: {
        id: true,
        topicId: true,
        scoreAtPublish: true,
        pageviews24h: true,
        publishedAt: true,
        category: { select: { slug: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    });

    const samples: AccuracySample[] = articles
      .filter((a) => a.scoreAtPublish !== null && a.pageviews24h !== null && a.publishedAt !== null)
      .map((a) => ({
        topicId: a.topicId ?? '',
        articleId: a.id,
        predictedScore: a.scoreAtPublish!,
        actualPageviews24h: a.pageviews24h!,
        publishedAt: a.publishedAt!,
        weightsVersion: 'v1.0.0-mvp',
        categorySlug: a.category.slug,
      }));

    return buildAccuracyReport(samples, 'v1.0.0-mvp');
  } catch (error) {
    console.error('[admin-metrics] falha ao gerar relatório de precisão:', error);
    return null;
  }
}
