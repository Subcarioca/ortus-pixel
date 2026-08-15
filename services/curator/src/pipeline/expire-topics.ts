/**
 * =============================================================================
 * EXPIRAÇÃO DE PAUTAS — a faxina da fila
 * =============================================================================
 *
 * O REQUISITO, nas palavras do dono do site: "as pautas sugeridas não devem ter
 * mais de 1 semana; pautas que ficarem por mais de uma semana devem ser
 * sobrescritas por novas pautas para que não haja acúmulo desnecessário".
 *
 * O PROBLEMA REAL POR TRÁS DELE: até aqui NADA limpava `Topic`. O ciclo do
 * curator só sabia acrescentar — cada execução descobre dezenas de itens e
 * grava os que não são duplicata. Uma fila que só cresce degrada de um jeito
 * particularmente traiçoeiro: ela não fica lenta (o painel já corta em 50 por
 * score), ela fica MENTIROSA. Uma pauta de dez dias atrás com score 62 continua
 * disputando as 50 vagas com a notícia de hoje que tirou 58 — e a de dez dias
 * atrás já não é notícia nenhuma. O acúmulo não enche a tela: ele empurra o que
 * importa para fora dela.
 *
 * -----------------------------------------------------------------------------
 * TRÊS DECISÕES QUE VALEM MAIS QUE O CÓDIGO
 * -----------------------------------------------------------------------------
 *
 * 1. MARCAR COMO 'dismissed', E NÃO APAGAR A LINHA.
 *
 *    'dismissed' é o status que o vocabulário do domínio JÁ tem para "esta
 *    pauta saiu da fila sem virar matéria" — é o mesmo que a ação "descartar"
 *    do painel grava (ver a rota PATCH de tópicos). Reaproveitá-lo significa
 *    que a fila do painel, o `@@index([status, currentScore])` e qualquer
 *    consulta futura continuam funcionando sem saber que esta rotina existe.
 *    Um status novo ('expired') obrigaria a revisar todo `where` do projeto —
 *    e o primeiro esquecido faria a pauta expirada reaparecer na fila.
 *
 *    APAGAR seria pior por um motivo concreto e não óbvio: `Topic.dedupeHash` é
 *    ÚNICO e é ele que impede o mesmo fato de virar tópico duas vezes. A linha
 *    apagada libera o hash, e o primeiro feed que ainda listar aquela notícia
 *    antiga a recria — a pauta "expirada" volta do zero, com data de hoje, e o
 *    trabalho de faxina vira um moinho. Manter a linha morta é o que faz a
 *    expiração ser definitiva. (De quebra, preserva o histórico de score e a
 *    trilha de instrumentação, que são de auditoria.)
 *
 * 2. O QUE NUNCA EXPIRA: pauta que já virou trabalho.
 *
 *    Só entram `status` 'new' e 'assigned' — as duas situações de "ninguém
 *    decidiu nada ainda". 'published' e 'dismissed' são decisões tomadas, e
 *    reescrevê-las seria apagar a decisão de uma pessoa.
 *
 *    E há uma segunda trava, essa por LINHA e não por status: pauta que já tem
 *    matéria vinculada fica de fora, mesmo 'assigned' e mesmo com um mês. O
 *    caso é real — alguém assume uma pauta na segunda, abre o rascunho e leva
 *    duas semanas apurando uma reportagem grande. Expirar a pauta debaixo dela
 *    não apagaria o texto, mas quebraria o vínculo editorial (e o KPI de
 *    time-to-publish, que casa `Topic.becameHotAt` com a publicação). A regra é
 *    "faxina no que ninguém tocou", não "prazo de validade do trabalho alheio".
 *
 * 3. A IDADE É MEDIDA POR `createdAt`, NÃO POR `firstSeenAt`.
 *
 *    Os dois existem no schema e parecem intercambiáveis. Não são:
 *      `firstSeenAt` é a data de publicação declarada PELO FEED de terceiro —
 *        dado externo, que não controlamos. Um feed com data errada (acontece o
 *        tempo todo) ou com data no futuro criaria pauta imortal; um com data
 *        antiga demais faria a pauta nascer expirada. Pior: seria um controle
 *        de retenção nosso governado por quem publica do outro lado.
 *      `createdAt` é quando a LINHA entrou na nossa fila. É exatamente o que o
 *        requisito descreve ("pautas que ficarem [na fila] por mais de uma
 *        semana") e é um dado que só nós escrevemos.
 *    Vale também para a pauta MANUAL (`origin: 'manual'`), que não tem
 *    `firstSeenAt` vindo de lugar nenhum — ela cai no default do banco e a
 *    conta por `createdAt` continua significando a mesma coisa.
 *
 * -----------------------------------------------------------------------------
 * ONDE ISTO RODA — e por que não é um cron
 * -----------------------------------------------------------------------------
 * Esta hospedagem não tem cron confiável: está documentado no repositório
 * (`api/internal/curator-run/route.ts`) que o agendador do painel não dispara.
 * O padrão que o projeto adotou para tarefa periódica é PEGAR CARONA no ciclo
 * do curator, que já é acionado de fora — e é o que esta rotina faz: é uma
 * etapa a mais de `runCurationCycle`, sem agendamento próprio.
 *
 * A consequência é boa: a faxina roda exatamente na mesma cadência em que a
 * fila cresce. Nenhum outro ritmo faria sentido — não adianta limpar de hora em
 * hora uma fila que só muda a cada 15 minutos, e uma limpeza diária deixaria a
 * fila suja durante o dia inteiro de trabalho.
 */

