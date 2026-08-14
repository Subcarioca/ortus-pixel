/**
 * =============================================================================
 * ORIGEM DA PAUTA — pipeline ou gente
 * =============================================================================
 *
 * Até aqui, um `Topic` só nascia de um jeito: o `services/curator` varria os
 * conectores, deduplicava e gravava. Isso deixava de fora o caso mais banal de
 * uma redação — o jornalista que TEM uma pauta e quer escrevê-la. A alternativa
 * que restava era abrir uma matéria sem tópico nenhum, e com isso perder tudo o
 * que o tópico organiza: a fila, o score, o cronômetro de publicação e o vínculo
 * com a franquia.
 *
 * POR QUE A DIFERENÇA PRECISA ESTAR NO DADO, e não só na cabeça de quem criou:
 *
 *   1. O SCORE DE UMA PAUTA MANUAL É VAZIO, E ISSO NÃO É UM DEFEITO. Ela não
 *      passou por nenhum conector: não há volume de busca medido, não há
 *      trending do Reddit, não há nada. Exibir "score 0" ao lado de uma pauta
 *      manual, na mesma lista em que 0 significa "medimos e não deu nada",
 *      mentiria para quem lê a fila. A tela precisa saber a diferença para
 *      escrever "sem medição" em vez de "zero".
 *
 *   2. O PIPELINE NÃO PODE MEXER NELA como mexe nas suas. Uma pauta que um
 *      humano criou não deve ser descartada por um ciclo automático que a achou
 *      pouco relevante — a decisão de criá-la JÁ foi a decisão editorial.
 *
 *   3. RELATÓRIO. "Quantas das nossas matérias saíram de pauta própria e
 *      quantas o algoritmo achou?" é a pergunta que mede se o produto está
 *      ajudando ou substituindo a redação. Sem esta coluna, ela não tem
 *      resposta.
 */

export const TOPIC_ORIGINS = ['curator', 'manual'] as const;

export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];

/**
 * Valor desconhecido cai em 'curator'.
 *
 * Motivo prático, e não de gosto: TODAS as linhas que existiam antes desta
 * coluna vieram do pipeline. O padrão é a verdade histórica, e não um chute.
 */
export function toTopicOrigin(value: unknown): TopicOrigin {
  return value === 'manual' ? 'manual' : 'curator';
}

export const TOPIC_ORIGIN_LABELS: Record<TopicOrigin, string> = {
  curator: 'Encontrada pelo monitoramento',
  manual: 'Pauta da redação',
};
