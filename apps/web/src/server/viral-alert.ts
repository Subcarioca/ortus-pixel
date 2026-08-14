import 'server-only';

/**
 * =============================================================================
 * ALERTA DE PAUTA COM POTENCIAL DE VIRALIZAR
 * =============================================================================
 *
 * O PEDIDO: "quando uma pauta tiver chance real de virar hit, avise a redação
 * por e-mail". A dificuldade não está em enviar e-mail — está em enviar o
 * NÚMERO CERTO de e-mails.
 *
 * -----------------------------------------------------------------------------
 * O PROBLEMA QUE MATA ESTE TIPO DE FUNCIONALIDADE
 * -----------------------------------------------------------------------------
 * O curator recalcula score continuamente. Um alerta ingênuo ("se score >= 80,
 * mande e-mail") dispara a CADA ciclo enquanto o tópico continuar quente: uma
 * pauta que fica seis horas em alta vira dezenas de mensagens idênticas para
 * toda a redação. O desfecho não é irritação — é a redação criando uma regra no
 * cliente de e-mail que arquiva tudo automaticamente, e aí o alerta que
 * importava também morre. Um alerta que ninguém lê é pior do que alerta nenhum,
 * porque custa manutenção e dá uma falsa sensação de cobertura.
 *
 * A REGRA IMPLEMENTADA, e o que cada parte dela evita:
 *
 *   1. LIMIAR POR FAIXA, NÃO POR NÚMERO SOLTO. O gatilho é a banda 'HOT' (>= 80),
 *      que já é definida em `core/scoring-types.ts` como "alerta imediato para a
 *      redação" (`alertsNewsroom: true`). Reusar essa definição, em vez de
 *      escrever outro número aqui, evita o sistema ter duas opiniões sobre o que
 *      é urgente.
 *
 *   2. SÓ NA SUBIDA DE FAIXA. Guardamos a faixa do último alerta
 *      (`Topic.viralAlertBand`) e só voltamos a alertar se a faixa atual for
 *      diferente daquela. É a diferença entre "avisar quando muda" e "avisar
 *      enquanto for verdade".
 *
 *      ⚠ O QUE ISSO SIGNIFICA HOJE, na prática, e vale dizer sem rodeio: existe
 *      UMA única faixa que alerta ('HOT'), então a regra equivale a UM E-MAIL
 *      POR PAUTA, para sempre. A segunda cláusula da consulta parece morta — e
 *      está, de propósito. Ela é o que faz o dia em que 'RISING' passar a
 *      alertar (mudando `alertsNewsroom` em core/scoring-types.ts) funcionar
 *      sozinho, com RISING → HOT gerando o segundo aviso. Escrever a regra pela
 *      metade agora custaria uma releitura inteira deste arquivo depois.
 *
 *   3. PERÍODO DE SILÊNCIO. Nenhum tópico alertado há menos de N horas volta a
 *      alertar, aconteça o que acontecer. É a defesa contra oscilação em torno
 *      do limiar (79 → 81 → 79 → 81), que sem isso viraria um alerta por ciclo
 *      assim que houvesse mais de uma faixa alertando.
 *
 *   4. CONFIANÇA MÍNIMA. Score alto com confiança baixa é "achamos que talvez",
 *      e o próprio painel já trata os dois números como inseparáveis. Acordar a
 *      redação por um palpite queima o alerta rápido.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ISTO NÃO VIVE DENTRO DO `services/curator`
 * -----------------------------------------------------------------------------
 * Seria o lugar "natural" — é lá que o score muda. Duas razões concretas para
 * ficar aqui:
 *
 *   (a) O adaptador de e-mail é do app web (`server/email.ts`), junto com a
 *       configuração de remetente e a URL pública do site. Duplicá-lo no curator
 *       criaria dois caminhos de envio para manter.
 *   (b) Separação de responsabilidade: o curator MEDE, o app AVISA. Um erro de
 *       SMTP não pode derrubar o ciclo de curadoria, e é exatamente isso que
 *       aconteceria se o envio fosse uma etapa de dentro do pipeline.
 *
 * O acionamento é uma chamada HTTP à rota `/api/internal/viral-alerts` — o mesmo
 * padrão que o curator já usa para invalidar cache (`/api/revalidate`).
 */

import { prisma } from '@subcarioca/db';
import { SCORE_BANDS, absoluteUrl, bandForScore, routes } from '@subcarioca/core';

import { sendEmail } from './email';
import { SITE_NAME } from '@/lib/site';

/**
 * Faixas que disparam alerta.
 *
 * DERIVADO de `SCORE_BANDS`, e não uma lista escrita à mão: a propriedade
 * `alertsNewsroom` já existe lá e é a definição oficial de "isto acorda a
 * redação". Se um dia RISING passar a alertar, muda-se a definição num lugar só
 * e este módulo acompanha sem ninguém lembrar dele.
 */
