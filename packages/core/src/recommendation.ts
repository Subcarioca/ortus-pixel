/**
 * =============================================================================
 * RECOMENDAÇÃO DE MATÉRIAS RELACIONADAS
 * =============================================================================
 *
 * O QUE ISTO SUBSTITUI: a versão anterior de "relacionadas" pegava os 4 artigos
 * mais recentes que dividissem QUALQUER franquia com o artigo aberto. O efeito
 * colateral era previsível: numa franquia movimentada, as relacionadas de todos
 * os artigos ficavam idênticas (as 4 últimas notícias da franquia), e um
 * comparativo de hardware nunca puxava outro comparativo de hardware — só o
 * noticiário da franquia.
 *
 * A PONTUAÇÃO, EM UMA FRASE: proximidade temática define QUANTO vale a
 * relação; a recência apenas DESCONTA o que envelheceu, sem nunca inverter o
 * ranking.
 *
 * POR QUE É UMA FUNÇÃO PURA, E NÃO UM `ORDER BY` NO SQL:
 *
 *  1. TESTÁVEL SEM BANCO. As regras de peso são a parte que vai ser ajustada
 *     com o tempo ("franquia devia pesar mais que categoria?"). Ajustar número
 *     dentro de uma string SQL, sem teste, é como esses pesos silenciosamente
 *     param de fazer sentido.
 *  2. LEGÍVEL. A fórmula inteira cabe numa tela e diz o que o produto pensa
 *     sobre semelhança. Espalhada em `CASE WHEN` dentro de uma query, ela vira
 *     algo que ninguém ousa mexer.
 *
 * O QUE ISTO NÃO É: aprendizado de máquina, embedding, "usuários que leram X".
 * É uma soma ponderada de atributos que o artigo já tem. Não há modelo para
 * treinar, serviço externo para cair, nem dado de comportamento para guardar —
 * o que também evita construir um perfil de leitura de cada leitor, coisa que
 * este projeto decidiu não fazer (ver a política de minimização em community.ts).
 *
 * SOBRE TAGS: o pedido original incluía "tags em comum" na fórmula. Ficaram de
 * fora porque `Tag`/`ArticleTag` estão VAZIAS e nenhum código do projeto as
 * popula hoje — o termo seria um ramo que nunca executa. Quando existir quem
 * preencha as tags, entra aqui como mais uma parcela de `affinity`, e o teste
 * ao lado deste arquivo é o lugar de fixar o peso.
 */

/** Atributos de um artigo que entram na conta. Nada além disto é necessário. */
export interface RecommendationSubject {
  id: string;
  /** Slugs das franquias ligadas ao artigo. */
  franchiseSlugs: readonly string[];
  categoryKey: string;
  subcategoryKey: string | null;
  publishedAt: Date | null;
}

/**
 * PESOS. Os números relativos importam muito mais que os absolutos — o que a
 * escala afirma é a ordem: franquia > sub-categoria > categoria.
 */
export const RECOMMENDATION_WEIGHTS = {
  /**
   * Franquia em comum. É o vínculo mais forte que existe no produto: quem lê
   * sobre Zelda quer mais Zelda, e o hub de franquia é a peça de retenção do
   * site. Vale por franquia coincidente, até o teto abaixo.
   */
  franchise: 3.0,
  /**
   * Sub-categoria (ex.: Hardware dentro de Tech). Pesa mais que a categoria
   * porque representa INTENÇÃO parecida ("estou pesquisando placa de vídeo"),
   * e não só assunto parecido.
   */
  subcategory: 1.5,
  /** Mesma editoria. Sinal fraco: "Games" é metade do site. */
  category: 0.8,
} as const;

/**
 * Teto de franquias contadas.
 *
 * Sem teto, um artigo de crossover marcado com cinco franquias venceria
 * qualquer outro por acumulação, mesmo sendo menos relevante para quem está
 * lendo. Duas coincidências já significam "é bem sobre a mesma coisa"; da
 * terceira em diante o sinal não fica mais forte, só mais barulhento.
 */
export const MAX_COUNTED_FRANCHISES = 2;

/** Meia-vida do desconto por idade. */
export const RECENCY_HALF_LIFE_DAYS = 14;

