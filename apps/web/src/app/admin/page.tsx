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

import { CATEGORIES, SCORE_BANDS, bandForScore, can, routes, toTopicOrigin } from '@subcarioca/core';
import { prisma, toStringArray, type Prisma } from '@subcarioca/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminNav } from '@/components/admin/admin-nav';
import { CuratorRunButton } from '@/components/admin/curator-run-button';
import { TopicCreateForm } from '@/components/admin/topic-create-form';
import { TopicRow } from '@/components/admin/topic-row';
import { isAiDraftConfigured } from '@/server/ai-draft';
import { isPreArticleConfigured } from '@/server/ai/prearticle';
import { getHotPublishRateSafe } from '@/server/admin-metrics';
import { requireStaffPage } from '@/server/staff-auth';
import {
  effectiveTopicScore,
  rankTopicQueue,
  TOPIC_QUEUE_WINDOW,
} from '@/server/topic-queue';

/** Painel nunca é cacheado: mostra o estado ao vivo da redação. */
export const dynamic = 'force-dynamic';

/**
 * O que cada linha da fila precisa carregar junto.
 *
 * Extraído para uma constante porque a fila é buscada em DUAS consultas (o
 * porquê está logo abaixo) e as duas precisam trazer exatamente os mesmos
 * relacionamentos. Duplicar este bloco seria criar a possibilidade de as duas
 * metades da mesma lista virem com formatos diferentes — um erro que o
 * TypeScript pegaria só se tivesse sorte, e que na tela apareceria como
 * "algumas pautas estão sem categoria".
 *
 * `satisfies` e não `as const`: `satisfies` valida o objeto contra o tipo do
 * Prisma (um `slug` escrito errado falha AQUI, não em produção) e ainda preserva
 * os literais — que é o que permite ao Prisma inferir o tipo do retorno com as
 * relações incluídas. Com `as const`, o objeto vira somente-leitura e a
 * inferência do cliente gerado se perde: o retorno degrada para um `Topic` sem
 * `category`, `franchises` nem `scoreSnapshots`.
 */
const TOPIC_QUEUE_INCLUDE = {
  category: { select: { slug: true, name: true } },
  franchises: { include: { franchise: { select: { id: true, slug: true, name: true } } } },
  scoreSnapshots: {
    orderBy: { calculatedAt: 'desc' },
    take: 1,
    select: { contributions: true, calculatedAt: true },
  },
} satisfies Prisma.TopicInclude;

/** Status que definem "pauta ainda em aberto" — o que a fila mostra. */
const FILA_ABERTA = {
  status: { in: ['new', 'assigned'] },
} satisfies Prisma.TopicWhereInput;

