/**
 * Tela de "você está logado, mas isto não é para o seu nível".
 *
 * Existe como componente próprio porque a alternativa — mostrar o formulário de
 * login — é a pior resposta possível: a pessoa digita a senha certa, entra, e
 * cai de volta na mesma tela de login, sem nenhuma pista de que o problema não é
 * a senha. Distinguir "não autenticado" de "não autorizado" é a mesma distinção
 * entre 401 e 403 na API, aplicada à interface.
 */

import Link from 'next/link';

import { routes } from '@subcarioca/core';

import type { StaffUser } from '@/server/staff-auth';

export function AdminForbidden({ user, what }: { user: StaffUser; what: string }) {
  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Sem acesso a esta tela</h1>
      </header>

      <p className="empty-state">
        <span>
          {what} é uma área de administrador. Sua conta ({user.name}) entra como redator — você
          continua criando e editando as suas próprias matérias normalmente.
        </span>
        <Link href={routes.adminArticles()} className="link-more">
          Ir para as minhas matérias
        </Link>
      </p>
    </div>
  );
}
