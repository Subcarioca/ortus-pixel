/**
 * =============================================================================
 * CICLO DE CURADORIA — onde tudo se junta
 * =============================================================================
 *
 * Fluxo completo:
 *
 *   [0] EXPIRAÇÃO         pauta parada há mais de 7 dias sai da fila (mas volta a
 *                         entrar sozinha se o mesmo assunto reaparecer nos feeds —
 *                         ver o "REVIVAL" em `upsertTopicFromItem`)
 *   [1] DESCOBERTA        feeds RSS -> itens candidatos
 *   [1.5] REESCRITA pt-BR itens de fonte estrangeira -> português do Brasil
 *   [2] DEDUPLICAÇÃO      5 veículos noticiando o mesmo fato -> 1 tópico
 *                         (+ os tetos de volume: 20 por ciclo, 5 por editoria)
 *   [3] TRIAGEM (barata)  conectores 'discovery' -> score preliminar
 *   [4] CORTE             só quem passa do limiar segue para o estágio caro
 *   [5] ENRIQUECIMENTO    conectores 'enrichment' -> score final
 *   [6] AÇÕES             alerta / push / hero, conforme a faixa
 *   [6.5] TETO DA FILA    o que ficou fora das 30 vagas sai por RELEVÂNCIA (a
 *                         etapa [0] corta por idade; esta corta por score, e só
 *                         pode rodar aqui porque precisa dos scores já
 *                         atualizados deste ciclo — ver `topic-pool.ts`)
 *   [7] INSTRUMENTAÇÃO    eventos internos para os KPIs editoriais
 *
 * A ETAPA [4] É O QUE TORNA O PRODUTO VIÁVEL FINANCEIRAMENTE.
 *
 * Sem ela, todo item descoberto acionaria as APIs pagas. Com ~800 itens/dia
 * vindos dos feeds e X cobrando por leitura, a conta passaria de US$ 70 mil/mês.
 * Com o corte, apenas ~5% dos candidatos chegam ao estágio caro, e a conta cai
 * para a casa das centenas de dólares.
 *
 * Repare que a decisão não está no código de nenhum conector: está na TOPOLOGIA
 * do pipeline. Foi por isso que `stage` virou parte do contrato de conector lá
 * em `core/signals.ts`.
 */

import {
  bandForScore,
  slugify,
  type EmotionalTrigger,
  type ScoreResult,
  type SignalContext,
} from '@subcarioca/core';
import { prisma, toStringArray } from '@subcarioca/db';
import { calculateScore, DEFAULT_WEIGHTS, isEligibleForAutomation } from '@subcarioca/scoring';

import { getAvailableConnectors } from '../connectors/registry';
import { detectTriggers } from '../connectors/emotional-triggers';
import { classifyDomain } from '../connectors/source-authority';
import { discoverFromFeeds, type DiscoveredItem } from '../discovery/rss-sources';
import { canonicalHash, findDuplicate } from './dedupe';
import { expireStaleTopics, TOPIC_EXPIRY_DAYS } from './expire-topics';
import {
  createTopicQuota,
  MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE,
  MAX_NEW_TOPICS_PER_CYCLE,
} from './topic-quota';
import { MAX_ACTIVE_TOPICS, trimTopicPool } from './topic-pool';
import { isRewriteConfigured, rewriteItemsToPtBr } from './rewrite-ptbr';
import { collectSignals } from './orchestrator';
import { onScoreCalculated } from '../actions/dispatcher';
import { logPipelineEvent } from '../actions/instrumentation';

/**
 * Limiar de triagem: score preliminar mínimo para gastar API paga.
 *
 * 35 é intencionalmente PERMISSIVO (abaixo da faixa RELEVANTE, que começa em
 * 40). O motivo é assimetria de custo: deixar passar um tópico morno custa
 * centavos; barrar um breaking news por engano custa a matéria — e o produto
 * inteiro existe para não perder breaking news. Na dúvida, enriquecemos.
 */
const ENRICHMENT_THRESHOLD = 35;

/** Teto de tópicos enriquecidos por ciclo. Trava dura contra estouro de custo. */
const MAX_ENRICHMENT_PER_CYCLE = 40;

/**
 * AS FAIXAS QUE SIGNIFICAM "ESTE ASSUNTO ESTÁ EM ALTA".
 *
 * São as duas do topo do catálogo (`core/scoring-types.ts`): 'HOT' (80-100,
 * "QUENTE / BREAKING") e 'RISING' (60-79, cujo rótulo é literalmente "EM ALTA").
 * Ficam de fora 'RELEVANT' (40-59) e 'EVERGREEN' (0-39) — a primeira é descrita
 * no próprio catálogo como "fluxo editorial normal, sem meta de velocidade", e a
 * segunda está fora da curadoria de velocidade por definição.
 *
 * Escrito como conjunto, e não como `banda !== 'EVERGREEN'`, porque a negação
 * silenciosamente passaria a incluir qualquer faixa NOVA que alguém acrescente
 * ao catálogo no futuro — e o efeito (toda a fila marcada como "em alta") não
 * apareceria em teste nenhum. `Set<string>` e não `Set<ScoreBand>` para poder
 * comparar direto com `Topic.currentBand`, que o Prisma devolve como `string`
 * (a faixa não é enum no schema, ver o comentário de `Author.systemRole`).
 */
const TRENDING_BANDS: ReadonlySet<string> = new Set(['HOT', 'RISING']);

/**
 * OS OUTROS DOIS TETOS DO CICLO — e por que não moram aqui.
 *
 * `MAX_NEW_TOPICS_PER_CYCLE` (20 pautas novas por ciclo) e
 * `MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE` (5 por editoria) são importados de
 * `topic-quota.ts`, junto com a lógica de contagem que eles governam. A razão de
 * não estarem declarados aqui, ao lado do teto acima, é que o LAÇO da etapa [2]
 * é E/S pura e não tem teste — a decisão "este item ainda cabe no ciclo?" foi
 * extraída para um módulo sem banco justamente para poder ser testada, e número
 * separado da regra que ele governa é número que muda sem o teste perceber.
 *
 * E, principalmente, ELES NÃO SÃO A MESMA COISA QUE O TETO ACIMA, apesar de
 * parecerem: `MAX_ENRICHMENT_PER_CYCLE` é uma trava de CUSTO, que age DEPOIS da
 * criação (o tópico já existe, já está na fila; o que se economiza é a segunda
 * rodada de API paga). Os tetos da cota são de VOLUME EDITORIAL: quantas pautas
 * a redação consegue absorver por rodada. Mudam por motivos diferentes — um
 * quando o preço da API muda, o outro quando o tamanho da redação muda. O
 * racional completo (inclusive a decisão editorial de que "tema" = editoria)
 * está no cabeçalho de `topic-quota.ts`.
 */

