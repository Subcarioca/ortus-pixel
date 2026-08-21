/**
 * =============================================================================
 * PREVIEW DA MATÉRIA — /admin/preview/{id}
 * =============================================================================
 *
 * O REQUISITO, nas palavras do dono do site: "o site deve ter uma funcionalidade
 * de preview antes da matéria ou pauta ser postada, para que o redator possa
 * avaliar a qualidade e como ela ficaria para o leitor".
 *
 * O QUE EXISTIA ANTES: só o formulário. O redator escrevia num `<textarea>`, ou
 * no editor de blocos, e a primeira vez que via a matéria de verdade — com a
 * tipografia, a largura da coluna de leitura, a capa em destaque, o índice, o
 * TL;DR no topo — era DEPOIS de publicar, no site, junto com o público. Corrigir
 * ali é corrigir com plateia.
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO CENTRAL: ESTA PÁGINA NÃO TEM TEMPLATE PRÓPRIO
 * -----------------------------------------------------------------------------
 * Ela renderiza `<ArticleView>` — literalmente o mesmo componente que a página
 * pública `/{categoria}/{slug}` usa, com o mesmo CSS e os mesmos dados
 * derivados. Não há um HTML "parecido" mantido em paralelo.
 *
 * Isso é o ponto inteiro da funcionalidade, e não um detalhe de implementação:
 * um preview com template próprio começa idêntico e desalinha na primeira
 * mudança de design que alguém aplicar em um dos dois arquivos. A partir daí ele
 * passa a dar CONFIANÇA FALSA — o redator aprova o que viu, publica, e a página
 * real é outra. Preview que mente é pior que preview nenhum. O racional
 * completo e a lista do que muda no modo preview estão no cabeçalho de
 * `components/article-view.tsx`.
 *
 * -----------------------------------------------------------------------------
 * SEGURANÇA — três camadas, porque o que está aqui é conteúdo não publicado
 * -----------------------------------------------------------------------------
 *
 * 1. SESSÃO DE REDAÇÃO OBRIGATÓRIA (`requireStaffPage`). Sem ela, esta rota
 *    seria uma porta pública para ler qualquer rascunho por id — inclusive a
 *    matéria embargada que ainda não pode sair. A verificação é feita AQUI, na
 *    página, e não em middleware: o Prisma não roda no runtime Edge, então um
 *    middleware só conseguiria conferir a PRESENÇA do cookie, que não é
 *    verificação nenhuma. O porquê está no cabeçalho de `server/staff-auth.ts`.
 *
 * 2. PROPRIEDADE DA MATÉRIA (`canEditArticleOf`), e só quando ela NÃO está
 *    publicada. A regra é a mesma da lista de matérias do painel, que já entrega
 *    ao redator apenas o que ele assina: o rascunho de outra pessoa não é dele
 *    para ler. Matéria JÁ PUBLICADA fica liberada para toda a redação porque
 *    negá-la seria teatro — ela está no site, aberta para o mundo.
 *
 * 3. NUNCA INDEXÁVEL. `robots: { index: false, follow: false }` na metadata,
 *    ALÉM do `Disallow: /admin` que o `robots.txt` já publica. As duas coisas
 *    não são redundantes: `robots.txt` pede para não RASTREAR, e uma URL que
 *    ninguém rastreia ainda pode ser INDEXADA se alguém a linkar de fora (é o
 *    clássico resultado "nenhuma informação disponível para esta página" na
 *    busca do Google). A meta tag é o que diz "não indexe", e ela só é lida por
 *    quem baixa a página. Ter as duas cobre os dois caminhos.
 *
 * Uma quarta camada vem de graça e vale registrar: como a rota está sob
 * `/admin`, ela herda tudo que o projeto já decidiu para o painel — nada de
 * cache, nada de sitemap, nenhum link público apontando para cá.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { canEditArticleOf, routes } from '@subcarioca/core';

import { AdminLogin } from '@/components/admin/admin-login';
import { ArticleView } from '@/components/article-view';
import { getArticleForPreview } from '@/server/queries';
import { requireStaffPage } from '@/server/staff-auth';

/**
 * Sempre dinâmica, nunca cacheada.
 *
 * O preview existe para mostrar o que ACABOU de ser salvo. Qualquer cache aqui,
 * por menor que fosse, devolveria a versão anterior do texto logo depois de o
 * redator apertar salvar — e ele concluiria, com razão aparente, que a alteração
 * se perdeu. Vale também para a consulta: `getArticleForPreview` não passa por
 * `unstable_cache`, pelo mesmo motivo.
 */
export const dynamic = 'force-dynamic';

/**
 * METADATA MÍNIMA E `noindex` — e nada do artigo aqui dentro.
 *
 * Repare no que NÃO é gerado: título da matéria, descrição, canonical, Open
 * Graph. Não é economia de código. Metadata de Open Graph é o que aparece quando
 * alguém cola o link no WhatsApp ou no Slack da redação, e um link de preview
 * colado num grupo mostraria a manchete, a linha fina e a capa de uma matéria
 * ainda não publicada para quem nem tem conta no painel. O conteúdo continuaria
 * protegido (a página exige sessão), mas o VAZAMENTO DA MANCHETE já é o vazamento
 * — em pauta embargada, é o furo inteiro.
 */
