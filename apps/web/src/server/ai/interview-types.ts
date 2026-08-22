/**
 * =============================================================================
 * TIPOS DA ENTREVISTA — contrato entre o servidor (IA) e o painel (UI)
 * =============================================================================
 *
 * Mesmo papel de `prearticle-types.ts` e pelo mesmo motivo: o componente do
 * painel é `'use client'` e precisa do TIPO da conversa sem puxar o código de
 * servidor junto. Tipos somem na compilação, então importar daqui não cria
 * dependência de runtime.
 *
 * -----------------------------------------------------------------------------
 * POR QUE A CONVERSA VIVE NO CLIENTE, E NÃO NO BANCO
 * -----------------------------------------------------------------------------
 * É a mesma decisão já tomada para a pré-matéria (ver `topic-row.tsx`: "o
 * resultado é conteúdo transiente para revisão, não um novo estado do tópico no
 * banco"). A entrevista é material de trabalho, não estado do produto: o que
 * vira estado é o RASCUNHO no fim, que é uma `Article` de verdade.
 *
 * A consequência honesta: recarregar a página perde a conversa. É o mesmo preço
 * que a pré-matéria já paga hoje, e o remédio (uma tabela de conversas + coluna
 * nova + migração manual em produção) custa mais do que o problema — a
 * alternativa barata, se isso incomodar na prática, é o próprio painel guardar
 * o histórico em `sessionStorage`, sem tocar no banco.
 */

/**
 * Uma fala da conversa.
 *
 * Só 'user' e 'assistant': a mensagem de SISTEMA (o prompt do entrevistador)
 * nunca trafega — é montada no servidor a cada chamada, sempre a partir do
 * código. Deixá-la fora deste tipo não é economia, é a trava que impede o
 * cliente de reescrever as regras do entrevistador mandando um `role: 'system'`
 * próprio no histórico.
 */
export interface InterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Teto de mensagens no histórico enviado ao modelo.
 *
 * TRAVA DE CUSTO, não de produto: o histórico inteiro viaja em TODA chamada
 * (é assim que um modelo sem memória "lembra" da conversa), então o custo de
 * cada turno cresce com o tamanho do papo. 40 mensagens são ~20 rodadas de
 * pergunta e resposta — muito além das 3 rodadas que o prompt prevê antes de
 * escrever, com folga para várias revisões depois do rascunho.
 *
 * Ao estourar, o servidor corta as MAIS ANTIGAS e mantém as recentes: o começo
 * da conversa é a apuração (que já virou texto no rascunho), e o fim é o ajuste
 * fino que está em andamento. Perder o fim seria perder o que está sendo feito
 * agora.
 */
export const MAX_INTERVIEW_MESSAGES = 40;

/** Teto de caracteres por mensagem. Uma resposta de entrevista não passa disso. */
export const MAX_INTERVIEW_MESSAGE_CHARS = 6_000;
