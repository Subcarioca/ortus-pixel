/**
 * =============================================================================
 * TETO DA FILA ATIVA — a faxina por RELEVÂNCIA (a outra é por idade)
 * =============================================================================
 *
 * O REQUISITO, nas palavras do dono do site: "a cada nova chamada do curator, ele
 * deve sobrescrever as pautas que perderam relevância por novas pautas. Caso a
 * pauta tenha mantido a relevância, ela deve ser mantida na sua colocação. Se
 * aumentou, ela sobe; se diminuiu, ela desce até ser sobrescrita por pautas mais
 * relevantes. Diminua a quantidade de pautas para 30".
 *
 * -----------------------------------------------------------------------------
 * O QUE DESSE PEDIDO JÁ EXISTIA — e por isso NÃO foi construído aqui
 * -----------------------------------------------------------------------------
 * "Sobe" e "desce" já acontecem, e sem nenhuma peça nova: NÃO existe campo de
 * posição no `Topic`. A colocação é consequência de LEITURA — a fila do painel e
 * o /em-alta ordenam por `currentScore` (é o que o índice
 * `@@index([status, currentScore(sort: Desc)])` serve), e `curate.ts` reescreve
 * `currentScore`/`currentBand` de todo tópico tocado no ciclo. Score novo =
 * colocação nova na próxima consulta, automaticamente. Uma tabela de posições
 * mantida à mão só acrescentaria uma segunda verdade para divergir da primeira.
 *
 * O QUE FALTAVA ERA A EXPULSÃO. Nada limitava o TOTAL de pautas vivas ao mesmo
 * tempo. As duas travas que existiam parecem fazer isso e não fazem:
 *
 *   `topic-quota.ts`   -> 20 por ciclo / 5 por editoria. É uma taxa de CRIAÇÃO
 *                         por rodada; não diz nada sobre quantas já estão lá.
 *                         Vinte por ciclo, 48 ciclos por dia, sete dias de
 *                         validade: o teto que ele impõe ao acúmulo é da ordem
 *                         de milhares, não de dezenas.
 *   `expire-topics.ts` -> 7 dias. É IDADE PURA. Uma pauta irrelevante de ontem
 *                         (score 12) fica na fila por mais seis dias disputando
 *                         espaço com a notícia de agora, porque a única pergunta
 *                         que aquela rotina faz é "quando isso entrou?".
 *
 * As duas continuam valendo e nenhuma foi alterada. Este módulo responde a uma
 * terceira pergunta, que ninguém respondia: "a fila cabe na cabeça de quem lê?".
 *
 * -----------------------------------------------------------------------------
 * QUATRO DECISÕES QUE VALEM MAIS QUE O CÓDIGO
 * -----------------------------------------------------------------------------
 *
 * 1. MARCAR COMO 'dismissed', E NÃO APAGAR A LINHA — a regra é a mesma de
 *    `expire-topics.ts` e a razão é a mesma, então não se repete aqui inteira:
 *    `Topic.dedupeHash` é ÚNICO e é ele que impede o mesmo fato de virar pauta
 *    duas vezes; a linha apagada libera o hash e o primeiro feed que ainda
 *    listar aquela notícia a recria como "nova". Expulsar apagando seria um
 *    moinho. NUNCA se apaga `Topic` neste projeto.
 *
 *    Vale um detalhe PRÓPRIO desta rotina: a expulsão aqui é MENOS definitiva
 *    que a expiração, e de propósito. O "REVIVAL" de `upsertTopicFromItem`
 *    traz de volta para 'new' qualquer pauta 'dismissed' cujo assunto reapareça
 *    nos feeds — ou seja, o assunto que foi cortado por estar em 30º lugar e
 *    voltar a repercutir volta para a fila sozinho, com o score de agora. É
 *    exatamente o comportamento que o requisito descreve: quem perdeu
 *    relevância sai, quem recupera relevância volta.
 *
 * 2. O CORTE É PELO SCORE, NUNCA PELA IDADE. É a diferença inteira entre este
 *    módulo e a expiração. Ordenar por `currentScore` ascendente e cortar o
 *    excesso é o "sobrescrever as pautas que perderam relevância" do requisito
 *    lido ao pé da letra: quem cai no ranking desce até a borda dos 30 e, no
 *    ciclo em que uma pauta melhor chega, sai. A idade só entra como CRITÉRIO DE
 *    DESEMPATE (ver o `orderBy` abaixo), e mesmo aí só entre pautas de score
 *    idêntico.
 *
 * 3. O QUE É CONTADO x O QUE PODE SER EXPULSO — não são o mesmo conjunto, e a
 *    assimetria é deliberada (é a decisão mais discutível deste arquivo).
 *
 *    CONTA-SE toda pauta ativa ('new' ou 'assigned'), sem exceção. O número 30
 *    é sobre o que a redação VÊ na fila, e a fila do painel mostra as duas
 *    situações — inclusive a pauta já assumida, que ocupa atenção como qualquer
 *    outra. Contar só um subconjunto faria "30" significar "30 mais um tanto".
 *
 *    NÃO PODE SER EXPULSA, mesmo contando:
 *
 *      (a) PAUTA COM MATÉRIA VINCULADA (`articles: { none: {} }`). É a mesma
 *          trava de `expire-topics.ts`, e aqui ela é ainda mais necessária: o
 *          score de um assunto CAI naturalmente enquanto o repórter apura (o
 *          hype dura horas, a reportagem grande dura dias), então sem esta
 *          exclusão a rotina expulsaria preferencialmente as pautas em que
 *          alguém está trabalhando — o pior alvo possível. Não apagaria o
 *          texto, mas quebraria o vínculo editorial e o KPI de time-to-publish
 *          (que casa `Topic.becameHotAt` com a publicação).
 *
 *      (b) PAUTA COM SCORE SOBREPOSTO À MÃO (`manualScoreOverride`). O projeto
 *          inteiro repete que o humano vence o algoritmo, e a fila do painel de
 *          fato ordena pelo score EFETIVO (`manualScoreOverride ?? currentScore`,
 *          ver `web/server/topic-queue.ts`). Este módulo só sabe ordenar por
 *          coluna do banco: cortar por `currentScore` mandaria para o fim da
 *          fila justamente a pauta que um editor puxou para 95 com score
 *          algorítmico 8 — a automação desfazendo, em silêncio, a decisão de uma
 *          pessoa. Como override é ato pontual (são unidades, não dezenas),
 *          blindá-lo por inteiro custa nada e fecha o caso; o override de score
 *          BAIXO, que em tese ficaria eterno, continua saindo pela expiração de
 *          7 dias.
 *
 *    A CONSEQUÊNCIA HONESTA da assimetria: se um dia houver 30+ pautas
 *    protegidas, a fila fica acima do teto e esta rotina não terá o que cortar.
 *    É o comportamento certo — trabalho humano em andamento vale mais que um
 *    número redondo —, e o `hasMore` do retorno é o que faz isso aparecer no log
 *    em vez de virar mistério.
 *
 * 4. NUNCA TOCA EM 'published' NEM EM 'dismissed'. Idêntico à expiração: são
 *    decisões já tomadas, e reescrevê-las é apagar a decisão de alguém.
 *
 * -----------------------------------------------------------------------------
 * ONDE ISTO RODA — e por que DEPOIS de tudo, ao contrário da expiração
 * -----------------------------------------------------------------------------
 * É mais uma etapa de `runCurationCycle` (esta hospedagem não tem cron
 * confiável; o padrão do projeto é pegar carona no ciclo — ver o cabeçalho de
 * `expire-topics.ts`). Mas o lugar dentro do ciclo é o OPOSTO do da expiração, e
 * isso importa:
 *
 *   a expiração roda ANTES da descoberta, porque a idade não depende de nada
 *   que o ciclo vá fazer, e a faxina não pode ser refém de um feed que trave;
 *
 *   este roda DEPOIS da descoberta e da pontuação, porque o critério é
 *   comparativo: ele precisa ver os scores JÁ ATUALIZADOS deste ciclo e as
 *   pautas novas JÁ CRIADAS. Rodando antes, decidiria quem sai com os números da
 *   rodada passada e cortaria justamente a pauta que acabou de subir.
 *
 * O preço é o que o cabeçalho da expiração alerta: uma etapa no fim da função
 * não roda se o ciclo estourar antes. Aqui isso é aceitável — fila grande demais
 * por 30 minutos é um incômodo, e no ciclo seguinte o excesso continua lá para
 * ser cortado. A rotina, como a irmã, NUNCA LANÇA.
 */

