/**
 * =============================================================================
 * PAINEL EDITORIAL — fila de pautas por score
 * =============================================================================
 *
 * Requisito do briefing: "painel administrativo/editorial onde jornalistas
 * vejam o score calculado, possam sobrepor manualmente (override humano sempre
 * deve poder vencer o algoritmo) e publicar rapidamente notícias QUENTE".
 *
 * PRINCÍPIO DE PROJETO DESTA TELA: o jornalista precisa CONFIAR no número. Um
 * score que ele não entende é um score que ele ignora — e aí todo o pipeline
 * vira enfeite. Por isso a tela mostra, para cada tópico:
 *   - o score E a decomposição por sinal ("por que deu 84");
 *   - a confiança (um 84 com 30% de confiança não é um 84);
 *   - o cronômetro da meta de 30 minutos;
 *   - o motivo de a automação estar bloqueada, quando estiver.
 *
 * ACESSO: conta individual (e-mail + senha), com nível `admin` ou `redator`.
 * A checagem vive em `server/staff-auth.ts` e é obrigatória em TODA página e
 * rota de `/admin` — não existe middleware fazendo isso por baixo (o porquê está
 * documentado no cabeçalho daquele módulo).
 *
 * O QUE MUDA PARA O REDATOR NESTA TELA: ele vê a fila e assume pauta, mas não
 * sobrepõe score nem descarta tópico — as duas ações mexem no que o SITE INTEIRO
 * exibe, e por isso são de curadoria, não de redação. Ver `STAFF_CAPABILITIES`.
 */

import Link from 'next/link';

import { CATEGORIES, SCORE_BANDS, bandForScore, can, routes } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminNav } from '@/components/admin/admin-nav';
import { TopicRow } from '@/components/admin/topic-row';
import { getHotPublishRateSafe } from '@/server/admin-metrics';
import { requireStaffPage } from '@/server/staff-auth';

