import 'server-only';

/**
 * =============================================================================
 * LEITURA DE AUDIÊNCIA PARA O PAINEL — com a regra de "só o que é meu" embutida
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO QUE ORGANIZA ESTE ARQUIVO: O RECORTE VEM ANTES DA AGREGAÇÃO
 * -----------------------------------------------------------------------------
 * A tela poderia agregar tudo e filtrar o resultado. Seria mais simples e
 * estaria errado por dois motivos, na ordem de gravidade:
 *
 *   1. VAZAMENTO. O total agregado do site — mesmo que a tela mostrasse só as
 *      linhas do redator — chegaria ao navegador dele dentro do payload da
 *      página. Uma subtração entregaria o desempenho dos colegas. É o mesmo
 *      raciocínio que já governa a listagem de matérias: "o que ele não pode
 *      ver, ele não recebe".
 *   2. CUSTO. Agregar o site inteiro para descartar 95% é trabalho de banco
 *      jogado fora a cada abertura de tela.
 *
 * Por isso a função pede o `viewer` e resolve o conjunto de matérias PRIMEIRO.
 * Não existe caminho neste módulo que agregue sem passar por esse recorte — a
 * proteção está na forma da função, não na disciplina de quem a chama.
 *
 * -----------------------------------------------------------------------------
 * POR QUE `groupBy` E NÃO QUATRO CONSULTAS COM `count`
 * -----------------------------------------------------------------------------
 * Uma consulta por tipo de evento seria quatro varreduras do mesmo intervalo do
 * mesmo índice. O `groupBy` por `[articleId, kind]` faz uma passada só e devolve
 * a matriz inteira — e o índice `[articleId, kind, createdAt]` do schema foi
 * desenhado exatamente para esta consulta, nesta ordem.
 *
 * ⚠ LIMITE CONHECIDO E ACEITO: com a tabela muito grande, nem o melhor índice
 * salva um `GROUP BY` sobre milhões de linhas. O caminho já está escrito no
 * comentário do model `AnalyticsEvent` (agregação diária + poda dos 90 dias), e
 * o dia de executá-lo será visível: a tela do painel começa a demorar. Fixar a
 * janela em 30 dias é o que faz esse dia demorar a chegar.
 */

import { ANALYTICS_WINDOW_DAYS, can, type AnalyticsEventKind } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import type { StaffUser } from './staff-auth';

export interface ArticleAudienceRow {
  articleId: string;
  title: string;
  slug: string;
  categorySlug: string;
  authorName: string;
  status: string;
  publishedAt: Date | null;
  /** Total histórico (sobrevive à poda dos eventos). */
  lifetimeViews: number;
  /** Contagens DENTRO da janela. */
  views: number;
  outboundArticleClicks: number;
  adClicks: number;
  affiliateClicks: number;
}

export interface AudienceReport {
  windowDays: number;
  rows: ArticleAudienceRow[];
  /**
   * Totais do SITE INTEIRO — presente APENAS para quem tem
   * `verAnalyticsDoSite`. É `null`, e não zero, para o resto: zero seria um
   * número, e número errado numa tela é pior do que ausência declarada.
   */
  siteTotals: Record<AnalyticsEventKind, number> | null;
}

/**
 * Relatório de audiência com o recorte da conta que está olhando.
 *
 * `viewer` é obrigatório e é o primeiro parâmetro de propósito: não existe
 * "relatório sem dono" neste módulo.
 */
