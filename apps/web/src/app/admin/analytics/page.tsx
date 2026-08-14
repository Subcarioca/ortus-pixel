/**
 * =============================================================================
 * PAINEL — AUDIÊNCIA (o que o leitor fez com o que a redação publicou)
 * =============================================================================
 *
 * A tela responde quatro perguntas por matéria, e nenhuma delas o painel sabia
 * responder antes: quantas visualizações, quantos cliques levaram a OUTRA
 * matéria nossa, quantos cliques em anúncio e quantos em oferta de afiliado.
 *
 * -----------------------------------------------------------------------------
 * POR QUE UMA TELA PRÓPRIA, E NÃO UMA COLUNA EM /admin/materias
 * -----------------------------------------------------------------------------
 * São dois trabalhos com ritmos diferentes — a mesma razão que já separa a fila
 * de pautas da lista de matérias. `/admin/materias` é ferramenta de EDIÇÃO,
 * ordenada por recência ("o que eu mexi por último"); esta é de AVALIAÇÃO,
 * ordenada por desempenho ("o que funcionou"). Espremer as quatro colunas na
 * lista de edição deixaria a linha ilegível no celular e ainda misturaria a
 * pergunta "preciso corrigir isto?" com "isto deu certo?".
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTA TELA NÃO PROMETE — e diz isso na cara do usuário
 * -----------------------------------------------------------------------------
 * Os números são de instrumentação PRÓPRIA, coletada no navegador. Não são
 * auditáveis, não deduplicam pessoas e, no caso de anúncio, são aproximados por
 * limitação do navegador (o criativo vive num iframe de outro domínio). Tudo
 * isso está escrito na tela, e não só no código: um número sem contexto vira
 * argumento em reunião, e argumento errado custa decisão errada.
 *
 * ACESSO: `verAnalytics` (redator TEM). O RECORTE é que muda — e ele é aplicado
 * na CONSULTA, em `server/analytics.ts`, não aqui. Redator recebe do servidor
 * apenas as linhas das matérias que assina, e o total do site nem é calculado
 * para ele.
 */

import Link from 'next/link';

import { ANALYTICS_EVENT_LABELS, can, routes } from '@subcarioca/core';

import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminLogin } from '@/components/admin/admin-login';
import { AdminNav } from '@/components/admin/admin-nav';
import { getAudienceReport } from '@/server/analytics';
import { requireStaffPage } from '@/server/staff-auth';

export const dynamic = 'force-dynamic';

export default async function AdminAnalyticsPage() {
  const guard = await requireStaffPage('verAnalytics');
  if (guard.state === 'anonymous') return <AdminLogin />;
  // Hoje `verAnalytics` é `true` nos dois níveis, então este caminho não é
  // alcançável. Ele fica aqui de propósito: se um terceiro nível de acesso
  // entrar na tabela de capacidades sem esta permissão, a tela responde a coisa
  // certa em vez de estourar — e o compilador não teria como avisar.
  if (guard.state === 'forbidden') return <AdminForbidden user={guard.user} what="A audiência" />;

  const { user } = guard;
  const report = await getAudienceReport(user);
  const vePorTodaARedacao = can(user.accessLevel, 'verAnalyticsDoSite');

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">{vePorTodaARedacao ? 'Audiência' : 'Minha audiência'}</h1>
        <p className="section-sub">
          Últimos {report.windowDays} dias.{' '}
          {vePorTodaARedacao
            ? 'Todas as matérias da redação.'
            : 'Somente as matérias que você assina.'}
        </p>
        <AdminNav user={user} current="analytics" />
      </header>

      {/* ---------- TOTAIS DO SITE (só administrador) ---------- */}
      {report.siteTotals && (
        <section className="admin__kpis" aria-label="Totais do site">
          {(
            [
              ['article.view', report.siteTotals['article.view']],
              ['article.link', report.siteTotals['article.link']],
              ['ad.click', report.siteTotals['ad.click']],
              ['affiliate.click', report.siteTotals['affiliate.click']],
            ] as const
          ).map(([kind, total]) => (
            <div key={kind} className="side-box">
              <h2 className="hub-stat__lbl">{ANALYTICS_EVENT_LABELS[kind]}</h2>
              <p className="hub-stat__num">{total.toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </section>
      )}

      {/* ---------- POR MATÉRIA ---------- */}
      <section aria-labelledby="audiencia-materias">
        <div className="section-head">
          <h2 id="audiencia-materias" className="section-title">
            Por matéria
          </h2>
        </div>

        {report.rows.length === 0 ? (
          <p className="empty-state">
            Nenhuma matéria com dados ainda. Os números aparecem conforme os leitores
            navegam — matéria recém-publicada leva algumas horas para dizer alguma coisa.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Matéria</th>
                {vePorTodaARedacao && <th scope="col">Autor</th>}
                <th scope="col">{ANALYTICS_EVENT_LABELS['article.view']}</th>
                <th scope="col">{ANALYTICS_EVENT_LABELS['article.link']}</th>
                <th scope="col">{ANALYTICS_EVENT_LABELS['ad.click']}</th>
                <th scope="col">{ANALYTICS_EVENT_LABELS['affiliate.click']}</th>
                <th scope="col">Total histórico</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.articleId}>
                  <td>
                    {/* Só matéria publicada tem página pública; rascunho vira
                        texto simples, porque um link para 404 na própria
                        ferramenta de trabalho é pura frustração. */}
                    {row.status === 'published' ? (
                      <Link href={routes.article(row.categorySlug, row.slug)}>{row.title}</Link>
                    ) : (
                      <>
                        {row.title} <span className="cmt__time">· {row.status}</span>
                      </>
                    )}
                  </td>
                  {vePorTodaARedacao && <td>{row.authorName}</td>}
                  <td>{row.views.toLocaleString('pt-BR')}</td>
                  <td>{row.outboundArticleClicks.toLocaleString('pt-BR')}</td>
                  <td>{row.adClicks.toLocaleString('pt-BR')}</td>
                  <td>{row.affiliateClicks.toLocaleString('pt-BR')}</td>
                  <td>{row.lifetimeViews.toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------- COMO LER ESTES NÚMEROS ---------- */}
      {/*
        Este bloco não é rodapé decorativo. Ele existe porque a alternativa —
        deixar cada pessoa supor o que a coluna significa — produz conclusões
        erradas com aparência de dado, e conclusão errada com número do lado é
        muito mais difícil de desfazer do que palpite assumido.
      */}
      <section aria-labelledby="audiencia-notas">
        <div className="section-head">
          <h2 id="audiencia-notas" className="section-title">
            Como ler estes números
          </h2>
        </div>
        <ul className="form-hint">
          <li>
            <strong>Visualizações</strong> conta aberturas de página, não pessoas: a mesma
            pessoa voltando amanhã conta de novo. Serve para comparar matérias entre si.
          </li>
          <li>
            <strong>Cliques para outras matérias</strong> é o que mede se a matéria segura o
            leitor no site — é o número que justifica (ou não) a caixa &ldquo;Leia
            também&rdquo; no meio do texto.
          </li>
          <li>
            <strong>Cliques em anúncio</strong> é APROXIMADO. O anúncio é carregado dentro de
            um quadro de outro domínio e o navegador, com razão, não deixa a gente ver o que
            acontece lá dentro. Use para comparar posições; a receita real está no relatório
            do AdSense.
          </li>
          <li>
            <strong>Total histórico</strong> é o acumulado desde sempre. As outras colunas
            olham só os últimos {report.windowDays} dias.
          </li>
        </ul>
      </section>
    </div>
  );
}