/** Painel nunca é cacheado: mostra o estado ao vivo da redação. */
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const guard = await requireStaffPage('verFilaDePautas');
  if (guard.state !== 'ok') return <AdminLogin />;

  const { user } = guard;
  const podeCurar = can(user.accessLevel, 'curarFilaDePautas');

  const [topics, publishRate, lastRun, authors] = await Promise.all([
    prisma.topic.findMany({
      where: { status: { in: ['new', 'assigned'] } },
      orderBy: { currentScore: 'desc' },
      take: 50,
      include: {
        category: { select: { slug: true, name: true } },
        franchises: { include: { franchise: { select: { slug: true, name: true } } } },
        scoreSnapshots: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
          select: { contributions: true, calculatedAt: true },
        },
      },
    }),
    getHotPublishRateSafe(),
    prisma.pipelineRun.findFirst({
      where: { status: 'completed' },
      orderBy: { finishedAt: 'desc' },
    }),
    // Um REDATOR não escolhe o autor da matéria: ele assina o que escreve (ver
    // `atribuirOutroAutor` em core/staff.ts). Buscar a redação inteira para
    // depois esconder a lista seria mandar ao navegador o nome de todo mundo
    // sem necessidade — a consulta já sai filtrada.
    can(guard.user.accessLevel, 'atribuirOutroAutor')
      ? prisma.author.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([{ id: guard.user.id, name: guard.user.name }]),
  ]);

  const categoryOptions = CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }));

  const hotTopics = topics.filter((t) => t.currentBand === 'HOT');

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Painel editorial</h1>
        <p className="section-sub">
          Fila de pautas ordenada por score. O override manual sempre vence o algoritmo.
        </p>
        <AdminNav user={user} current="fila" />
      </header>

      {/* ---------- KPIs DO PIPELINE ---------- */}
      {/* Métricas que NENHUMA ferramenta de analytics fornece: nascem dentro
          do nosso pipeline. Ver services/curator/src/actions/instrumentation.ts */}
      <section className="admin__kpis" aria-label="Indicadores do pipeline">
        <div className="side-box">
          <h2 className="hub-stat__lbl">QUENTES na fila</h2>
          <p className="hub-stat__num heat--hot">{hotTopics.length}</p>
        </div>
        <div className="side-box">
          <h2 className="hub-stat__lbl">Publicados na meta de 30min</h2>
          <p className="hub-stat__num">
            {publishRate.total > 0 ? `${Math.round(publishRate.rate * 100)}%` : '—'}
          </p>
          <p className="form-hint">
            {publishRate.total > 0
              ? `${publishRate.withinTarget}/${publishRate.total} · média ${publishRate.avgMinutes}min`
              : 'Sem dados suficientes ainda'}
          </p>
        </div>
        <div className="side-box">
          <h2 className="hub-stat__lbl">Último ciclo</h2>
          <p className="hub-stat__num">
            {lastRun?.finishedAt
              ? `há ${Math.round((Date.now() - lastRun.finishedAt.getTime()) / 60_000)}min`
              : '—'}
          </p>
          <p className="form-hint">
            {lastRun
              ? `${lastRun.topicsDiscovered} descobertos · ${lastRun.connectorsFailed} conector(es) com falha`
              : 'Pipeline ainda não rodou'}
          </p>
        </div>
        {/* O relatório é de administrador: para um redator, este cartão seria
            um link para uma tela que responde "sem acesso". */}
        {can(user.accessLevel, 'verRelatorios') && (
          <div className="side-box">
            <h2 className="hub-stat__lbl">Precisão do score</h2>
            <p className="hub-stat__num">
              <Link href={routes.adminAccuracy()}>Ver relatório</Link>
            </p>
            <p className="form-hint">Correlação entre score previsto e pageviews reais</p>
          </div>
        )}
      </section>

      {/* ---------- LEGENDA DAS FAIXAS ---------- */}
      <section className="admin__legend" aria-label="Faixas de ação">
        {SCORE_BANDS.map((band) => (
          <div key={band.band} className="admin__legend-item">
            <span className={`heat heat--${band.band.toLowerCase() === 'rising' ? 'rise' : band.band.toLowerCase() === 'relevant' ? 'base' : band.band.toLowerCase() === 'evergreen' ? 'ever' : 'hot'}`}>
              {band.min}-{band.max}
            </span>
            <div>
              <strong>{band.label}</strong>
              <p className="form-hint">
                {band.publishTargetMinutes
                  ? `Meta: publicar em ${band.publishTargetMinutes} min`
                  : 'Sem meta de velocidade'}
              </p>
            </div>
          </div>
        ))}
      </section>

      {/* ---------- FILA DE PAUTAS ---------- */}
      <section aria-labelledby="fila-titulo">
        <h2 id="fila-titulo" className="section-title">
          Fila de pautas ({topics.length})
        </h2>

        {topics.length === 0 ? (
          <p className="empty-state">
            Nenhum tópico na fila. O pipeline ainda não rodou ou nada foi descoberto.
            Rode <code>npm run curator:once</code>.
          </p>
        ) : (
          <ul className="admin__list">
            {topics.map((topic) => (
              <TopicRow
                key={topic.id}
                categories={categoryOptions}
                authors={authors}
                canCurate={podeCurar}
                topic={{
                  id: topic.id,
                  title: topic.title,
                  summary: topic.summary,
                  // Se há override manual, é ELE que aparece — o humano venceu.
                  score: topic.manualScoreOverride ?? topic.currentScore,
                  algorithmicScore: topic.currentScore,
                  hasOverride: topic.manualScoreOverride !== null,
                  overrideReason: topic.manualOverrideReason,
                  band: bandForScore(topic.manualScoreOverride ?? topic.currentScore).band,
                  confidence: topic.confidence,
                  seoOpportunity: topic.seoOpportunity,
                  termType: topic.termType,
                  scoreSummary: topic.scoreSummary,
                  emotionalTriggers: topic.emotionalTriggers,
                  requiresHumanReview: topic.requiresHumanReview,
                  sourceName: topic.sourceName,
                  sourceUrl: topic.sourceUrl,
                  sourceTier: topic.sourceTier,
                  categoryName: topic.category?.name ?? null,
                  categorySlug: topic.category?.slug ?? null,
                  franchises: topic.franchises.map((f) => f.franchise.name),
                  becameHotAt: topic.becameHotAt,
                  claimedAt: topic.claimedAt,
                  status: topic.status,
                  contributions: topic.scoreSnapshots[0]?.contributions ?? null,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
