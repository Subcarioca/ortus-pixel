/**
 * =============================================================================
 * CONECTOR: GOOGLE TRENDS — volume e VELOCIDADE de busca
 * =============================================================================
 *
 * Este é o conector mais importante do sistema: alimenta `searchVelocity`, a
 * dimensão de maior peso (0.26), que é o "breakout signal".
 *
 * REALIDADE DE ACESSO (verificada em ago/2026): a API oficial do Google Trends
 * foi anunciada em jul/2025 e SEGUE EM ALPHA POR CONVITE. A maior parte dos
 * desenvolvedores não consegue acesso. Ignorar isso e escrever o conector só
 * contra a API oficial produziria um sistema que não roda no mundo real.
 *
 * Por isso o conector suporta três estratégias intercambiáveis:
 *   1. 'official' — API oficial (se/quando o acesso sair).
 *   2. 'serpapi'  — intermediário pago (SerpApi/DataForSEO), estável e legal.
 *   3. 'mock'     — dados sintéticos determinísticos (padrão em desenvolvimento).
 *
 * A troca é por variável de ambiente e não altera uma linha do resto do sistema:
 * a estratégia é um detalhe interno; o contrato de saída é sempre o mesmo.
 * Este é o padrão Strategy aplicado onde ele realmente se paga.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@subcarioca/core';
import { logNormalize, normalizeGrowth } from '@subcarioca/core';

import { deterministicRandom, fetchJson } from './http';

/** Série temporal normalizada, independente da estratégia usada. */
interface TrendsSeries {
  /** Pontos horários das últimas 24h+ (índice 0 = mais antigo). */
  points: { timestamp: Date; value: number }[];
  /** Volume médio mensal estimado do termo, quando a fonte fornecer. */
  monthlySearchVolume: number | null;
  /** Confiança da estratégia usada (mock vale menos que dado real). */
  confidence: number;
}

type TrendsProvider = 'official' | 'serpapi' | 'mock';

function resolveProvider(): TrendsProvider {
  const configured = process.env.TRENDS_PROVIDER?.toLowerCase();
  if (configured === 'official' && process.env.GOOGLE_TRENDS_API_KEY) return 'official';
  if (configured === 'serpapi' && process.env.SERPAPI_API_KEY) return 'serpapi';
  // Fallback silencioso para mock: preferimos rodar com dado sintético (e
  // confiança baixa, que o motor de score leva em conta) a derrubar o pipeline.
  return 'mock';
}

async function fetchOfficial(context: SignalContext, timeoutMs: number): Promise<TrendsSeries> {
  // Contrato conforme a documentação do alpha. Mantido isolado para que, quando
  // o formato mudar (alpha muda), só esta função precise de ajuste.
  const url = new URL('https://trends.googleapis.com/v1alpha/trends:fetchTimeSeries');
  url.searchParams.set('terms', context.query);
  url.searchParams.set('geo', 'BR');
  url.searchParams.set('resolution', 'HOUR');

  const data = await fetchJson<{
    timelineData?: { time: string; value: number[] }[];
  }>(url.toString(), {
    timeoutMs,
    signal: context.signal,
    headers: { 'X-Goog-Api-Key': process.env.GOOGLE_TRENDS_API_KEY ?? '' },
  });

  const points = (data.timelineData ?? []).map((point) => ({
    timestamp: new Date(Number(point.time) * 1000),
    value: point.value[0] ?? 0,
  }));

  return { points, monthlySearchVolume: null, confidence: 0.95 };
}

async function fetchSerpApi(context: SignalContext, timeoutMs: number): Promise<TrendsSeries> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_trends');
  url.searchParams.set('q', context.query);
  url.searchParams.set('geo', 'BR');
  url.searchParams.set('date', 'now 1-d');
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY ?? '');

  const data = await fetchJson<{
    interest_over_time?: { timeline_data?: { timestamp: string; values: { value: number }[] }[] };
  }>(url.toString(), { timeoutMs, signal: context.signal });

  const points = (data.interest_over_time?.timeline_data ?? []).map((point) => ({
    timestamp: new Date(Number(point.timestamp) * 1000),
    value: point.values[0]?.value ?? 0,
  }));

  return { points, monthlySearchVolume: null, confidence: 0.85 };
}

/**
 * Estratégia de desenvolvimento: série sintética plausível.
 *
 * Não é um `return 0.5` disfarçado. A série gerada tem FORMATO realista —
 * uma linha de base estável com um pico recente — porque é justamente esse
 * formato que exercita o cálculo de velocidade. Um mock plano faria os testes
 * de breakout passarem sem nunca testar nada.
 */
function fetchMock(context: SignalContext): TrendsSeries {
  const seed = context.query.toLowerCase();
  const baseline = deterministicRandom(seed + ':base', 10, 60);
  // ~30% dos termos recebem um pico, imitando a proporção real de breakouts.
  const hasSpike = deterministicRandom(seed + ':spike') > 0.7;
  const spikeMagnitude = hasSpike ? deterministicRandom(seed + ':mag', 2.5, 8) : 1;

  const now = Date.now();
  const points = Array.from({ length: 24 }, (_, i) => {
    const hoursAgo = 23 - i;
    const noise = deterministicRandom(`${seed}:${i}`, 0.85, 1.15);
    // O pico só afeta as últimas 3 horas.
    const spikeFactor = hoursAgo <= 3 ? spikeMagnitude : 1;
    return {
      timestamp: new Date(now - hoursAgo * 3_600_000),
      value: Math.round(baseline * noise * spikeFactor),
    };
  });

  return {
    points,
    monthlySearchVolume: Math.round(deterministicRandom(seed + ':vol', 500, 400_000)),
    // Confiança baixa DE PROPÓSITO: sinaliza ao motor que este dado é sintético.
    // Assim, em desenvolvimento, nada atinge confiança suficiente para automação
    // real — é uma trava contra "mock virou produção sem ninguém perceber".
    confidence: 0.35,
  };
}

