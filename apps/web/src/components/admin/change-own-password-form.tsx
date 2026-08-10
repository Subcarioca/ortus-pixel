'use client';

/**
 * Troca da própria senha.
 *
 * Fica na tela de contas por ora — é onde a pessoa já está pensando em acesso.
 * Quando o painel do redator ganhar uma tela de "meu perfil", este componente se
 * move para lá sem alteração: ele não sabe de nada além da própria rota.
 */

import { useState } from 'react';

import { readAdminResponse } from './admin-response';

export function ChangeOwnPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const formEl = event.currentTarget;
    const form = new FormData(formEl);

    const novaSenha = String(form.get('newPassword') ?? '');
    if (novaSenha !== String(form.get('confirmPassword') ?? '')) {
      // Conferência de repetição no CLIENTE, e só ela: é o único caso em que o
      // servidor não tem como ajudar (ele recebe uma senha, não duas) e em que a
      // resposta imediata evita uma ida ao servidor com uma senha que a pessoa
      // provavelmente digitou errado.
      setMessage('A confirmação não confere com a senha nova.');
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          newPassword: novaSenha,
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        formEl.reset();
        // A troca derrubou esta sessão junto. Recarregar leva direto ao
        // formulário de acesso, que é o estado verdadeiro — deixar a tela do
        // painel na frente faria o próximo clique falhar sem explicação.
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. A senha não foi trocada.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form admin-form--cols" onSubmit={submit} aria-label="Trocar minha senha">
      <label className="admin-form__full">
        Senha atual
        <input name="currentPassword" type="password" required autoComplete="current-password" />
      </label>

      <label>
        Senha nova
        <input name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
      </label>

      <label>
        Repita a senha nova
        <input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" />
      </label>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Trocando…' : 'Trocar senha'}
        </button>
        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
