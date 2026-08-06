/**
 * =============================================================================
 * CONECTOR: YOUTUBE — trailers, reactions e o Trending nativo
 * =============================================================================
 *
 * O YouTube é, hoje, o conector de MELHOR CUSTO-BENEFÍCIO do conjunto:
 *   - Quota gratuita de 10.000 unidades/dia.
 *   - `search.list` custa 100 unidades (caro: só 100 buscas/dia).
 *   - `videos.list` custa 1 unidade (barato).
 *
 * É a razão de ele ser o ÚNICO conector externo no estágio de descoberta: com
 * uma única chamada de 1 unidade trazemos os 50 vídeos em alta do Brasil e
 * casamos os títulos localmente contra todos os nossos candidatos. Custo O(1)
 * por ciclo em vez de O(n) por tópico.
 *
 * Além disso, é a fonte mais relevante para trailers — que são justamente o
 * tipo de conteúdo que viraliza depois de publicado e faz o score subir a
 * posteriori, cenário citado no briefing.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@canalnerd/core';
import { logNormalize } from '@canalnerd/core';

import { deterministicRandom, fetchJson } from './http';

interface YouTubeVideo {
  id: string;
  snippet: { title: string; channelTitle: string; publishedAt: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

/**
 * Cache do Trending do Brasil, compartilhado por todos os tópicos do ciclo.
 *
 * Esta é a otimização que torna o conector viável: sem ela, 200 tópicos =
 * 200 chamadas. Com ela, 1 chamada a cada 15 minutos serve o ciclo inteiro.
 * O trending do YouTube muda devagar; 15 min é conservador e ainda assim
 * reduz o consumo em duas ordens de grandeza.
 */
let trendingCache: { videos: YouTubeVideo[]; fetchedAt: number } | null = null;
const TRENDING_TTL_MS = 15 * 60 * 1000;

async function getTrendingVideos(timeoutMs: number): Promise<YouTubeVideo[]> {
  if (trendingCache && Date.now() - trendingCache.fetchedAt < TRENDING_TTL_MS) {
    return trendingCache.videos;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,statistics');
  url.searchParams.set('chart', 'mostPopular');
  url.searchParams.set('regionCode', 'BR');
  // Categoria 20 = Gaming; 24 = Entertainment. Buscamos a geral e filtramos
  // por relevância no nosso lado, o que evita duas chamadas.
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('key', apiKey);

  const data = await fetchJson<{ items: YouTubeVideo[] }>(url.toString(), { timeoutMs });

  trendingCache = { videos: data.items ?? [], fetchedAt: Date.now() };
  return trendingCache.videos;
}

/**
 * Casamento entre o termo do tópico e o título do vídeo.
 *
 * Heurística simples de propósito: exigimos que uma fração significativa das
 * palavras relevantes do termo apareça no título. Fuzzy matching mais elaborado
 * (Levenshtein, embeddings) traria falso positivo — e um falso positivo aqui
 * significa creditar a um tópico o pico de um vídeo que não tem nada a ver,
 * inflando o score e mandando a redação correr atrás de fantasma.
 */
function titleMatches(video: YouTubeVideo, terms: string[]): boolean {
  const title = video.snippet.title.toLowerCase();
  return terms.some((term) => {
    const words = term
      .toLowerCase()
      .split(/\s+/)
      // Ignora palavras curtas ("de", "o", "vi"), que casariam com qualquer coisa.
      .filter((w) => w.length > 3);
    if (words.length === 0) return false;
    const matched = words.filter((w) => title.includes(w)).length;
    // Pelo menos 60% das palavras significativas presentes.
    return matched / words.length >= 0.6;
  });
}

export const youtubeConnector: SignalConnector = {
  id: 'youtube',
  displayName: 'YouTube',
  dimensions: ['socialMomentum', 'platformTrending'],
  cost: 'quota',
  // Único externo na descoberta, graças ao cache compartilhado (ver topo).
  stage: 'discovery',
  timeoutMs: 6000,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const observedAt = new Date();
    const terms = [context.query, ...context.aliases];

    let trending: YouTubeVideo[] = [];
    let confidence = 0.85;

    try {
      trending = await getTrendingVideos(this.timeoutMs);
      if (trending.length === 0) {
        // Sem chave configurada: modo sintético.
        return mockMeasurements(context, this.id, observedAt);
      }
    } catch (error) {
      console.warn(
        '[youtube] falha ao buscar trending, degradando:',
        error instanceof Error ? error.message : error,
      );
      return mockMeasurements(context, this.id, observedAt, 0.15);
    }

    const matches = trending.filter((v) => titleMatches(v, terms));
    if (matches.length === 0) {
      return [
        {
          dimension: 'platformTrending',
          connectorId: this.id,
          value: 0,
          rawValue: 0,
          explanation: 'Fora do YouTube Trending BR',
          confidence: confidence * 0.9,
          observedAt,
        },
      ];
    }

    const totalViews = matches.reduce(
      (acc, v) => acc + Number(v.statistics?.viewCount ?? 0),
      0,
    );
    // Posição no trending: quanto mais alto, mais forte o sinal.
    const bestPosition = trending.findIndex((v) => matches.includes(v)) + 1;

    return [
      {
        dimension: 'platformTrending',
        connectorId: this.id,
        // Posição 1 = 1.0; posição 50 = ~0.02. Linear invertido é suficiente
        // porque a própria lista já é um ranking de relevância.
        value: Math.max(0, 1 - (bestPosition - 1) / 50),
        rawValue: bestPosition,
        explanation: `#${bestPosition} no YouTube Trending BR (${matches.length} vídeo(s) relacionados)`,
        confidence,
        observedAt,
      },
      {
        dimension: 'socialMomentum',
        connectorId: this.id,
        // 500 mil views = relevante; 20 milhões = fenômeno nacional.
        value: logNormalize(totalViews, 500_000, 20_000_000),
        rawValue: totalViews,
        explanation: `${totalViews.toLocaleString('pt-BR')} views somadas em vídeos relacionados`,
        confidence,
        observedAt,
      },
    ];
  },
};

function mockMeasurements(
  context: SignalContext,
  connectorId: string,
  observedAt: Date,
  confidenceOverride?: number,
): SignalMeasurement[] {
  const seed = context.query.toLowerCase();
  // Só ~20% dos tópicos entram no trending — refletindo a raridade real.
  const isTrending = deterministicRandom(seed + ':yt') > 0.8;
  const views = deterministicRandom(seed + ':ytviews', 10_000, 8_000_000);

  return [
    {
      dimension: 'platformTrending',
      connectorId,
      value: isTrending ? deterministicRandom(seed + ':ytpos', 0.5, 1) : 0,
      rawValue: isTrending ? 'trending (simulado)' : 'fora do trending (simulado)',
      explanation: isTrending ? 'No YouTube Trending BR (dado simulado)' : 'Fora do trending (simulado)',
      confidence: confidenceOverride ?? 0.3,
      observedAt,
    },
    {
      dimension: 'socialMomentum',
      connectorId,
      value: logNormalize(views, 500_000, 20_000_000),
      rawValue: Math.round(views),
      explanation: `~${Math.round(views).toLocaleString('pt-BR')} views (simulado)`,
      confidence: confidenceOverride ?? 0.3,
      observedAt,
    },
  ];
}
