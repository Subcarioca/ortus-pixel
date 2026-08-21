'use client';

/**
 * =============================================================================
 * CURTIR / DESCURTIR — mesmo peso, toggle/replace
 * =============================================================================
 *
 * A REGRA DE NEGÓCIO (curtir e descurtir SOMAM na popularidade, com o mesmo
 * peso) mora no SERVIDOR (`server/reactions.ts`); este componente só reflete o
 * resultado. Ele NUNCA calcula popularidade — só mostra o número que o
 * servidor devolveu e aplica uma atualização OTIMISTA local para o clique
 * responder na hora (mesmo raciocínio de `FollowButton`).
 *
 * `[aria-pressed="true"]` em `.chip` já é a pílula "ativa" preenchida do design
 * system (ver `ortuspixel.css`) — reaproveitada aqui em vez de inventar uma
 * variante nova só para este botão.
 *
 * LEITOR NÃO LOGADO: os botões continuam visíveis (mostrar a contagem não exige
 * conta), mas o clique não dispara requisição — abre um convite curto para
 * entrar, com link para /minha-conta, em vez de silenciosamente não fazer
 * nada (o que pareceria bug) ou de embutir aqui o seletor de provedor inteiro
 * (que já existe em `comment-login.tsx`/`minha-conta`, e duplicá-lo aqui
 * criaria um terceiro lugar para manter sincronizado).
 */

import { useState } from 'react';

import { routes } from '@subcarioca/core';

type Reaction = 'like' | 'dislike';

interface ReactionBarProps {
  articleId: string;
  initialReaction: Reaction | null;
  initialCount: number;
  isLoggedIn: boolean;
}

export function ReactionBar({
  articleId,
  initialReaction,
  initialCount,
  isLoggedIn,
}: ReactionBarProps) {
  const [reaction, setReactionState] = useState<Reaction | null>(initialReaction);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [showLoginHint, setShowLoginHint] = useState(false);

  async function toggle(type: Reaction) {
    if (!isLoggedIn) {
      setShowLoginHint(true);
      return;
    }
    if (pending) return;

    // MESMA regra de toggle/replace do servidor (`server/reactions.ts`),
    // calculada aqui só para a resposta otimista — o servidor é quem decide de
    // verdade, e a resposta dele (abaixo) sobrescreve qualquer divergência.
    const previousReaction = reaction;
    const previousCount = count;

    let nextReaction: Reaction | null;
    let delta: number;
    if (previousReaction === type) {
      // clicou nO MESMO botão: desfaz.
      nextReaction = null;
      delta = -1;
    } else if (previousReaction === null) {
      nextReaction = type;
      delta = 1;
    } else {
      // tinha o OUTRO tipo: troca, contagem total não muda.
      nextReaction = type;
      delta = 0;
    }

    setReactionState(nextReaction);
    setCount(previousCount + delta);
    setPending(true);
    setShowLoginHint(false);

    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, type }),
      });

      if (!response.ok) {
        setReactionState(previousReaction);
        setCount(previousCount);
        return;
      }

      const data = (await response.json()) as {
        current?: Reaction | null;
        reactionCount?: number;
      };

      // O SERVIDOR é a fonte da verdade final: se dois cliques concorrentes
      // (duas abas) chegaram fora de ordem, o número otimista local pode ter
      // ficado errado — esta linha corrige.
      if (typeof data.reactionCount === 'number') setCount(data.reactionCount);
      if (data.current === 'like' || data.current === 'dislike' || data.current === null) {
        setReactionState(data.current);
      }
    } catch {
      setReactionState(previousReaction);
      setCount(previousCount);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="reaction-bar">
      <button
        type="button"
        className="chip"
        aria-pressed={reaction === 'like'}
        aria-label="Curtir esta matéria"
        disabled={pending}
        onClick={() => toggle('like')}
      >
        Curtir
      </button>
      <button
        type="button"
        className="chip"
        aria-pressed={reaction === 'dislike'}
        aria-label="Descurtir esta matéria"
        disabled={pending}
        onClick={() => toggle('dislike')}
      >
        Descurtir
      </button>
      {/* Mono e cinza, como `.share__count`: é prova de engajamento, não
          conteúdo — não pode competir com o texto da matéria. */}
      <span className="reaction-bar__count">
        {count.toLocaleString('pt-BR')} {count === 1 ? 'reação' : 'reações'}
      </span>

      {showLoginHint && (
        <p className="form-hint reaction-bar__hint">
          <a href={routes.account()}>Entre com uma conta</a> para curtir ou descurtir.
        </p>
      )}
    </div>
  );
}
