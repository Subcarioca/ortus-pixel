/**
 * =============================================================================
 * SERVICE WORKER — recebimento de push
 * =============================================================================
 *
 * Arquivo em JavaScript puro (não TypeScript) e servido estaticamente de
 * /public. Motivo: o service worker roda num contexto próprio, fora do bundle
 * do Next, e precisa estar disponível na RAIZ do domínio para ter escopo sobre
 * o site inteiro. Um SW em /_next/static/... só controlaria aquele caminho.
 *
 * ESCOPO DELIBERADAMENTE MÍNIMO: este worker SÓ trata push e clique em
 * notificação. Não faz cache de páginas nem intercepta requisições.
 *
 * Por quê? Um service worker que cacheia HTML é a causa mais comum de "o site
 * não atualiza para alguns usuários" — e num portal de NOTÍCIAS isso é
 * inaceitável: a pessoa receberia a versão de ontem de uma breaking news. O
 * cache de rede já é resolvido pela CDN, que é a camada correta para isso.
 */

/**
 * Instalação: assume o controle imediatamente.
 * Sem `skipWaiting`, uma versão nova do worker só passaria a valer quando TODAS
 * as abas do site fossem fechadas — o que pode levar dias e atrasar correções.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

/** Ativação: assume as abas já abertas. */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Recebimento de push.
 *
 * SEGURANÇA: a carga é criptografada de ponta a ponta e só nós (com a chave
 * VAPID privada) podemos assiná-la — mas ainda assim tratamos o conteúdo como
 * dado não confiável e validamos a forma. O `try/catch` também evita que uma
 * carga malformada deixe o navegador exibindo a notificação genérica do
 * sistema ("Este site foi atualizado em segundo plano"), que é péssima.
 */
self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  // Título de reserva quando a carga vem malformada. É literal (e não lido de
  // variável de ambiente) porque o service worker é servido como arquivo
  // estático de /public: ele não passa pelo bundler do Next e, portanto, não
  // tem acesso a `process.env`. Ao trocar a marca, este literal precisa ser
  // atualizado à mão — está anotado no relatório da renomeação.
  const title = typeof payload.title === 'string' ? payload.title : 'Ortus Pixel';
  const body = typeof payload.body === 'string' ? payload.body : 'Nova notícia em alta.';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/';

  const options = {
    body,
    icon: payload.icon || '/icon-192.png',
    badge: '/badge-72.png',
    // `tag` faz uma notificação nova SUBSTITUIR a anterior do mesmo assunto,
    // em vez de empilhar. Evita 5 notificações do mesmo tópico na tela.
    tag: typeof payload.tag === 'string' ? payload.tag : 'ortuspixel-noticia',
    // `renotify` garante que a substituição ainda alerte o usuário.
    renotify: true,
    // Não vibra nem faz som fora de horário razoável — respeito à atenção do
    // usuário é o que preserva a permissão a longo prazo.
    requireInteraction: false,
    data: { url, notificationId: payload.notificationId ?? null },
    actions: [{ action: 'open', title: 'Ler agora' }],
  };

  // `waitUntil` mantém o worker vivo até a notificação ser exibida. Sem ele, o
  // navegador pode encerrar o worker antes e a notificação nunca aparece.
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Clique na notificação.
 *
 * Além de abrir a página, avisamos o servidor para medir o CTR de push — um dos
 * KPIs de retenção exigidos no briefing.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const notificationId = event.notification.data?.notificationId;

  event.waitUntil(
    (async () => {
      // Registra o clique. `keepalive` permite que a requisição sobreviva ao
      // encerramento do worker. Falha aqui é irrelevante: nunca deve impedir a
      // navegação, que é o que o usuário pediu.
      if (notificationId) {
        try {
          await fetch('/api/push/clicked', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notificationId }),
            keepalive: true,
          });
        } catch {
          // silencioso de propósito
        }
      }

      // Se já houver uma aba do site aberta, REAPROVEITA em vez de abrir outra.
      // Abrir uma aba nova a cada notificação enche o navegador do usuário.
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }

      await self.clients.openWindow(url);
    })(),
  );
});
