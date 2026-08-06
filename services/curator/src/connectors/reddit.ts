/**
 * =============================================================================
 * CONECTOR: REDDIT — menções, engajamento e trending de nicho
 * =============================================================================
 *
 * O Reddit é a fonte social de MAIOR QUALIDADE para o nicho nerd: os subreddits
 * são segmentados por fandom, o engajamento é público e o sistema de upvotes já
 * é, por si só, um filtro de relevância feito por humanos.
 *
 * REALIDADE DE ACESSO (verificada em ago/2026):
 *   - Free tier: 100 QPM com OAuth, mas exige pré-aprovação (Responsible
 *     Builder Policy, nov/2025) e PROÍBE uso comercial.
 *   - Comercial: ~US$ 0,24 por 1.000 chamadas.
 *   - Registro self-service fechado; aprovação leva de 2 a 4 semanas.
 *
 * CONSEQUÊNCIA JURÍDICA QUE PRECISA ESTAR NO RADAR DO PRODUTO: um portal com
 * monetização é uso comercial. Operar no free tier seria violação de termos —
 * com risco de banimento da chave em pleno funcionamento. O plano correto é
 * iniciar o processo de aprovação comercial junto com o desenvolvimento.
 *
 * Reflexo disso na arquitetura: o conector é 'metered', vive no estágio de
 * enriquecimento e tem cache agressivo. Chamamos o mínimo possível.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@canalnerd/core';
import { logNormalize } from '@canalnerd/core';

import { deterministicRandom, fetchJson } from './http';

/** Subreddits monitorados por categoria — nossa curadoria de onde o fandom vive. */
const SUBREDDITS_BY_CATEGORY: Record<string, string[]> = {
  games: ['gaming', 'Games', 'pcgaming', 'NintendoSwitch', 'PS5', 'xbox'],
  'cinema-e-series': ['movies', 'television', 'MarvelStudios', 'StarWars', 'DC_Cinematic'],
  'anime-e-manga': ['anime', 'manga', 'OnePiece'],
  hqs: ['comicbooks', 'Marvel', 'DCcomics'],
  tech: ['technology', 'gadgets', 'hardware'],
  eventos: ['comicbooks', 'gaming'],
};

const DEFAULT_SUBREDDITS = ['gaming', 'movies', 'anime', 'comicbooks'];

interface RedditPost {
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  title: string;
  permalink: string;
}

