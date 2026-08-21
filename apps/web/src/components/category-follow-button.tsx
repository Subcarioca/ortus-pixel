'use client';

/**
 * =============================================================================
 * BOTÃO "SEGUIR" DE CATEGORIA — espelha `FollowButton` (franquia)
 * =============================================================================
 *
 * O cabeçalho de `follow-button.tsx` (franquia) tem o racional completo do
 * padrão (estado vindo do CLIENTE porque a página de categoria é cacheada;
 * atualização otimista; não exige login). Repetido aqui só o que muda: o
 * endpoint (`/api/category-follows`) e o campo do corpo (`categorySlug`).
 */

import { useEffect, useState } from 'react';

type FollowState = 'unknown' | 'following' | 'not-following';

interface CategoryFollowButtonProps {
  categorySlug: string;
  categoryName: string;
}

export function CategoryFollowButton({ categorySlug, categoryName }: CategoryFollowButtonProps) {
  const [state, setState] = useState<FollowState>('unknown');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let ignore = false;

    fetch('/api/category-follows', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { following?: string[] } | null) => {
        if (ignore) return;
        const following = Array.isArray(data?.following) && data.following.includes(categorySlug);
        setState(following ? 'following' : 'not-following');
      })
      .catch(() => {
        if (!ignore) setState('not-following');
      });

    return () => {
      ignore = true;
    };
  }, [categorySlug]);

  async function toggle() {
    if (pending || state === 'unknown') return;

    const willFollow = state === 'not-following';
    setPending(true);
    setState(willFollow ? 'following' : 'not-following');

    try {
      const response = await fetch('/api/category-follows', {
        method: willFollow ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categorySlug }),
      });

      if (!response.ok) {
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
      className={`btn ${isFollowing ? 'btn--ghost' : 'btn--primary'}`}
      onClick={toggle}
      disabled={state === 'unknown' || pending}
      aria-busy={state === 'unknown' || pending}
      aria-label={
        isFollowing ? `Deixar de seguir ${categoryName}` : `Seguir ${categoryName}`
      }
    >
      {state === 'unknown' ? 'Seguir' : isFollowing ? 'Seguindo' : `Seguir ${categoryName}`}
    </button>
  );
}
