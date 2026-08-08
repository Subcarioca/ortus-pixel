/**
 * =============================================================================
 * CONECTOR: X (TWITTER) — o mais caro do conjunto
 * =============================================================================
 *
 * REALIDADE DE CUSTO (verificada em ago/2026):
 *   - Fev/2026: o X tornou pay-per-use o modelo padrão e ENCERROU o free tier
 *     para contas novas. O plano Basic de US$ 200/mês foi extinto.
 *   - Preço atual: ~US$ 0,005 por post lido, teto de 2 milhões de leituras/mês.
 *
 * MATEMÁTICA QUE DEFINIU O DESENHO DESTE CONECTOR:
 *   200 tópicos/ciclo x 100 posts x 24 ciclos/dia x 30 dias x US$ 0,005
 *   = US$ 72.000/mês. Inviável.
 *
 * Com o desenho adotado (só enriquecimento, só tópicos acima do limiar, com
 * orçamento rígido e cache):
 *   ~30 tópicos/dia x 50 posts x 30 dias x US$ 0,005 = US$ 225/mês. Viável.
 *
 * Ou seja: a diferença entre um produto e um prejuízo está em ONDE o conector
 * roda no pipeline — não na qualidade do código dele. É por isso que o campo
 * `stage` existe no contrato de conector.
 *
 * O guarda de orçamento abaixo é uma trava real, não um comentário de boa
 * intenção: ele impede que um bug de laço gere uma fatura de cinco dígitos.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@subcarioca/core';
import { logNormalize } from '@subcarioca/core';

import { deterministicRandom, fetchJson } from './http';

interface XPost {
  id: string;
  text: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  created_at: string;
}

/**
 * Controle de orçamento em memória.
 *
 * Em produção com múltiplas réplicas isso PRECISA migrar para o Redis (um
 * `INCR` com expiração mensal), senão cada réplica terá seu próprio contador e
 * o orçamento real será multiplicado pelo número de instâncias. Está isolado
 * aqui justamente para que a troca seja de poucas linhas.
 */
const budget = {
  postsRead: 0,
  periodStart: new Date(),
};

function getMonthlyBudget(): number {
  const configured = Number(process.env.X_MONTHLY_READ_BUDGET);
  // Padrão conservador: 20.000 leituras/mês = ~US$ 100. Um valor inválido na
  // env NUNCA deve virar "sem limite" — o padrão seguro é o limite baixo.
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000;
}

function resetBudgetIfNeeded(): void {
  const now = new Date();
  if (
    now.getMonth() !== budget.periodStart.getMonth() ||
    now.getFullYear() !== budget.periodStart.getFullYear()
  ) {
    budget.postsRead = 0;
    budget.periodStart = now;
  }
}

/** Quanto do orçamento já foi consumido, em [0,1]. Exposto ao painel de custos. */
export function getXBudgetUsage(): { used: number; limit: number; ratio: number } {
  resetBudgetIfNeeded();
  const limit = getMonthlyBudget();
  return { used: budget.postsRead, limit, ratio: budget.postsRead / limit };
}

const POSTS_PER_QUERY = 50;

export const xConnector: SignalConnector = {
  id: 'x-twitter',
  displayName: 'X (Twitter)',
  dimensions: ['socialMomentum', 'platformTrending'],
  cost: 'metered',
  stage: 'enrichment',
  timeoutMs: 7000,

  isAvailable() {
    resetBudgetIfNeeded();

    // TRAVA DE ORÇAMENTO: acima de 95% do limite mensal, o conector se desliga
    // sozinho. O motor redistribui o peso e o pipeline segue normalmente — a
    // degradação é preferível a uma fatura surpresa.
    const usage = getXBudgetUsage();
    if (usage.ratio >= 0.95) {
      console.warn(
        `[x-twitter] orçamento mensal em ${(usage.ratio * 100).toFixed(0)}% — conector desativado até a virada do mês.`,
      );
      return false;
    }

    // Sem token não simulamos: diferente do Trends e do Reddit, aqui o mock
    // seria enganoso. Como o X exige pagamento desde o primeiro request, "não
    // configurado" é o estado normal e permanente de quem não contratou — e o
    // sistema deve refletir isso, não fingir que tem o dado.
    return Boolean(process.env.X_BEARER_TOKEN);
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const observedAt = new Date();

    let posts: XPost[];
    let confidence: number;

    try {
      const url = new URL('https://api.twitter.com/2/tweets/search/recent');
      // `-is:retweet` reduz o custo de forma significativa: retweet não é
      // conteúdo novo e ainda assim seria cobrado como leitura.
      url.searchParams.set('query', `${context.query} -is:retweet lang:pt`);
      url.searchParams.set('max_results', String(POSTS_PER_QUERY));
      url.searchParams.set('tweet.fields', 'public_metrics,created_at');

      const data = await fetchJson<{ data?: XPost[]; meta?: { result_count: number } }>(
        url.toString(),
        {
          timeoutMs: this.timeoutMs,
          signal: context.signal,
          headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
          // Sem retry: cada tentativa CUSTA DINHEIRO. Melhor perder o sinal
          // deste ciclo do que pagar três vezes por uma falha provavelmente
          // persistente. É o oposto da política dos conectores gratuitos.
          maxRetries: 0,
        },
      );

      posts = data.data ?? [];
      // Contabiliza o consumo real, não o solicitado.
      budget.postsRead += data.meta?.result_count ?? posts.length;
      confidence = 0.9;
    } catch (error) {
      console.warn(
        '[x-twitter] falha na coleta:',
        error instanceof Error ? error.message : error,
      );
      // Falhou: devolvemos NADA. O motor trata como dimensão indisponível e
      // redistribui o peso — que é mais honesto do que inventar um número.
      return [];
    }

    if (posts.length === 0) {
      return [
        {
          dimension: 'socialMomentum',
          connectorId: this.id,
          value: 0,
          rawValue: 0,
          explanation: 'Sem menções recentes no X (pt-BR)',
          confidence: confidence * 0.8,
          observedAt,
        },
      ];
    }

    // Ponderação por tipo de interação, do mais barato ao mais custoso para o
    // usuário: curtir < responder < citar < retuitar. Retweet e citação são os
    // que efetivamente espalham o assunto, então valem mais.
    const engagement = posts.reduce((acc, post) => {
      const m = post.public_metrics;
      if (!m) return acc;
      return (
        acc + m.like_count + m.reply_count * 2 + m.quote_count * 3 + m.retweet_count * 3
      );
    }, 0);

    return [
      {
        dimension: 'socialMomentum',
        connectorId: this.id,
        value: logNormalize(engagement, 3_000, 150_000),
        rawValue: engagement,
        explanation: `${posts.length} posts no X, ${engagement.toLocaleString('pt-BR')} de engajamento ponderado`,
        confidence,
        observedAt,
      },
    ];
  },
};

/** Versão simulada, usada em desenvolvimento e testes do orquestrador. */
export const xConnectorMock: SignalConnector = {
  ...xConnector,
  id: 'x-twitter-mock',
  displayName: 'X (Twitter) [simulado]',
  cost: 'free',
  isAvailable: () => process.env.NODE_ENV !== 'production',
  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const seed = context.query.toLowerCase();
    return [
      {
        dimension: 'socialMomentum',
        connectorId: 'x-twitter-mock',
        value: deterministicRandom(seed + ':x', 0, 1),
        rawValue: 'simulado',
        explanation: 'Engajamento simulado no X (sem credencial configurada)',
        confidence: 0.25,
        observedAt: new Date(),
      },
    ];
  },
};