export default async function AdminPage() {
  const guard = await requireStaffPage('verFilaDePautas');
  if (guard.state !== 'ok') return <AdminLogin />;

  const { user } = guard;
  const podeCurar = can(user.accessLevel, 'curarFilaDePautas');

  const [comOverride, semOverride, publishRate, lastRun, authors, franchises] = await Promise.all([
    /**
     * FILA, PARTE 1 — as pautas com override manual. TODAS elas.
     *
     * Consulta separada, e a razão é a mesma que motivou a correção inteira: a
     * fila é ordenada pelo score EFETIVO (`manualScoreOverride ?? currentScore`,
     * ver `server/topic-queue.ts`), mas o banco só sabe ordenar por coluna. Se a
     * janela buscada fosse uma só, ordenada por `currentScore`, uma pauta com
     * score algorítmico rasteiro e override máximo poderia ficar FORA da janela —
     * o mesmo bug de antes, só que num limite maior e portanto mais raro e mais
     * difícil de diagnosticar.
     *
     * Trazendo os overrides à parte, é estruturalmente impossível perder um: a
     * decisão humana nunca depende de ter passado num corte do algoritmo.
     *
     * O teto continua existindo (`TOPIC_QUEUE_WINDOW`) porque toda consulta sem
     * teto é um incidente esperando o cadastro crescer — mas 200 overrides
     * simultâneos na fila aberta seria um cenário sem relação com o uso real
     * (override é ato editorial pontual, não rotina).
     */
    prisma.topic.findMany({
      where: { ...FILA_ABERTA, manualScoreOverride: { not: null } },
      orderBy: { manualScoreOverride: 'desc' },
      take: TOPIC_QUEUE_WINDOW,
      include: TOPIC_QUEUE_INCLUDE,
    }),
    /**
     * FILA, PARTE 2 — as demais, pelo score do algoritmo.
     *
     * `manualScoreOverride: null` torna os dois conjuntos DISJUNTOS por
     * construção: nenhum tópico aparece nas duas consultas, então basta
     * concatenar — sem deduplicação, sem chave, sem o bug clássico do "a mesma
     * pauta apareceu duas vezes na lista".
     *
     * Esta é a consulta que usa o índice `[status, currentScore DESC]` do
     * schema, e é ela que carrega o volume.
     */
    prisma.topic.findMany({
      where: { ...FILA_ABERTA, manualScoreOverride: null },
      orderBy: { currentScore: 'desc' },
      take: TOPIC_QUEUE_WINDOW,
      include: TOPIC_QUEUE_INCLUDE,
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
    // Franquias para os dois formulários desta tela (criar pauta e criar
    // matéria). `take` explícito pelo mesmo motivo do `take` das matérias: uma
    // lista sem teto degrada em silêncio conforme o cadastro cresce. Quando
    // passar de 200 franquias, o `<select multiple>` deixa de ser a interface
    // certa — e o teto é o que faz esse dia aparecer como "a lista está
    // cortada", em vez de "o painel ficou lento".
    prisma.franchise.findMany({
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  /**
   * A FILA DE VERDADE: as duas metades juntas, ordenadas pelo score EFETIVO e
   * só então cortadas em 50.
   *
   * Esta única linha é a correção de um bug que contradizia o princípio impresso
   * no topo desta tela ("o override manual sempre vence o algoritmo"): antes, a
   * ordenação e o corte vinham do banco, por `currentScore`, enquanto a etiqueta
   * de cada linha exibia o score com override aplicado. O racional completo
   * (inclusive por que ordenar em memória é aceitável aqui) está em
   * `server/topic-queue.ts`.
   */
  const topics = rankTopicQueue([...comOverride, ...semOverride]);

  const categoryOptions = CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }));
  const podeAfrouxarConteudo = can(user.accessLevel, 'reduzirRestricaoDeConteudo');

  /**
   * A SUGESTÃO POR IA ESTÁ LIGADA NESTE SERVIDOR?
   *
   * A pergunta é respondida UMA vez, aqui, e desce como prop — em vez de cada
   * linha da fila consultar o ambiente. Não é economia: componente de cliente
   * não lê `process.env` do servidor, e fazer a leitura na página é o que mantém
   * a chave inteiramente do lado de cá (o que atravessa a fronteira é um
   * booleano, nunca o valor).
   */
  const aiEnabled = isAiDraftConfigured();
  // Mesma pergunta, para a pré-matéria via DeepSeek. Uma variável separada de
  // propósito: cada funcionalidade tem sua própria chave e pode estar ligada
  // ou desligada sozinha — exibir as duas sob o mesmo booleano mentiria sobre
  // qual delas está disponível.
  const preArticleEnabled = isPreArticleConfigured();

  /**
   * KPI "QUENTES na fila".
   *
   * Usa o score EFETIVO, e não a coluna `currentBand` (que é a faixa gravada
   * pelo algoritmo). Motivo: cada linha da lista abaixo já exibe sua faixa
   * calculada com o override aplicado — contar aqui pela coluna do algoritmo
   * produzia um cartão que dizia "2 QUENTES" acima de uma lista com 3 etiquetas
   * vermelhas. Uma tela que se contradiz sozinha é uma tela que ninguém usa para
   * decidir.
   */
  const hotTopics = topics.filter(
    (t) => bandForScore(effectiveTopicScore(t)).band === 'HOT',
  );

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

          {/*
            DISPARO MANUAL — fica AQUI, colado no número que motiva o clique.
            Quem lê "há 240min" quer agir na mesma olhada; o botão em outro canto
            da tela obrigaria a cruzar duas informações distantes.

            Só para quem CURA a fila: um ciclo reordena a fila que alimenta a home
            e o /em-alta, e ainda consome chamadas pagas de API. É a mesma
            capacidade de sobrepor score e descartar tópico (ver core/staff.ts).
            Esconder o botão é cortesia — quem recusa de verdade é a rota.

            ⚠ Este botão deixou de ser plano B: o cron desta hospedagem não
            dispara (confirmado no hPanel E por crontab via SSH). Hoje o pipeline
            depende de um agendador EXTERNO chamando a mesma rota, mais este
            clique. Ver o cabeçalho de `api/internal/curator-run/route.ts`.
          */}
          {podeCurar && <CuratorRunButton />}
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

        {/* Criar pauta é trabalho de redação: redator TAMBÉM pode (ver
            `criarPauta` em core/staff.ts). A checagem existe porque a tabela de
            capacidades é a fonte da verdade — não porque exista hoje um nível
            que não possa. */}
        {can(user.accessLevel, 'criarPauta') && (
          <TopicCreateForm categories={categoryOptions} franchises={franchises} />
        )}

        {/* GERAÇÃO DESLIGADA: o aviso aparece UMA vez, e só para quem pode
            resolver. Um botão desabilitado repetido em cinquenta linhas seria
            ruído para o redator — que não tem acesso ao ambiente do servidor e
            só ficaria olhando para uma ferramenta que não pode usar.
            `gerenciarContas` é a capacidade de quem administra a instalação. */}
        {!aiEnabled && can(user.accessLevel, 'gerenciarContas') && (
          <p className="form-hint">
            Sugestão de matéria por IA desligada: falta a variável{' '}
            <code>ANTHROPIC_API_KEY</code> no ambiente do servidor. A fila funciona
            normalmente sem ela — só o botão “Gerar sugestão com IA” não aparece.
          </p>
        )}

        {/* Pré-matéria desligada: aviso próprio, porque a chave é outra
            (DeepSeek). Um administrador pode ter configurado uma e não a outra —
            fundir os dois avisos num só diria que as duas estão no mesmo estado,
            que é justamente o que o par de chaves separadas desmente. */}
        {!preArticleEnabled && can(user.accessLevel, 'gerenciarContas') && (
          <p className="form-hint">
            Pré-matéria por IA desligada: falta a variável{' '}
            <code>DEEPSEEK_API_KEY</code> no ambiente do servidor. A fila funciona
            normalmente sem ela — só o botão “Gerar pré-matéria” não aparece.
          </p>
        )}

        {topics.length === 0 ? (
          /* A instrução daqui era "rode `npm run curator:once`", que só serve a
             quem tem um terminal no monorepo. Em produção — hospedagem
             compartilhada, sem shell útil — ela mandava a redação para um beco
             sem saída. Agora quem cura tem o botão logo acima, e é para ele que
             o texto aponta. Quem não cura recebe a instrução que de fato pode
             seguir: falar com um administrador. */
          <p className="empty-state">
            Nenhum tópico na fila. O pipeline ainda não rodou ou nada foi descoberto.{' '}
            {podeCurar
              ? 'Use “Buscar pautas agora”, no cartão “Último ciclo” acima.'
              : 'Peça a um administrador para disparar uma busca de pautas.'}
          </p>
        ) : (
          <ul className="admin__list">
            {topics.map((topic) => (
              <TopicRow
                key={topic.id}
                categories={categoryOptions}
                authors={authors}
                franchises={franchises}
                canCurate={podeCurar}
                canLowerSensitivity={podeAfrouxarConteudo}
                aiEnabled={aiEnabled}
                preArticleEnabled={preArticleEnabled}
                topic={{
                  origin: toTopicOrigin(topic.origin),
                  id: topic.id,
                  title: topic.title,
                  summary: topic.summary,
                  // Se há override manual, é ELE que aparece — o humano venceu.
                  // A MESMA função que ordena a fila (`effectiveTopicScore`):
                  // foi a divergência entre o número exibido aqui e o critério
                  // de ordenação que gerou o bug. Uma fonte só, e a divergência
                  // deixa de ser possível.
                  score: effectiveTopicScore(topic),
                  algorithmicScore: topic.currentScore,
                  hasOverride: topic.manualScoreOverride !== null,
                  overrideReason: topic.manualOverrideReason,
                  band: bandForScore(effectiveTopicScore(topic)).band,
                  confidence: topic.confidence,
                  seoOpportunity: topic.seoOpportunity,
                  termType: topic.termType,
                  scoreSummary: topic.scoreSummary,
                  // Coluna `Json` desde a migração para o MySQL: normalizada no
                  // servidor para que `topic-row.tsx` continue podendo fazer
                  // `.length` e `.map` sem checagem defensiva.
                  emotionalTriggers: toStringArray(topic.emotionalTriggers),
                  requiresHumanReview: topic.requiresHumanReview,
                  sourceName: topic.sourceName,
                  sourceUrl: topic.sourceUrl,
                  sourceTier: topic.sourceTier,
                  categoryName: topic.category?.name ?? null,
                  categorySlug: topic.category?.slug ?? null,
                  franchises: topic.franchises.map((f) => f.franchise.name),
                  // Os IDS vão junto dos nomes: os nomes são para a tela, os
                  // ids são para pré-selecionar as franquias no formulário de
                  // matéria (ver `defaultFranchiseIds` em article-create-form).
                  franchiseIds: topic.franchises.map((f) => f.franchise.id),
                  // QUANDO A PAUTA FOI ENCONTRADA. `createdAt`, e não
                  // `firstSeenAt`: aquele é a data de publicação DECLARADA
                  // PELO FEED de terceiro (dado externo, frequentemente errado
                  // ou no futuro); este é quando a linha entrou na NOSSA fila,
                  // que é literalmente "quando o curator achou". Mesma escolha
                  // e mesmo motivo de `expire-topics.ts`, que conta a validade
                  // de 7 dias por `createdAt`.
                  createdAt: topic.createdAt,
                  becameHotAt: topic.becameHotAt,
                  // Os dois marcos de tempo viajam JUNTOS e significam coisas
                  // diferentes: `becameHotAt` é o T-zero da meta de 30 min (só
                  // existe se o score cruzou 80), `becameTrendingAt` é "desde
                  // quando o assunto está em alta" (vale a partir de 'EM ALTA').
                  // Ver o comentário do campo em `schema.prisma`.
                  becameTrendingAt: topic.becameTrendingAt,
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