export interface CurationCycleOptions {
  phase: 1 | 2 | 3;
  /** `true` = só descobre e pontua, sem gravar. Útil para depuração. */
  dryRun?: boolean;
  maxAgeHours?: number;
}

export interface CurationCycleResult {
  runId: string;
  discovered: number;
  /** Pautas retiradas da fila por idade na etapa [0]. Ver `expire-topics.ts`. */
  expiredTopics: number;
  /**
   * Pautas retiradas da fila por RELEVÂNCIA na etapa [6.5] — as que ficaram
   * fora das 30 vagas. Contador separado de `expiredTopics` de propósito: as
   * duas rotinas deixam a MESMA marca no banco ('dismissed') e só este número
   * (mais o evento 'topic.evicted') distingue "envelheceu" de "perdeu no
   * ranking". Ver `topic-pool.ts`.
   */
  trimmedTopics: number;
  /**
   * Pautas expiradas que REAPARECERAM nos feeds e voltaram para a fila
   * (`status: 'dismissed'` -> `'new'`) neste ciclo. Ver o "REVIVAL" em
   * `upsertTopicFromItem`.
   */
  revived: number;
  /** Itens de fonte estrangeira efetivamente reescritos para pt-BR na etapa [1.5]. */
  rewrittenToPtBr: number;
  deduplicated: number;
  screened: number;
  enriched: number;
  promotedToHot: number;
  failedConnectors: string[];
  durationMs: number;
}

/**
 * Executa um ciclo completo de curadoria.
 * Projetado para ser idempotente: rodar duas vezes seguidas não duplica tópicos
 * nem redispara alertas já enviados.
 */
