/**
 * =============================================================================
 * ALERTA PARA A REDAÇÃO
 * =============================================================================
 *
 * Quando um tópico entra na faixa QUENTE, a redação precisa saber AGORA — a
 * meta é publicar em 30 minutos, e cada minuto gasto até alguém perceber sai
 * desse orçamento.
 *
 * ARQUITETURA DE ADAPTADORES: o canal de alerta (Slack, Discord, e-mail, SMS)
 * é um detalhe de implementação. O pipeline chama `notifyNewsroom()` e não sabe
 * nem se importa com o destino. Trocar de Slack para Discord é escrever um
 * adaptador novo e mudar uma variável de ambiente.
 *
 * O adaptador padrão é o console, de modo que o sistema funcione em
 * desenvolvimento sem nenhuma configuração — mesma filosofia do seed.
 */

import type { EmotionalTrigger } from '@subcarioca/core';
import { EMOTIONAL_TRIGGER_LABELS } from '@subcarioca/core';

export interface NewsroomAlert {
  topicId: string;
  title: string;
  score: number;
  confidence: number;
  summary: string;
  /** `true` quando a automação foi bloqueada e um humano precisa decidir. */
  requiresReview: boolean;
  reviewReason: string;
  emotionalTriggers: EmotionalTrigger[];
  targetMinutes: number;
}

/** Contrato do canal de alerta. */
interface AlertChannel {
  readonly name: string;
  isConfigured(): boolean;
  send(alert: NewsroomAlert): Promise<void>;
}

const adminUrl = (topicId: string): string => {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return `${base}/admin/topicos/${topicId}`;
};

/**
 * Canal de console — padrão em desenvolvimento.
 * Formatado para ser legível de verdade no terminal: em dev, este é o feedback
 * principal de que o pipeline está funcionando.
 */
const consoleChannel: AlertChannel = {
  name: 'console',
  isConfigured: () => true,
  async send(alert) {
    const triggers =
      alert.emotionalTriggers.length > 0
        ? alert.emotionalTriggers.map((t) => EMOTIONAL_TRIGGER_LABELS[t]).join(', ')
        : 'nenhum';

    console.log(
      [
        '',
        '='.repeat(72),
        `  ALERTA QUENTE — score ${alert.score.toFixed(0)}/100`,
        '='.repeat(72),
        `  ${alert.title}`,
        '',
        `  Confiança:  ${(alert.confidence * 100).toFixed(0)}%`,
        `  Gatilhos:   ${triggers}`,
        `  Meta:       publicar em até ${alert.targetMinutes} minutos`,
        `  Análise:    ${alert.summary}`,
        '',
        alert.requiresReview
          ? `  >> REVISÃO HUMANA OBRIGATÓRIA: ${alert.reviewReason}`
          : '  >> Elegível a push automático após publicação.',
        '',
        `  Abrir: ${adminUrl(alert.topicId)}`,
        '='.repeat(72),
        '',
      ].join('\n'),
    );
  },
};

/**
 * Canal de Slack via Incoming Webhook.
 *
 * SEGURANÇA: a URL do webhook É um segredo — quem a tiver posta no canal da
 * redação como se fosse o sistema. Por isso ela vive só em variável de
 * ambiente, nunca é logada e nunca aparece em mensagem de erro.
 */
const slackChannel: AlertChannel = {
  name: 'slack',
  isConfigured: () => Boolean(process.env.SLACK_WEBHOOK_URL),
  async send(alert) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return;

    const emoji = alert.requiresReview ? ':warning:' : ':fire:';

    const payload = {
      text: `${emoji} QUENTE (${alert.score.toFixed(0)}/100): ${alert.title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} Score ${alert.score.toFixed(0)} — publicar em ${alert.targetMinutes}min`,
          },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${alert.title}*\n${alert.summary}` },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Confiança: ${(alert.confidence * 100).toFixed(0)}% | ${
                alert.requiresReview ? `:warning: ${alert.reviewReason}` : 'Push liberado'
              }`,
            },
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Assumir pauta' },
              url: adminUrl(alert.topicId),
              style: alert.requiresReview ? 'danger' : 'primary',
            },
          ],
        },
      ],
    };

    // Timeout curto: o alerta é urgente. Se o Slack não responder em 5s,
    // desistimos — insistir atrasaria o processamento dos próximos tópicos.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        // Logamos o status, JAMAIS a URL do webhook.
        console.error(`[alert] Slack respondeu ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  },
};

const CHANNELS: AlertChannel[] = [slackChannel, consoleChannel];

/**
 * Envia o alerta por todos os canais configurados.
 *
 * `allSettled`: se o Slack estiver fora, o console ainda registra. Redundância
 * proposital — perder um alerta de breaking news é perder a matéria.
 */
export async function notifyNewsroom(alert: NewsroomAlert): Promise<void> {
  const active = CHANNELS.filter((channel) => channel.isConfigured());

  const results = await Promise.allSettled(active.map((channel) => channel.send(alert)));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[alert] canal "${active[index]?.name}" falhou:`, result.reason);
    }
  });
}
