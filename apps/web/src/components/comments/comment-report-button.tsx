'use client';

/**
 * =============================================================================
 * DENUNCIAR COMENTÁRIO — o único pedaço de cliente da lista de comentários
 * =============================================================================
 *
 * A seção de comentários é renderizada inteira no servidor, e isso é uma decisão
 * de peso do projeto: LER comentário não deve custar JavaScript nenhum (ver o
 * cabeçalho de `comment-section.tsx`). Este componente é a exceção mínima
 * necessária — um botão por comentário, com o estado da própria requisição.
 *
 * Ele NÃO existe para quem está deslogado: a denúncia exige sessão de leitor, e
 * oferecer um botão que responde 401 é pior do que não oferecer botão. Quem
 * decide é `comment-section.tsx`, que só o renderiza quando há sessão — e a
 * rota recusa de qualquer forma, porque esconder botão nunca foi proteção.
 *
 * -----------------------------------------------------------------------------
 * DOIS PASSOS, E NÃO UM `window.confirm()`
 * -----------------------------------------------------------------------------
 * É o mesmo padrão da exclusão de matéria no painel (`article-row.tsx`), pelo
 * mesmo motivo: o diálogo nativo é fechado no reflexo e não tem onde explicar o
 * que vai acontecer. Aqui o segundo passo diz a coisa que muda a decisão —
 * denúncia não é "não gostei", é "isto quebra a regra da casa".
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CommentReportButtonProps {
  commentId: string;
}

export function CommentReportButton({ commentId }: CommentReportButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function report() {
    if (busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/comments/${commentId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Corpo vazio: o motivo em texto é opcional na rota e não é pedido aqui.
        // Um campo de justificativa antes do envio derrubaria a taxa de denúncia
        // a quase zero — e o que a moderação precisa, no volume atual, é do
        // PONTEIRO para o comentário, não de um dossiê.
        body: '{}',
      });

      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; removed?: boolean; message?: string }
        | null;

      setMessage(data?.message ?? 'Não foi possível registrar a denúncia agora.');
      setConfirming(false);

      // Quando o bot removeu, a lista precisa ser refeita no servidor: o
      // comentário deixou de ser público e o HTML atual ainda o mostra.
      if (data?.ok && data.removed) router.refresh();
    } catch {
      setMessage('Não foi possível falar com o servidor. Tente de novo em instantes.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  // Depois de responder, o botão não volta: repetir a denúncia não faz nada (o
  // banco impede a segunda da mesma conta) e um botão que reaparece convida ao
  // clique inútil. O que fica é a frase do servidor.
  if (message) {
    return (
      <span className="cmt__time" role="status">
        {message}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setConfirming(true)}
      >
        Denunciar
      </button>
    );
  }

  return (
    <>
      <span className="cmt__time">Denunciar por ofensa ou ataque pessoal?</span>
      <button type="button" className="btn btn--hot btn--sm" onClick={() => void report()} disabled={busy}>
        {busy ? 'Enviando…' : 'Confirmar denúncia'}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        Cancelar
      </button>
    </>
  );
}
