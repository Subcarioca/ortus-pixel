import 'server-only';

import webpush from 'web-push';

import { prisma, toStringArray } from '@subcarioca/db';

import { CONTACT_EMAIL } from '@/lib/site';

/**
 * =============================================================================
 * ENVIO DE PUSH NOTIFICATION
 * =============================================================================
 *
 * Processa as campanhas criadas pelo pipeline (status 'pending') e entrega a
 * cada inscrito elegível.
 *
 * DECISÕES QUE PROTEGEM A BASE DE ASSINANTES:
 *
 *  1. SEGMENTAÇÃO POR LIMIAR: cada inscrito define seu `minScoreThreshold`
 *     (padrão 80). Notificação de score 62 simplesmente não vai para quem pediu
 *     só as urgentes.
 *
 *  2. LIMPEZA AUTOMÁTICA: endpoints que respondem 404/410 estão mortos
 *     (usuário desinstalou o navegador, limpou dados, revogou a permissão).
 *     Desativamos na hora. Insistir em endpoint morto desperdiça recurso e,
 *     em alguns serviços, prejudica a reputação do remetente.
 *
 *  3. ENVIO EM LOTES: 100 por vez. Disparar 200 mil requisições simultâneas
 *     esgotaria o pool de conexões do processo e derrubaria o site inteiro —
 *     um autogol clássico.
 */