import { prisma } from '@subcarioca/db';

import { logPipelineEvents } from '../actions/instrumentation';

/**
 * Sete dias — o número do requisito, escrito uma vez.
 *
 * NÃO é configurável por variável de ambiente, e isso é deliberado: é uma regra
 * EDITORIAL (quanto tempo uma pauta continua sendo notícia), não um parâmetro de
 * infraestrutura. Regra editorial que mora no ambiente é regra que muda sem
 * ninguém decidir e sem deixar rastro no histórico do código.
 */
export const TOPIC_EXPIRY_DAYS = 7;

/**
 * Teto de pautas expiradas por ciclo.
 *
 * Existe por causa da PRIMEIRA execução, que é o caso extremo: quando esta
 * rotina entrar no ar, ela encontra todo o passivo acumulado desde que o
 * pipeline começou a rodar — potencialmente milhares de linhas. Um `UPDATE`
 * único desse tamanho segura o lock da tabela justamente enquanto o ciclo
 * grava os tópicos novos, e o sintoma seria "o curator ficou lento" numa
 * execução só, sem explicação em lugar nenhum.
 *
 * Com o teto, o passivo é drenado em blocos, um por ciclo (15 min). Depois da
 * primeira semana, o número real por ciclo é de meia dúzia — o teto nunca mais
 * é tocado.
 */
const MAX_EXPIRE_PER_CYCLE = 500;

export interface ExpireTopicsResult {
  /** Quantas pautas foram marcadas como descartadas nesta execução. */
  expired: number;
  /**
   * Ainda sobrou fila vencida para o próximo ciclo?
   *
   * Só é `true` quando o teto acima foi atingido. Serve para o log distinguir
   * "a faxina terminou" de "a faxina foi interrompida no meio" — sem isso, a
   * drenagem de um passivo grande apareceria como uma sequência de ciclos
   * limpando 500 pautas sem nenhuma pista de que havia mais.
   */
  hasMore: boolean;
}

/**
 * O instante a partir do qual uma pauta é considerada vencida.
 *
 * Função separada (e exportada) porque é a única aritmética do módulo e é onde
 * um erro passaria despercebido: trocar dias por horas aqui não quebra nada —
 * só faz a fila inteira ser descartada a cada ciclo, e o sintoma ("as pautas
 * somem") não aponta para uma conta de milissegundos.
 */
export function expiryCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TOPIC_EXPIRY_DAYS * 86_400_000);
}

/**
 * Descarta as pautas vencidas. NUNCA LANÇA.
 *
 * O contrato de não lançar é o mesmo da reescrita para pt-BR e da
 * instrumentação, e pelo mesmo motivo: isto é FAXINA. Uma falha aqui não pode,
 * em hipótese alguma, derrubar a descoberta — que é a razão de o produto
 * existir. Fila suja é um incômodo; ciclo perdido é breaking news perdida.
 */
