/**
 * =============================================================================
 * DEDUPLICAÇÃO DE TÓPICOS
 * =============================================================================
 *
 * O PROBLEMA CONCRETO: a Rockstar anuncia o atraso de GTA VI. Em 20 minutos,
 * IGN, Eurogamer, Variety, Omelete e JovemNerd publicam. Nossos feeds trazem 5
 * itens. Sem deduplicação, viram 5 tópicos, e as consequências são todas ruins:
 *   - a home mostra o mesmo assunto cinco vezes;
 *   - o orçamento de API (X custa por leitura) é gasto cinco vezes;
 *   - a redação recebe cinco alertas do mesmo fato e perde a confiança no sistema;
 *   - o score se dilui entre cinco registros e nenhum atinge a faixa QUENTE —
 *     ou seja, a duplicação chega a IMPEDIR a detecção do breaking news.
 *
 * ESTRATÉGIA EM DUAS CAMADAS:
 *
 *  1. Hash canônico (rápido, exato) — normaliza o título de forma agressiva e
 *     gera um hash. Pega reposts e títulos quase idênticos. Custo O(1) via
 *     índice único no banco.
 *
 *  2. Similaridade por tokens (mais lento, tolerante) — compara o candidato com
 *     tópicos recentes usando coeficiente de Jaccard sobre palavras
 *     significativas. Pega os casos que o hash não pega, como:
 *       "Rockstar adia GTA VI para novembro"
 *       "GTA 6 é adiado novamente; novo prazo é novembro"
 *     Custo O(n) sobre uma janela pequena (só as últimas 48h).
 *
 * A ordem importa: o caminho barato resolve a maioria dos casos, e o caro só
 * roda para o que sobrou.
 */

import { createHash } from 'node:crypto';

/**
 * Palavras sem valor discriminante em português e inglês.
 * Removê-las evita que "o", "de" e "the" inflem artificialmente a similaridade
 * entre dois títulos que não têm nada a ver um com o outro.
 */
const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'sob', 'sobre',
  'e', 'ou', 'mas', 'que', 'se', 'ao', 'aos', 'à', 'às', 'pelo', 'pela',
  'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'is', 'are',
  'was', 'were', 'be', 'been', 'has', 'have', 'had', 'it', 'its', 'this', 'that',
  'new', 'novo', 'nova', 'agora', 'hoje', 'após', 'apos',
]);

/**
 * Normaliza um título para comparação.
 * Agressivo de propósito: queremos que variações irrelevantes de forma
 * colapsem no mesmo texto.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    // Remove acentos (o NFD separa a letra do diacrítico).
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Remove pontuação, mantendo letras, números e espaços.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sufixos removidos pelo stemmer, ORDENADOS DO MAIS LONGO PARA O MAIS CURTO.
 * A ordem é essencial: se testássemos "o" antes de "ado", "adiado" viraria
 * "adiad" em vez de "adi", e o casamento falharia.
 */
const SUFFIXES = [
  'amentos', 'imentos', 'amento', 'imento', 'adores', 'adoras',
  'acoes', 'ancia', 'antes', 'ados', 'adas', 'idos', 'idas',
  'ando', 'endo', 'indo', 'cao', 'ram', 'rem', 'ria', 'ado',
  'ada', 'ido', 'ida', 'ndo', 'ou', 'ar', 'er', 'ir', 'os',
  'as', 'es', 'a', 'o', 'e', 's',
];

/** Radical mínimo. Abaixo disso, palavras distintas começariam a colidir. */
const MIN_STEM_LENGTH = 3;