export async function getAudienceReport(
  viewer: StaffUser,
  options: { limit?: number } = {},
): Promise<AudienceReport> {
  const limit = options.limit ?? 50;
  const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 3_600_000);

  /**
   * O RECORTE, em UMA pergunta: esta conta enxerga além do que ela assina?
   *
   * `verAnalyticsDoSite` é a capacidade certa (e não `verMaterias`, que só diz
   * "a tela existe para você"). Ela governa as DUAS coisas de uma vez — quais
   * linhas entram e se o total do site é calculado — e isso não é economia de
   * código: se fossem duas checagens independentes, existiria um estado em que
   * alguém vê só as próprias matérias E o total do site, que é justamente a
   * combinação que permite deduzir o desempenho dos colegas por subtração.
   */
  const vePorTodaARedacao = can(viewer.accessLevel, 'verAnalyticsDoSite');

  const articles = await prisma.article.findMany({
    where: {
      status: { in: ['published', 'draft', 'in-review'] },
      ...(vePorTodaARedacao ? {} : { authorId: viewer.id }),
    },
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      publishedAt: true,
      viewCount: true,
      author: { select: { name: true } },
      category: { select: { slug: true } },
    },
  });

  if (articles.length === 0) {
    return {
      windowDays: ANALYTICS_WINDOW_DAYS,
      rows: [],
      siteTotals: vePorTodaARedacao ? await siteTotals(since) : null,
    };
  }

  const articleIds = articles.map((article) => article.id);

  /**
   * UMA passada, agrupando por matéria E tipo.
   *
   * O `IN (...)` sobre os ids já recortados é o que garante, no nível do SQL,
   * que nenhum evento de matéria alheia entre na conta — nem por engano, nem
   * por um filtro esquecido depois.
   */
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ['articleId', 'kind'],
    where: {
      articleId: { in: articleIds },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });

  // Índice em memória: `articleId` → tipo → contagem. Sobre no máximo
  // `limit × 4` linhas, então é barato e evita um `find` aninhado por matéria.
  const counts = new Map<string, Map<string, number>>();
  for (const row of grouped) {
    if (!row.articleId) continue;
    const byKind = counts.get(row.articleId) ?? new Map<string, number>();
    byKind.set(row.kind, row._count._all);
    counts.set(row.articleId, byKind);
  }

  const rows: ArticleAudienceRow[] = articles.map((article) => {
    const byKind = counts.get(article.id);
    return {
      articleId: article.id,
      title: article.title,
      slug: article.slug,
      categorySlug: article.category.slug,
      authorName: article.author.name,
      status: article.status,
      publishedAt: article.publishedAt,
      lifetimeViews: article.viewCount,
      views: byKind?.get('article.view') ?? 0,
      outboundArticleClicks: byKind?.get('article.link') ?? 0,
      adClicks: byKind?.get('ad.click') ?? 0,
      affiliateClicks: byKind?.get('affiliate.click') ?? 0,
    };
  });

  /**
   * A ORDENAÇÃO É POR VISUALIZAÇÃO NA JANELA, e não por data.
   *
   * A pergunta desta tela é "o que está funcionando?", não "o que saiu por
   * último" — essa já é respondida pela tela de matérias. Ordenar por data aqui
   * faria a matéria de ontem, ainda com zero, empurrar para baixo a que está
   * bombando há uma semana.
   */
  rows.sort((a, b) => b.views - a.views);

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    rows,
    siteTotals: vePorTodaARedacao ? await siteTotals(since) : null,
  };
}

/**
 * Totais do site inteiro, por tipo de evento.
 *
 * PRIVADO, e chamado só depois de `vePorTodaARedacao` ser verdadeiro. Não é
 * exportado justamente para que nenhuma tela futura consiga pedir "só os totais"
 * sem passar pela verificação — a função inacessível é a melhor documentação de
 * que ela não é para uso geral.
 */
async function siteTotals(since: Date): Promise<Record<AnalyticsEventKind, number>> {
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ['kind'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });

  const totals: Record<AnalyticsEventKind, number> = {
    'article.view': 0,
    'article.link': 0,
    'ad.click': 0,
    'affiliate.click': 0,
  };

  for (const row of grouped) {
    if (row.kind in totals) {
      totals[row.kind as AnalyticsEventKind] = row._count._all;
    }
  }

  return totals;
}