import { prisma } from '@subcarioca/db';

import { logPipelineEvents } from '../actions/instrumentation';

/**
 * Teto de pautas vivas na fila ao mesmo tempo — o número do requisito, escrito
 * uma vez.
 *
 * NÃO é configurável por variável de ambiente, pela mesma razão que
 * `TOPIC_EXPIRY_DAYS` e `MAX_NEW_TOPICS_PER_CYCLE` não são: é uma regra
 * EDITORIAL (quantas pautas a redação consegue ter em aberto sem que a fila vire
 * paisagem), não um parâmetro de infraestrutura. Regra editorial que mora no
 * ambiente é regra que muda sem ninguém decidir e sem deixar rastro no histórico
 * do código.
 *
 * ⚠ 30 NÃO É "MENOR QUE OS 20 DE `MAX_NEW_TOPICS_PER_CYCLE`" — os dois números
 * medem coisas diferentes e a comparação direta engana. 20 é quantas pautas
 * NASCEM por rodada; 30 é quantas EXISTEM ao mesmo tempo. O "diminua para 30" do
 * requisito é sobre o total, que até aqui não tinha teto nenhum (só o limite
 * indireto dos 7 dias de validade, na casa dos milhares). A relação entre os
 * dois, aliás, é o que mantém a fila viva: com 20 vagas de criação por ciclo
 * contra 30 lugares, uma rodada forte renova até dois terços da fila — bastante
 * para o "sobrescrever" do requisito, sem varrer tudo de uma vez.
 */
