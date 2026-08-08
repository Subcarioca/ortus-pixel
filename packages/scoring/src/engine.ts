/**
 * =============================================================================
 * MOTOR DE SCORE — transforma medições de sinal em decisões editoriais
 * =============================================================================
 *
 * PROPRIEDADE MAIS IMPORTANTE DESTE ARQUIVO: ele é uma FUNÇÃO PURA.
 *
 * Nenhuma chamada de rede, nenhum acesso a banco, nenhum `Date.now()` escondido
 * (o "agora" entra por parâmetro). Isso não é purismo funcional — tem três
 * consequências práticas muito concretas:
 *
 *  1) Testável de verdade: dá para afirmar "com estes sinais, o score é 84,2"
 *     e travar isso num teste. Se o motor fizesse I/O, os testes precisariam de
 *     mocks de rede e ninguém confiaria neles.
 *  2) Reprodutível: dá para reprocessar o histórico inteiro com pesos novos e
 *     comparar com o que foi decidido no passado — que é exatamente o que a
 *     recalibração da Fase 3 exige.
 *  3) Reutilizável: o mesmo código roda no curator (para decidir) e no painel
 *     web (para explicar ao editor por que deu aquilo). Duas implementações do
 *     mesmo cálculo divergiriam em uma semana.
 */

import {
  bandForScore,
  clamp,
  hoursBetween,
  timeDecay,
  TRIGGERS_REQUIRING_REVIEW,
  weightedMean,
  type DimensionContribution,
  type EmotionalTrigger,
  type ScoreResult,
  type SignalDimension,
  type SignalMeasurement,
  SIGNAL_DIMENSIONS,
} from '@subcarioca/core';

import { DEFAULT_WEIGHTS, SEO_WEIGHTS_V1, type WeightSet } from './weights';

export interface ScoreInput {
  measurements: SignalMeasurement[];
  /** Quando o tópico foi visto pela primeira vez — base do decaimento temporal. */
  firstSeenAt: Date;
  /** Gatilhos emocionais detectados pelo classificador. */
  emotionalTriggers?: EmotionalTrigger[];
  /** "Agora" injetado, para tornar o cálculo determinístico e testável. */
  now?: Date;
  weightSet?: WeightSet;
  /**
   * Desliga o decaimento temporal. Usado ao pontuar um tópico recém-descoberto
   * cujo `firstSeenAt` é antigo apenas porque ele já estava no nosso radar —
   * penalizá-lo por idade nesse caso seria injusto.
   */
  ignoreTimeDecay?: boolean;
}