/**
 * Stemmer leve para português.
 *
 * POR QUE ISTO EXISTE (achado real, encontrado pelos testes):
 *
 * Sem tratamento morfológico, a deduplicação FALHAVA nos casos mais comuns do
 * dia a dia da redação:
 *     "Rockstar adia GTA VI"          -> tokens {rockstar, adia, gta}
 *     "GTA VI adiado pela Rockstar"   -> tokens {rockstar, adiado, gta}
 * Jaccard = 0,5 — abaixo do limiar. Ou seja: o mesmo anúncio virava dois
 * tópicos, exatamente o problema que a deduplicação existe para evitar.
 *
 * O português é muito flexionado (adia/adiado/adiaram/adiamento), então
 * comparar formas de superfície não funciona. Reduzir ao radical resolve:
 * todas viram "adi".
 *
 * POR QUE UM STEMMER PRÓPRIO E NÃO UMA BIBLIOTECA (RSLP/Snowball): precisamos
 * apenas de agrupamento aproximado, não de análise linguística correta. Este
 * stemmer tem 15 linhas, zero dependências e nenhum risco de supply chain. Se
 * um dia a qualidade do agrupamento virar gargalo medido, trocar por Snowball
 * é substituir esta única função.
 *
 * LIMITAÇÃO CONHECIDA E ACEITA: gera falsos positivos ocasionais
 * ("console"/"consolidado" -> "consol"). Como a deduplicação exige 60% de
 * similaridade sobre o CONJUNTO de tokens, um radical colidindo isoladamente
 * não é suficiente para fundir dois tópicos.
 */
export function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= MIN_STEM_LENGTH && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Extrai os tokens significativos: sem stopwords, sem palavras curtas e
 * reduzidos ao radical.
 */
export function significantTokens(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .map(stem),
  );
}

/**
 * Hash canônico de um tópico.
 *
 * Ordenamos os tokens antes de gerar o hash, de modo que
 * "Rockstar adia GTA VI" e "GTA VI adiado pela Rockstar" produzam a MESMA
 * chave. É o que transforma uma comparação de texto livre em uma busca por
 * índice único no banco.
 */
export function canonicalHash(title: string, categorySlug?: string | null): string {
  const tokens = [...significantTokens(title)].sort().join('-');
  // A categoria entra no hash para evitar colisões entre assuntos homônimos de
  // editorias diferentes (ex.: um jogo e um filme com o mesmo nome).
  const input = `${categorySlug ?? 'sem-categoria'}:${tokens}`;
  // SHA-256 truncado: 32 caracteres hex já tornam colisão acidental
  // improvável a ponto de ser irrelevante, e o índice fica menor.
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Coeficiente de Jaccard: |interseção| / |união|.
 *
 * Escolhido em vez de distância de Levenshtein porque nos importa o CONJUNTO
 * de conceitos, não a ordem nem a grafia exata. Levenshtein diria que
 * "GTA VI adiado" e "GTA VI confirmado" são muito parecidos (poucas letras de
 * diferença) — quando são notícias opostas. Jaccard, operando sobre palavras,
 * enxerga corretamente que "adiado" e "confirmado" são tokens distintos.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Limiar de similaridade para considerar dois tópicos iguais.
 *
 * 0.6 foi calibrado a favor do FALSO NEGATIVO (deixar passar duplicata) e
 * contra o FALSO POSITIVO (fundir dois assuntos distintos). O raciocínio:
 * duplicata gera ruído visível que o editor corrige em um clique; fusão errada
 * faz uma notícia real DESAPARECER do sistema, e ninguém percebe o que não
 * apareceu. Erro silencioso é sempre o pior dos dois.
 */
export const SIMILARITY_THRESHOLD = 0.6;

export interface DedupeCandidate {
  id: string;
  title: string;
  categorySlug: string | null;
}

/**
 * Procura um tópico existente equivalente ao candidato.
 * @param recentTopics janela recente (48h), já carregada pelo chamador.
 */
export function findDuplicate(
  candidateTitle: string,
  candidateCategory: string | null,
  recentTopics: DedupeCandidate[],
): { topicId: string; similarity: number } | null {
  const candidateTokens = significantTokens(candidateTitle);

  // Título sem nenhum token significativo (ex.: "Confira agora") não é
  // comparável: qualquer similaridade calculada seria acidental.
  if (candidateTokens.size === 0) return null;

  let best: { topicId: string; similarity: number } | null = null;

  for (const topic of recentTopics) {
    // Assuntos de categorias diferentes não são duplicata um do outro.
    if (
      candidateCategory &&
      topic.categorySlug &&
      candidateCategory !== topic.categorySlug
    ) {
      continue;
    }

    const similarity = jaccardSimilarity(candidateTokens, significantTokens(topic.title));

    if (similarity >= SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { topicId: topic.id, similarity };
    }
  }

  return best;
}
