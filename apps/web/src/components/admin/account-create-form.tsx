'use client';

/**
 * Formulário de criação de conta da redação.
 *
 * A SENHA É DEFINIDA PELO ADMIN, e não sorteada pelo sistema. Sorteá-la parece
 * mais seguro e é pior na prática: uma senha aleatória de 16 caracteres precisa
 * ser copiada e enviada de algum jeito, e o jeito real é WhatsApp. Uma frase que
 * o admin combina com a pessoa ("aquela do café, com o ano no fim") pode ser dita
 * por voz e trocada no primeiro acesso — que é o que o texto de ajuda pede.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ACCESS_LEVELS, ACCESS_LEVEL_LABELS } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';

export function AccountCreateForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const formEl = event.currentTarget;
    const form = new FormData(formEl);

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          accessLevel: form.get('accessLevel'),
          editorialRole: form.get('editorialRole'),
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        // Limpa o formulário no sucesso — e a senha é o motivo principal: deixá-la
        // no campo mantém a credencial de outra pessoa visível na tela de quem
        // acabou de criar a conta.
        formEl.reset();
        router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. Nada foi criado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form admin-form--cols" onSubmit={submit} aria-label="Criar conta">
      <label>
        Nome completo
        <input name="name" required minLength={3} maxLength={80} autoComplete="off" />
      </label>

      <label>
        E-mail
        <input name="email" type="email" required autoComplete="off" />
      </label>

      <label>
        Nível de acesso
        <select name="accessLevel" defaultValue="redator">
          {ACCESS_LEVELS.map((level) => (
            <option key={level} value={level}>
              {ACCESS_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Título editorial (aparece na assinatura)
        <input
          name="editorialRole"
          maxLength={60}
          placeholder="Repórter de Games"
          autoComplete="off"
        />
      </label>

      <label className="admin-form__full">
        Senha provisória
        <input
          name="password"
          type="password"
          required
          minLength={12}
          // `new-password` impede o gerenciador de senhas de preencher aqui a
          // senha de quem está logado — o que aconteceria com `current-password`
          // e criaria duas contas com a mesma credencial sem ninguém notar.
          autoComplete="new-password"
        />
      </label>

      <p className="admin-form__full form-hint">
        Mínimo de 12 caracteres — uma frase curta funciona melhor que
        &ldquo;Senha@2026&rdquo;. Combine a senha com a pessoa por um canal seguro e peça que
        ela troque no primeiro acesso, em &ldquo;Minha senha&rdquo;.
      </p>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Criando…' : 'Criar conta'}
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
