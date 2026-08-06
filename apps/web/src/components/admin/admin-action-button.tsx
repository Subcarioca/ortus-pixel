'use client';

/**
 * =============================================================================
 * BOTÃO DE AÇÃO DO PAINEL — cliente mínimo, reutilizável
 * =============================================================================
 *
 * As telas de afiliados e de moderação precisam do mesmo comportamento: dispara
 * um POST, mostra o resultado, recarrega a lista. Escrever isso duas vezes daria
 * dois lugares para esquecer de desabilitar o botão durante o envio — que é
 * como um clique duplo vira duas remoções (ou dois vínculos).
 *
 * O `confirm()` nativo é usado nas ações destrutivas. Não é bonito, e é a opção
 * certa aqui: é acessível por padrão, não custa JavaScript nenhum e não some
 * atrás de um `z-index` errado no meio de uma tabela. Um modal caprichado é
 * trabalho de design que ainda não foi pedido para esta tela.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AdminActionButtonProps {
  endpoint: string;
  payload: Record<string, unknown>;
  label: string;
  /** Texto do `confirm()`. Quando ausente, a ação executa direto. */
  confirmMessage?: string;
  variant?: 'primary' | 'ghost' | 'danger';
}

export function AdminActionButton({
  endpoint,
  payload,
  label,
  confirmMessage,
  variant = 'ghost',
}: AdminActionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };

      setMessage(data.message ?? (data.ok ? 'Feito.' : 'Falhou.'));

      // `router.refresh()` refaz a renderização do Server Component sem perder
      // o estado da página. É o equivalente moderno do "recarrega a lista",
      // sem recarregar a página inteira.
      if (data.ok) router.refresh();
    } catch {
      setMessage('Erro de rede.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="admin-actions">
      <button
        type="button"
        className={`btn btn--sm btn--${variant === 'danger' ? 'hot' : variant}`}
        onClick={run}
        disabled={busy}
      >
        {busy ? '…' : label}
      </button>
      {message && (
        <span className="form-hint" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