export async function expireStaleTopics(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<ExpireTopicsResult> {
  const { dryRun = false, now = new Date() } = options;
  const cutoff = expiryCutoff(now);

  try {
    /**
     * DUAS ETAPAS (selecionar ids, depois atualizar), e não um `updateMany`
     * direto com o mesmo `where`.
     *
     * O `updateMany` do Prisma não aceita `take`, então não haveria como impor
     * o teto do bloco anterior — a alternativa seria atualizar tudo de uma vez,
     * que é exatamente o que o teto existe para evitar.
     *
     * A seleção também é o que permite registrar o evento de instrumentação por
     * pauta (mais abaixo): sem os ids, o descarte seria um número solto no log e
     * ninguém conseguiria responder "o que aconteceu com a minha pauta?".
     *
     * `take: MAX + 1` é o truque de sempre para saber que há mais sem contar a
     * tabela inteira: se voltarem MAX+1 linhas, sobrou trabalho.
     */
    const vencidas = await prisma.topic.findMany({
      where: {
        // Só o que ninguém decidiu ainda. Ver a decisão 2 no cabeçalho.
        status: { in: ['new', 'assigned'] },
        createdAt: { lt: cutoff },
        // A trava por linha: pauta que já gerou matéria (mesmo rascunho) não é
        // fila parada, é trabalho em andamento.
        articles: { none: {} },
      },
      // Da mais velha para a mais nova: se o teto cortar, o que fica para o
      // próximo ciclo é o menos vencido. É a mesma prioridade do corte da
      // reescrita — quando é preciso sacrificar, sacrifica-se o mais antigo.
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPIRE_PER_CYCLE + 1,
      select: { id: true, title: true, createdAt: true, status: true },
    });

    const hasMore = vencidas.length > MAX_EXPIRE_PER_CYCLE;
    const lote = hasMore ? vencidas.slice(0, MAX_EXPIRE_PER_CYCLE) : vencidas;

    if (lote.length === 0) return { expired: 0, hasMore: false };

    // `dryRun` é o mesmo contrato do resto do pipeline: mede sem gravar. Aqui
    // ele importa mais que nos outros passos — é a forma de conferir QUANTAS
    // pautas a regra pegaria antes de deixá-la solta no banco de produção.
    if (dryRun) return { expired: lote.length, hasMore };

    const ids = lote.map((topic) => topic.id);

    /**
     * `updateMany` sobre a lista de ids: um único `UPDATE ... WHERE id IN (...)`.
     *
     * O `status` volta a aparecer no filtro de propósito. Entre a leitura acima
     * e esta escrita, um editor pode ter descartado ou publicado a pauta pelo
     * painel — e sobrescrever a decisão dele com 'dismissed' seria transformar
     * uma condição de corrida rara numa perda silenciosa de trabalho humano. É a
     * mesma proteção que um `WHERE` de atualização condicional dá.
     */
    const { count } = await prisma.topic.updateMany({
      where: { id: { in: ids }, status: { in: ['new', 'assigned'] } },
      data: { status: 'dismissed' },
    });

    /**
     * INSTRUMENTAÇÃO: um evento por pauta expirada.
     *
     * Por que não basta o número no log do ciclo: o `status` final de uma pauta
     * expirada é IDÊNTICO ao de uma descartada à mão por um editor
     * ('dismissed'). Sem este evento, a pergunta "por que esta pauta sumiu da
     * fila?" não tem resposta no banco — e a diferença entre "o sistema
     * envelheceu" e "uma pessoa decidiu" é exatamente o tipo de coisa que se
     * precisa saber seis meses depois, quando alguém questionar a regra.
     *
     * Vai em LOTE (um `INSERT` só) porque na primeira execução são centenas.
     */
    await logPipelineEvents(
      lote.map((topic) => ({
        eventType: 'topic.expired',
        topicId: topic.id,
        payload: {
          reason: 'stale',
          expiryDays: TOPIC_EXPIRY_DAYS,
          previousStatus: topic.status,
          ageDays: Math.floor((now.getTime() - topic.createdAt.getTime()) / 86_400_000),
        },
      })),
    );

    return { expired: count, hasMore };
  } catch (error) {
    // Ver o contrato de "nunca lança" no cabeçalho desta função.
    console.error(
      '[expire-topics] falha ao expirar pautas antigas (a fila segue como está):',
      error instanceof Error ? error.message : error,
    );
    return { expired: 0, hasMore: false };
  }
}
