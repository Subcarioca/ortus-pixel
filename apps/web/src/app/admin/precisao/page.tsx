/**
 * =============================================================================
 * RELATÓRIO DE PRECISÃO DO SCORE
 * =============================================================================
 *
 * O KPI que o briefing classifica como "crítico": a correlação entre o score
 * previsto no momento da publicação e os pageviews reais nas 24h seguintes.
 *
 * É esta tela que transforma o algoritmo de "opinião congelada" em "sistema que
 * aprende". Sem ela, os pesos definidos no primeiro dia permaneceriam para
 * sempre, sem ninguém saber se funcionam.
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { routes } from '@canalnerd/core';

import { AdminLogin } from '@/components/admin/admin-login';
import { ADMIN_SESSION_COOKIE } from '@/server/admin-auth';
import { getAccuracyReportSafe } from '@/server/admin-metrics';
import { safeCompare } from '@/server/security';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Precisão do score',
  robots: { index: false, follow: false },
};

async function isAuthenticated(): Promise<boolean> {
  const expected = process.env.ADMIN_ACCESS_TOKEN;
  if (!expected) return false;
  const cookieStore = await cookies();
  const provided = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  return Boolean(provided) && safeCompare(provided!, expected);
}

export default async function AccuracyPage() {
  if (!(await isAuthenticated())) return <AdminLogin />;

  const report = await getAccuracyReportSafe();

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Precisão do score</h1>
        <p className="section-sub">
          O quanto o score previsto na publicação se relacionou com a audiência real das 24h
          seguintes. <Link href={routes.admin()}>Voltar ao painel</Link>.
        </p>
      </header>

      {!report || report.sampleSize < 20 ? (
        <div className="side-box">
          <h2>Amostra insuficiente</h2>
          <p>
            {report
              ? `Temos ${report.sampleSize} artigo(s) com janela de 24h fechada. São necessários ao menos 20 para que a correlação signifique alguma coisa.`
              : 'Não foi possível gerar o relatório.'}
          </p>
          <p className="form-hint">
            Correlação calculada sobre poucos pontos é numerologia, não estatística — e levaria
            alguém a mexer nos pesos por engano. Por isso o relatório se recusa a exibir um
            número antes disso.
          </p>
        </div>
      ) : (
        <>
          <section className="admin__kpis">
            <div className="side-box">
              <h2 className="hub-stat__lbl">Correlação (Spearman)</h2>
              <p className="hub-stat__num">{report.spearman.toFixed(3)}</p>
              <p className="form-hint">Métrica principal — mede ordenação, não valor absoluto</p>
            </div>
            <div className="side-box">
              <h2 className="hub-stat__lbl">Correlação (Pearson)</h2>
              <p className="hub-stat__num">{report.pearson.toFixed(3)}</p>
              <p className="form-hint">Diagnóstico secundário</p>
            </div>
            <div className="side-box">
              <h2 className="hub-stat__lbl">Amostra</h2>
              <p className="hub-stat__num">{report.sampleSize}</p>
              <p className="form-hint">artigos analisados</p>
            </div>
          </section>

          <div className="side-box">
            <h2>Leitura</h2>
            <p>{report.interpretation}</p>
          </div>

          {/* Precisão por faixa: revela ONDE o modelo erra. Um Spearman geral
              bom pode esconder que a faixa QUENTE está sistematicamente
              superestimada — que é justamente a faixa que dispara push. */}
          <section>
            <h2 className="section-title">Desempenho por faixa</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Faixa</th>
                  <th scope="col">Artigos</th>
                  <th scope="col">Score médio previsto</th>
                  <th scope="col">Pageviews médios</th>
                  <th scope="col">Pageviews medianos</th>
                </tr>
              </thead>
              <tbody>
                {report.byBand.map((band) => (
                  <tr key={band.band}>
                    <th scope="row">{band.band}</th>
                    <td>{band.sampleSize}</td>
                    <td>{band.avgPredicted.toFixed(1)}</td>
                    <td>{Math.round(band.avgActual).toLocaleString('pt-BR')}</td>
                    {/* A MEDIANA é mais representativa que a média em
                        distribuição de cauda longa: um único viral distorce
                        completamente a média. */}
                    <td>{Math.round(band.medianActual).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* A lista mais acionável do relatório: cada linha é uma hipótese
              sobre um peso mal calibrado. */}
          <section>
            <h2 className="section-title">Maiores erros de previsão</h2>
            <div className="layout-2col">
              <div className="side-box">
                <h3>Superestimados</h3>
                <p className="form-hint">
                  Prevemos alto, a audiência não veio. Investigue se algum sinal está inflando.
                </p>
                <ul className="side-list">
                  {report.worstOverestimates.map((sample) => (
                    <li key={sample.articleId}>
                      Score {sample.predictedScore.toFixed(0)} →{' '}
                      {sample.actualPageviews24h.toLocaleString('pt-BR')} pageviews
                    </li>
                  ))}
                </ul>
              </div>
              <div className="side-box">
                <h3>Subestimados</h3>
                <p className="form-hint">
                  Prevemos baixo e a matéria bombou. Há sinal que não estamos capturando.
                </p>
                <ul className="side-list">
                  {report.worstUnderestimates.map((sample) => (
                    <li key={sample.articleId}>
                      Score {sample.predictedScore.toFixed(0)} →{' '}
                      {sample.actualPageviews24h.toLocaleString('pt-BR')} pageviews
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
