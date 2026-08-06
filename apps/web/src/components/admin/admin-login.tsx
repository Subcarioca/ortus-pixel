'use client';

/**
 * Tela de acesso ao painel.
 *
 * AVISO EXPLÍCITO: autenticação por segredo compartilhado é adequada para
 * desenvolvimento e piloto, NÃO para produção com uma redação real. Não há
 * identidade individual — e sem identidade individual, a trilha de auditoria
 * registra "alguém" em vez de "a Marina". Isso anula boa parte do valor do
 * `AuditLog`.
 *
 * O componente exibe esse aviso na própria tela, de propósito: alerta em
 * comentário de código é fácil de ignorar; alerta na interface, não.
 * Substituição planejada: Auth.js com SSO da redação (ver README).
 */

import { useState } from 'react';

export function AdminLogin() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (response.ok) {
      window.location.reload();
    } else {
      // Mensagem genérica: não confirmamos se o token existe ou está errado.
      setError('Acesso negado.');
    }
  }

  return (
    <div className="container admin-login">
      <h1 className="article__title">Painel editorial</h1>

      <form onSubmit={handleSubmit} className="side-box">
        <label htmlFor="admin-token">Token de acesso</label>
        <input
          id="admin-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="input"
          required
          autoComplete="current-password"
        />
        <button type="submit" className="btn btn--primary">
          Entrar
        </button>

        {error && (
          <p className="form-hint form-hint--error" role="alert">
            {error}
          </p>
        )}
      </form>

      <p className="form-hint">
        Autenticação provisória por token compartilhado. Antes de produção, isto deve ser
        substituído por login individual (Auth.js + SSO), para que a trilha de auditoria
        identifique cada jornalista.
      </p>
    </div>
  );
}
