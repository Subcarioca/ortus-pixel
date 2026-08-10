/**
 * =============================================================================
 * PAINEL — CONTAS DA REDAÇÃO
 * =============================================================================
 *
 * A tela que faltava para o sistema de contas se sustentar sozinho: sem ela, dar
 * acesso a alguém novo exigiria acesso ao servidor, e o script de bootstrap
 * viraria ferramenta de rotina em vez de ferramenta de resgate.
 *
 * DELIBERADAMENTE SIMPLES. Uma lista e um formulário. Não há busca, filtro,
 * paginação nem convite por e-mail — uma redação tem dezenas de pessoas, não
 * milhares, e cada uma dessas peças é uma superfície a mais para manter (o
 * convite por e-mail, em particular, é um token de uso único com expiração, ou
 * seja, um fluxo de autenticação inteiro escondido atrás de uma conveniência).
 *
 * O QUE A TELA DEIXA EXPLÍCITO, E POR QUÊ:
 *   - contas SEM SENHA aparecem marcadas. São autores que assinam matéria e não
 *     entram no painel — um estado legítimo (colaborador externo) que, sem
 *     rótulo, pareceria um defeito ("criei a conta e a pessoa não entra").
 *   - a última conta de administrador ativa é sinalizada. A trava que impede
 *     desativá-la vive na API; dizer isso ANTES do clique evita a mensagem de
 *     erro que parece um bug.
 */

import { toAccessLevel } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminNav } from '@/components/admin/admin-nav';
import { AccountCreateForm } from '@/components/admin/account-create-form';
import { AccountRow } from '@/components/admin/account-row';
import { ChangeOwnPasswordForm } from '@/components/admin/change-own-password-form';
import { requireStaffPage } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export default async function AdminAccountsPage() {
  const guard = await requireStaffPage('gerenciarContas');
  if (guard.state === 'anonymous') return <AdminLogin />;
  if (guard.state === 'forbidden') {
    return <AdminForbidden user={guard.user} what="A gestão de contas da redação" />;
  }

  const authors = await prisma.author.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      systemRole: true,
      isActive: true,
      lastLoginAt: true,
      // NUNCA `passwordHash: true`. Precisamos saber se EXISTE senha, não qual
      // é o hash — e um hash que não sai do banco é um hash que não pode vazar
      // por um `console.log` esquecido nem pelo payload de uma página. Por isso
      // a contagem indireta abaixo, em vez do campo.
      _count: { select: { articles: true } },
    },
  });

  // "Tem senha?" sem trazer o hash: uma consulta que só devolve ids.
  const comSenha = new Set(
    (
      await prisma.author.findMany({
        where: { passwordHash: { not: null } },
        select: { id: true },
      })
    ).map((row) => row.id),
  );

  const adminsAtivos = authors.filter(
    (author) => author.isActive && toAccessLevel(author.systemRole) === 'admin',
  ).length;

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Contas da redação</h1>
        <p className="section-sub">
          Quem entra no painel e com qual nível. Redator cria e edita só as próprias matérias;
          administrador vê tudo e gerencia estas contas.
        </p>
        <AdminNav user={guard.user} current="contas" />
      </header>

      <section aria-labelledby="conta-nova">
        <div className="section-head">
          <h2 id="conta-nova" className="section-title">
            Criar conta
          </h2>
        </div>
        <AccountCreateForm />
      </section>

      <section aria-labelledby="contas-lista">
        <div className="section-head">
          <h2 id="contas-lista" className="section-title">
            Contas <span className="cmt__time"> · {authors.length}</span>
          </h2>
        </div>

        <ul className="admin__list">
          {authors.map((author) => (
            <AccountRow
              key={author.id}
              account={{
                id: author.id,
                name: author.name,
                email: author.email,
                editorialRole: author.role,
                accessLevel: toAccessLevel(author.systemRole),
                isActive: author.isActive,
                hasPassword: comSenha.has(author.id),
                articleCount: author._count.articles,
                lastLoginAt: author.lastLoginAt?.toISOString() ?? null,
                // "Sou eu mesmo" muda a linha: a pessoa não deve conseguir se
                // rebaixar ou se desativar por engano no meio de outra tarefa.
                isSelf: author.id === guard.user.id,
                // Se este é o único admin ativo, a linha avisa antes do clique.
                isLastAdmin:
                  author.isActive &&
                  toAccessLevel(author.systemRole) === 'admin' &&
                  adminsAtivos === 1,
              }}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="minha-senha">
        <div className="section-head">
          <h2 id="minha-senha" className="section-title">
            Minha senha
          </h2>
        </div>
        <p className="form-hint">
          Trocar a senha encerra todas as sessões abertas — inclusive esta. Você vai precisar
          entrar de novo.
        </p>
        <ChangeOwnPasswordForm />
      </section>
    </div>
  );
}
