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
 *
 * -----------------------------------------------------------------------------
 * TRÊS SEÇÕES, E A PRIMEIRA É A FILA DE APROVAÇÃO
 * -----------------------------------------------------------------------------
 * "Aguardando aprovação" (`status: 'in-review'`) veio para o topo pelo mesmo
 * raciocínio que já colocava rascunho antes de publicada, só que mais forte:
 * matéria em revisão é trabalho PRONTO que está parado esperando UMA outra
 * pessoa. Todo minuto ali é uma pauta esfriando, e a pessoa que precisa agir não
 * é a autora — é quem abre esta tela para outra coisa e passaria batido.
 *
 * A seção aparece para os DOIS níveis, com conteúdos diferentes e por motivos
 * diferentes: para o administrador ela é a mesa de trabalho (tem os botões);
 * para o redator ela é a resposta a "cadê a minha matéria?" — sem ela, o texto
 * dele sumiria da lista de publicadas sem explicação. Ver core/staff.ts.
 */

import { CATEGORIES, can, routes, toContentOrigin, toContentSensitivity } from '@subcarioca/core';
import { prisma, toStringArray } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminNav } from '@/components/admin/admin-nav';
import { ArticleRow, type AdminArticleRowData } from '@/components/admin/article-row';
import { requireStaffPage } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export default async function AdminArticlesPage() {
  const guard = await requireStaffPage('verMaterias');
  if (guard.state !== 'ok') return <AdminLogin />;

  const { user } = guard;
  const vePorTodaARedacao = can(user.accessLevel, 'atribuirOutroAutor');

  const [articles, authors, franchises] = await Promise.all([
    prisma.article.findMany({
      // 'suggested'/'archived' ficam de fora: esta tela é sobre o que a redação
      // escreveu e mantém no ar. Incluir tudo transformaria a lista num despejo
      // do banco, que é o oposto de uma ferramenta de trabalho.
      //
      // O RECORTE POR AUTORIA É FEITO NA CONSULTA, e não filtrando em memória
      // depois. Não é otimização: filtrar depois significaria mandar ao
      // navegador do redator o título, o resumo e o corpo dos rascunhos não
      // publicados de toda a redação — inclusive os que ainda são segredo de
      // pauta. O que ele não pode editar, ele não recebe.
      where: {
        status: { in: ['published', 'draft', 'in-review'] },
        ...(vePorTodaARedacao ? {} : { authorId: user.id }),
      },
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
        coverImageFit: true,
        coverImageFocalX: true,
        coverImageFocalY: true,
        isBreaking: true,
        hasSpoiler: true,
        contentSensitivity: true,
        // Procedência do texto inicial: alimenta a etiqueta "rascunho de IA" da
        // linha. Quem revisa precisa saber disso ANTES de abrir o texto.
        contentOrigin: true,
        blocks: true,
        publishedAt: true,
        updatedAt: true,
        authorId: true,
        author: { select: { name: true } },
        category: { select: { slug: true, name: true } },
        subcategory: { select: { slug: true } },
        // As etiquetas atuais precisam voltar para o formulário: a gravação é
        // por SUBSTITUIÇÃO (ver server/article-taxonomy.ts), então um formulário
        // que reabre vazio APAGARIA silenciosamente as franquias e tags da
        // matéria no primeiro salvamento.
        franchises: { select: { franchiseId: true } },
        tags: { select: { tag: { select: { name: true } } } },
        // A contagem entra aqui, e não numa consulta por linha: é o que o aviso
        // de exclusão precisa dizer ("isso apaga também os N comentários"), e
        // um `count` por matéria seria N+1 na abertura da tela.
        _count: { select: { comments: true } },
      },
    }),
    // Mesma regra da fila de pautas: quem não pode atribuir outro autor só
    // recebe a si mesmo como opção.
    vePorTodaARedacao
      ? prisma.author.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([{ id: user.id, name: user.name }]),
    prisma.franchise.findMany({
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  const categoryOptions = CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }));
  const podeAfrouxarConteudo = can(user.accessLevel, 'reduzirRestricaoDeConteudo');
  const podeAprovarSensivel = can(user.accessLevel, 'aprovarConteudoSensivel');

  /**
   * MOTIVOS DAS DEVOLUÇÕES — uma consulta só, depois da lista.
   *
   * Por que uma SEGUNDA consulta e não um `include` na primeira: `AuditLog` não
   * tem chave estrangeira para `Article` (é proposital — a trilha precisa
   * sobreviver à exclusão da matéria, ver o cabeçalho do modelo no schema), então
   * não existe relação para o Prisma incluir. O jeito de ler é por `entityId`.
   *
   * Por que um `IN` com todos os ids de uma vez, e não uma consulta por linha:
   * consulta dentro de `map` é o N+1 clássico — 100 idas ao banco para montar uma
   * tela. Aqui são duas, independentemente do tamanho da lista.
   *
   * O `take` alto e o `orderBy` decrescente juntos dão o que interessa: como a
   * lista já chega da mais recente para a mais antiga, o PRIMEIRO registro de
   * cada matéria é a devolução mais recente dela — e o `Map` abaixo, que só
   * grava quando a chave ainda não existe, guarda exatamente esse.
   */
  const rejections = await prisma.auditLog.findMany({
    where: {
      action: 'article.review_rejected',
      entityType: 'Article',
      entityId: { in: articles.map((article) => article.id) },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { entityId: true, reason: true, createdAt: true },
  });

  const lastRejectionByArticle = new Map<string, { reason: string; at: string }>();
  for (const log of rejections) {
    if (!log.entityId || lastRejectionByArticle.has(log.entityId)) continue;
    // Devolução sem motivo não deveria existir (a rota exige), mas a trilha é
    // histórica: um registro antigo ou gravado por outro caminho não pode virar
    // um "undefined" na tela de quem trabalha.
    if (!log.reason) continue;
    lastRejectionByArticle.set(log.entityId, {
      reason: log.reason,
      at: log.createdAt.toISOString(),
    });
  }

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
    // `tldr` é coluna `Json` desde a migração para o MySQL. Ao contrário de
    // `blocks` (logo abaixo), que atravessa a fronteira cru e é normalizado no
    // editor, aqui normalizamos no SERVIDOR: o formulário de edição inicializa
    // seu estado com `article.tldr.length > 0 ? ... : ['', '', '']`, ou seja,
    // já espera um array de verdade. Um `null` vindo do banco quebraria a tela.
    tldr: toStringArray(article.tldr),
    coverImageUrl: article.coverImageUrl,
    coverImageAlt: article.coverImageAlt,
    coverImageFit: article.coverImageFit,
    coverImageFocalX: article.coverImageFocalX,
    coverImageFocalY: article.coverImageFocalY,
    isBreaking: article.isBreaking,
    hasSpoiler: article.hasSpoiler,
    // Normalizado no SERVIDOR, como `tldr`: o formulário espera um dos três
    // níveis, e uma string estranha no banco viraria um `<select>` sem valor
    // selecionado — que salva 'none' sem ninguém ter escolhido isso.
    contentSensitivity: toContentSensitivity(article.contentSensitivity),
    // Normalizado no servidor pelo mesmo motivo dos dois acima: o valor vem de
    // uma coluna de texto, e a tela decide o que exibir a partir de um
    // vocabulário fechado (ver core/content-origin.ts).
    contentOrigin: toContentOrigin(article.contentOrigin),
    subcategorySlug: article.subcategory?.slug ?? null,
    franchiseIds: article.franchises.map((f) => f.franchiseId),
    tagNames: article.tags.map((t) => t.tag.name),
    // O `blocks` é `Json` no Prisma, ou seja, `unknown` aqui. Ele atravessa a
    // fronteira servidor→cliente como veio e é NORMALIZADO no editor
    // (`toEditorBlocks`), que trata Json malformado como "sem blocos". Validar
    // de novo aqui só duplicaria a regra.
    blocks: article.blocks,
    // Datas viram ISO na fronteira servidor→cliente: props de componente de
    // cliente são serializadas, e formatar no servidor usaria o fuso dele.
    publishedAt: article.publishedAt?.toISOString() ?? null,
    updatedAt: article.updatedAt.toISOString(),
    commentCount: article._count.comments,
    url: routes.article(article.category.slug, article.slug),
    /**
     * Só nas matérias que estão EM RASCUNHO. Numa matéria já publicada (ou de
     * volta na fila), a devolução de duas semanas atrás é ruído: ela já foi
     * resolvida, e repetir o texto de uma recusa antiga ao lado de uma matéria
     * no ar é a informação mais confusa possível.
     */
    reviewRejection:
      article.status === 'draft' ? (lastRejectionByArticle.get(article.id) ?? null) : null,
  }));

  const inReview = rows.filter((row) => row.status === 'in-review');
  const drafts = rows.filter((row) => row.status !== 'published' && row.status !== 'in-review');
  const published = rows.filter((row) => row.status === 'published');

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">{vePorTodaARedacao ? 'Matérias' : 'Minhas matérias'}</h1>
        <p className="section-sub">
          {vePorTodaARedacao
            ? 'Edite ou remova o que já foi criado. Para escrever uma matéria nova, comece por um tópico da fila de pautas.'
            : 'Esta lista mostra só o que você assina. Para escrever uma matéria nova, comece por um tópico da fila de pautas.'}
        </p>
        <AdminNav user={user} current="materias" />
      </header>

      {/* ---------- FILA DE APROVAÇÃO DE CONTEÚDO SENSÍVEL ---------- */}
      {/* A seção só é DESENHADA quando há algo nela. Uma "Aguardando aprovação ·
          0" fixa no topo da tela, todos os dias, é como um aviso deixa de ser
          lido — e o dia em que houver uma matéria de verdade ali, ninguém vai
          reparar que o número mudou. */}
      {inReview.length > 0 && (
        <section aria-labelledby="materias-aprovacao">
          <div className="section-head">
            <h2 id="materias-aprovacao" className="section-title">
              Aguardando aprovação
              <span className="cmt__time"> · {inReview.length}</span>
            </h2>
          </div>

          <p className="form-hint">
            {podeAprovarSensivel
              ? 'Matérias de conteúdo sensível escritas pela redação. Elas NÃO estão no ar: só sobem depois que você aprovar.'
              : 'Suas matérias de conteúdo sensível esperando liberação da administração. Elas ainda não estão no ar — o texto continua salvo e editável.'}
          </p>

          <ul className="admin__list">
            {inReview.map((row) => (
              <ArticleRow
                key={row.id}
                article={row}
                categories={categoryOptions}
                authors={authors}
                franchises={franchises}
                canLowerSensitivity={podeAfrouxarConteudo}
                canApproveReview={podeAprovarSensivel}
              />
            ))}
          </ul>
        </section>
      )}

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
                franchises={franchises}
                canLowerSensitivity={podeAfrouxarConteudo}
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
                franchises={franchises}
                canLowerSensitivity={podeAfrouxarConteudo}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