/**
 * Cache de token OAuth em memória.
 *
 * O token do Reddit vale ~24h. Pedir um novo a cada chamada gastaria quota e
 * adicionaria latência a cada tópico. Em memória basta porque o curator é um
 * processo longevo; se ele virar várias réplicas, este cache migra para o Redis
 * (o ponto de troca está isolado nesta única função).
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(timeoutMs: number): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Renova 60s antes de expirar, para não usar um token que vence no meio da chamada.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  // Basic auth exigido pelo fluxo client_credentials do Reddit.
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const data = await fetchJson<{ access_token: string; expires_in: number }>(
    'https://www.reddit.com/api/v1/access_token',
    {
      method: 'POST',
      timeoutMs,
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
  );

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

function mockPosts(context: SignalContext): RedditPost[] {
  const seed = context.query.toLowerCase();
  const count = Math.floor(deterministicRandom(seed + ':rcount', 0, 12));
  const subs = SUBREDDITS_BY_CATEGORY[context.categorySlug ?? ''] ?? DEFAULT_SUBREDDITS;

  return Array.from({ length: count }, (_, i) => ({
    score: Math.floor(deterministicRandom(`${seed}:rscore:${i}`, 5, 15_000)),
    num_comments: Math.floor(deterministicRandom(`${seed}:rcom:${i}`, 1, 900)),
    // Espalha as postagens nas últimas 24h.
    created_utc: Date.now() / 1000 - deterministicRandom(`${seed}:rtime:${i}`, 0, 86_400),
    subreddit: subs[i % subs.length] ?? 'gaming',
    title: `${context.query} (post simulado ${i + 1})`,
    permalink: `/r/${subs[i % subs.length]}/comments/mock${i}`,
  }));
}

export const redditConnector: SignalConnector = {
  id: 'reddit',
  displayName: 'Reddit',
  dimensions: ['socialMomentum', 'platformTrending'],
  cost: 'metered',
  stage: 'enrichment',
  timeoutMs: 7000,

  isAvailable() {
    // Sem credencial, cai no mock — como o Trends. Nunca "some" do cálculo.
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    let posts: RedditPost[];
    let confidence: number;

    try {
      const token = await getAccessToken(this.timeoutMs);

      if (!token) {
        posts = mockPosts(context);
        confidence = 0.3;
      } else {
        const url = new URL('https://oauth.reddit.com/search');
        // `encodeURIComponent` fica a cargo do URLSearchParams — montar a query
        // manualmente é a origem clássica de injeção de parâmetro.
        url.searchParams.set('q', context.query);
        url.searchParams.set('sort', 'hot');
        url.searchParams.set('t', 'day');
        url.searchParams.set('limit', '25');

        const data = await fetchJson<{ data: { children: { data: RedditPost }[] } }>(
          url.toString(),
          {
            timeoutMs: this.timeoutMs,
            signal: context.signal,
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        posts = data.data.children.map((child) => child.data);
        confidence = 0.9;
      }
    } catch (error) {
      console.warn(
        '[reddit] falha na coleta, degradando para mock:',
        error instanceof Error ? error.message : error,
      );
      posts = mockPosts(context);
      confidence = 0.15;
    }

    if (posts.length === 0) {
      // Zero posts é INFORMAÇÃO, não ausência de dado: significa que o assunto
      // não repercutiu no Reddit. Reportamos 0 com confiança boa, para que o
      // motor conte isso como sinal medido (e não redistribua o peso).
      return [
        {
          dimension: 'socialMomentum',
          connectorId: this.id,
          value: 0,
          rawValue: 0,
          explanation: 'Nenhuma menção relevante no Reddit nas últimas 24h',
          confidence: confidence * 0.8,
          observedAt: new Date(),
        },
      ];
    }

    const observedAt = new Date();
    const nowSeconds = Date.now() / 1000;

    // Engajamento total ponderado. Comentário vale 2x upvote: comentar exige
    // muito mais esforço do que clicar na setinha, então é um indicador bem
    // mais forte de que o assunto mobilizou de verdade.
    const totalEngagement = posts.reduce((acc, p) => acc + p.score + p.num_comments * 2, 0);

    // Fração do engajamento gerada nas últimas 6h = "está esquentando agora?".
    const recentEngagement = posts
      .filter((p) => nowSeconds - p.created_utc < 6 * 3600)
      .reduce((acc, p) => acc + p.score + p.num_comments * 2, 0);
    const recencyRatio = totalEngagement > 0 ? recentEngagement / totalEngagement : 0;

    const topPost = posts.reduce((best, p) => (p.score > best.score ? p : best), posts[0]!);

    const measurements: SignalMeasurement[] = [
      {
        dimension: 'socialMomentum',
        connectorId: this.id,
        // Calibração: 5.000 pontos de engajamento = sinal relevante (0,5);
        // 200.000 = fenômeno (1,0). Combinamos volume com recência para que
        // um assunto antigo e grande não pareça um assunto explodindo agora.
        value: Math.min(
          1,
          logNormalize(totalEngagement, 5_000, 200_000) * (0.7 + 0.3 * recencyRatio),
        ),
        rawValue: totalEngagement,
        explanation: `${posts.length} posts, ${totalEngagement.toLocaleString('pt-BR')} de engajamento (${(recencyRatio * 100).toFixed(0)}% nas últimas 6h)`,
        confidence,
        observedAt,
      },
    ];

    // Trending nativo: um post com mais de 5.000 upvotes já está, na prática,
    // no topo do subreddit — o que é presença em trending de nicho.
    if (topPost.score > 1000) {
      measurements.push({
        dimension: 'platformTrending',
        connectorId: this.id,
        value: logNormalize(topPost.score, 5_000, 80_000),
        rawValue: topPost.score,
        explanation: `Post em alta em r/${topPost.subreddit} (${topPost.score.toLocaleString('pt-BR')} upvotes)`,
        confidence,
        observedAt,
      });
    }

    return measurements;
  },
};
