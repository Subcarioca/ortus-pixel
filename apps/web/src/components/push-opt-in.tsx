'use client';

/**
 * =============================================================================
 * OPT-IN DE PUSH NOTIFICATION
 * =============================================================================
 *
 * A REGRA MAIS IMPORTANTE DESTE COMPONENTE, e a razão de ele existir separado
 * de um simples `Notification.requestPermission()`:
 *
 *   NUNCA pedir a permissão do navegador sem contexto e sem uma ação explícita
 *   do usuário.
 *
 * Pedir de imediato, ao carregar a página, é a razão nº 1 de bloqueio
 * PERMANENTE de notificações — e "permanente" é literal: uma vez que o usuário
 * clica em "Bloquear", o navegador nunca mais mostra o pedido para o domínio, e
 * não há nada que o site possa fazer para reverter. Cada pedido malfeito é um
 * assinante perdido para sempre.
 *
 * Por isso o fluxo aqui tem DOIS PASSOS:
 *   1. Um convite nosso, em HTML, explicando o motivo e a frequência.
 *   2. Só se o usuário clicar, chamamos o navegador.
 *
 * O botão "Agora não" tem o MESMO tamanho do "Ativar" (design §3): dar
 * proeminência desproporcional ao "sim" é padrão escuro, e converte pior no
 * médio prazo porque gera bloqueio.
 *
 * RE-SKIN v0.3: o componente agora é o `.push-prompt` do design (borda e fundo
 * na cor de urgência, ícone de sino em quadrado sólido, ações embaixo). Antes
 * ele reaproveitava `.cd-box` — que no design system é a CAIXINHA DA CONTAGEM
 * REGRESSIVA do hub de franquia ("12 / DIAS"), não uma caixa genérica. O
 * convite de push herdava, portanto, um contêiner de 56px de largura mínima
 * pensado para exibir dois dígitos.
 */

import { useEffect, useState } from 'react';

interface PushOptInProps {
  headline: string;
  /** Justificativa concreta — "esta notícia está com score 97". */
  reason: string;
  /** Promessa de frequência: reduz muito a taxa de recusa. */
  frequencyPromise: string;
}

type State = 'checking' | 'unsupported' | 'available' | 'granted' | 'denied' | 'dismissed';

/**
 * Chave de recusa no armazenamento local.
 *
 * Renomeada junto com a marca. Efeito de uma vez só: quem já tinha dispensado o
 * convite de push volta a vê-lo (a janela de 30 dias reinicia), porque a chave
 * antiga não é mais consultada. Aceito conscientemente — ver a mesma nota em
 * lib/theme.ts.
 */
const DISMISS_KEY = 'ortuspixel:push-dismissed-at';
/** Recusou? Só perguntamos de novo em 30 dias (design §4). */
const DISMISS_DAYS = 30;

export function PushOptIn({ headline, reason, frequencyPromise }: PushOptInProps) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    // Todas as checagens dependem de APIs do navegador, por isso rodam só após
    // a montagem. Renderizar 'checking' no servidor evita erro de hidratação.
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'granted') {
      setState('granted');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    // Respeita a recusa anterior pela janela combinada.
    const dismissedAt = window.localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const daysSince = (Date.now() - Number(dismissedAt)) / 86_400_000;
      if (daysSince < DISMISS_DAYS) {
        setState('dismissed');
        return;
      }
    }

    setState('available');
  }, []);

  async function handleEnable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error('[push] VAPID public key ausente.');
        setState('unsupported');
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // `true` é obrigatório nos navegadores atuais: toda notificação precisa
        // ser visível ao usuário. Push silencioso foi banido justamente por
        // ter sido usado para rastreamento.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      setState('granted');
    } catch (error) {
      console.error('[push] falha ao ativar:', error);
      setState('denied');
    }
  }

  function handleDismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setState('dismissed');
  }

  // Não renderizamos nada nesses estados: insistir com quem já disse não (ou
  // já disse sim) só gera irritação.
  if (state === 'checking' || state === 'unsupported' || state === 'dismissed' || state === 'denied') {
    return null;
  }

  if (state === 'granted') {
    return (
      <div className="side-box" role="status">
        <h2>Alertas ativados</h2>
        <p className="form-hint">Avisaremos assim que algo grande acontecer.</p>
      </div>
    );
  }

  return (
    <section className="push-prompt" role="region" aria-label="Ativar notificações">
      <div className="push-prompt__top">
        {/* Quadrado vermelho de 42px com o sino. É o único elemento do bloco
            que usa `--heat-hot` preenchido, e ele é o que ancora a leitura:
            sem o ícone, o bloco vira "mais um parágrafo com dois botões". */}
        <span className="push-prompt__ico" aria-hidden="true">
          <span className="ico" />
        </span>
        <div>
          <h2>{headline}</h2>
          <p>{reason}</p>
        </div>
      </div>

      <p className="form-hint">{frequencyPromise}</p>

      <div className="push-prompt__actions">
        {/* `.btn--hot` (e não `--primary`): o design reserva o vermelho de
            temperatura para alertas de urgência, e é exatamente disso que
            este botão trata. Ver a "regra dos dois vermelhos" no design §2. */}
        <button type="button" onClick={handleEnable} className="btn btn--hot">
          Ativar alertas
        </button>
        {/* Mesmo tamanho do botão primário — ver comentário no topo. */}
        <button type="button" onClick={handleDismiss} className="btn btn--ghost">
          Agora não
        </button>
      </div>
    </section>
  );
}

/**
 * Converte a chave VAPID de base64url para Uint8Array.
 *
 * A Push API exige `Uint8Array`, mas a chave é distribuída em base64url (com
 * `-` e `_` no lugar de `+` e `/`, e sem preenchimento). Esta conversão é
 * padrão e aparece em toda implementação de Web Push.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);

  // Alocamos o ArrayBuffer explicitamente. A partir do TypeScript 5.7,
  // `new Uint8Array(n)` tem tipo `Uint8Array<ArrayBufferLike>`, que inclui
  // `SharedArrayBuffer` e por isso NÃO satisfaz `BufferSource` — o tipo que a
  // Push API exige. Construir sobre um `ArrayBuffer` concreto resolve o
  // conflito sem recorrer a `as any`, que só esconderia o problema.
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