/** Configura as credenciais VAPID. Retorna false se não estiverem presentes. */
function configureVapid(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? `mailto:${CONTACT_EMAIL}`;

  if (!publicKey || !privateKey) return false;

  // A chave PRIVADA nunca sai do servidor: é ela que prova ao serviço de push
  // que a mensagem veio de nós. Se vazar, qualquer um envia notificação em
  // nome do site — por isso ela jamais tem o prefixo NEXT_PUBLIC_.
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

const BATCH_SIZE = 100;

export interface SendResult {
  notificationId: string;
  recipients: number;
  delivered: number;
  failed: number;
  deactivated: number;
}

/** Processa uma campanha de push. */
export async function sendPushNotification(notificationId: string): Promise<SendResult> {
  const result: SendResult = {
    notificationId,
    recipients: 0,
    delivered: 0,
    failed: 0,
    deactivated: 0,
  };

  if (!configureVapid()) {
    console.warn('[push] chaves VAPID ausentes: envio ignorado.');
    return result;
  }

  const notification = await prisma.pushNotification.findUnique({
    where: { id: notificationId },
    include: { article: { select: { category: { select: { slug: true } } } } },
  });

  if (!notification || notification.status !== 'pending') return result;

  // Marca como 'sending' ANTES de começar. Se o processo cair no meio, a
  // campanha não será reenviada do zero — o que geraria notificação duplicada
  // para quem já recebeu.
  await prisma.pushNotification.update({
    where: { id: notificationId },
    data: { status: 'sending' },
  });

  const score = notification.scoreAtTrigger ?? 0;
  const categorySlug = notification.article.category.slug;

  // ---------------------------------------------------------------------------
  // SEGMENTAÇÃO — dois passos, e o segundo é em MEMÓRIA de propósito
  // ---------------------------------------------------------------------------
  //
  // PASSO 1, NO BANCO: inscritos ativos cujo limiar seja compatível com o score.
  // Esse filtro é indexado (`@@index([isActive, minScoreThreshold])`) e é o que
  // faz o volume de linhas trazido ser pequeno.
  //
  // PASSO 2, EM MEMÓRIA: a regra de categoria.
  //
  // POR QUE MUDOU: até a migração para o MySQL, este `where` também filtrava a
  // categoria dentro do banco, com `{ preferredCategories: { isEmpty: true } }` e
  // `{ preferredCategories: { has: categorySlug } }`. Esses são FILTROS DE ARRAY
  // do Prisma que existem SÓ no conector Postgres. Com `preferredCategories`
  // virando coluna `Json` (MySQL não tem array nativo), eles deixaram de existir
  // — não é uma questão de desempenho, o código simplesmente não compila mais.
  //
  // AS TRÊS SAÍDAS CONSIDERADAS, e por que esta:
  //
  //   (a) FILTRAR EM MEMÓRIA — escolhida. A base de push é de centenas a poucos
  //       milhares de linhas, o disparo já roda em lotes (`BATCH_SIZE`) e
  //       acontece FORA do caminho da requisição do leitor: ninguém está
  //       esperando na frente de uma tela enquanto isto roda. É a mudança menor,
  //       a mais legível, e a única que não acrescenta nada ao sistema.
  //
  //   (b) `JSON_CONTAINS` VIA SQL CRU — descartada. É precisa, mas NÃO USA
  //       ÍNDICE (varredura completa da tabela), então não é sequer mais rápida
  //       que (a) nesta escala. E acrescentaria um terceiro ponto de SQL cru a um
  //       projeto que tem dois — cada um deles um lugar a mais onde o banco não
  //       pode ser trocado sem reescrita.
  //
  //   (c) TABELA DE JUNÇÃO `PushSubscriptionCategory` — a modelagem correta e a
  //       única que escala de verdade, porque volta a ser indexável. Descartada
  //       POR ORA: cria tabela, migração de dados e código novo para um problema
  //       que ainda não existe.
  //
  // ⚠ A RÉGUA PARA MUDAR DE IDEIA, escrita para não virar decisão de intuição:
  // quando a base de `PushSubscription` ativa passar de ~10.000 linhas, o passo 2
  // deixa de ser barato (estaríamos trazendo dezenas de milhares de linhas para
  // descartar a maioria em JavaScript) e o caminho é (c), não (b).
  const candidates = await prisma.pushSubscription.findMany({
    where: {
      isActive: true,
      minScoreThreshold: { lte: Math.round(score) },
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      preferredCategories: true,
    },
  });

  const subscriptions = candidates.filter((subscription) => {
    // `toStringArray` e não `as string[]`: a coluna é `Json`, então o banco não
    // garante mais a forma do valor — um `null` ou um objeto ali dentro faria
    // `.includes` estourar e derrubar a campanha inteira. Ver packages/db/src/json.ts.
    const preferred = toStringArray(subscription.preferredCategories);
    // Lista vazia = quer tudo. Caso contrário, precisa conter a categoria desta
    // notícia. É exatamente a mesma regra de antes, só que avaliada aqui.
    return preferred.length === 0 || preferred.includes(categorySlug);
  });

  result.recipients = subscriptions.length;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url,
    icon: notification.iconUrl,
    tag: `artigo-${notification.articleId}`,
    notificationId: notification.id,
  });

  // Processa em lotes para não esgotar conexões.
  for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
    const batch = subscriptions.slice(i, i + BATCH_SIZE);

    const outcomes = await Promise.allSettled(
      batch.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            // TTL de 1h: se o dispositivo estiver offline por mais tempo, a
            // notícia já não é novidade e a notificação vira ruído.
            { TTL: 3600, urgency: 'high' },
          );
          return { subscriptionId: subscription.id, status: 'sent' as const };
        } catch (error) {
          const statusCode =
            typeof error === 'object' && error !== null && 'statusCode' in error
              ? (error as { statusCode: number }).statusCode
              : 0;

          // 404 / 410 = endpoint morto. Desativamos permanentemente.
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.update({
              where: { id: subscription.id },
              data: { isActive: false, lastFailureAt: new Date() },
            });
            return { subscriptionId: subscription.id, status: 'expired' as const };
          }

          // Outros erros são possivelmente transitórios: contamos a falha e,
          // após 5 seguidas, desativamos por inatividade.
          await prisma.pushSubscription.update({
            where: { id: subscription.id },
            data: { failureCount: { increment: 1 }, lastFailureAt: new Date() },
          });
          return { subscriptionId: subscription.id, status: 'failed' as const };
        }
      }),
    );

    // Registra as entregas do lote numa única operação.
    const deliveries = outcomes
      .filter((o): o is PromiseFulfilledResult<{ subscriptionId: string; status: 'sent' | 'failed' | 'expired' }> =>
        o.status === 'fulfilled',
      )
      .map((o) => o.value);

    await prisma.pushDelivery.createMany({
      data: deliveries.map((d) => ({
        notificationId,
        subscriptionId: d.subscriptionId,
        status: d.status,
      })),
      // Já existe (reprocessamento)? Ignora em vez de estourar.
      skipDuplicates: true,
    });

    result.delivered += deliveries.filter((d) => d.status === 'sent').length;
    result.failed += deliveries.filter((d) => d.status === 'failed').length;
    result.deactivated += deliveries.filter((d) => d.status === 'expired').length;
  }

  await prisma.pushNotification.update({
    where: { id: notificationId },
    data: {
      status: 'sent',
      sentAt: new Date(),
      recipientCount: result.recipients,
      deliveredCount: result.delivered,
    },
  });

  console.log(
    `[push] campanha ${notificationId}: ${result.delivered}/${result.recipients} entregues, ` +
      `${result.deactivated} endpoints desativados.`,
  );

  return result;
}

/**
 * Processa campanhas agendadas cujo horário chegou.
 * Chamado por cron (Vercel Cron, GitHub Actions ou o agendador do curator).
 */
export async function processPendingNotifications(): Promise<SendResult[]> {
  const pending = await prisma.pushNotification.findMany({
    where: {
      status: 'pending',
      // Respeita a carência de 90s que dá ao editor a chance de cancelar.
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    select: { id: true },
    take: 5,
  });

  const results: SendResult[] = [];
  for (const notification of pending) {
    results.push(await sendPushNotification(notification.id));
  }
  return results;
}
