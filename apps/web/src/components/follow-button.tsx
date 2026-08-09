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

import { useEffect, useState } from 'react';

type FollowState = 'unknown' | 'following' | 'not-following';

interface FollowButtonProps {
  franchiseSlug: string;
  franchiseName: string;
}

export function FollowButton({ franchiseSlug, franchiseName }: FollowButtonProps) {
  const [state, setState] = useState<FollowState>('unknown');
  const [pending, setPending] = useState(false);

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
      // de seguir não deve competir visualmente com ela.
      className={`btn ${isFollowing ? 'btn--ghost' : 'btn--primary'}`}
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
