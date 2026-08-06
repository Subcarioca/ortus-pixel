'use client';

/**
 * =============================================================================
 * FORMULÁRIO DE COMENTÁRIO
 * =============================================================================
 *
 * Componente de cliente — necessário para dar retorno imediato sem recarregar a
 * página. É pequeno de propósito: um `useState` para o texto, um para o estado
 * do envio. Sem biblioteca de formulário, sem validação declarativa.
 *
 * DETALHES QUE PARECEM PEQUENOS E NÃO SÃO:
 *
 *  - O CONTADOR DE CARACTERES só aparece perto do limite. Um contador sempre
 *    visível transmite "você está sendo vigiado" e encurta comentários; um
 *    contador ausente deixa a pessoa escrever 2000 caracteres e perder tudo.
 *  - O BOTÃO É DESABILITADO DURANTE O ENVIO. Sem isso, o clique duplo (comum no
 *    celular, onde o toque parece não ter respondido) publica duas vezes.
 *  - A MENSAGEM DE SUCESSO DIFERENCIA "publicado" de "em revisão". Se o
 *    primeiro comentário de alguém simplesmente sumisse, a pessoa concluiria
 *    que o site está quebrado — e não voltaria.
 *  - O TEXTO NÃO É LIMPO DO CAMPO EM CASO DE ERRO. Perder o que se escreveu por
 *    causa de uma falha de rede é o jeito mais rápido de perder um comentarista.
 */

import { useState } from 'react';

import { COMMENT_MAX_LENGTH } from '@canalnerd/core';

interface CommentFormProps {
  articleId: string;
  displayName: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; message: string; pending: boolean }
  | { kind: 'error'; message: string };

export function CommentForm({ articleId, displayName }: CommentFormProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === 'sending') return;

    setStatus({ kind: 'sending' });

    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, content }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        status?: string;
      };

      if (!response.ok || !data.ok) {
        setStatus({
          kind: 'error',
          message: data.message ?? 'Não foi possível enviar. Tente de novo.',
        });
        return;
      }

      setContent('');
      setStatus({
        kind: 'done',
        message: data.message ?? 'Comentário enviado.',
        pending: data.status === 'pending',
      });
    } catch {
      setStatus({
        kind: 'error',
        message: 'Sem conexão com o servidor. Seu texto continua aqui — tente de novo.',
      });
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Recarrega para o servidor renderizar de novo o estado deslogado. Mais
    // simples e mais confiável do que espelhar a sessão em estado do cliente.
    window.location.reload();
  }

  const remaining = COMMENT_MAX_LENGTH - content.length;
  const showCounter = remaining <= 200;

  if (status.kind === 'done') {
    // `.side-box` (caixa neutra do design), não `.cd-box` (a caixinha da
    // contagem regressiva do hub) — ver nota em comment-login.tsx.
    return (
      <div className="side-box" role="status">
        <p>{status.message}</p>
        {!status.pending && (
          <p className="form-hint">
            Ele aparece na lista assim que a página for atualizada.
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="cmt-form" onSubmit={handleSubmit}>
      <div className="cmt-me">
        <span>
          Comentando como <strong>{displayName}</strong>
        </span>
        <button type="button" className="link-more" onClick={handleLogout}>
          Sair
        </button>
      </div>

      <label className="sr-only" htmlFor="comentario">
        Seu comentário
      </label>
      <textarea
        id="comentario"
        value={content}
        onChange={(event) => setContent(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
        placeholder="O que você achou?"
        // `maxLength` é conveniência de interface. A validação que vale é a do
        // servidor (core/community.ts) — atributo de HTML é sugestão, não trava.
        maxLength={COMMENT_MAX_LENGTH}
        required
      />

      <div className="cmt-form__foot">
        <span className="form-hint">
          {showCounter
            ? `${remaining} caracteres restantes`
            : 'Sem links clicáveis e sem HTML — é texto puro.'}
        </span>

        <button
          type="submit"
          className="btn btn--primary"
          disabled={status.kind === 'sending' || content.trim().length < 2}
        >
          {status.kind === 'sending' ? 'Enviando…' : 'Comentar'}
        </button>
      </div>

      {status.kind === 'error' && (
        // `role="alert"` faz o leitor de tela anunciar o erro imediatamente,
        // sem que a pessoa precise procurar a mensagem na página.
        <p className="form-hint" role="alert">
          {status.message}
        </p>
      )}
    </form>
  );
}