export const metadata: Metadata = {
  title: 'Pré-visualização',
  robots: { index: false, follow: false, nocache: true },
};

export default async function ArticlePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Camada 1: sessão da redação. `verMaterias` é a mesma capacidade que abre a
  // lista de matérias — quem pode ver a lista pode pré-visualizar o que é seu.
  const guard = await requireStaffPage('verMaterias');
  if (guard.state !== 'ok') return <AdminLogin />;

  /**
   * O id é validado ANTES de virar consulta.
   *
   * `cuid()` é alfanumérico; o formato é conferido aqui para que um parâmetro
   * esquisito vindo da URL vire 404 sem tocar no banco. Não é defesa contra
   * injeção (o Prisma parametriza, isso não é um risco aqui) — é higiene de
   * rota: um `id` de 4 KB não deve custar uma consulta.
   */
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) notFound();

  const data = await getArticleForPreview(id);
  if (!data) notFound();

  const { article, status } = data;
  const publicada = status === 'published';
  /**
   * "Em aprovação" é um terceiro estado, e a faixa precisa dizer isso.
   *
   * Sem essa distinção, a matéria sensível que um redator enviou para o
   * editor-chefe apareceria aqui rotulada como "rascunho" — e a conclusão
   * natural de quem lê é "esqueci de publicar", que leva a clicar em publicar de
   * novo e a nada acontecer. Ver `requiresSensitiveApproval` em core/staff.ts.
   */
  const emAprovacao = status === 'in-review';

  /**
   * Camada 2: a matéria é desta pessoa?
   *
   * Só vale para o que ainda NÃO está publicado. Ver a decisão 2 no cabeçalho.
   *
   * A mensagem é escrita aqui em vez de reaproveitar `<AdminForbidden>` porque
   * aquele componente diz "esta é uma área de administrador", que seria uma
   * explicação errada: o problema não é o nível de acesso da pessoa, é a
   * autoria da matéria. Mensagem de erro que explica a causa errada faz alguém
   * pedir uma promoção de conta para resolver um problema que a promoção não
   * resolve.
   */
  if (!publicada && !canEditArticleOf(guard.user, article.author.id)) {
    return (
      <div className="container admin">
        <header className="admin__head">
          <h1 className="article__title">Este rascunho não é seu</h1>
        </header>
        <p className="empty-state">
          <span>
            A pré-visualização de uma matéria não publicada fica restrita a quem a assina.
            Esta é de {article.author.name}.
          </span>
          <Link href={routes.adminArticles()} className="link-more">
            Ir para as minhas matérias
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
        A FAIXA DE AVISO FICA FORA DO `<ArticleView>`, E ISSO É DELIBERADO.

        Ela é uma `.container` irmã, acima da matéria — não um elemento
        injetado dentro do template. Duas razões:

          1. NÃO CONTAMINA O QUE ESTÁ SENDO AVALIADO. O redator está julgando
             espaçamento, hierarquia e ritmo de leitura. Uma faixa dentro do
             `.article` empurraria tudo para baixo e mudaria justamente aquilo
             que ele veio conferir.
          2. MANTÉM O TEMPLATE LIMPO DE "SE FOR PREVIEW". Quanto menos o
             componente compartilhado souber sobre o painel, menor a chance de
             a página do leitor herdar um enfeite de preview por engano.

        Ela também é NECESSÁRIA: sem um aviso permanente na tela, uma aba de
        preview esquecida aberta é indistinguível do site real — e a pergunta
        "por que a matéria está no ar sem eu ter publicado?" nasce aí.
      */}
      <div className="container">
        <div className="side-box" role="status">
          <h1 className="hub-stat__lbl">
            Pré-visualização{' '}
            {publicada ? '· matéria publicada' : emAprovacao ? '· aguardando aprovação' : '· rascunho'}
          </h1>
          <p className="form-hint">
            Esta é a aparência exata que a matéria tem (ou terá) para o leitor: mesmo template,
            mesmo CSS.{' '}
            {publicada
              ? 'Ela já está no ar — o que você vê aqui é a versão salva neste momento.'
              : emAprovacao
                ? 'Ela está esperando a liberação de um administrador por ser conteúdo sensível. Até lá, ninguém de fora consegue abrir esta página.'
                : 'Ela ainda NÃO está publicada. Ninguém de fora consegue abrir esta página.'}{' '}
            Não são carregados: anúncios (o espaço fica reservado), medição de audiência e
            comentários.
          </p>
          <p className="form-hint">
            <Link href={routes.adminArticles()} className="link-more">
              Voltar para as matérias
            </Link>
            {publicada && (
              <>
                {' · '}
                <Link
                  href={routes.article(article.category.slug, article.slug)}
                  className="link-more"
                >
                  Abrir a página pública
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <ArticleView data={data} mode="preview" />
    </>
  );
}