/**
 * Calcula a variação percentual entre a média das últimas `windowHours` horas
 * e a média do período anterior de mesmo tamanho.
 *
 * Esta é a matemática do "breakout". A comparação com o período imediatamente
 * anterior (e não com uma média longa) é o que permite detectar aceleração em
 * minutos — que é a vantagem competitiva do produto.
 */
function growthRate(points: { timestamp: Date; value: number }[], windowHours: number): number {
  if (points.length < windowHours * 2) return 0;

  const recent = points.slice(-windowHours);
  const previous = points.slice(-windowHours * 2, -windowHours);

  const avg = (arr: { value: number }[]) =>
    arr.length > 0 ? arr.reduce((a, p) => a + p.value, 0) / arr.length : 0;

  const recentAvg = avg(recent);
  const previousAvg = avg(previous);

  // Base zero: qualquer valor é crescimento infinito, o que não é informação
  // útil. Devolvemos um crescimento alto porém limitado, para não deixar ruído
  // de baixíssimo volume dominar o score.
  if (previousAvg === 0) return recentAvg > 0 ? 300 : 0;

  return ((recentAvg - previousAvg) / previousAvg) * 100;
}

export const googleTrendsConnector: SignalConnector = {
  id: 'google-trends',
  displayName: 'Google Trends',
  dimensions: ['searchVolume', 'searchVelocity'],
  // 'metered' porque as estratégias viáveis hoje (SerpApi/DataForSEO) são pagas.
  cost: 'metered',
  stage: 'enrichment',
  timeoutMs: 8000,

  isAvailable() {
    // Sempre disponível: no pior caso cai no mock. O que muda é a CONFIANÇA,
    // não a disponibilidade. Essa distinção é o que mantém o pipeline vivo.
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const provider = resolveProvider();

    let series: TrendsSeries;
    try {
      if (provider === 'official') series = await fetchOfficial(context, this.timeoutMs);
      else if (provider === 'serpapi') series = await fetchSerpApi(context, this.timeoutMs);
      else series = fetchMock(context);
    } catch (error) {
      // Degradação em camadas: se o provedor real falhar, ainda entregamos o
      // sinal sintético com confiança baixíssima. O tópico continua pontuando
      // (com o peso redistribuído pelo motor), em vez de simplesmente sumir.
      console.warn(
        `[google-trends] provedor "${provider}" falhou, usando mock degradado:`,
        error instanceof Error ? error.message : error,
      );
      series = { ...fetchMock(context), confidence: 0.15 };
    }

    if (series.points.length === 0) return [];

    const observedAt = new Date();
    const measurements: SignalMeasurement[] = [];

    // --- VELOCIDADE (dimensão de maior peso) ---
    //
    // Combinamos três janelas em vez de usar só uma:
    //   1h  → detecção mais precoce, porém mais ruidosa.
    //   6h  → equilíbrio entre antecipação e estabilidade.
    //   24h → confirma que é tendência real e não um soluço.
    // A janela de 6h recebe o maior peso por ser o melhor compromisso: 1h
    // sozinha dispararia alerta para todo ruído estatístico.
    const growth1h = growthRate(series.points, 1);
    const growth6h = growthRate(series.points, 6);
    const growth24h = growthRate(series.points, 12);

    const velocityValue =
      normalizeGrowth(growth1h) * 0.3 +
      normalizeGrowth(growth6h) * 0.45 +
      normalizeGrowth(growth24h) * 0.25;

    measurements.push({
      dimension: 'searchVelocity',
      connectorId: this.id,
      value: velocityValue,
      rawValue: `1h:${growth1h.toFixed(0)}% 6h:${growth6h.toFixed(0)}% 24h:${growth24h.toFixed(0)}%`,
      explanation:
        growth6h > 100
          ? `Busca acelerando forte: +${growth6h.toFixed(0)}% em 6h`
          : `Variação de busca em 6h: ${growth6h.toFixed(0)}%`,
      confidence: series.confidence,
      observedAt,
    });

    // --- VOLUME ABSOLUTO ---
    if (series.monthlySearchVolume !== null) {
      measurements.push({
        dimension: 'searchVolume',
        connectorId: this.id,
        // Calibração para o mercado brasileiro de nicho nerd: 10 mil buscas/mês
        // é um termo relevante (0,5) e 500 mil é fenômeno nacional (1,0).
        value: logNormalize(series.monthlySearchVolume, 10_000, 500_000),
        rawValue: series.monthlySearchVolume,
        explanation: `~${series.monthlySearchVolume.toLocaleString('pt-BR')} buscas/mês`,
        confidence: series.confidence,
        observedAt,
      });
    } else {
      // Sem volume absoluto, usamos o pico do índice relativo (0-100) do Trends
      // como aproximação. Confiança reduzida porque índice relativo não é
      // volume: dois termos com índice 100 podem diferir em 100x no absoluto.
      const peak = Math.max(...series.points.map((p) => p.value));
      measurements.push({
        dimension: 'searchVolume',
        connectorId: this.id,
        value: peak / 100,
        rawValue: peak,
        explanation: `Índice relativo de interesse: ${peak}/100`,
        confidence: series.confidence * 0.7,
        observedAt,
      });
    }

    return measurements;
  },
};
