/**
 * =============================================================================
 * PAINEL — MATÉRIAS JÁ CRIADAS (editar e apagar)
 * =============================================================================
 *
 * A tela que faltava para o ciclo editorial fechar. O painel sabia CRIAR
 * matéria a partir de um tópico da fila, mas não sabia mexer no que já existia:
 * corrigir um erro de digitação numa matéria publicada exigia abrir o banco.
 * Editar direto no banco é onde acontecem os acidentes que ninguém audita.
 *
 * POR QUE ESTA LISTA É SEPARADA DA FILA DE PAUTAS (/admin), e não uma aba dela:
 * são dois trabalhos com ritmos diferentes. A fila é urgente e ordenada por
 * SCORE — é a tela que o jornalista olha para decidir o que escrever agora. Esta
 * é de manutenção e ordenada por RECÊNCIA DE EDIÇÃO — a pergunta aqui é "o que
 * eu mexi por último?". Misturar as duas faria a mais barulhenta esconder a
 * outra.
 *
 * RASCUNHOS VÊM PRIMEIRO, e isso é deliberado: rascunho é trabalho inacabado,
 * e trabalho inacabado que some da vista é trabalho esquecido.
 */

import Link from 'next/link';

import { CATEGORIES, routes } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { ArticleRow, type AdminArticleRowData } from '@/components/admin/article-row';
import { isAdminAuthenticated } from '@/server/admin-auth';

export const dynamic = 'force-dynamic';

export default async function AdminArticlesPage() {
  if (!(await isAdminAuthenticated())) {
    return <AdminLogin />;
  }

  const [articles, authors] = await Promise.all([
    prisma.article.findMany({
      // 'suggested'/'archived' ficam de fora: esta tela é sobre o que a redação
      // escreveu e mantém no ar. Incluir tudo transformaria a lista num despejo
      // do banco, que é o oposto de uma ferramenta de trabalho.
      where: { status: { in: ['published', 'draft', 'in-review'] } },
      orderBy: { updatedAt: 'desc' },
      // Teto explícito. Sem ele, a tela degrada silenciosamente conforme o
      // acervo cresce — e o dia em que travar será numa quinta-feira agitada.
      // Quando incomodar, o próximo passo é paginação, não um `take` maior.
      take: 100,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        content: true,
        status: true,
        format: true,
        tldr: true,
        coverImageUrl: true,
        coverImageAlt: true,
        isBreaking: true,
        hasSpoiler: true,
        publishedAt: true,
        updatedAt: true,
        authorId: true,
        author: { select: { name: true } },
        category: { select: { slug: true, name: true } },
        // A contagem entra aqui, e não numa consulta por linha: é o que o aviso
        // de exclusão precisa dizer ("isso apaga também os N comentários"), e
        // um `count` por matéria seria N+1 na abertura da tela.
        _count: { select: { comments: true } },
      },
    }),
    prisma.author.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const categoryOptions = CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }));

  const rows: AdminArticleRowData[] = articles.map((article) => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    status: article.status,
    categorySlug: article.category.slug,
    categoryName: article.category.name,
    authorId: article.authorId,
    authorName: article.author.name,
    format: article.format,
    tldr: article.tldr,
    coverImageUrl: article.coverImageUrl,
    coverImageAlt: article.coverImageAlt,
    isBreaking: article.isBreaking,
    hasSpoiler: article.hasSpoiler,
    // Datas viram ISO na fronteira servidor→cliente: props de componente de
    // cliente são serializadas, e formatar no servidor usaria o fuso dele.
    publishedAt: article.publishedAt?.toISOString() ?? null,
    updatedAt: article.updatedAt.toISOString(),
    commentCount: article._count.comments,
    url: routes.article(article.category.slug, article.slug),
  }));

  const drafts = rows.filter((row) => row.status !== 'published');
  const published = rows.filter((row) => row.status === 'published');

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Matérias</h1>
        <p className="section-sub">
          Edite ou remova o que já foi criado. Para escrever uma matéria nova, comece por um
          tópico da fila de pautas.
        </p>
        <nav className="admin-actions">
          <Link href={routes.admin()} className="link-more">
            Fila de pautas
          </Link>
          <Link href={routes.adminComments()} className="link-more">
            Comentários
          </Link>
          <Link href={routes.adminAffiliates()} className="link-more">
            Afiliados
          </Link>
        </nav>
      </header>

      <section aria-labelledby="materias-rascunhos">
        <div className="section-head">
          <h2 id="materias-rascunhos" className="section-title">
            Rascunhos
            {drafts.length > 0 && <span className="cmt__time"> · {drafts.length}</span>}
          </h2>
        </div>

        {drafts.length === 0 ? (
          <p className="empty-state">Nenhum rascunho aberto.</p>
        ) : (
          <ul className="admin__list">
            {drafts.map((row) => (
              <ArticleRow
                key={row.id}
                article={row}
                categories={categoryOptions}
                authors={authors}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="materias-publicadas">
        <div className="section-head">
          <h2 id="materias-publicadas" className="section-title">
            Publicadas
            {published.length > 0 && <span className="cmt__time"> · {published.length}</span>}
          </h2>
        </div>

        {published.length === 0 ? (
          <p className="empty-state">Nenhuma matéria publicada ainda.</p>
        ) : (
          <ul className="admin__list">
            {published.map((row) => (
              <ArticleRow
                key={row.id}
                article={row}
                categories={categoryOptions}
                authors={authors}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
