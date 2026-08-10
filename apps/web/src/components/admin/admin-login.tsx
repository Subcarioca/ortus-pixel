'use client';

/**
 * =============================================================================
 * ENTRADA DA REDAÇÃO — e-mail + senha individual
 * =============================================================================
 *
 * Substituiu a tela de "token de acesso" compartilhado. Junto com ela saiu o
 * aviso amarelo que dizia "autenticação provisória, trocar antes de produção":
 * o aviso cumpriu o papel dele e não faz mais sentido: agora cada pessoa tem
 * conta própria e o `AuditLog` registra quem fez o quê.
 *
 * A TELA NÃO OFERECE "ESQUECI MINHA SENHA", e isso é uma decisão, não um
 * esquecimento. Um fluxo de recuperação por e-mail é uma superfície de ataque de
 * peso (token de redefinição, expiração, enumeração de contas pelo tempo de
 * resposta, e-mail transacional que pode ser interceptado) para uma redação de
 * poucas pessoas em que a chefia está a uma mensagem de distância. A recuperação
 * é feita por um administrador na tela de contas, ou pelo script de resgate no
 * servidor. Quando a redação crescer a ponto de isso incomodar, aí sim vale a
 * pena pagar o preço do fluxo automático.
 */

import { useState } from 'react';

export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // `location.reload()` e não `router.refresh()`: a sessão nova está num
        // cookie, e o que precisa ser refeito é a renderização do SERVIDOR
        // inteira (é lá que o guard decide o que a página mostra). Um refresh de
        // cliente traria o mesmo HTML de antes.
        window.location.reload();
        return;
      }

      // A mensagem vem do servidor de propósito: ele é a única fonte que sabe
      // distinguir credencial errada (401) de excesso de tentativas (429), e
      // repetir essas regras aqui criaria duas verdades sobre o mesmo evento.
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(data?.message ?? 'Não foi possível entrar. Tente de novo.');
    } catch {
      setError('Não foi possível falar com o servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container admin-login">
      <h1 className="article__title">Painel editorial</h1>
      <p className="section-sub">Entre com a conta que a redação criou para você.</p>

      <form onSubmit={handleSubmit} className="side-box admin-form">
        <label htmlFor="staff-email">
          E-mail
          <input
            id="staff-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            // `username` (e não `email`) é o valor que os gerenciadores de senha
            // reconhecem como o par de `current-password` — sem ele, o navegador
            // salva a senha sem saber a qual conta ela pertence.
            autoComplete="username"
            autoFocus
          />
        </label>

        <label htmlFor="staff-password">
          Senha
          <input
            id="staff-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        {error && (
          // `role="alert"` faz o leitor de tela anunciar o erro na hora. Sem ele,
          // quem não vê a tela preenche o formulário de novo sem saber que ele
          // já foi recusado.
          <p className="form-hint form-hint--error" role="alert">
            {error}
          </p>
        )}
      </form>

      <p className="form-hint">
        Não tem conta? Peça a um administrador da redação. Se ninguém consegue entrar, use o
        script de resgate no servidor (<code>npm run staff:create</code>).
      </p>
    </div>
  );
}
