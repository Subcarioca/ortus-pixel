'use client';

/**
 * Botão "Sair".
 *
 * É um `<button>` que dispara POST, e não um `<a href="/api/admin/logout">`:
 * link é navegação (GET), e uma rota que muda estado por GET pode ser disparada
 * por qualquer imagem em qualquer página. Ver o comentário da rota.
 */

import { useState } from 'react';

export function AdminLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);

    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      // Recarrega mesmo se a chamada falhar: a rota apaga o cookie, e se ela não
      // respondeu a página recarregada mostra o formulário de acesso — que é a
      // informação certa ("você não está mais dentro"), sem prometer um sucesso
      // que não houve.
      window.location.href = '/admin';
    }
  }

  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={logout} disabled={busy}>
      {busy ? 'Saindo…' : 'Sair'}
    </button>
  );
}
