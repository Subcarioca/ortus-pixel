'use client';

/**
 * =============================================================================
 * BOTÃO "SEGUIR" — o degrau mais barato do funil de retenção
 * =============================================================================
 *
 * POR QUE O ESTADO VEM DO CLIENTE, e não do servidor: a página do hub é
 * cacheada e serve o mesmo HTML para todo mundo. Renderizar "Seguindo" no
 * servidor exigiria ler o cookie do leitor, o que tornaria a rota dinâmica e
 * faria toda visita bater no banco — no lugar do site que mais recebe pico de
 * fandom. O raciocínio completo está em app/api/follows/route.ts.
 *
 * Consequência visível: existe um instante em que o botão ainda não sabe o
 * estado. Ele é tratado explicitamente (`aria-busy` + rótulo neutro), e não
 * escondido: um botão que aparece do nada depois de meio segundo é pior do que
 * um botão que diz que está carregando.
 *
 * NÃO EXIGE LOGIN. Sem sessão, o follow é gravado contra um cookie anônimo e é
 * adotado pela conta se a pessoa logar depois (`reconcileFollowsOnLogin`).
 * Exigir cadastro aqui mataria a conversão do gesto mais barato do funil.
 */

import { useEffect, useRef, useState } from 'react';

type FollowState = 'unknown' | 'following' | 'not-following';

interface FollowButtonProps {
  franchiseSlug: string;
  franchiseName: string;
}

export function FollowButton({ franchiseSlug, franchiseName }: FollowButtonProps) {
  const [state, setState] = useState<FollowState>('unknown');
  const [pending, setPending] = useState(false);
  // Microinteração (Tarefa B de UI): um "pop" de ~0,3s toda vez que o estado
  // muda de verdade — não em toda renderização. `.btn--pulse` só existe
  // enquanto este timer está de pé; ele mesmo se desliga no fim da animação,
  // então um segundo clique rápido reinicia o efeito em vez de acumular
  // `setTimeout`s pendentes (ver `toggle`, abaixo).
  const [pulsing, setPulsing] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    // Limpa o timer se o botão sair da tela no meio da animação (navegação
    // rápida entre hubs) — o mesmo cuidado que a busca de estado já tem
    // acima com `ignore`, aplicado a este segundo efeito.
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
  }, []);

  useEffect(() => {
    // `ignore` evita atualizar estado depois que o componente saiu da tela
    // (navegação rápida entre hubs) — o aviso clássico de "setState em
    // componente desmontado", que aqui viraria um botão piscando o estado do
    // hub anterior.
    let ignore = false;

    fetch('/api/follows', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { following?: string[] } | null) => {
        if (ignore) return;
        const following = Array.isArray(data?.following) && data.following.includes(franchiseSlug);
        setState(following ? 'following' : 'not-following');
      })
      .catch(() => {
        // Falha de rede: assumimos "não segue". É o estado que permite AGIR —
        // se estivermos errados, o servidor devolve o mesmo resultado (a
        // operação é idempotente) e nada quebra.
        if (!ignore) setState('not-following');
      });

    return () => {
      ignore = true;
    };
  }, [franchiseSlug]);

  async function toggle() {
    if (pending || state === 'unknown') return;

    const willFollow = state === 'not-following';
    setPending(true);

    // Atualização OTIMISTA: o clique responde na hora. Num gesto de um toque, a
    // espera pela rede é o que faz a pessoa clicar duas vezes achando que
    // falhou.
    setState(willFollow ? 'following' : 'not-following');

    // "Pop" de confirmação (Tarefa B de UI) — dispara junto da atualização
    // otimista, não da resposta do servidor: é o clique que precisa parecer
    // instantâneo, e a resposta de rede já tem sua própria reversão se der
    // errado (abaixo). Reinicia o timer a cada clique em vez de deixar dois
    // rodando: um segundo toggle rápido troca a animação em andamento pela
    // nova, em vez de somar as duas.
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setPulsing(true);
    pulseTimer.current = setTimeout(() => setPulsing(false), 280);

    try {
      const response = await fetch('/api/follows', {
        method: willFollow ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseSlug }),
      });

      if (!response.ok) {
        // Reverte: o botão nunca pode ficar afirmando um estado que o servidor
        // não registrou.
        setState(willFollow ? 'not-following' : 'following');
      }
    } catch {
      setState(willFollow ? 'not-following' : 'following');
    } finally {
      setPending(false);
    }
  }

  const isFollowing = state === 'following';

  return (
    <button
      type="button"
      // `.btn--ghost` quando já segue: seguir é a ação PRIMÁRIA (carmim), deixar
      // de seguir não deve competir visualmente com ela. `.btn--pulse` some
      // sozinha 280ms depois do clique (ver `toggle`) — a mesma microinteração
      // do `.chip` de curtir, aplicada a um botão que muda de classe em vez de
      // `aria-pressed` (ortuspixel.css §22).
      className={`btn ${isFollowing ? 'btn--ghost' : 'btn--primary'}${pulsing ? ' btn--pulse' : ''}`}
      onClick={toggle}
      disabled={state === 'unknown' || pending}
      aria-busy={state === 'unknown' || pending}
      // O rótulo visível muda ("Seguindo"), mas quem usa leitor de tela precisa
      // saber o que o clique FAZ, não em que estado o botão está.
      aria-label={
        isFollowing ? `Deixar de seguir ${franchiseName}` : `Seguir ${franchiseName}`
      }
    >
      {state === 'unknown' ? 'Seguir' : isFollowing ? 'Seguindo' : `Seguir ${franchiseName}`}
    </button>
  );
}
