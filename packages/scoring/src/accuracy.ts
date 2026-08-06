/**
 * =============================================================================
 * PRECISÃO DO SCORE — o KPI que fecha o ciclo de aprendizado
 * =============================================================================
 *
 * O briefing chama isso de "crítico", e com razão: sem medir precisão, os pesos
 * do algoritmo são uma opinião congelada para sempre. Com essa medição, o
 * sistema aprende.
 *
 * A pergunta que respondemos aqui: "o score previsto no momento da publicação
 * teve relação com os pageviews reais das 24h seguintes?"
 *
 * DECISÃO ESTATÍSTICA IMPORTANTE — por que Spearman e não Pearson:
 *
 * Pearson mede relação LINEAR. Mas ninguém espera que score 80 renda exatamente
 * o dobro de score 40 — pageviews têm distribuição de cauda longa, então um
 * punhado de virais dominaria a correlação e o número ficaria instável a ponto
 * de ser inútil.
 *
 * O que de fato importa para a redação é ORDENAÇÃO: se o algoritmo diz que A é
 * mais quente que B, A rendeu mais tráfego que B? Isso é exatamente correlação
 * de postos (Spearman), que é robusta a outliers e a relações não lineares.
 *
 * Calculamos Pearson junto apenas como diagnóstico secundário: divergência
 * grande entre os dois indica que existe algum viral extremo distorcendo a
 * amostra — informação útil, mas não a métrica de referência.
 */

export interface AccuracySample {
  topicId: string;
  articleId: string;
  /** Score no momento da publicação (congelado). */
  predictedScore: number;
  /** Pageviews reais nas 24h seguintes à publicação. */
  actualPageviews24h: number;
  publishedAt: Date;
  weightsVersion: string;
  categorySlug: string | null;
}

export interface AccuracyReport {
  sampleSize: number;
  /** Correlação de Spearman em [-1, 1]. MÉTRICA PRINCIPAL. */
  spearman: number;
  /** Correlação de Pearson — diagnóstico secundário. */
  pearson: number;
  /**
   * Leitura pronta para humano. Referências usuais para dados de audiência:
   *   > 0.7  excelente | 0.5–0.7 bom | 0.3–0.5 fraco | < 0.3 o modelo não está
   *   ordenando melhor que o acaso e precisa de recalibração urgente.
   */
  interpretation: string;
  /** Precisão por faixa — revela ONDE o modelo erra. */
  byBand: {
    band: string;
    sampleSize: number;
    avgPredicted: number;
    avgActual: number;
    /** Mediana é mais representativa que média em cauda longa. */
    medianActual: number;
  }[];
  /**
   * Os maiores erros, nas duas direções. É a lista mais acionável do relatório:
   * cada linha é uma hipótese sobre um peso errado.
   */
  worstOverestimates: AccuracySample[];
  worstUnderestimates: AccuracySample[];
  weightsVersion: string;
  generatedAt: Date;
}

/** Converte valores em postos, tratando empates pela média (padrão de Spearman). */
function toRanks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    // Avança enquanto houver empate.
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j++;
    // Posto médio do bloco empatado (1-based).
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);
  // Variância zero (todos os valores iguais) => correlação indefinida.
  // Devolvemos 0 em vez de NaN para não contaminar dashboards.
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function buildAccuracyReport(
  samples: AccuracySample[],
  weightsVersion: string,
): AccuracyReport {
  // Guarda de tamanho mínimo: correlação com 5 pontos é numerologia, não
  // estatística. Preferimos declarar "amostra insuficiente" a exibir um 0.91
  // que vai levar alguém a mexer nos pesos por engano.
  const MIN_SAMPLE = 20;

  if (samples.length < MIN_SAMPLE) {
    return {
      sampleSize: samples.length,
      spearman: 0,
      pearson: 0,
      interpretation: `Amostra insuficiente (${samples.length}/${MIN_SAMPLE}). Não recalibre pesos com base nisto.`,
      byBand: [],
      worstOverestimates: [],
      worstUnderestimates: [],
      weightsVersion,
      generatedAt: new Date(),
    };
  }

  const predicted = samples.map((s) => s.predictedScore);
  const actual = samples.map((s) => s.actualPageviews24h);

  const spearman = pearsonCorrelation(toRanks(predicted), toRanks(actual));
  const pearson = pearsonCorrelation(predicted, actual);

  // Erro relativo: comparamos o posto previsto com o posto real. Trabalhar em
  // postos evita ter de converter score (0-100) em pageviews (0-1.000.000),
  // conversão que exigiria um modelo à parte e traria erro próprio.
  const predictedRanks = toRanks(predicted);
  const actualRanks = toRanks(actual);
  const withError = samples.map((sample, i) => ({
    sample,
    // Positivo = prevemos mais alto do que a realidade entregou (superestimação).
    rankError: predictedRanks[i]! - actualRanks[i]!,
  }));

  const sortedByError = [...withError].sort((a, b) => b.rankError - a.rankError);

  const bands = [
    { band: 'HOT', min: 80, max: 100 },
    { band: 'RISING', min: 60, max: 79 },
    { band: 'RELEVANT', min: 40, max: 59 },
    { band: 'EVERGREEN', min: 0, max: 39 },
  ];

  const byBand = bands.map((b) => {
    const inBand = samples.filter((s) => s.predictedScore >= b.min && s.predictedScore <= b.max);
    return {
      band: b.band,
      sampleSize: inBand.length,
      avgPredicted:
        inBand.length > 0 ? inBand.reduce((a, s) => a + s.predictedScore, 0) / inBand.length : 0,
      avgActual:
        inBand.length > 0
          ? inBand.reduce((a, s) => a + s.actualPageviews24h, 0) / inBand.length
          : 0,
      medianActual: median(inBand.map((s) => s.actualPageviews24h)),
    };
  });

  return {
    sampleSize: samples.length,
    spearman: Math.round(spearman * 1000) / 1000,
    pearson: Math.round(pearson * 1000) / 1000,
    interpretation: interpret(spearman),
    byBand,
    worstOverestimates: sortedByError.slice(0, 5).map((w) => w.sample),
    worstUnderestimates: sortedByError.slice(-5).reverse().map((w) => w.sample),
    weightsVersion,
    generatedAt: new Date(),
  };
}

function interpret(spearman: number): string {
  if (spearman >= 0.7) {
    return 'Excelente: o score ordena muito bem o desempenho real. Mudanças de peso devem ser conservadoras.';
  }
  if (spearman >= 0.5) {
    return 'Bom: o score é um preditor útil. Há espaço para ajuste fino nas dimensões com maior erro.';
  }
  if (spearman >= 0.3) {
    return 'Fraco: o score acerta a tendência geral, mas erra muito caso a caso. Revise os pesos das dimensões com maior erro de posto.';
  }
  if (spearman >= 0) {
    return 'Ruim: o score praticamente não prevê desempenho. Recalibração urgente — verifique também se algum conector está devolvendo dado degradado.';
  }
  return 'Crítico: correlação NEGATIVA. O modelo está sistematicamente invertido; investigue normalização de sinais antes de mexer em pesos.';
}
