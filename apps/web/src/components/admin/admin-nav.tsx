/**
 * =============================================================================
 * CABEÇALHO DO PAINEL — identidade de quem está logado + navegação por permissão
 * =============================================================================
 *
 * Componente de SERVIDOR: ele lê a tabela de permissões e decide o que existe na
 * barra. Antes, cada uma das cinco telas do painel repetia a mesma `<nav>` com a
 * lista de links escrita à mão — e o resultado previsível era que a tela de
 * afiliados não linkava para a de comentários, e a de matérias linkava para uma
 * ordem diferente das outras. Com contas e níveis entrando, essa duplicação
 * deixaria de ser um detalhe estético: cada cópia esquecida seria um link que
 * oferece a um redator uma tela que vai responder 403.
 *
 * ESCONDER O LINK NÃO É A PROTEÇÃO. Quem protege é o guard de cada página e de
 * cada rota (`requireStaffPage` / `requireStaffApi`). Isto aqui só evita oferecer
 * um caminho que não leva a lugar nenhum — que é uma questão de respeito com quem
 * usa a ferramenta, não de segurança.
 */

import Link from 'next/link';

import { ACCESS_LEVEL_LABELS, can, routes } from '@subcarioca/core';

import type { StaffUser } from '@/server/staff-auth';

import { AdminLogoutButton } from './admin-logout-button';

interface AdminNavProps {
  user: StaffUser;
  /** Rota atual, para marcar o item ativo com `aria-current`. */
  current: 'fila' | 'materias' | 'comentarios' | 'afiliados' | 'precisao' | 'contas';
}

export function AdminNav({ user, current }: AdminNavProps) {
  const links: { key: AdminNavProps['current']; href: string; label: string; visible: boolean }[] = [
    { key: 'fila', href: routes.admin(), label: 'Fila de pautas', visible: can(user.accessLevel, 'verFilaDePautas') },
    { key: 'materias', href: routes.adminArticles(), label: 'Matérias', visible: can(user.accessLevel, 'verMaterias') },
    { key: 'comentarios', href: routes.adminComments(), label: 'Comentários', visible: can(user.accessLevel, 'moderarComentarios') },
    { key: 'afiliados', href: routes.adminAffiliates(), label: 'Afiliados', visible: can(user.accessLevel, 'gerenciarComercial') },
    { key: 'precisao', href: routes.adminAccuracy(), label: 'Precisão do score', visible: can(user.accessLevel, 'verRelatorios') },
    { key: 'contas', href: routes.adminAccounts(), label: 'Contas', visible: can(user.accessLevel, 'gerenciarContas') },
  ];

  return (
    <div className="admin-bar">
      {/*
        `.tabs` (e não `.admin-actions`) porque cada item é uma PÁGINA distinta,
        com URL própria — a mesma distinção documentada na página de categoria:
        chip é filtro dentro da mesma tela, aba é navegação entre telas.
      */}
      <nav className="tabs" aria-label="Seções do painel">
        {links
          .filter((link) => link.visible)
          .map((link) => (
            <Link
              key={link.key}
              href={link.href}
              // `aria-current="page"` só no item ativo: é o que o leitor de tela
              // anuncia como "página atual", e é o que o CSS usa para o filete.
              {...(link.key === current ? { 'aria-current': 'page' as const } : {})}
            >
              {link.label}
            </Link>
          ))}
      </nav>

      <div className="admin-bar__me">
        <span className="admin-row__detail">
          {user.name} · {ACCESS_LEVEL_LABELS[user.accessLevel]}
        </span>
        <AdminLogoutButton />
      </div>
    </div>
  );
}