export function calculateScore(input: ScoreInput): ScoreResult {
  const weightSet = input.weightSet ?? DEFAULT_WEIGHTS;
  const now = input.now ?? new Date();
  const triggers = input.emotionalTriggers ?? [];

  // ---------------------------------------------------------------------------
  // ETAPA 1 — Agrupar medições por dimensão.
  //
  // Várias fontes podem alimentar a mesma dimensão (Reddit + YouTube + X todas
  // alimentam socialMomentum). Consolidamos com média ponderada pela CONFIANÇA
  // de cada medição: um conector que avisa "estou com dado velho, confiança 0.3"
  // influencia pouco, sem precisar ser descartado por completo.
  // ---------------------------------------------------------------------------
  const byDimension = new Map<SignalDimension, SignalMeasurement[]>();
  for (const m of input.measurements) {
    // Descarta medições corrompidas antes que contaminem o cálculo. Um NaN aqui
    // se propagaria por toda a média e o score final sairia NaN, quebrando a home.
    if (!Number.isFinite(m.value) || !Number.isFinite(m.confidence)) continue;
    const list = byDimension.get(m.dimension) ?? [];
    list.push(m);
    byDimension.set(m.dimension, list);
  }

  // ---------------------------------------------------------------------------
  // ETAPA 2 — Calcular o valor de cada dimensão e descobrir quais faltaram.
  // ---------------------------------------------------------------------------
  const raw: {
    dimension: SignalDimension;
    value: number;
    available: boolean;
    measurements: SignalMeasurement[];
    avgConfidence: number;
  }[] = SIGNAL_DIMENSIONS.map((dimension) => {
    const measurements = byDimension.get(dimension) ?? [];
    const mean = weightedMean(
      measurements.map((m) => ({ value: clamp(m.value), weight: clamp(m.confidence) })),
    );
    const avgConfidence =
      measurements.length > 0
        ? measurements.reduce((a, m) => a + clamp(m.confidence), 0) / measurements.length
        : 0;

    return {
      dimension,
      // `mean === null` significa "não medido", que é diferente de "medido e deu 0".
      value: mean ?? 0,
      available: mean !== null,
      measurements,
      avgConfidence,
    };
  });

  // ---------------------------------------------------------------------------
  // ETAPA 3 — RENORMALIZAÇÃO DOS PESOS.
  //
  // Esta é a peça que atende ao requisito "uma API de trends fora do ar não
  // pode travar o sistema", e é onde a maioria das implementações erra.
  //
  // A abordagem ingênua é tratar dimensão ausente como zero. O efeito colateral
  // é devastador: se o conector de velocidade (peso 0.26) cair, TODO tópico
  // perde até 26 pontos e nada mais atinge a faixa QUENTE. O sistema não
  // "degrada" — ele silenciosamente para de detectar breaking news, e ninguém
  // percebe, porque não há erro nenhum nos logs.
  //
  // A abordagem correta: calcular a média ponderada apenas sobre as dimensões
  // DISPONÍVEIS, dividindo pela soma dos pesos disponíveis. Com isso o score
  // permanece na escala 0-100 e continua comparável entre tópicos. O preço da
  // informação faltante é pago na CONFIANÇA (etapa 5), não no score — que é o
  // lugar honesto de pagá-lo.
  // ---------------------------------------------------------------------------
  const availableWeightSum = raw
    .filter((r) => r.available)
    .reduce((acc, r) => acc + weightSet.weights[r.dimension], 0);

  const contributions: DimensionContribution[] = raw.map((r) => {
    const weight = weightSet.weights[r.dimension];
    const effectiveWeight = r.available && availableWeightSum > 0 ? weight / availableWeightSum : 0;
    return {
      dimension: r.dimension,
      normalizedValue: r.value,
      weight,
      effectiveWeight,
      points: r.value * effectiveWeight * 100,
      measurements: r.measurements,
      available: r.available,
    };
  });

  // Score-base antes dos ajustes de tempo e gatilho.
  const baseScore = contributions.reduce((acc, c) => acc + c.points, 0);

  // ---------------------------------------------------------------------------
  // ETAPA 4 — Ajustes finais.
  // ---------------------------------------------------------------------------

  // 4a) Decaimento temporal. Notícia é ativo perecível.
  const ageHours = hoursBetween(input.firstSeenAt, now);
  const decay = input.ignoreTimeDecay ? 1 : timeDecay(ageHours, weightSet.halfLifeHours);

  // Aplicamos o decaimento de forma ATENUADA (piso de 0.35) e não direta.
  // Motivo: um tópico realmente grande continua relevante no dia seguinte. Com
  // decaimento puro, uma notícia de 24h com sinais ainda fortíssimos cairia para
  // 25% do score e sumiria da home enquanto o público ainda a procura. O piso
  // preserva a hierarquia entre tópicos e deixa o decaimento atuar como
  // desempate, não como guilhotina.
  const decayMultiplier = 0.35 + 0.65 * decay;

  // 4b) Bônus de gatilho emocional — pequeno de propósito (ver weights.ts).
  const triggerBonus = Math.min(triggers.length * 1.5, 4);

  const score = clamp(baseScore * decayMultiplier + triggerBonus, 0, 100);

  // ---------------------------------------------------------------------------
  // ETAPA 5 — CONFIANÇA.
  //
  // Combina duas coisas distintas:
  //  - COBERTURA: quanto do peso total conseguimos medir. Se só medimos 40% do
  //    peso, o score é um palpite instruído, não uma medição.
  //  - QUALIDADE: quão confiantes estavam os próprios conectores.
  //
  // A confiança é o que separa "score 85, pode disparar push para 200 mil
  // pessoas" de "score 85, mostre ao editor e deixe ELE decidir".
  // ---------------------------------------------------------------------------
  const totalWeight = Object.values(weightSet.weights).reduce((a, b) => a + b, 0);
  const coverage = totalWeight > 0 ? availableWeightSum / totalWeight : 0;

  const availableContribs = contributions.filter((c) => c.available);
  const qualityMean =
    availableContribs.length > 0
      ? raw.filter((r) => r.available).reduce((a, r) => a + r.avgConfidence, 0) /
        availableContribs.length
      : 0;

  // Média geométrica: penaliza mais que a aritmética quando um dos fatores é
  // ruim. Cobertura 1.0 com qualidade 0.2 NÃO é uma situação "média" — é uma
  // situação ruim, e a raiz do produto (0.45) reflete isso melhor que 0.6.
  const confidence = clamp(Math.sqrt(coverage * qualityMean));

  // ---------------------------------------------------------------------------
  // ETAPA 6 — Score de SEO e classificação cabeça vs. cauda longa.
  // ---------------------------------------------------------------------------
  const seoOpportunity = calculateSeoScore(raw);
  const termType = classifyTermType(
    byDimension.get('searchVolume'),
    byDimension.get('serpOpportunity'),
  );

  return {
    score: round1(score),
    band: bandForScore(score).band,
    seoOpportunity: round1(seoOpportunity),
    confidence: round2(confidence),
    termType,
    emotionalTriggers: triggers,
    contributions,
    weightsVersion: weightSet.version,
    calculatedAt: now,
    summary: buildSummary(contributions, score, confidence, triggers, ageHours),
  };
}