export const MAX_ACTIVE_TOPICS = 30;

/**
 * Teto de expulsões por ciclo.
 *
 * Existe pelo mesmo motivo do teto de `expire-topics.ts`, e o caso extremo aqui
 * é ainda mais certo de acontecer: na PRIMEIRA execução desta rotina a fila de
 * produção estará muito acima de 30 (ela nunca teve teto), então o primeiro
 * corte é o passivo inteiro de uma vez. Um `UPDATE` desse tamanho segura o lock
 * da tabela justamente enquanto o ciclo grava os tópicos novos, e o sintoma
 * seria "o curator ficou lento" numa execução só, sem explicação em lugar nenhum.
 *
 * Com o teto, o passivo é drenado em blocos, um por ciclo. Em regime, o número
 * real por ciclo é de meia dúzia (o que entrou de novo na rodada) e o teto nunca
 * mais é tocado.
 */
const MAX_TRIM_PER_CYCLE = 500;

export interface TrimTopicPoolResult {
  /** Quantas pautas ativas existiam ANTES do corte. Vai para o log do ciclo. */
  active: number;
  /** Quantas foram marcadas como descartadas nesta execução. */
  dismissed: number;
  /**
   * Ainda sobrou excesso para o próximo ciclo?
   *
   * DUAS CAUSAS POSSÍVEIS, e o log não precisa distingui-las para ser útil:
   * (1) o teto de lote acima cortou a drenagem do passivo — normal na primeira
   * semana; (2) não havia candidatas suficientes porque o excesso é formado por
   * pautas protegidas (com matéria vinculada ou com override manual — ver a
   * decisão 3 no cabeçalho). Em ambos os casos a leitura é a mesma: "a fila
   * segue acima do teto de propósito, e não por falha".
   */
  hasMore: boolean;
}

/**
 * Quantas pautas passam do teto.
 *
 * Função separada (e exportada) porque é a única aritmética do módulo e é
 * exatamente onde um erro passaria despercebido — trocar o sinal ou esquecer o
 * piso em zero não gera exceção nenhuma: faz a rotina cortar a fila inteira a
 * cada ciclo, e o sintoma ("as pautas somem sozinhas") não aponta para uma
 * subtração. É também o que dá teste de verdade a este módulo sem exigir MySQL
 * de pé (ver `expire-topics.test.ts` para o mesmo corte).
 *
 * O piso em zero não é defensivo por costume: sem ele, uma fila com 12 pautas
 * devolveria -18 e o `take: -18` do Prisma percorreria a ordenação ao contrário,
 * ou seja, cortaria as MELHORES pautas da fila.
 */
export function excessOverCap(activeCount: number, cap: number = MAX_ACTIVE_TOPICS): number {
  return Math.max(0, activeCount - cap);
}

/**
 * Corta a fila ativa até o teto, expulsando as pautas de menor score. NUNCA LANÇA.
 *
 * O contrato de não lançar é o mesmo de `expireStaleTopics`, da reescrita para
 * pt-BR e da instrumentação, e pelo mesmo motivo: isto é FAXINA. Uma falha aqui
 * não pode derrubar o ciclo — fila grande é um incômodo; ciclo perdido é
 * breaking news perdida.
 */