const ALERTING_BANDS = new Set(
  SCORE_BANDS.filter((band) => band.alertsNewsroom).map((band) => band.band),
);

/**
 * Confiança mínima para alertar (0 a 1).
 *
 * 0,5 não é chute fino: abaixo disso, metade das dimensões do score costuma
 * estar indisponível (conector fora do ar, assunto novo demais para ter dado), e
 * o número é mais ruído do que medida. Configurável por ambiente para permitir
 * calibrar sem deploy — o tipo de ajuste que se descobre no primeiro mês.
 */
function minConfidence(): number {
  const configured = Number(process.env.VIRAL_ALERT_MIN_CONFIDENCE);
  return Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured : 0.5;
}

/**
 * Silêncio entre alertas do MESMO tópico, em horas.
 *
 * 12h cobre um turno inteiro: se o assunto voltar a esquentar no dia seguinte,
 * é notícia de novo e merece um segundo aviso.
 */
function quietHours(): number {
  const configured = Number(process.env.VIRAL_ALERT_QUIET_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : 12;
}

/** Teto de tópicos alertados por execução. */
const MAX_PER_RUN = 5;

export interface ViralAlertResult {
  /** Tópicos que passaram por todos os critérios e geraram e-mail. */
  alerted: { id: string; title: string; score: number }[];
  /** Quantas contas receberam cada alerta. */
  recipients: number;
  /** Motivo de não ter alertado nada, quando for o caso. */
  note?: string;
}

/**
 * Varre os tópicos, decide quem merece alerta e envia.
 *
 * IDEMPOTENTE NA PRÁTICA: rodar duas vezes seguidas não manda o e-mail duas
 * vezes, porque a primeira execução grava `viralAlertSentAt`/`viralAlertBand` e
 * a segunda encontra o tópico já alertado. Isso importa porque um job de fundo
 * ganha retentativa mais cedo ou mais tarde — e, quando ganhar, ninguém vai
 * lembrar de conferir se este código aguentava.
 */
export async function runViralAlerts(): Promise<ViralAlertResult> {
  const bands = [...ALERTING_BANDS];
  const cutoff = new Date(Date.now() - quietHours() * 3_600_000);

  /**
   * OS DESTINATÁRIOS SÃO LIDOS ANTES DOS TÓPICOS, de propósito.
   *
   * Sem ninguém para avisar, nem vale consultar tópicos — e, mais importante,
   * não podemos marcar `viralAlertSentAt` num tópico cujo e-mail não foi para
   * lugar nenhum. Isso "queimaria" o alerta: o tópico ficaria marcado como
   * avisado e o aviso de verdade nunca aconteceria.
   */
  const recipients = await prisma.author.findMany({
    where: {
      isActive: true,
      systemRole: { in: ['admin', 'redator'] },
    },
    select: { email: true, name: true },
  });

  if (recipients.length === 0) {
    return { alerted: [], recipients: 0, note: 'Nenhuma conta ativa para avisar.' };
  }

  const candidates = await prisma.topic.findMany({
    where: {
      // Pauta já publicada ou descartada não é oportunidade — é trabalho feito.
      status: { in: ['new', 'assigned'] },
      currentBand: { in: bands },
      confidence: { gte: minConfidence() },
      OR: [
        // Nunca alertado.
        { viralAlertSentAt: null },
        // Alertado numa faixa DIFERENTE (ou seja, subiu) e fora do silêncio.
        {
          AND: [
            { viralAlertBand: { notIn: bands } },
            { viralAlertSentAt: { lt: cutoff } },
          ],
        },
      ],
    },
    orderBy: { currentScore: 'desc' },
    take: MAX_PER_RUN,
    select: {
      id: true,
      title: true,
      summary: true,
      currentScore: true,
      currentBand: true,
      confidence: true,
      scoreSummary: true,
      sourceName: true,
      sourceUrl: true,
      category: { select: { name: true } },
      franchises: { select: { franchise: { select: { name: true } } } },
    },
  });

  if (candidates.length === 0) {
    return { alerted: [], recipients: recipients.length, note: 'Nada acima do limiar.' };
  }

  const alerted: ViralAlertResult['alerted'] = [];

  for (const topic of candidates) {
    /**
     * A MARCA É GRAVADA ANTES DO ENVIO, e essa ordem é uma escolha consciente
     * entre dois erros possíveis:
     *
     *   marcar depois → se o processo morrer no meio do envio (deploy, OOM,
     *                   timeout do provedor), a próxima execução reenvia tudo.
     *                   Erro: SPAM na redação inteira.
     *   marcar antes  → se o envio falhar, aquele alerta se perde.
     *                   Erro: um aviso a menos.
     *
     * Escolhemos o segundo. Um alerta perdido é recuperável (a pauta continua na
     * fila, ordenada por score, visível no painel — que é a fonte primária);
     * uma enxurrada de e-mails destrói a confiança no canal de forma permanente.
     *
     * O `updateMany` com `viralAlertSentAt` no `where` é o que torna isto seguro
     * sob concorrência: se duas execuções acontecerem ao mesmo tempo, só uma
     * consegue `count === 1` e só ela envia. É a mesma técnica já usada para
     * impedir matéria duplicada em `api/admin/topics/[id]`.
     */
    const claimed = await prisma.topic.updateMany({
      where: {
        id: topic.id,
        OR: [{ viralAlertSentAt: null }, { viralAlertSentAt: { lt: cutoff } }],
      },
      data: {
        viralAlertSentAt: new Date(),
        viralAlertBand: topic.currentBand,
      },
    });

    if (claimed.count === 0) continue;

    const message = buildViralAlertEmail({
      title: topic.title,
      summary: topic.summary,
      score: topic.currentScore,
      confidence: topic.confidence,
      scoreSummary: topic.scoreSummary,
      categoryName: topic.category?.name ?? null,
      franchises: topic.franchises.map((f) => f.franchise.name),
      sourceName: topic.sourceName,
      sourceUrl: topic.sourceUrl,
    });

    /**
     * UM E-MAIL POR PESSOA, com o endereço dela no `to`.
     *
     * A alternativa (um envio com todos em cópia) vazaria a lista de e-mails da
     * redação inteira para cada destinatário e, num veículo, essa lista é
     * informação de contato profissional que não precisa circular. O custo é N
     * requisições ao provedor; com uma redação de poucas pessoas e no máximo
     * cinco tópicos por execução, é irrelevante.
     *
     * Falha de envio individual NÃO interrompe o laço: um endereço com problema
     * não pode impedir o resto da redação de ser avisada.
     */
    for (const recipient of recipients) {
      const result = await sendEmail({ ...message, to: recipient.email });
      if (!result.ok) {
        console.error(`[viral-alert] falha ao enviar para uma conta: ${result.error}`);
      }
    }

    await prisma.pipelineEvent.create({
      data: {
        eventType: 'topic.became_hot',
        topicId: topic.id,
        payload: {
          alert: 'email',
          score: topic.currentScore,
          band: topic.currentBand,
          recipients: recipients.length,
        },
      },
    });

    alerted.push({ id: topic.id, title: topic.title, score: topic.currentScore });
  }

  return { alerted, recipients: recipients.length };
}

/**
 * Monta o e-mail.
 *
 * TEXTO PURO, sem HTML. Não é economia: é o formato que chega igual em todo
 * cliente de e-mail, aparece inteiro na notificação do celular (que é onde este
 * aviso será lido de verdade) e não some por bloqueio de imagem remota. O
 * conteúdo é uma decisão de dez segundos — "vale largar o que estou fazendo?" —,
 * e para isso o que serve é a manchete, o número e o link.
 *
 * O `to` sai vazio de propósito: quem preenche é o laço de envio, um
 * destinatário por vez.
 */
function buildViralAlertEmail(topic: {
  title: string;
  summary: string;
  score: number;
  confidence: number;
  scoreSummary: string;
  categoryName: string | null;
  franchises: string[];
  sourceName: string | null;
  sourceUrl: string | null;
}) {
  const band = bandForScore(topic.score);
  const painel = absoluteUrl(routes.admin());

  const linhas = [
    `${topic.title}`,
    '',
    `Score ${Math.round(topic.score)} (${band.label}) · confiança ${Math.round(topic.confidence * 100)}%`,
    band.publishTargetMinutes
      ? `Meta de publicação: ${band.publishTargetMinutes} minutos.`
      : 'Sem meta de velocidade.',
    '',
    topic.summary || '(sem resumo)',
    '',
    topic.scoreSummary ? `Por que subiu: ${topic.scoreSummary}` : '',
    topic.categoryName ? `Editoria: ${topic.categoryName}` : '',
    topic.franchises.length > 0 ? `Franquias: ${topic.franchises.join(', ')}` : '',
    topic.sourceName ? `Fonte: ${topic.sourceName}${topic.sourceUrl ? ` — ${topic.sourceUrl}` : ''}` : '',
    '',
    `Assumir a pauta no painel: ${painel}`,
    '',
    '—',
    'Você recebe este aviso porque tem conta ativa na redação.',
    'Ele é disparado uma vez por pauta, quando ela entra na faixa QUENTE.',
  ];

  return {
    to: '',
    subject: `[${SITE_NAME}] Pauta quente: ${topic.title.slice(0, 90)}`,
    text: linhas.filter((linha) => linha !== '').join('\n'),
  };
}