/**
 * Piso do fator de recência.
 *
 * ESTE NÚMERO É O QUE TORNA O DECAIMENTO "SUAVE", e ele existe por um motivo
 * concreto: com decaimento puro, um artigo de seis meses ficaria com fator
 * ~0,0001 e NENHUM conteúdo evergreen apareceria em relacionadas — justamente o
 * material que o projeto trata como porta de entrada de franquia ("Essencial").
 * Com piso 0,5, o mais antigo do acervo ainda vale metade da sua afinidade
 * temática: a recência desempata, não elimina.
 */
export const RECENCY_FLOOR = 0.5;

const MS_PER_DAY = 86_400_000;

/**
 * Fator de recência, entre `RECENCY_FLOOR` e 1.
 *
 * Data no futuro (agendamento, relógio do servidor adiantado) é tratada como
 * "agora": fator 1. Sem esse cuidado, o expoente ficaria negativo e o fator
 * passaria de 1, dando a um artigo agendado uma vantagem que a fórmula nunca
 * pretendeu conceder.
 */
export function recencyFactor(publishedAt: Date | null, now: Date): number {
  // Sem data de publicação não há como medir idade. Usamos o piso em vez de 1:
  // na dúvida, o artigo não ganha bônus de novidade que talvez não mereça.
  if (!publishedAt) return RECENCY_FLOOR;

  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / MS_PER_DAY);
  const decay = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);

  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

/**
 * Afinidade TEMÁTICA, sem tempo. Separada de propósito: é ela que responde
 * "estes dois artigos falam da mesma coisa?", e é ela que o teste fixa.
 */
export function thematicAffinity(
  seed: RecommendationSubject,
  candidate: RecommendationSubject,
): number {
  // `Set` para não pagar busca linear por franquia — e porque a duplicata de
  // uma mesma franquia no vínculo não deve contar duas vezes.
  const seedFranchises = new Set(seed.franchiseSlugs);
  let shared = 0;
  for (const slug of new Set(candidate.franchiseSlugs)) {
    if (seedFranchises.has(slug)) shared++;
  }

  let score = Math.min(shared, MAX_COUNTED_FRANCHISES) * RECOMMENDATION_WEIGHTS.franchise;

  // A sub-categoria só conta quando os DOIS a têm e são a mesma. Comparar nulo
  // com nulo daria "combinam" para todo artigo que não tem sub-categoria — que
  // é a maioria do acervo.
  if (
    seed.subcategoryKey !== null &&
    candidate.subcategoryKey !== null &&
    seed.subcategoryKey === candidate.subcategoryKey
  ) {
    score += RECOMMENDATION_WEIGHTS.subcategory;
  }

  if (seed.categoryKey === candidate.categoryKey) {
    score += RECOMMENDATION_WEIGHTS.category;
  }

  return score;
}

/** Pontuação final de um candidato: afinidade temática descontada pela idade. */
export function scoreRecommendation(
  seed: RecommendationSubject,
  candidate: RecommendationSubject,
  now: Date,
): number {
  return thematicAffinity(seed, candidate) * recencyFactor(candidate.publishedAt, now);
}

export interface ScoredRecommendation<T extends RecommendationSubject> {
  item: T;
  score: number;
}

/**
 * Ordena candidatos por relevância para `seed`.
 *
 * DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
 *
 *  - O PRÓPRIO ARTIGO é removido. Ele tem, por definição, a maior afinidade
 *    possível consigo mesmo e encabeçaria a lista das suas próprias
 *    relacionadas.
 *  - Candidato com afinidade ZERO é DESCARTADO, não exibido no fim da fila.
 *    "Relacionadas" que não têm relação nenhuma com o texto é pior do que
 *    exibir menos cards: quebra a promessa do bloco e ensina o leitor a
 *    ignorá-lo. É preferível devolver dois itens bons do que quatro sendo dois
 *    aleatórios.
 *
 * O desempate por data mantém a ordem ESTÁVEL: sem ele, dois candidatos de
 * mesma pontuação poderiam trocar de posição entre renderizações, e o bloco
 * pareceria "embaralhar sozinho" a cada revalidação de cache.
 */
export function rankRecommendations<T extends RecommendationSubject>(
  seed: RecommendationSubject,
  candidates: readonly T[],
  now: Date,
  limit: number,
): ScoredRecommendation<T>[] {
  return candidates
    .filter((candidate) => candidate.id !== seed.id)
    .map((item) => ({ item, score: scoreRecommendation(seed, item, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.item.publishedAt?.getTime() ?? 0) - (a.item.publishedAt?.getTime() ?? 0);
    })
    .slice(0, limit);
}