export async function trimTopicPool(
  options: { dryRun?: boolean; cap?: number } = {},
): Promise<TrimTopicPoolResult> {
  const { dryRun = false, cap = MAX_ACTIVE_TOPICS } = options;

  /**
   * O QUE CONTA COMO "PAUTA VIVA". Ver a decisão 3 do cabeçalho: aqui não há
   * filtro de matéria nem de override — o total é o total que a redação vê.
   */
  const ATIVAS = { status: { in: ['new', 'assigned'] } };

  try {
    const active = await prisma.topic.count({ where: ATIVAS });
    const excesso = excessOverCap(active, cap);

    // O caminho normal em regime: a fila cabe no teto e a rotina custa UMA
    // contagem indexada. Sair aqui é o que a torna barata o bastante para rodar
    // em todo ciclo.
    if (excesso === 0) return { active, dismissed: 0, hasMore: false };

    /**
     * DUAS ETAPAS (selecionar ids, depois atualizar), e não um `updateMany`
     * direto — pelas mesmas duas razões de `expire-topics.ts`: o `updateMany` do
     * Prisma não aceita `take` (não haveria como impor o teto de lote nem o
     * "corte só o excesso"), e sem os ids o descarte seria um número solto no
     * log, sem resposta para "o que aconteceu com a minha pauta?".
     *
     * ORDENAÇÃO — o coração da regra:
     *   `currentScore: 'asc'` põe as MENOS relevantes na frente da fila de
     *     expulsão. É o requisito ao pé da letra.
     *   `createdAt: 'asc'` desempata. Empate é frequente e não é hipótese
     *     acadêmica: pauta recém-criada que ainda não passou pelo enriquecimento
     *     fica com score baixo e parecido com o de outras. Entre dois valores
     *     iguais, sacrifica-se a mais ANTIGA — mesma prioridade que a expiração
     *     e o corte da reescrita já usam. Sem o desempate, a escolha ficaria a
     *     cargo da ordem física das linhas no MySQL, que ninguém controla e que
     *     pode mudar sozinha entre um ciclo e outro.
     */
    const candidatas = await prisma.topic.findMany({
      where: {
        ...ATIVAS,
        // Trabalho em andamento não é fila parada. Ver decisão 3(a).
        articles: { none: {} },
        // Decisão humana não é sobrescrita por automação. Ver decisão 3(b).
        manualScoreOverride: null,
      },
      orderBy: [{ currentScore: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(excesso, MAX_TRIM_PER_CYCLE),
      select: {
        id: true,
        title: true,
        status: true,
        currentScore: true,
        currentBand: true,
      },
    });

    // Sobrou excesso? Só é `false` quando o corte deu conta do recado inteiro.
    // As duas causas possíveis estão no comentário do campo, lá em cima.
    const hasMore = candidatas.length < excesso;

    if (candidatas.length === 0) return { active, dismissed: 0, hasMore };

    // `dryRun` é o mesmo contrato do resto do pipeline: mede sem gravar. Aqui é
    // a forma de conferir QUANTAS pautas o teto cortaria antes de soltar a regra
    // no banco de produção — e, na estreia, de dimensionar o passivo.
    if (dryRun) return { active, dismissed: candidatas.length, hasMore };

    const ids = candidatas.map((topic) => topic.id);

    /**
     * O `status` volta ao filtro de propósito, como na expiração: entre a
     * leitura acima e esta escrita, um editor pode ter assumido, publicado ou
     * descartado a pauta pelo painel — e sobrescrever a decisão dele com
     * 'dismissed' transformaria uma corrida rara em perda silenciosa de trabalho
     * humano.
     */
    const { count } = await prisma.topic.updateMany({
      where: { id: { in: ids }, status: { in: ['new', 'assigned'] } },
      data: { status: 'dismissed' },
    });

    /**
     * INSTRUMENTAÇÃO: um evento por pauta expulsa.
     *
     * A necessidade é a mesma da expiração e agora é MAIOR: o `status` final de
     * uma pauta expulsa é idêntico ao de uma expirada por idade E ao de uma
     * descartada à mão por um editor — três histórias diferentes com a mesma
     * marca no banco. Sem este evento, "por que esta pauta sumiu da fila?" fica
     * sem resposta, e a diferença entre "uma pessoa decidiu", "envelheceu" e
     * "perdeu no ranking" é exatamente o que se precisa saber meses depois,
     * quando alguém questionar o número 30.
     *
     * O `score` e a `band` vão no payload porque são a JUSTIFICATIVA do corte:
     * "saiu com 11 pontos, faixa EVERGREEN" é uma explicação; "saiu" não é.
     *
     * Vai em LOTE (um `INSERT` só) porque na primeira execução são centenas.
     */
    await logPipelineEvents(
      candidatas.map((topic) => ({
        eventType: 'topic.evicted',
        topicId: topic.id,
        payload: {
          reason: 'pool_cap',
          cap,
          activeBefore: active,
          previousStatus: topic.status,
          score: topic.currentScore,
          band: topic.currentBand,
        },
      })),
    );

    return { active, dismissed: count, hasMore };
  } catch (error) {
    // Ver o contrato de "nunca lança" no cabeçalho desta função.
    console.error(
      '[topic-pool] falha ao cortar a fila pelo teto (a fila segue como está):',
      error instanceof Error ? error.message : error,
    );
    return { active: 0, dismissed: 0, hasMore: false };
  }
}
