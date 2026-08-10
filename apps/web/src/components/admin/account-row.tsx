'use client';

/**
 * Linha de conta na tela de gestão.
 *
 * A DESATIVAÇÃO PEDE CONFIRMAÇÃO NA PRÓPRIA LINHA, com o mesmo padrão de dois
 * passos já usado na exclusão de matéria: o segundo passo diz o que acontece
 * junto (as sessões abertas caem) — informação que muda a decisão de quem está
 * prestes a desligar alguém no meio de um plantão.
 *
 * A PRÓPRIA CONTA NÃO TEM OS BOTÕES DE DESATIVAR E REBAIXAR. Não é uma regra de
 * segurança (a API tem a trava do último admin, que é a que importa): é para não
 * oferecer um caminho que só existe para dar errado. Ninguém precisa se desligar
 * pela tela de gestão; quem quer sair usa o botão "Sair".
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ACCESS_LEVEL_LABELS, type AccessLevel } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';

export interface AdminAccountRowData {
  id: string;
  name: string;
  email: string;
  editorialRole: string;
  accessLevel: AccessLevel;
  isActive: boolean;
  hasPassword: boolean;
  articleCount: number;
  lastLoginAt: string | null;
  isSelf: boolean;
  isLastAdmin: boolean;
}

export function AccountRow({ account }: { account: AdminAccountRowData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        setConfirmingDeactivate(false);
        setResettingPassword(false);
        router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. Nada mudou.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="admin-row">
      <div className="admin-row__main">
        <div className="admin-row__body">
          <h3 className="admin-row__title">
            {account.name}
            {account.isSelf && <span className="admin-row__detail"> (você)</span>}
          </h3>

          <div className="admin-row__meta">
            <span className="admin-override">{ACCESS_LEVEL_LABELS[account.accessLevel]}</span>
            <span className="admin-row__detail">{account.email}</span>
            <span className="admin-row__detail">{account.editorialRole}</span>
            {account.articleCount > 0 && (
              <span className="admin-row__detail">
                {account.articleCount} matéria{account.articleCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="admin-row__timer">
              {account.lastLoginAt
                ? `último acesso ${formatDate(account.lastLoginAt)}`
                : 'nunca entrou'}
            </span>
          </div>

          {!account.isActive && (
            <p className="admin-row__warning">
              Conta desativada. Ela não entra no painel e não aparece como opção de autor — o
              que já publicou continua no ar, assinado por ela.
            </p>
          )}

          {account.isActive && !account.hasPassword && (
            <p className="admin-row__warning">
              Sem senha definida: esta pessoa assina matéria mas não consegue entrar no painel.
              Defina uma senha em &ldquo;Trocar senha&rdquo; para dar acesso a ela.
            </p>
          )}

          {account.isLastAdmin && (
            <p className="form-hint">
              É a única conta de administrador ativa — o sistema não deixa desativá-la nem
              rebaixá-la enquanto não houver outra.
            </p>
          )}
        </div>
      </div>

      <div className="admin-row__actions">
        {!account.isSelf && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || account.isLastAdmin}
            onClick={() =>
              call({
                action: 'set-level',
                accessLevel: account.accessLevel === 'admin' ? 'redator' : 'admin',
              })
            }
          >
            {account.accessLevel === 'admin' ? 'Tornar redator' : 'Tornar administrador'}
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setResettingPassword((value) => !value)}
          aria-expanded={resettingPassword}
          disabled={busy}
        >
          {resettingPassword ? 'Cancelar' : 'Trocar senha'}
        </button>

        {!account.isSelf &&
          (account.isActive ? (
            !confirmingDeactivate ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmingDeactivate(true)}
                disabled={busy || account.isLastAdmin}
              >
                Desativar
              </button>
            ) : (
              <>
                <span className="admin-row__warning" role="alert">
                  Desativar {account.name}? As sessões abertas dela caem na hora. As matérias
                  continuam no ar.
                </span>
                <button
                  type="button"
                  className="btn btn--hot btn--sm"
                  onClick={() => call({ action: 'set-active', isActive: false })}
                  disabled={busy}
                >
                  {busy ? 'Desativando…' : 'Desativar mesmo assim'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setConfirmingDeactivate(false)}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => call({ action: 'set-active', isActive: true })}
              disabled={busy}
            >
              Reativar
            </button>
          ))}

        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>

      {resettingPassword && (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            const password = new FormData(event.currentTarget).get('password');
            void call({ action: 'reset-password', password });
          }}
        >
          <label>
            Nova senha para {account.name}
            <input name="password" type="password" required minLength={12} autoComplete="new-password" />
          </label>
          <div className="admin-actions">
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? 'Salvando…' : 'Definir senha'}
            </button>
            <span className="form-hint">
              Isso encerra as sessões abertas desta conta. Passe a senha por um canal seguro.
            </span>
          </div>
        </form>
      )}
    </li>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