export async function runCurationCycle(
  options: CurationCycleOptions,
): Promise<CurationCycleResult> {
  const startedAt = Date.now();
  const { phase, dryRun = false, maxAgeHours = 6 } = options;

  const run = await prisma.pipelineRun.create({
    data: { stage: 'full', status: 'running' },
  });

  const result: CurationCycleResult = {
    runId: run.id,
    discovered: 0,
    expiredTopics: 0,
    trimmedTopics: 0,
    revived: 0,
    rewrittenToPtBr: 0,
    deduplicated: 0,
    screened: 0,
    enriched: 0,
    promotedToHot: 0,
    failedConnectors: [],
    durationMs: 0,
  };

  try {
    // -------------------------------------------------------------------------
    // [0] EXPIRAÇÃO DAS PAUTAS ANTIGAS
    // -------------------------------------------------------------------------
    // POR QUE ANTES DA DESCOBERTA, e não depois de tudo:
    //
    //   1. A FAXINA NÃO PODE DEPENDER DO SUCESSO DO RESTO. Se um feed pendurar
    //      a descoberta ou uma API paga derrubar o ciclo com exceção, uma etapa
    //      no fim da função simplesmente não roda — e a fila acumularia
    //      justamente nos dias em que o pipeline está com problema, que é quando
    //      a redação mais precisa que ela esteja legível.
    //   2. A FILA FICA CERTA ANTES DE CRESCER. As pautas novas deste ciclo já
    //      chegam a uma fila sem as vencidas, e a disputa pelas 50 vagas do
    //      painel (ordenadas por score) acontece só entre o que ainda é notícia.
    //
    // O custo é uma consulta indexada por ciclo — desprezível perto do resto.
    // A rotina não lança em nenhuma hipótese; ver o cabeçalho de expire-topics.
    //
    // UMA PAUTA EXPIRADA NÃO ESTÁ MORTA PARA SEMPRE: se o mesmo assunto
    // reaparecer nos feeds depois de expirado (hype que esfriou e voltou —
    // ex.: um jogo adiado que vira notícia de novo no lançamento), o
    // `dedupeHash` único faz o item bater no tópico já existente, e o
    // "REVIVAL" em `upsertTopicFromItem`, mais abaixo, o traz de volta a
    // 'new' — ele não fica preso em 'dismissed' só porque envelheceu uma vez.
    const expiry = await expireStaleTopics({ dryRun });
    result.expiredTopics = expiry.expired;

    if (expiry.expired > 0) {
      console.log(
        `[curate] ${expiry.expired} pauta(s) descartada(s) por passarem de ${TOPIC_EXPIRY_DAYS} dias na fila` +
          // O aviso de "sobrou" é o que explica um número redondo repetido
          // ciclo após ciclo (o teto de lote) sem parecer um bug.
          (expiry.hasMore ? ' — ainda há mais vencidas, o próximo ciclo continua' : '') +
          (dryRun ? ' [dryRun: nada foi gravado]' : '') +
          '.',
      );
    }

    // -------------------------------------------------------------------------
    // [1] DESCOBERTA
    // -------------------------------------------------------------------------
    const { items: rawItems, failedSources } = await discoverFromFeeds({ phase, maxAgeHours });
    result.discovered = rawItems.length;
    console.log(`[curate] ${rawItems.length} itens descobertos em feeds (fase ${phase}).`);

    // -------------------------------------------------------------------------
    // [1.5] REESCRITA PARA PORTUGUÊS DO BRASIL
    // -------------------------------------------------------------------------
    // POR QUE AQUI, e não depois da deduplicação (onde seriam menos itens e a
    // conta seria menor)? Porque a deduplicação compara TOKENS DO TÍTULO: com os
    // itens em línguas diferentes, "Rockstar delays GTA VI" e "Rockstar adia GTA
    // VI" têm interseção quase nula e viram DOIS tópicos do mesmo fato — que é
    // exatamente o problema que a etapa [2] existe para evitar. Traduzir antes
    // faz as duas versões colapsarem em uma, e o custo extra da ordem é pequeno
    // porque só itens de fonte estrangeira gastam chamada.
    //
    // O outro motivo é de produto: é AQUI que nasce o `Topic.title` que a
    // redação lê na fila. Reescrever depois de gravar exigiria uma segunda
    // passada de escrita no banco e deixaria uma janela em que o painel mostra
    // a pauta em inglês.
    const rewrite = await rewriteItemsToPtBr(rawItems);
    const items = rewrite.items;
    result.rewrittenToPtBr = rewrite.rewritten;

    if (isRewriteConfigured()) {
      console.log(
        `[curate] reescrita pt-BR: ${rewrite.rewritten} reescrito(s), ` +
          `${rewrite.skippedPt} já em português, ${rewrite.failed} falha(s)` +
          (rewrite.overBudget > 0 ? `, ${rewrite.overBudget} fora do teto do ciclo` : '') +
          '.',
      );
    } else if (rewrite.skippedPt < rawItems.length) {
      // Aviso ÚNICO por ciclo, e só quando existe item que precisaria dela: sem
      // isso, "as pautas voltaram a chegar em inglês" viraria um mistério sem
      // rastro nenhum no log.
      console.warn(
        `[curate] reescrita pt-BR DESLIGADA (falta GEMINI_API_KEY): ` +
          `${rawItems.length - rewrite.skippedPt} item(ns) de fonte estrangeira seguem no idioma original.`,
      );
    }

    // -------------------------------------------------------------------------
    // [2] DEDUPLICAÇÃO E PERSISTÊNCIA DOS CANDIDATOS
    // -------------------------------------------------------------------------
    // Carregamos a janela de comparação UMA vez, fora do laço. Consultar o banco
    // por item seria N+1 clássico: com 800 itens, 800 queries.
    const recentTopics = await prisma.topic.findMany({
      where: { firstSeenAt: { gte: new Date(Date.now() - 48 * 3_600_000) } },
      select: { id: true, title: true, category: { select: { slug: true } } },
      take: 500,
    });

    /**
     * SEGUNDA JANELA: os tópicos que JÁ VIRARAM TRABALHO, sem limite de tempo.
     *
     * O BURACO QUE ISTO TAPA: a janela de 48h acima é a janela do "assunto ainda
     * está circulando". Mas uma pauta com matéria em rascunho há dez dias
     * (reportagem grande, apuração longa) já saiu dela — e quando o mesmo fato
     * reaparece num feed com a manchete reformulada, o `dedupeHash` exato não
     * bate (as palavras mudaram) e a similaridade não é nem calculada (o tópico
     * não está na janela). Resultado: nasce um tópico duplicado do zero, a
     * redação recebe na fila uma pauta que ela já está escrevendo, e o pipeline
     * gasta orçamento de API paga para pontuar um assunto já coberto. É
     * exatamente o desperdício que o requisito manda evitar — e a checagem por
     * hash exato, sozinha, não o pega.
     *
     * POR QUE "SEM LIMITE DE TEMPO" AQUI É SEGURO, e não seria na fila geral:
     * este conjunto é limitado pelo número de MATÉRIAS REAIS que a redação
     * escreveu — dezenas por semana, não centenas por dia. A fila geral, não:
     * ampliar os 48h dela para "sempre" faria a comparação O(n) rodar contra
     * milhares de títulos por item descoberto e, pior, aumentaria a chance de
     * FUNDIR indevidamente assuntos recorrentes ("One Piece capítulo 1120" com
     * "One Piece capítulo 1121"), que é o erro silencioso que o limiar de 0,6 foi
     * calibrado para evitar (ver `dedupe.ts`). Por isso o prazo dos outros
     * tópicos fica intocado: só o conjunto pequeno e caro de errar ganha memória
     * longa.
     *
     * O `take: 500` com `orderBy` decrescente existe porque "sem limite de tempo"
     * cresce para sempre: em dois anos de operação são milhares de matérias, e a
     * janela viraria um custo crescente por ciclo, sem teto. Com o corte, a
     * memória longa é das 500 coberturas MAIS RECENTES — que é onde mora
     * praticamente toda a chance de reincidência.
     */
    const coveredTopics = await prisma.topic.findMany({
      where: { articles: { some: { status: { in: ['draft', 'published'] } } } },
      select: { id: true, title: true, category: { select: { slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    /**
     * União das duas janelas, SEM repetir id.
     *
     * A interseção é grande e previsível (matéria escrita hoje está nas duas
     * listas). Duplicar a entrada não daria resultado errado — a similaridade
     * seria a mesma, o `best` continuaria apontando para o mesmo tópico —, mas
     * dobraria comparações à toa em cima do laço mais quente do ciclo. O `Map`
     * por id é a forma mais direta de deduplicar preservando a ordem em que os
     * itens foram inseridos.
     */
    const dedupeWindow = [
      ...new Map(
        [...recentTopics, ...coveredTopics].map((t) => [
          t.id,
          { id: t.id, title: t.title, categorySlug: t.category?.slug ?? null },
        ]),
      ).values(),
    ];

    const topicIds: string[] = [];

    /**
     * OS TETOS DE VOLUME DO REQUISITO (20 por ciclo, 5 por editoria).
     *
     * A cota é criada AQUI, dentro do ciclo, e morre com ele — ver por que na
     * fábrica em `topic-quota.ts`. Ela não sabe nada de banco: quem decide o que
     * é "criação de verdade" é este laço, informando-a com `registerCreated()`.
     *
     * NOTA SOBRE `dryRun`: como nada é gravado, nada é "criado", e portanto os
     * tetos nunca chegam a apertar numa execução de teste. É consequência direta
     * (e antiga) de `upsertTopicFromItem` devolver vazio em `dryRun`, não um
     * descuido: medir quantas pautas os tetos cortariam exigiria simular a
     * criação, e simulação de escrita é justamente o que `dryRun` não faz aqui.
     */
    const quota = createTopicQuota();
    let ignoradosPorTetoDeCategoria = 0;
    let ignoradosPorTetoDoCiclo = 0;

    for (const [index, item] of items.entries()) {
      const decision = quota.evaluate(item.source.categorySlug);

      if (!decision.allowed && decision.reason === 'cycle_limit') {
        // TETO GLOBAL: não há mais vaga para NENHUMA editoria neste ciclo, então
        // continuar varreria centenas de itens só para recusar todos. Sair do
        // laço aqui é o que o requisito descreve como "o ciclo para de criar
        // tópicos novos" — e repare que só a CRIAÇÃO para: as etapas [3] a [6]
        // seguem normalmente sobre os tópicos que já entraram.
        ignoradosPorTetoDoCiclo = items.length - index;
        break;
      }

      if (!decision.allowed) {
        // TETO POR EDITORIA: este item não vira pauta, mas o laço CONTINUA. É
        // literalmente o "o buscador passará para o próximo, mesmo que tenham
        // outros assuntos em alta" do requisito — a editoria cheia não pode
        // bloquear as outras, que ainda têm vaga.
        ignoradosPorTetoDeCategoria++;
        continue;
      }

      const outcome = await upsertTopicFromItem(item, dedupeWindow, dryRun);
      if (!outcome) continue;

      topicIds.push(outcome.topicId);

      // SÓ CRIAÇÃO DE VERDADE CONSOME VAGA. Um item que apenas reencontrou um
      // tópico já existente (mesmo hash, ainda sem matéria) devolve
      // `created: false` e não gasta cota: ele não aumentou a fila da redação em
      // nada, e cobrá-lo faria 20 reposts do dia anterior consumirem o ciclo
      // inteiro sem uma pauta nova sequer aparecer.
      if (outcome.created) {
        quota.registerCreated(item.source.categorySlug);
      }
      if (outcome.revived) {
        result.revived++;
      }

      // Alimenta a janela para que duplicatas DENTRO do mesmo ciclo também
      // sejam detectadas (5 veículos no mesmo lote é o caso mais comum).
      dedupeWindow.push({
        id: outcome.topicId,
        title: item.title,
        categorySlug: item.source.categorySlug,
      });
    }

    const ignoradosPorTeto = ignoradosPorTetoDeCategoria + ignoradosPorTetoDoCiclo;

    // `deduplicated` continua significando O MESMO DE ANTES: itens que não
    // viraram tópico por serem repetição (hash igual, similaridade alta ou
    // assunto já coberto por rascunho/matéria). Os barrados pelos tetos são
    // descontados de propósito — eles não eram duplicata de nada, só chegaram
    // depois de a vaga acabar, e somá-los aqui inflaria a métrica de duplicação
    // do pipeline com um número que não tem nada a ver com deduplicação.
    result.deduplicated = items.length - topicIds.length - ignoradosPorTeto;
    console.log(
      `[curate] ${topicIds.length} tópicos únicos (${result.deduplicated} duplicatas` +
        (ignoradosPorTeto > 0 ? `, ${ignoradosPorTeto} fora dos tetos do ciclo` : '') +
        (result.revived > 0 ? `, ${result.revived} revivida(s)` : '') +
        `) — ${quota.created}/${MAX_NEW_TOPICS_PER_CYCLE} pauta(s) nova(s) criada(s).`,
    );

    if (ignoradosPorTeto > 0 && !dryRun) {
      /**
       * UM evento agregado por ciclo, e não um por item barrado.
       *
       * A tentação é registrar cada item recusado, como se faz com a duplicata.
       * Seria um erro de escala: num dia agitado, 800 itens descobertos contra 20
       * vagas geram centenas de recusas POR CICLO, ou seja, dezenas de milhares
       * de linhas por dia numa tabela de auditoria — o log afogaria justamente os
       * eventos que se quer encontrar nela. O que importa saber depois não é qual
       * item específico ficou de fora (ele volta no próximo ciclo, se ainda for
       * notícia), e sim SE E QUANTO os tetos estão apertando: é isso que diz se
       * 20 e 5 são os números certos.
       */
      await logPipelineEvent({
        eventType: 'topic.cap_reached',
        payload: {
          created: quota.created,
          createdByCategory: quota.createdByCategory(),
          skippedByCategoryCap: ignoradosPorTetoDeCategoria,
          skippedByCycleCap: ignoradosPorTetoDoCiclo,
          maxPerCycle: MAX_NEW_TOPICS_PER_CYCLE,
          maxPerCategory: MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE,
          discovered: items.length,
        },
      });
    }

    // -------------------------------------------------------------------------
    // [3] TRIAGEM BARATA
    // -------------------------------------------------------------------------
    const discoveryConnectors = await getAvailableConnectors('discovery');
    const enrichmentConnectors = await getAvailableConnectors('enrichment');

    console.log(
      `[curate] conectores ativos: ${discoveryConnectors.length} de triagem, ${enrichmentConnectors.length} de enriquecimento.`,
    );

    const screened: { topicId: string; preliminaryScore: number }[] = [];
    const allFailedConnectors = new Set<string>(failedSources);

    for (const topicId of topicIds) {
      const scoring = await scoreTopic(topicId, discoveryConnectors, dryRun);
      if (!scoring) continue;

      screened.push({ topicId, preliminaryScore: scoring.score });
      scoring.failedConnectors.forEach((c) => allFailedConnectors.add(c));
    }
    result.screened = screened.length;

    // -------------------------------------------------------------------------
    // [4] CORTE — a etapa que define a viabilidade econômica
    // -------------------------------------------------------------------------
    const toEnrich = screened
      .filter((s) => s.preliminaryScore >= ENRICHMENT_THRESHOLD)
      .sort((a, b) => b.preliminaryScore - a.preliminaryScore)
      .slice(0, MAX_ENRICHMENT_PER_CYCLE);

    console.log(
      `[curate] ${toEnrich.length}/${screened.length} tópicos passaram do limiar de ${ENRICHMENT_THRESHOLD} e serão enriquecidos.`,
    );

    // -------------------------------------------------------------------------
    // [5] ENRIQUECIMENTO + [6] AÇÕES
    // -------------------------------------------------------------------------
    for (const candidate of toEnrich) {
      const scoring = await scoreTopic(
        candidate.topicId,
        [...discoveryConnectors, ...enrichmentConnectors],
        dryRun,
      );
      if (!scoring) continue;

      result.enriched++;
      scoring.failedConnectors.forEach((c) => allFailedConnectors.add(c));

      if (scoring.band === 'HOT') result.promotedToHot++;
    }

    // -------------------------------------------------------------------------
    // [6.5] TETO DA FILA ATIVA — a faxina por RELEVÂNCIA
    // -------------------------------------------------------------------------
    // A OUTRA faxina do ciclo, e o par com a etapa [0]: aquela corta por IDADE
    // (7 dias), esta corta por RELEVÂNCIA (as piores colocadas, além das 30).
    // São perguntas diferentes e por isso são duas rotinas — ver os cabeçalhos
    // de `expire-topics.ts` e `topic-pool.ts`.
    //
    // POR QUE AQUI E NÃO LÁ EM CIMA, junto da expiração: o critério é
    // comparativo. Este passo precisa enxergar os scores JÁ RECALCULADOS nas
    // etapas [3] e [5] e as pautas novas JÁ CRIADAS na etapa [2] — rodando
    // antes, decidiria quem sai com os números da rodada passada e cortaria
    // justamente a pauta que acabou de subir. O preço de ficar no fim (um ciclo
    // que estoure antes não corta nada) é aceitável: o excesso continua lá no
    // ciclo seguinte, e a rotina não lança em hipótese alguma.
    const trim = await trimTopicPool({ dryRun });
    result.trimmedTopics = trim.dismissed;

    if (trim.dismissed > 0) {
      console.log(
        `[curate] ${trim.dismissed} pauta(s) descartada(s) por ficarem fora das ` +
          `${MAX_ACTIVE_TOPICS} vagas da fila (havia ${trim.active} ativas)` +
          // O aviso de "sobrou" explica tanto o número redondo repetido ciclo
          // após ciclo (teto de lote, na drenagem do passivo) quanto a fila que
          // segue acima de 30 por ter pautas protegidas — os dois casos são
          // esperados e nenhum é falha.
          (trim.hasMore ? ' — ainda há excesso, o próximo ciclo continua' : '') +
          (dryRun ? ' [dryRun: nada foi gravado]' : '') +
          '.',
      );
    }

    result.failedConnectors = [...allFailedConnectors];
    result.durationMs = Date.now() - startedAt;

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        topicsDiscovered: result.discovered,
        topicsScored: result.screened,
        topicsPromoted: result.promotedToHot,
        connectorsRun: discoveryConnectors.length + enrichmentConnectors.length,
        connectorsFailed: result.failedConnectors.length,
        finishedAt: new Date(),
        durationMs: result.durationMs,
      },
    });

    console.log(
      `[curate] ciclo concluído em ${(result.durationMs / 1000).toFixed(1)}s — ${result.promotedToHot} tópico(s) QUENTE(S).`,
    );

    return result;
  } catch (error) {
    // Falha do CICLO (não de um conector): registramos e propagamos. O
    // agendador decide se tenta de novo; não é papel desta função insistir.
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}

/**
 * O que aconteceu com um item descoberto.
 *
 * POR QUE NÃO BASTA DEVOLVER O ID (como era até aqui): os tetos de volume do
 * requisito contam PAUTAS CRIADAS, e `upsert` é justamente a operação que
 * esconde se houve criação ou não — ele devolve a linha do mesmo jeito nos dois
 * casos. Sem este `created`, um item que apenas reencontrou um tópico já
 * existente consumiria uma das 20 vagas do ciclo sem ter aumentado a fila em
 * nada, e o sintoma ("o curator parou de trazer pauta nova") não teria pista
 * nenhuma no log. O dado sai de graça: a consulta que o requisito 4 obriga a
 * fazer (existe matéria para este hash?) já responde se a linha existe.
 */
interface UpsertOutcome {
  topicId: string;
  /**
   * `true` quando a linha nasceu AGORA **ou** foi revivida de 'dismissed'
   * neste item. É o que consome cota (ver comentário do REVIVAL): das duas
   * formas, é uma pauta a mais que a redação passa a ver na fila hoje.
   */
  created: boolean;
  /** `true` só no caso específico de revival, para a instrumentação própria. */
  revived: boolean;
}

/**
 * Cria ou atualiza um tópico a partir de um item descoberto.
 *
 * Retorna `null` quando o item foi DESCARTADO — e são três os motivos possíveis,
 * todos com o mesmo contrato de saída porque o chamador trata os três igual
 * ("este item não vira pauta"): duplicata por similaridade, assunto que a
 * redação JÁ está cobrindo (rascunho ou publicado) e `dryRun`. Qual dos três
 * ocorreu fica registrado na instrumentação, não no tipo de retorno.
 */
async function upsertTopicFromItem(
  item: DiscoveredItem,
  dedupeWindow: { id: string; title: string; categorySlug: string | null }[],
  dryRun: boolean,
): Promise<UpsertOutcome | null> {
  const duplicate = findDuplicate(item.title, item.source.categorySlug, dedupeWindow);

  if (duplicate) {
    // Duplicata NÃO é lixo: é confirmação independente de que o assunto é real
    // e está repercutindo. Poderíamos usar a contagem de veículos como sinal
    // adicional (previsto para a Fase 3). Por ora, apenas registramos.
    if (!dryRun) {
      await logPipelineEvent({
        eventType: 'topic.duplicate_detected',
        topicId: duplicate.topicId,
        payload: {
          title: item.title,
          source: item.source.name,
          similarity: duplicate.similarity,
        },
      });
    }
    return null;
  }

  const hash = canonicalHash(item.title, item.source.categorySlug);
  if (dryRun) return null;

  /**
   * O ASSUNTO JÁ ESTÁ SENDO COBERTO PELA REDAÇÃO?
   *
   * O `upsert` logo abaixo, sozinho, tem um efeito colateral silencioso: quando
   * o hash já existe, ele devolve o id do tópico existente — INCLUSIVE quando
   * esse tópico já tem matéria em rascunho ou publicada. O id voltava para o
   * laço, entrava em `topicIds` e era pontuado de novo nas etapas [3] a [5],
   * gastando orçamento de API paga (X cobra por leitura) para redescobrir que um
   * assunto que a redação já está escrevendo continua em alta. Dinheiro gasto
   * para não mudar decisão nenhuma: a pauta já saiu da fila e já virou trabalho.
   *
   * A consulta é por `dedupeHash`, que é UNIQUE — ou seja, é uma busca por
   * índice, do mesmo custo de uma leitura pontual, e o `take: 1` em `articles`
   * impede que um tópico com muitas matérias traga uma lista inteira só para
   * responder "existe pelo menos uma?".
   *
   * ESTA É A CAMADA DE HASH EXATO. A camada de SIMILARIDADE do mesmo requisito
   * (título reformulado, que não bate hash) é resolvida na etapa [2], que agora
   * carrega os tópicos já cobertos na janela de comparação sem limite de tempo —
   * ver o comentário da segunda janela lá em cima. As duas juntas é que fecham o
   * caso; nenhuma delas sozinha basta.
   */
  const existente = await prisma.topic.findUnique({
    where: { dedupeHash: hash },
    select: {
      id: true,
      status: true,
      articles: {
        where: { status: { in: ['draft', 'published'] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (existente && existente.articles.length > 0) {
    await logPipelineEvent({
      eventType: 'topic.already_covered_skipped',
      topicId: existente.id,
      payload: {
        title: item.title,
        source: item.source.name,
        url: item.url,
        // O motivo escrito por extenso: daqui a seis meses, "por que esta
        // notícia não apareceu na fila?" precisa ter resposta sem arqueologia
        // no código.
        reason: 'topic_already_has_draft_or_published_article',
      },
    });
    return null;
  }

  if (existente && existente.status === 'dismissed') {
    /**
     * REVIVAL: o hash já existe, ninguém escreveu nada, e o tópico foi
     * DESCARTADO POR IDADE (`expire-topics.ts`, 7 dias) numa execução anterior.
     *
     * SEM ISTO, A PAUTA FICARIA INVISÍVEL PARA SEMPRE. `dedupeHash` é único —
     * então o mesmo fato nunca cria uma linha nova — e o `upsert` de baixo, se
     * chegasse a rodar aqui, faria `update: {}` (no-op) sobre uma linha que
     * continua 'dismissed', e o painel só lista `status` 'new'/'assigned'. Um
     * assunto que esfriou e expirou, mas que volta a virar notícia semanas
     * depois (ex.: um jogo adiado que vira pauta de novo no lançamento), nunca
     * mais apareceria na fila — e é exatamente o oposto do que a curadoria
     * deveria fazer com um tema que voltou a ficar quente.
     *
     * Reabrimos a fila para ele: `status` volta a 'new' e `firstSeenAt` é
     * atualizado para AGORA — sem isso, o relógio dos 7 dias de
     * `expire-topics.ts` continuaria contando da primeira vez que o assunto
     * apareceu, e a pauta reviveria já quase vencida (ou já vencida, se tivesse
     * ficado 'dismissed' por mais de 7 dias), sumindo nas próximas execuções sem
     * a redação ter tido chance de vê-la.
     *
     * Título e fonte da PRIMEIRA aparição são preservados de propósito (mesmo
     * raciocínio do `create` abaixo): o texto que a redação vê deve ser estável
     * entre a descoberta original e a revivida, e comparar títulos entre feeds
     * de novo não muda a identidade do assunto — só a idade dele.
     */
    const revivido = await prisma.topic.update({
      where: { id: existente.id },
      data: { status: 'new', firstSeenAt: item.publishedAt },
    });

    await logPipelineEvent({
      eventType: 'topic.revived',
      topicId: revivido.id,
      payload: {
        title: item.title,
        source: item.source.name,
        url: item.url,
      },
    });

    // Conta como cota consumida: para a redação, uma pauta que reaparece na
    // fila hoje é trabalho novo a considerar, do mesmo jeito que uma pauta
    // nascida agora — ver o comentário de `UpsertOutcome.created`.
    return { topicId: revivido.id, created: true, revived: true };
  }

  if (existente) {
    /**
     * REENCONTRO: o hash já existe, o tópico está ATIVO ('new' ou 'assigned'),
     * e ninguém escreveu nada ainda.
     *
     * Devolvemos o id sem passar pelo `upsert` — e não é otimização gratuita: o
     * `update: {}` do upsert original já era um NO-OP DELIBERADO (a primeira
     * versão registrada é a que vale, ver o comentário na criação abaixo), então
     * a leitura que acabamos de fazer torna a escrita inteiramente supérflua.
     * O que ganhamos com o desvio é `created: false`, que é o que impede o
     * reencontro de consumir cota do ciclo.
     *
     * MUDANÇA DE COMPORTAMENTO CONSCIENTE: o evento 'topic.discovered' deixa de
     * ser registrado nesses reencontros. Ele descreve o NASCIMENTO de uma pauta;
     * repeti-lo a cada reaparição do mesmo item no feed inflava a contagem de
     * "pautas descobertas" com pautas que ninguém descobriu e enchia a linha do
     * tempo do tópico de eventos idênticos. Na prática isso quase não ocorria — a
     * deduplicação por similaridade já barrava a maioria dos reencontros antes de
     * chegar aqui —, mas o "quase" é justamente o que fazia o número não fechar.
     */
    return { topicId: existente.id, created: false, revived: false };
  }

  const category = await prisma.category.findUnique({
    where: { slug: item.source.categorySlug },
    select: { id: true },
  });

  // A URL vem de fonte externa: classificamos o domínio em vez de confiar no
  // tier declarado pela fonte. Ver comentário de segurança em source-authority.
  const { tier } = classifyDomain(item.url);
  const effectiveTier = item.source.tier === 'official' ? 'official' : tier;

  const franchises = await matchFranchises(`${item.title} ${item.summary}`);

  // CONTINUA SENDO `upsert`, E NÃO `create`, mesmo depois de a consulta acima ter
  // confirmado que a linha não existe. A confirmação vale para o instante em que
  // foi feita: entre ela e esta escrita cabe outro processo (um segundo ciclo
  // disparado por engano, um reprocessamento manual) gravando o mesmo hash — e
  // `dedupeHash` é UNIQUE, então um `create` estouraria com violação de índice e
  // derrubaria o ciclo inteiro por causa de uma corrida rara. O `upsert` absorve
  // esse caso devolvendo a linha do outro processo, que é o resultado correto.
  //
  // (Nessa corrida a cota é contada como criação mesmo sem a linha ter nascido
  // aqui. Desempatar exigiria uma terceira consulta POR ITEM só para acertar uma
  // contagem que erraria por um, num evento que, com um único curator rodando,
  // não deve acontecer nunca. Não vale o custo fixo.)
  const topic = await prisma.topic.upsert({
    where: { dedupeHash: hash },
    // Se o tópico já existe (mesmo hash), não sobrescrevemos título nem fonte:
    // a primeira versão registrada é a que chegou primeiro, e essa informação
    // de precedência tem valor editorial.
    update: {},
    create: {
      query: item.title.slice(0, 200),
      title: item.title,
      summary: item.summary,
      aliases: [],
      dedupeHash: hash,
      categoryId: category?.id ?? null,
      sourceUrl: item.url,
      sourceName: item.source.name,
      sourceTier: effectiveTier,
      firstSeenAt: item.publishedAt,
      status: 'new',
      franchises: {
        create: franchises.map((f) => ({ franchiseId: f.id })),
      },
    },
  });

  await logPipelineEvent({
    eventType: 'topic.discovered',
    topicId: topic.id,
    payload: {
      source: item.source.name,
      url: item.url,
      tier: effectiveTier,
      // Só existe quando a etapa [1.5] trocou o texto. É o único lugar onde o
      // título como o veículo publicou sobrevive — sem ele, não há como
      // auditar depois se uma manchete estranha na fila veio da fonte ou da
      // nossa reescrita. Ver `DiscoveredItem.originalTitle`.
      ...(item.originalTitle ? { originalTitle: item.originalTitle } : {}),
    },
  });

  return { topicId: topic.id, created: true, revived: false };
}

/**
 * Associa franquias ao texto por casamento de nome e apelidos.
 *
 * Simples de propósito. Um modelo de NER (reconhecimento de entidades) seria
 * mais preciso, mas as franquias do nosso catálogo têm nomes bastante
 * distintivos ("The Last of Us", "One Piece"), e o casamento por alias resolve
 * a maioria com custo zero e resultado auditável.
 */
async function matchFranchises(text: string): Promise<{ id: string; slug: string }[]> {
  const franchises = await prisma.franchise.findMany({
    select: { id: true, slug: true, name: true, aliases: true },
  });

  const lower = text.toLowerCase();

  return franchises
    .filter((franchise) => {
      // `toStringArray` porque `aliases` é coluna `Json` desde a migração para o
      // MySQL. Aqui a normalização não é só de tipo: um valor não-string caído
      // nesse array chegaria a `escapeRegex`/`new RegExp` mais abaixo e
      // derrubaria o ciclo inteiro de curadoria — num processo de fundo, onde
      // ninguém veria o erro até o score parar de atualizar.
      const terms = [franchise.name, ...toStringArray(franchise.aliases)];
      return terms.some((term) => {
        const normalized = term.toLowerCase();
        // Fronteira de palavra evita que "DC" case dentro de "DCEU" ou de
        // qualquer palavra que contenha as letras — falso positivo clássico
        // com siglas curtas.
        const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i');
        return pattern.test(lower);
      });
    })
    .map((f) => ({ id: f.id, slug: f.slug }));
}

/** Escapa metacaracteres antes de interpolar em RegExp (nome de franquia é dado externo). */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pontua um tópico com o conjunto de conectores informado.
 * Persiste o score, o histórico e as leituras brutas; dispara as ações da faixa.
 */
async function scoreTopic(
  topicId: string,
  connectors: Awaited<ReturnType<typeof getAvailableConnectors>>,
  dryRun: boolean,
): Promise<(ScoreResult & { failedConnectors: string[] }) | null> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: {
      category: { select: { slug: true } },
      franchises: { include: { franchise: { select: { slug: true } } } },
    },
  });

  if (!topic) return null;

  // O contexto é montado uma vez e compartilhado por todos os conectores.
  // Os campos extras (sourceUrl, analysisText) são lidos apenas pelos conectores
  // que os entendem, via interfaces estendidas — ver source-authority.ts.
  const context: Omit<SignalContext, 'signal'> & {
    sourceUrl: string | null;
    sourceTier: string | null;
    analysisText: string;
  } = {
    query: topic.query,
    // Coluna `Json` desde a migração para o MySQL. Este contexto é consumido
    // pelos conectores (youtube.ts, serp-competition.ts), que iteram os aliases
    // — normalizar aqui, na origem, evita repetir a checagem em cada um deles.
    aliases: toStringArray(topic.aliases),
    categorySlug: topic.category?.slug,
    franchiseSlugs: topic.franchises.map((f) => f.franchise.slug),
    firstSeenAt: topic.firstSeenAt,
    sourceUrl: topic.sourceUrl,
    sourceTier: topic.sourceTier,
    analysisText: `${topic.title} ${topic.summary}`,
  };

  const collection = await collectSignals(connectors, context);

  const triggers = detectTriggers(context.analysisText).map(
    (t) => t.trigger,
  ) as EmotionalTrigger[];

  const scoreResult = calculateScore({
    measurements: collection.measurements,
    firstSeenAt: topic.firstSeenAt,
    emotionalTriggers: triggers,
    weightSet: DEFAULT_WEIGHTS,
  });

  if (dryRun) {
    return { ...scoreResult, failedConnectors: collection.failedConnectors };
  }

  // --- Delta de 1h, para a seta "+38" do design ---
  const oneHourAgo = new Date(Date.now() - 3_600_000);
  const previousSnapshot = await prisma.scoreSnapshot.findFirst({
    where: { topicId, calculatedAt: { lte: oneHourAgo }, isShadow: false },
    orderBy: { calculatedAt: 'desc' },
    select: { score: true },
  });
  const scoreDelta1h = previousSnapshot
    ? Math.round((scoreResult.score - previousSnapshot.score) * 10) / 10
    : 0;

  const previousBand = topic.currentBand;
  const becameHotNow = scoreResult.band === 'HOT' && previousBand !== 'HOT';

  /**
   * ENTROU EM ALTA AGORA? — a versão LARGA do `becameHotNow` acima.
   *
   * As duas marcas convivem porque respondem a perguntas diferentes, e confundi-las
   * quebraria um KPI que já está em produção:
   *
   *   `becameHotNow`  -> "cruzou 80 AGORA?" É o T-zero do cronômetro de
   *                      time-to-publish (meta de 30 min) e alimenta o KPI de
   *                      `actions/instrumentation.ts`. Mexer nele é mexer na
   *                      medição da redação.
   *   esta variável   -> "saiu do fluxo normal AGORA?" É o T-zero de "este
   *                      assunto está em alta desde quando", que a fila do painel
   *                      exibe para o editor julgar se a pauta ainda vale.
   *
   * O corte é RISING (60) e não HOT (80) porque a pauta que só chega a 'EM ALTA'
   * é exatamente a que hoje não tem sinal NENHUM de tempo na fila — ela nunca
   * grava `becameHotAt` e portanto parece igualmente fresca no minuto 5 e na
   * hora 6. 'RELEVANT' fica de fora de propósito: o catálogo de faixas descreve
   * aquela faixa como "fluxo editorial normal, sem meta de velocidade", e um
   * aviso que aparece em quase toda linha da fila deixa de ser aviso.
   *
   * O `Set` é comparado contra `topic.currentBand`, que vem do banco como
   * `string` livre (a faixa não é enum no schema — ver o comentário de
   * `Author.systemRole`). Ler a faixa ANTERIOR desse jeito, e não do último
   * `ScoreSnapshot`, é o mesmo caminho que `becameHotNow` já usa: uma leitura a
   * menos e a mesma fonte de verdade.
   */
  const emAltaAgora =
    TRENDING_BANDS.has(scoreResult.band) && !TRENDING_BANDS.has(previousBand);

  // Persistimos tudo numa transação: score atual, histórico e leituras brutas
  // precisam ser consistentes entre si. Se gravássemos separadamente e o
  // processo caísse no meio, teríamos um tópico com score novo e histórico
  // velho — e a métrica de precisão passaria a mentir.
  await prisma.$transaction([
    prisma.topic.update({
      where: { id: topicId },
      data: {
        currentScore: scoreResult.score,
        currentBand: scoreResult.band,
        scoreDelta1h,
        seoOpportunity: scoreResult.seoOpportunity,
        confidence: scoreResult.confidence,
        termType: scoreResult.termType,
        emotionalTriggers: scoreResult.emotionalTriggers,
        requiresHumanReview: !isEligibleForAutomation(scoreResult).eligible,
        scoreSummary: scoreResult.summary,
        weightsVersion: scoreResult.weightsVersion,
        lastScoredAt: new Date(),
        // `becameHotAt` só é gravado UMA vez: é o T-zero do cronômetro de
        // time-to-publish. Sobrescrever a cada ciclo zeraria o KPI.
        ...(becameHotNow && !topic.becameHotAt ? { becameHotAt: new Date() } : {}),
        // MESMA trava de escrita única, pelo mesmo motivo e com um risco extra:
        // um assunto oscila de faixa (sobe para 'EM ALTA', cai para 'RELEVANTE'
        // no ciclo seguinte, volta a subir). Sem o `!topic.becameTrendingAt`,
        // cada volta reiniciaria a contagem e a fila mostraria "em alta há 15
        // min" para uma pauta que a redação vê desde a manhã — que é a leitura
        // errada exatamente no caso em que a informação mais importa.
        ...(emAltaAgora && !topic.becameTrendingAt ? { becameTrendingAt: new Date() } : {}),
      },
    }),

    prisma.scoreSnapshot.create({
      data: {
        topicId,
        score: scoreResult.score,
        band: scoreResult.band,
        seoOpportunity: scoreResult.seoOpportunity,
        confidence: scoreResult.confidence,
        // O `as unknown` é necessário porque o tipo Json do Prisma não aceita
        // diretamente nossa estrutura tipada. A conversão é segura: o objeto é
        // serializável por construção (só números, strings e arrays).
        contributions: scoreResult.contributions as unknown as object,
        weightsVersion: scoreResult.weightsVersion,
      },
    }),

    prisma.signalReading.createMany({
      data: collection.measurements.map((m) => ({
        topicId,
        connectorId: m.connectorId,
        dimension: m.dimension,
        value: m.value,
        rawValue: m.rawValue !== undefined ? String(m.rawValue) : null,
        confidence: m.confidence,
        explanation: m.explanation ?? null,
        observedAt: m.observedAt,
      })),
    }),
  ]);

  // --- [6] AÇÕES DA FAIXA ---
  await onScoreCalculated({
    topicId,
    topicTitle: topic.title,
    result: scoreResult,
    previousBand,
    becameHotNow,
    hasManualOverride: topic.manualScoreOverride !== null,
  });

  return { ...scoreResult, failedConnectors: collection.failedConnectors };
}

/**
 * RECÁLCULO DE CONTEÚDO JÁ PUBLICADO.
 *
 * Atende ao requisito: "permitir que uma notícia suba de posição na home
 * automaticamente se ganhar tração DEPOIS da publicação (ex.: um trailer que
 * viraliza 3h depois)".
 *
 * Roda com frequência maior que o ciclo de descoberta (a cada 5 min, contra
 * 15), porque é ele que mantém a home viva. E é bem mais barato: opera sobre
 * dezenas de artigos publicados, não sobre centenas de candidatos.
 */
export async function rescorePublished(options: { hoursBack?: number } = {}): Promise<number> {
  const { hoursBack = 48 } = options;

  const articles = await prisma.article.findMany({
    where: {
      status: 'published',
      publishedAt: { gte: new Date(Date.now() - hoursBack * 3_600_000) },
      topicId: { not: null },
    },
    select: { id: true, topicId: true, currentScore: true },
  });

  const connectors = await getAvailableConnectors('discovery');
  let updated = 0;

  for (const article of articles) {
    if (!article.topicId) continue;

    const scoring = await scoreTopic(article.topicId, connectors, false);
    if (!scoring) continue;

    const delta = scoring.score - article.currentScore;

    await prisma.article.update({
      where: { id: article.id },
      data: {
        currentScore: scoring.score,
        currentBand: scoring.band,
        scoreDelta1h: Math.round(delta * 10) / 10,
        scoreUpdatedAt: new Date(),
        // NOTA CRÍTICA: `scoreAtPublish` NÃO é tocado aqui. Ele é o "previsto"
        // do KPI de precisão e precisa permanecer congelado para sempre.
        // Atualizá-lo destruiria a capacidade de avaliar o algoritmo.
      },
    });

    // Variação relevante para cima: vale registrar, porque é o caso do
    // "trailer que viralizou depois" e alimenta o gráfico do painel.
    if (Math.abs(delta) >= 5) {
      await logPipelineEvent({
        eventType: 'article.score_changed',
        articleId: article.id,
        topicId: article.topicId,
        payload: { from: article.currentScore, to: scoring.score, delta },
      });
      updated++;
    }
  }

  return updated;
}
