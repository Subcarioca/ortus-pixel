/**
 * =============================================================================
 * GET /api/trending — ranking ao vivo por score (API pública)
 * =============================================================================
 *
 * Requisito do briefing: "Página/API de Trending que exponha o ranking ao vivo
 * por score".
 *
 * Consumidores previstos: widgets em páginas do próprio site, o app (futuro),
 * parceiros e a própria redação.
 *
 * DECISÃO — o que NÃO expomos aqui:
 *   - o SCORE NUMÉRICO de 0 a 100 (ver ADR 0009);
 *   - a decomposição do score por dimensão;
 *   - os pesos do algoritmo;
 *   - a confiança e os sinais brutos.
 *
 * O número saiu desta resposta junto com a interface pública, e não por
 * simetria estética: esconder o score nas páginas e mantê-lo num endpoint
 * público com CORS liberado seria teatro de segurança. Quem quisesse a série
 * histórica bastaria dar um `curl` a cada 10 minutos — que é exatamente o modo
 * mais barato de reconstruir a nossa calibração.
 *
 * O que a API continua entregando é o que tem valor para um consumidor
 * legítimo (widget, app, parceiro): a ORDEM e a FAIXA. Elas respondem "o que
 * está bombando agora?" sem entregar a régua.
 *
 * A API interna e o painel autenticado continuam com o número — lá ele é
 * ferramenta de trabalho da redação.
 */

import { NextResponse } from 'next/server';

import { isCategorySlug } from '@subcarioca/core';

import { getTrendingRanking } from '@/server/queries';
import { checkRateLimit, getClientIp } from '@/server/security';

// A rota lê de uma função já cacheada; o cabeçalho de cache abaixo cuida da CDN.
export const revalidate = 60;

export async function GET(request: Request) {
  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`api-trending:${ip}`, {
    maxRequests: 60,
    windowSeconds: 60,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Limite de requisições excedido.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  const url = new URL(request.url);

  // Filtro opcional por categoria, validado contra a lista fechada.
  const categoryParam = url.searchParams.get('categoria');
  const category = isCategorySlug(categoryParam) ? categoryParam : null;

  // `limit` numérico com teto: sem o teto, `?limit=999999` vira um jeito fácil
  // de forçar uma resposta gigante e consumir banda e CPU.
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 20;

  const { ranking, stats } = await getTrendingRanking();

  const filtered = (category ? ranking.filter((i) => i.category.slug === category) : ranking).slice(
    0,
    limit,
  );

  const body = {
    ok: true,
    updatedAt: stats.lastUpdatedAt?.toISOString() ?? null,
    stats: {
      hot: stats.hotCount,
      rising: stats.risingCount,
      publishedToday: stats.todayCount,
    },
    items: filtered.map((item, index) => ({
      // `rank` substitui `score` como sinal de intensidade. Para o consumidor
      // legítimo (montar uma lista), a posição é suficiente; para quem quer
      // reconstruir o algoritmo, ela é muito menos informativa.
      rank: index + 1,
      title: item.title,
      url: item.url,
      heat: item.heat,
      category: item.category,
      franchises: item.franchises,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      readingTimeMin: item.readingTimeMin,
    })),
  };

  return NextResponse.json(body, {
    headers: {
      // `s-maxage` instrui a CDN a guardar por 60s; `stale-while-revalidate`
      // permite servir a versão levemente antiga enquanto revalida em segundo
      // plano. É o que garante latência baixa mesmo no pico de tráfego.
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      // API pública de leitura: liberada para uso em widgets de terceiros.
      'Access-Control-Allow-Origin': '*',
    },
  });
}