/** Score de SEO, com renormalização própria (mesma lógica de resiliência). */
function calculateSeoScore(
  raw: { dimension: SignalDimension; value: number; available: boolean }[],
): number {
  const availableSum = raw
    .filter((r) => r.available)
    .reduce((acc, r) => acc + SEO_WEIGHTS_V1[r.dimension], 0);
  if (availableSum <= 0) return 0;

  return clamp(
    raw
      .filter((r) => r.available)
      .reduce((acc, r) => acc + r.value * (SEO_WEIGHTS_V1[r.dimension] / availableSum) * 100, 0),
    0,
    100,
  );
}

/**
 * Classifica o termo em cabeça / meio / cauda longa (item 7 do briefing).
 *
 * A regra combina volume com concorrência, porque nenhum dos dois isolado
 * descreve a situação:
 *   - Volume alto + concorrência alta  = CABEÇA (disputa cara, ganha quem chega antes)
 *   - Volume baixo + concorrência baixa = CAUDA LONGA (barato de rankear, converte bem)
 *
 * Lembrando que `serpOpportunity` é invertido por construção: valor ALTO
 * significa POUCA concorrência publicada (janela aberta).
 */
function classifyTermType(
  volumeMeasurements: SignalMeasurement[] | undefined,
  serpMeasurements: SignalMeasurement[] | undefined,
): 'head' | 'mid' | 'long-tail' {
  const volume = weightedMean(
    (volumeMeasurements ?? []).map((m) => ({ value: m.value, weight: m.confidence })),
  );
  const opportunity = weightedMean(
    (serpMeasurements ?? []).map((m) => ({ value: m.value, weight: m.confidence })),
  );

  // Sem dados de volume não dá para classificar; 'mid' é o padrão neutro, que
  // não enviesa a decisão editorial em nenhuma direção.
  if (volume === null) return 'mid';

  const competition = opportunity === null ? 0.5 : 1 - opportunity;

  if (volume >= 0.65 && competition >= 0.5) return 'head';
  if (volume <= 0.35) return 'long-tail';
  return 'mid';
}

