/**
 * Utilitários compartilhados. Só entram aqui funções puras, sem dependência de
 * ambiente (nada de `fs`, `window` ou banco) — assim o pacote pode ser importado
 * tanto por Server Components quanto pelo curator quanto pelo navegador.
 */

/** Prende um número num intervalo. Usado o tempo todo na normalização de sinais. */
export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalização logarítmica — a função mais importante do sistema de sinais.
 *
 * POR QUE LOG E NÃO LINEAR? Métricas de audiência são cauda longa extrema. Se
 * normalizarmos linearmente com base no máximo, um post viral de 500 mil upvotes
 * esmaga tudo: uma notícia com 5.000 upvotes (que é MUITO) viraria 0,01 e o
 * sinal ficaria inútil em 99% dos casos.
 *
 * Na escala log, a distância entre 100 e 1.000 é igual à distância entre 1.000
 * e 10.000 — que é exatamente como percebemos relevância na prática: uma ordem
 * de grandeza a mais é "um degrau", não "10x mais importante".
 *
 * @param value    valor bruto observado
 * @param midpoint valor que deve mapear para ~0,5 (calibre por plataforma)
 * @param ceiling  valor que deve mapear para ~1,0
 */
export function logNormalize(value: number, midpoint: number, ceiling: number): number {
  if (value <= 0) return 0;
  if (midpoint <= 1 || ceiling <= midpoint) {
    // Configuração inválida: falha de forma segura (sinal neutro) em vez de
    // devolver NaN e envenenar o score inteiro silenciosamente.
    return 0;
  }
  const logValue = Math.log10(value);
  const logMid = Math.log10(midpoint);
  const logCeil = Math.log10(ceiling);
  // Reta que passa por (logMid, 0.5) e (logCeil, 1.0).
  const slope = 0.5 / (logCeil - logMid);
  return clamp(0.5 + (logValue - logMid) * slope);
}

/**
 * Normaliza uma variação percentual (delta) para [0,1].
 *
 * Usada no sinal de VELOCIDADE, o mais importante do algoritmo. A curva é
 * assimétrica de propósito: crescimento de +300% é sinal fortíssimo de breakout,
 * enquanto queda de -300% é impossível (o piso é -100%). Portanto só a metade
 * positiva realmente nos interessa; quedas apenas empurram o sinal para perto
 * de zero, sem virar número negativo (que desestabilizaria a média ponderada).
 */
export function normalizeGrowth(percentDelta: number, breakoutThreshold = 200): number {
  if (!Number.isFinite(percentDelta) || percentDelta <= 0) return 0;
  // tanh dá saturação suave: +200% ≈ 0,76 e +1000% ≈ 0,99. Evita que um
  // outlier absurdo (ex.: 50.000% por divisão por base minúscula) domine tudo.
  return clamp(Math.tanh(percentDelta / breakoutThreshold));
}

/**
 * Decaimento exponencial por idade — a "meia-vida" de uma notícia.
 *
 * Notícia é um ativo perecível: uma matéria com score 90 há 18 horas não deve
 * mais ocupar o hero da home. Sem decaimento, a home congelaria no maior pico
 * do dia e nunca mais se atualizaria.
 *
 * @param ageHours   idade em horas
 * @param halfLifeHours horas para o peso cair pela metade
 */
export function timeDecay(ageHours: number, halfLifeHours = 12): number {
  if (ageHours <= 0) return 1;
  return Math.pow(0.5, ageHours / halfLifeHours);
}

/** Diferença em horas entre duas datas. */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/**
 * Gera um slug seguro para URL a partir de um título.
 *
 * SEGURANÇA E SEO: o slug entra na URL, no sitemap e em `<link rel=canonical>`.
 * A whitelist agressiva (só a-z, 0-9 e hífen) evita URLs duplicadas por
 * acentuação/caixa e fecha a porta para caracteres de controle em path.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    // Remove os diacríticos que o NFD separou da letra base (á => a + acento).
    // Usamos escapes Unicode em vez dos caracteres literais porque acentos
    // combinantes soltos no código-fonte são corrompidos com facilidade por
    // editores/ferramentas que trocam o encoding do arquivo.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Estimativa de tempo de leitura. 200 ppm é a média de leitura em português. */
export function estimateReadingMinutes(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * Média ponderada com proteção contra divisão por zero.
 * Retorna `null` (e não 0) quando não há amostras — a diferença importa muito:
 * "não medi" é diferente de "medi e deu zero", e o motor de score trata os dois
 * casos de formas opostas (redistribuir peso vs. penalizar).
 */
export function weightedMean(samples: { value: number; weight: number }[]): number | null {
  if (samples.length === 0) return null;
  const totalWeight = samples.reduce((acc, s) => acc + s.weight, 0);
  if (totalWeight <= 0) return null;
  return samples.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight;
}

/** Formata número para exibição compacta pt-BR (12400 → "12,4 mil"). */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}
