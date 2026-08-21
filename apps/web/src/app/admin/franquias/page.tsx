/**
 * =============================================================================
 * PAINEL — CATÁLOGO DE FRANQUIAS
 * =============================================================================
 *
 * A tela que faltava para o ciclo de etiquetagem fechar. O painel sabia
 * ESCOLHER franquia (o `<select multiple>` da matéria e o da pauta), e não sabia
 * CRIAR nenhuma: o catálogo inteiro vinha do seed. Cobrir um universo que o seed
 * não previu exigia abrir o banco à mão — que é onde acontecem os acidentes que
 * ninguém audita, o mesmo argumento que justificou a tela de matérias.
 *
 * ABERTA A ADMINISTRADOR E REDATOR (capacidade `criarFranquia`). O racional
 * completo está na declaração da chave em `packages/core/src/staff.ts`; em uma
 * frase: acrescentar ao catálogo não altera nem remove nada do que já existe, e
 * quem cobre a franquia é quem sabe que ela precisa existir.
 *
 * -----------------------------------------------------------------------------
 * A LISTA EXISTE PARA EVITAR A DUPLICATA, NÃO PARA ADMINISTRAR NADA
 * -----------------------------------------------------------------------------
 * O erro que esta tela mais precisa prevenir não é o cadastro inválido (a rota
 * recusa) — é o cadastro REPETIDO com outro nome: "GTA" e "Grand Theft Auto"
 * como duas franquias, cada uma com metade das matérias e metade dos
 * seguidores. Uma vez espalhado pelas matérias, isso só se conserta no banco.
 *
 * Por isso a lista mostra, para cada franquia, o SLUG (que é a identidade real,
 * e o que a rota compara) e os ALIASES já cadastrados — as duas informações que
 * respondem "isto já está aqui com outro nome?" antes de a pessoa digitar. E
 * por isso ela vem ANTES de qualquer paginação ou busca: com dezenas de linhas,
 * uma lista completa é mais útil que um campo de busca que exige saber o nome
 * que se está tentando descobrir.
 *
 * O TETO de 300 é explícito pelo mesmo motivo do teto da tela de matérias: sem
 * ele, a tela degrada em silêncio conforme o catálogo cresce. Quando incomodar,
 * o próximo passo é busca no servidor — não um `take` maior.
 */

import { CATEGORIES, routes } from '@subcarioca/core';
import { prisma, toStringArray } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminNav } from '@/components/admin/admin-nav';
import { FranchiseCreateForm } from '@/components/admin/franchise-create-form';
import { requireStaffPage } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export default async function AdminFranchisesPage() {
  const guard = await requireStaffPage('criarFranquia');
  if (guard.state === 'anonymous') return <AdminLogin />;
  // Hoje `criarFranquia` é `true` para os dois níveis, então este ramo é
  // inalcançável. Ele fica aqui de propósito: é a única linha que precisa
  // mudar se um dia a capacidade virar privativa, e sem ela o redator veria a
  // tela de LOGIN — a pior resposta possível para quem já está logado.
  if (guard.state === 'forbidden') {
    return <AdminForbidden user={guard.user} what="O catálogo de franquias" />;
  }

  const { user } = guard;

  const franchises = await prisma.franchise.findMany({
    orderBy: { name: 'asc' },
    take: 300,
    select: {
      id: true,
      slug: true,
      name: true,
      aliases: true,
      followerCount: true,
      primaryCategory: { select: { name: true } },
      // Quantas matérias já usam a etiqueta. É o dado que separa a franquia viva
      // da que foi cadastrada por engano e nunca mais usada — e ele sai de um
      // `_count` na MESMA consulta, e não de uma contagem por linha (que seria
      // o N+1 clássico numa lista de 300).
      _count: { select: { articles: true } },
    },
  });

  const categoryOptions = CATEGORIES.map((category) => ({
    slug: category.slug,
    name: category.name,
  }));

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Franquias</h1>
        <p className="section-sub">
          Cada franquia daqui vira uma página pública em {routes.franchise('...')}, entra no
          sitemap e pode ser seguida pelo leitor. Confira a lista antes de cadastrar: a mesma
          franquia com dois nomes divide as matérias e os seguidores em duas.
        </p>
        <AdminNav user={user} current="franquias" />
      </header>

      <section aria-labelledby="franquia-nova">
        <div className="section-head">
          <h2 id="franquia-nova" className="section-title">
            Cadastrar franquia
          </h2>
        </div>
        <FranchiseCreateForm categories={categoryOptions} />
      </section>

      <section aria-labelledby="franquias-existentes">
        <div className="section-head">
          <h2 id="franquias-existentes" className="section-title">
            No catálogo
            {franchises.length > 0 && <span className="cmt__time"> · {franchises.length}</span>}
          </h2>
        </div>

        {franchises.length === 0 ? (
          <p className="empty-state">
            Nenhuma franquia cadastrada ainda. Comece pelas que a redação cobre toda semana.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Franquia</th>
                <th scope="col">Endereço</th>
                <th scope="col">Editoria</th>
                <th scope="col">Outros nomes</th>
                <th scope="col">Matérias</th>
                <th scope="col">Seguidores</th>
              </tr>
            </thead>
            <tbody>
              {franchises.map((franchise) => {
                // `aliases` é coluna `Json` (o MySQL não tem array nativo).
                // Normalizamos no SERVIDOR, como o resto do painel já faz com
                // `tldr`: um `null` ou um JSON malformado vindo do banco viraria
                // um `.map` sobre `undefined` e derrubaria a tela inteira por
                // causa de UMA linha estranha.
                const aliasList = toStringArray(franchise.aliases);

                return (
                  <tr key={franchise.id}>
                    <th scope="row">{franchise.name}</th>
                    <td>
                      {/* Link para o hub PÚBLICO: é a forma mais rápida de
                          conferir que a franquia recém-criada está de pé, e
                          evita que alguém monte a URL na mão para descobrir. */}
                      <a href={routes.franchise(franchise.slug)}>/{franchise.slug}</a>
                    </td>
                    <td>{franchise.primaryCategory.name}</td>
                    <td>
                      {aliasList.length > 0 ? (
                        aliasList.map((alias) => (
                          <span key={alias} className="chip chip--sm">
                            {alias}
                          </span>
                        ))
                      ) : (
                        <span className="admin-row__detail">—</span>
                      )}
                    </td>
                    <td>{franchise._count.articles}</td>
                    <td>{franchise.followerCount.toLocaleString('pt-BR')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