/**
 * Monta a explicação em linguagem natural exibida no painel editorial.
 *
 * Isto NÃO é enfeite. Um score que o jornalista não entende é um score que o
 * jornalista ignora — e aí o produto inteiro vira um número decorativo na tela.
 * Mostrar "subiu por velocidade de busca (+22 pts) e trending no Reddit" é o
 * que faz a redação confiar (ou discordar com fundamento, o que também é ótimo,
 * porque gera o override manual que usaremos para recalibrar).
 */
function buildSummary(
  contributions: DimensionContribution[],
  score: number,
  confidence: number,
  triggers: EmotionalTrigger[],
  ageHours: number,
): string {
  const labels: Record<SignalDimension, string> = {
    searchVelocity: 'aceleração nas buscas',
    searchVolume: 'volume de busca',
    socialMomentum: 'repercussão nas redes',
    platformTrending: 'presença em trending topics',
    sourceAuthority: 'fonte oficial/confiável',
    releaseProximity: 'proximidade de lançamento',
    serpOpportunity: 'baixa concorrência publicada',
    audienceAffinity: 'afinidade da nossa audiência',
    emotionalTrigger: 'gatilho emocional',
  };

  const top = [...contributions]
    .filter((c) => c.available && c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  const parts: string[] = [];

  if (top.length === 0) {
    parts.push('Sem sinais mensuráveis no momento.');
  } else {
    parts.push(
      `Score ${score.toFixed(0)} puxado por ${top
        .map((c) => `${labels[c.dimension]} (+${c.points.toFixed(0)} pts)`)
        .join(', ')}.`,
    );
  }

  const missing = contributions.filter((c) => !c.available);
  if (missing.length > 0) {
    parts.push(
      `${missing.length} sinal(is) indisponível(is) neste ciclo — pesos redistribuídos entre os demais.`,
    );
  }

  if (confidence < 0.5) {
    parts.push(`Confiança baixa (${(confidence * 100).toFixed(0)}%): recomenda-se checagem humana.`);
  }

  if (triggers.length > 0) {
    const needsReview = triggers.filter((t) => TRIGGERS_REQUIRING_REVIEW.includes(t));
    if (needsReview.length > 0) {
      parts.push(`Contém gatilho sensível (${needsReview.join(', ')}): exige revisão antes de automação.`);
    }
  }

  if (ageHours > 24) {
    parts.push(`Tópico com ${Math.round(ageHours)}h de idade (score já sofre decaimento temporal).`);
  }

  return parts.join(' ');
}

/**
 * Decide se um tópico pode acionar automações (push, hero) SEM humano no meio.
 *
 * Regra de ouro do produto: automação é privilégio, não padrão. Precisa reunir
 * score alto E confiança suficiente E ausência de gatilho sensível. Um push
 * errado para a base inteira custa descadastros que levam meses para recuperar,
 * então o critério aqui é conservador de propósito.
 */
export function isEligibleForAutomation(
  result: ScoreResult,
  weightSet: WeightSet = DEFAULT_WEIGHTS,
): { eligible: boolean; reason: string } {
  const band = bandForScore(result.score);

  if (!band.pushCandidate) {
    return { eligible: false, reason: `Faixa ${band.label} não é candidata a automação.` };
  }
  if (result.confidence < weightSet.minConfidenceForAutomation) {
    return {
      eligible: false,
      reason: `Confiança ${(result.confidence * 100).toFixed(0)}% abaixo do mínimo de ${(
        weightSet.minConfidenceForAutomation * 100
      ).toFixed(0)}%.`,
    };
  }
  const sensitive = result.emotionalTriggers.filter((t) => TRIGGERS_REQUIRING_REVIEW.includes(t));
  if (sensitive.length > 0) {
    return {
      eligible: false,
      reason: `Gatilho sensível detectado (${sensitive.join(', ')}): exige aprovação humana.`,
    };
  }
  return { eligible: true, reason: 'Elegível a push e destaque automáticos.' };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
