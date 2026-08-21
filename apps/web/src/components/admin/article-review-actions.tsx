'use client';

/**
 * =============================================================================
 * APROVAR / DEVOLVER — os dois botões da fila de conteúdo sensível
 * =============================================================================
 *
 * POR QUE NÃO REUSAMOS `AdminActionButton`, que já faz "POST + mensagem +
 * refresh": porque uma das duas ações precisa de TEXTO antes de disparar. O
 * motivo da devolução é obrigatório na rota (`/api/admin/articles/[id]/review`)
 * e é a única coisa que permite ao redator corrigir em vez de adivinhar — um
 * `window.confirm()` não coleta texto, e um `window.prompt()` não valida nada,
 * não pode ser estilizado e é bloqueado por alguns navegadores.
 *
 * A DEVOLUÇÃO ABRE EM DOIS PASSOS, na própria linha, pelo mesmo motivo da
 * exclusão em `article-row.tsx`: o segundo passo é onde se explica o que vai
 * acontecer (a matéria volta como rascunho para quem escreveu) — informação que
 * muda a decisão e que um botão isolado não tem onde dizer.
 *
 * ESCONDER ESTES BOTÕES NÃO É PROTEÇÃO. Quem recusa é `requireStaffApi
 * ('aprovarConteudoSensivel')` na rota. A tela apenas evita oferecer uma ação
 * que vai falhar — é a mesma divisão de trabalho descrita em core/staff.ts.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { readAdminResponse } from './admin-response';

interface ArticleReviewActionsProps {
  articleId: string;
  articleTitle: string;
}

/** Os mesmos limites da rota. Repetidos aqui só para avisar ANTES do envio —
 *  quem valida de verdade continua sendo o servidor. */
const REASON_MIN = 5;
const REASON_MAX = 200;

export function ArticleReviewActions({ articleId, articleTitle }: ArticleReviewActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: 'approve' | 'reject') {
    if (busy) return;

    setBusy(action);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/articles/${articleId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: action === 'reject' ? reason.trim() : undefined }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        // A linha muda de seção (some da fila e reaparece em "Publicadas" ou em
        // "Rascunhos") quando o servidor recarregar os dados. Nada é removido do
        // estado local: a fonte da verdade é o banco.
        router.refresh();
        setRejecting(false);
        setReason('');
      } else if (response.status === 404 || response.status === 409) {
        // Outra aba já decidiu: esta linha virou fantasma. Recarregar a lista a
        // tira da tela em vez de deixar um botão que só repetiria o mesmo erro.
        router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. Nada foi alterado.');
    } finally {
      setBusy(null);
    }
  }

  const reasonTooShort = reason.trim().length < REASON_MIN;

  return (
    <div className="admin-actions">
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={() => void run('approve')}
        disabled={busy !== null}
      >
        {busy === 'approve' ? 'Publicando…' : 'Aprovar e publicar'}
      </button>

      {!rejecting ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setRejecting(true)}
          disabled={busy !== null}
          aria-expanded={false}
        >
          Devolver para ajuste
        </button>
      ) : (
        <>
          <label className="form-hint" htmlFor={`motivo-${articleId}`}>
            O que precisa mudar em “{articleTitle}”? O texto volta como rascunho para quem
            escreveu, com este motivo anexado.
          </label>
          <input
            id={`motivo-${articleId}`}
            type="text"
            className="input"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: falta o aviso de spoiler no primeiro parágrafo"
            disabled={busy !== null}
          />
          <button
            type="button"
            className="btn btn--hot btn--sm"
            onClick={() => void run('reject')}
            disabled={busy !== null || reasonTooShort}
          >
            {busy === 'reject' ? 'Devolvendo…' : 'Confirmar devolução'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setRejecting(false);
              setReason('');
            }}
            disabled={busy !== null}
          >
            Cancelar
          </button>
        </>
      )}

      {message && (
        <span className="form-hint" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
