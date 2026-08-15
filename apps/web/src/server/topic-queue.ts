/**
 * =============================================================================
 * FILA DE PAUTAS — score EFETIVO e ordenação
 * =============================================================================
 *
 * O PROBLEMA QUE ESTE MÓDULO EXISTE PARA RESOLVER (era um bug real, em produção):
 *
 * O painel exibia, em cada linha da fila, `manualScoreOverride ?? currentScore`
 * — o número que o editor forçou, quando havia um. Mas a ORDENAÇÃO vinha do
 * banco, por `currentScore`, que é só o score do algoritmo. O resultado era uma
 * tela que se contradizia: uma pauta etiquetada com 95 (override manual) podia
 * aparecer no fim da lista — ou nem aparecer, cortada pelo `take: 50` — porque o
 * algoritmo tinha dado 12 para ela.
 *
 * Isso não é um detalhe de apresentação: contradiz o princípio escrito no
 * cabeçalho da própria página ("o override manual sempre vence o algoritmo") e,
 * pior, o contradiz EM SILÊNCIO. O editor força o score justamente porque o
 * algoritmo errou; se o efeito prático é a pauta continuar enterrada, o recurso
 * de override é decoração, e a redação aprende a não confiar na fila.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ORDENAR EM MEMÓRIA, E NÃO NO BANCO
 * -----------------------------------------------------------------------------
 * O score efetivo não é uma COLUNA — é `COALESCE(manualScoreOverride,
 * currentScore)`. O `orderBy` do Prisma só aceita colunas (e relações), então as
 * saídas seriam:
 *
 *   a) `$queryRaw` com o COALESCE no ORDER BY. Ordenação correta e paginação
 *      correta no banco, mas custa perder o `include` tipado (categoria,
 *      franquias, último snapshot) — teríamos de remontar tudo à mão, com SQL
 *      escrito na mão numa tela que hoje não tem uma linha de SQL.
 *   b) Uma coluna materializada `effectiveScore`, mantida por trigger ou pelo
 *      curator. É a resposta certa para uma tabela de milhões de linhas, e uma
 *      complexidade desproporcional aqui.
 *   c) Buscar uma janela e ordenar em memória. É o que fazemos.
 *
 * (c) se sustenta em um fato mensurável, não em preguiça: a fila só contém
 * tópicos com status 'new' ou 'assigned' — pauta publicada ou descartada sai
 * dela. Isso é uma tabela de dezenas a poucas centenas de linhas, com teto
 * explícito (`TOPIC_QUEUE_WINDOW`). Ordenar 200 objetos em JavaScript custa
 * microssegundos; o gargalo desta página é a ida ao banco, não o `sort`.
 *
 * ⚠ SE ESTA PREMISSA MUDAR (fila passando do teto com frequência), a resposta
 * não é aumentar o teto indefinidamente — é a opção (b). O teto é o alarme:
 * quando a fila encostar nele, o número de pautas exibidas para de crescer e
 * isso aparece na tela, em vez de a página ficar lenta em silêncio.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE MÓDULO É PURO (e não fala com o Prisma)
 * -----------------------------------------------------------------------------
 * Só recebe objetos e devolve objetos. É o que permite testá-lo com o runner do
 * Node, sem banco e sem Next (ver `topic-queue.test.ts` e o comentário do script
 * `test` em package.json). A regra que estava errada era a de ORDENAÇÃO — é
 * exatamente ela que fica coberta por teste agora.
 */

/**
 * Quantas pautas a tela mostra depois de ordenar.
 *
 * O corte acontece DEPOIS da ordenação — essa ordem é o coração da correção.
 * Cortar antes (que era o efeito do `take: 50` no banco) é o que descartava a
 * pauta com override alto e score algorítmico baixo.
 */
export const TOPIC_QUEUE_SIZE = 50;

/**
 * Teto da janela buscada no banco para depois ser reordenada.
 *
 * Generoso o bastante para a fila real caber inteira, e baixo o bastante para
 * que um acidente (um conector duplicando pautas, por exemplo) não vire uma
 * consulta que traz a tabela toda para a memória do servidor.
 */
export const TOPIC_QUEUE_WINDOW = 200;

/**
 * O mínimo que um tópico precisa ter para ser ordenado por aqui.
 *
 * Interface estrutural (e não o tipo `Topic` do Prisma) de propósito: o módulo
 * não deve depender do cliente gerado, e o teste pode montar objetos de duas
 * linhas em vez de tópicos completos com trinta campos.
 */
export interface ScorableTopic {
  currentScore: number;
  manualScoreOverride: number | null;
}

/**
 * O score que VALE — o que a tela mostra e pelo qual a fila é ordenada.
 *
 * `??` e não `||`: um override de 0 ("esta pauta não interessa, mas não quero
 * descartá-la") é um valor legítimo, e `||` o trocaria pelo score algorítmico,
 * fazendo a pauta ressuscitar no topo. É a diferença entre "não definido" e
 * "definido como zero", e aqui ela tem consequência editorial.
 */
export function effectiveTopicScore(topic: ScorableTopic): number {
  return topic.manualScoreOverride ?? topic.currentScore;
}

/**
 * Ordena pelo score efetivo (decrescente) e SÓ ENTÃO corta.
 *
 * Não muda o array recebido (`[...topics]`): `Array.prototype.sort` ordena no
 * lugar, e mutar a lista de resultados do Prisma faria a ordem depender de quem
 * chamou esta função primeiro — o tipo de acoplamento que só aparece meses
 * depois, quando uma segunda tela reusa os mesmos dados.
 *
 * O `sort` do JavaScript é ESTÁVEL por especificação (ES2019+), então empates de
 * score preservam a ordem em que os itens chegaram — que é a do banco. Isso
 * torna a tela determinística: duas cargas seguidas, sem nada ter mudado,
 * mostram a mesma fila na mesma ordem.
 */
export function rankTopicQueue<T extends ScorableTopic>(
  topics: readonly T[],
  limit: number = TOPIC_QUEUE_SIZE,
): T[] {
  return [...topics]
    .sort((a, b) => effectiveTopicScore(b) - effectiveTopicScore(a))
    .slice(0, limit);
}
