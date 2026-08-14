/**
 * =============================================================================
 * ORIGEM DO CORPO DA MATÉRIA — gente ou modelo de linguagem
 * =============================================================================
 *
 * Irmão de `topic-origin.ts`, e pela mesma razão: quando uma linha do banco pode
 * ter nascido de dois jeitos com consequências editoriais diferentes, a
 * diferença precisa estar NO DADO — não na memória de quem estava de plantão.
 *
 * O que este vocabulário responde: "o TEXTO INICIAL desta matéria foi escrito
 * por uma pessoa ou pré-preenchido por um modelo de linguagem?".
 *
 * -----------------------------------------------------------------------------
 * TRÊS COISAS QUE ESTE CAMPO NÃO É — e é importante que não sejam
 * -----------------------------------------------------------------------------
 *
 *   1. NÃO É UMA TRAVA. Uma matéria com origem 'ai-assisted' publica pelo mesmo
 *      fluxo de qualquer outra. A trava que existe é anterior e é humana: a
 *      sugestão nasce como RASCUNHO e alguém precisa clicar em publicar. Se este
 *      campo virasse condição de publicação, ele passaria a ser burlado (basta
 *      não marcar) e deixaria de valer como registro.
 *
 *   2. NÃO É "ESTA MATÉRIA FOI ESCRITA POR IA". É "o ponto de partida veio de
 *      uma geração automática". O redator reescreve o quanto quiser por cima; o
 *      campo continua 'ai-assisted' porque a pergunta que ele responde é sobre a
 *      PROCEDÊNCIA do rascunho, e essa não muda depois.
 *
 *   3. NÃO É UM SELO PARA O LEITOR. Nada disso vai para a página pública neste
 *      momento — é instrumento de redação. O dia em que o produto decidir
 *      declarar uso de IA ao leitor (discussão editorial legítima, e crescente),
 *      o dado já vai existir para sustentar a declaração. O contrário — decidir
 *      declarar e descobrir que ninguém guardou — não tem conserto retroativo.
 *
 * -----------------------------------------------------------------------------
 * PARA QUE ELE SERVE, ENTÃO
 * -----------------------------------------------------------------------------
 *   AUDITORIA. "Quais matérias no ar começaram como sugestão automática?" é uma
 *   pergunta que o dono do site vai fazer no primeiro incidente de imprecisão, e
 *   uma que só tem resposta se a coluna existir ANTES do incidente.
 *
 *   REVISÃO. A tela de matérias e o formulário mostram um aviso discreto: quem
 *   revisa passa a saber que aquele texto merece a leitura mais desconfiada.
 *
 *   MEDIÇÃO. "A sugestão automática está economizando tempo ou dando trabalho?"
 *   depende de conseguir separar os dois grupos e comparar.
 */

export const CONTENT_ORIGINS = ['human', 'ai-assisted'] as const;

export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

/**
 * Valor desconhecido cai em 'human'.
 *
 * Mesmo raciocínio de `toTopicOrigin`: o padrão é a VERDADE HISTÓRICA, não um
 * chute. Toda matéria que existia antes desta coluna foi escrita por gente, e o
 * erro na direção contrária seria pior — marcar como automático um texto humano
 * levanta uma suspeita infundada sobre o trabalho de alguém.
 */
export function toContentOrigin(value: unknown): ContentOrigin {
  return value === 'ai-assisted' ? 'ai-assisted' : 'human';
}

export const CONTENT_ORIGIN_LABELS: Record<ContentOrigin, string> = {
  human: 'Escrita pela redação',
  'ai-assisted': 'Rascunho inicial gerado por IA',
};
