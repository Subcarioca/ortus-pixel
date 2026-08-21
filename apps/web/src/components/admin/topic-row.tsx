'use client';

/**
 * =============================================================================
 * LINHA DE TÓPICO NO PAINEL EDITORIAL
 * =============================================================================
 *
 * Concentra as três ações do jornalista:
 *   1. ASSUMIR a pauta (inicia o cronômetro de time-to-publish).
 *   2. SOBREPOR o score manualmente (o humano vence o algoritmo).
 *   3. DESCARTAR o tópico.
 *
 * O detalhe expansível ("Por que esse score?") é o que constrói confiança no
 * sistema. Sem ele, o número é uma caixa-preta — e caixa-preta em redação é
 * ignorada em duas semanas.
 */

import { useState, useTransition } from 'react';

import {
  EMOTIONAL_TRIGGER_LABELS,
  TOPIC_ORIGIN_LABELS,
  heatForBand,
  routes,
  type EmotionalTrigger,
  type ScoreBand,
  type TopicOrigin,
} from '@subcarioca/core';

import { HeatBadge } from '../heat-badge';
import { ScoreValue } from './score-value';
import { readAdminResponse } from './admin-response';
import type { FranchiseOption } from './article-classification-fields';
import { ArticleCreateForm } from './article-create-form';

// Só o TIPO do rascunho: `import type` some na compilação e nenhuma linha do
// módulo de servidor entra no pacote do navegador. Ver `article-create-form`.
import type { AiDraft } from '@/server/ai-draft';
import type { PreArticleOutput } from '@/server/ai/prearticle-types';

interface TopicRowProps {
  categories: { slug: string; name: string }[];
  authors: { id: string; name: string }[];
  /** Franquias cadastradas, para o campo de etiquetagem da matéria. */
  franchises: FranchiseOption[];
  /** Cortesia de interface: a rota PATCH é quem recusa de fato. */
  canLowerSensitivity: boolean;
  /**
   * A conta logada pode CURAR a fila (sobrepor score, descartar tópico)?
   *
   * Redator não pode: as duas ações mudam o que o site inteiro exibe. Esconder
   * os controles é cortesia, não segurança — a rota `/api/admin/topics/[id]`
   * recusa as duas ações por conta própria, e é ela que vale.
   */
  canCurate: boolean;
  /**
   * O servidor tem chave da API de geração de texto configurada?
   *
   * DEGRADAÇÃO GRACIOSA, igual à dos conectores do pipeline: sem chave, o botão
   * simplesmente não existe — em vez de existir e falhar em todo clique. A
   * explicação de por que ele sumiu aparece UMA vez no topo da fila, e só para
   * quem administra o servidor (ver `apps/web/src/app/admin/page.tsx`); repetir
   * um botão desabilitado em cinquenta linhas seria ruído para o redator, que
   * não tem como resolver isso de qualquer forma.
   *
   * Esconder o botão não é a proteção: a rota recusa a ação por conta própria.
   */
  aiEnabled: boolean;
  /**
   * O servidor tem a chave do DeepSeek configurada? Mesmo contrato de
   * `aiEnabled` — sem chave, o botão "Gerar pré-matéria" não existe em vez de
   * existir e falhar em todo clique. A explicação do porquê some aparece UMA
   * vez no topo da fila (ver `page.tsx`), e a rota recusa a ação por conta
   * própria — esconder o botão é cortesia, não segurança.
   */
  preArticleEnabled: boolean;
  topic: {
    id: string;
    title: string;
    summary: string;
    score: number;
    algorithmicScore: number;
    hasOverride: boolean;
    overrideReason: string | null;
    band: ScoreBand;
    confidence: number;
    seoOpportunity: number;
    termType: string;
    scoreSummary: string;
    emotionalTriggers: string[];
    requiresHumanReview: boolean;
    sourceName: string | null;
    sourceUrl: string | null;
    sourceTier: string;
    categoryName: string | null;
    categorySlug: string | null;
    franchises: string[];
    /**
     * Ids das franquias do tópico. Viram a seleção inicial da matéria — é o que
     * impede a matéria de nascer menos classificada do que a pauta que a
     * originou.
     */
    franchiseIds: string[];
    /** 'curator' | 'manual'. Ver core/topic-origin.ts. */
    origin: TopicOrigin;
    becameHotAt: Date | null;
    claimedAt: Date | null;
    status: string;
    contributions: unknown;
  };
}

export function TopicRow({
  topic,
  categories,
  authors,
  franchises,
  canCurate,
  canLowerSensitivity,
  aiEnabled,
  preArticleEnabled,
}: TopicRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState('');

  /**
   * Rascunho gerado, quando existir. `null` = formulário vazio de sempre.
   *
   * Ele mora AQUI (e não dentro do formulário) porque é a linha da fila que
   * decide qual dos dois caminhos abre o formulário — e porque o formulário
   * precisa nascer já com o texto: semear campos depois da montagem, via efeito,
   * é como se sobrescreve o que o redator acabou de digitar.
   */
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [generating, setGenerating] = useState(false);

  /**
   * Pré-matéria estruturada, quando gerada. `null` = nada a mostrar. Vive em
   * memória até o usuário recarregar a fila: o resultado é conteúdo transiente
   * para revisão, não um novo estado do tópico no banco — então recarregar a
   * página no sucesso (como `callAction` faz) jogaria fora justamente o que
   * acabou de chegar.
   */
  const [prearticle, setPrearticle] = useState<PreArticleOutput | null>(null);
  const [generatingPreArticle, setGeneratingPreArticle] = useState(false);
  const [prearticleCopied, setPrearticleCopied] = useState(false);

  /**
   * O RASCUNHO QUE A GERAÇÃO ACABOU DE CRIAR, quando criar (ver a rota:
   * `articleId`/`articleSlug` só vêm preenchidos quando a `Article` foi salva
   * como rascunho). `null` cobre os dois casos em que não há o que abrir: a
   * geração falhou, ou teve sucesso mas o rascunho automático não pôde ser
   * criado (tópico sem categoria, texto curto demais — ver a mensagem).
   */
  const [prearticleDraft, setPrearticleDraft] = useState<{ id: string; slug: string } | null>(null);

  /** Minutos restantes da meta de 30 min. Negativo = estourou. */
  const minutesLeft = topic.becameHotAt
    ? 30 - Math.floor((Date.now() - topic.becameHotAt.getTime()) / 60_000)
    : null;

  async function callAction(action: string, payload: Record<string, unknown> = {}) {
    setFeedback('');
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/topics/${topic.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = (await response.json()) as { ok: boolean; message?: string };
        setFeedback(data.message ?? (data.ok ? 'Feito.' : 'Falhou.'));
        if (data.ok) {
          // Recarrega para refletir o novo estado. Simples e suficiente para um
          // painel interno; uma revalidação mais fina seria otimização prematura.
          window.location.reload();
        }
      } catch {
        setFeedback('Erro de conexão.');
      }
    });
  }

  /**
   * PEDE A SUGESTÃO E ABRE O FORMULÁRIO — dando certo ou não.
   *
   * O ponto central desta função é o `catch`/`else`: em QUALQUER falha o
   * formulário abre do mesmo jeito, vazio, com a explicação do que houve. O
   * caminho de escrever a matéria não pode depender de uma API de terceiro estar
   * no ar; o que a falha custa é o pré-preenchimento, não o trabalho.
   *
   * Não usa o `callAction` desta mesma tela de propósito: aquele recarrega a
   * página inteira no sucesso (é o certo para "assumir"/"descartar", que mudam o
   * estado do tópico no banco). Aqui não há nada gravado para recarregar — e um
   * `reload` jogaria fora justamente o rascunho que acabou de chegar.
   */
  async function generateSuggestion() {
    if (generating) return;

    setFeedback('');
    setGenerating(true);

    try {
      const response = await fetch(`/api/admin/topics/${topic.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai-suggestion' }),
      });

      const data = await readAdminResponse(response);

      // `draft` chega como `unknown` (a resposta do painel é genérica). A forma
      // é conferida no servidor; aqui basta não abrir o formulário "preenchido"
      // com algo que não é um rascunho.
      const draft = data.ok && isDraft(data.draft) ? data.draft : null;

      setAiDraft(draft);
      // Sem rascunho, a mensagem explica o que houve — e o formulário vazio
      // abre do lado, pronto. É o "fallback para o formulário de sempre".
      if (!draft) setFeedback(data.message);
      setCreatingArticle(true);
    } catch {
      setAiDraft(null);
      setFeedback(
        'Não foi possível falar com o servidor para gerar a sugestão. ' +
          'O formulário está aberto para você escrever normalmente.',
      );
      setCreatingArticle(true);
    } finally {
      setGenerating(false);
    }
  }

  /**
   * GERA A PRÉ-MATÉRIA ESTRUTURADA (REDATOR-CHEFE) para esta pauta.
   *
   * Diferente de `generateSuggestion`, NÃO abre o formulário de matéria: a
   * pré-matéria é o pacote completo (análise do hype, modelo de popularidade,
   * SEO) que o editor revisa NA FILA, antes de decidir abrir o formulário. Por
   * isso também não recarrega a página no sucesso — o resultado fica em memória
   * até o usuário recarregar, para poder copiar o JSON ou reler sem perder a
   * geração.
   */
  async function generatePreArticle() {
    if (generatingPreArticle) return;

    setFeedback('');
    setPrearticle(null);
    setPrearticleCopied(false);
    setPrearticleDraft(null);
    setGeneratingPreArticle(true);

    try {
      const response = await fetch(`/api/admin/topics/${topic.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prearticle' }),
      });

      const data = await readAdminResponse(response);

      // `prearticle` chega como `unknown` (a resposta do painel é genérica). A
      // forma é conferida no servidor; aqui basta não renderizar um objeto que
      // não é a pré-matéria.
      if (data.ok && isPreArticle(data.prearticle)) {
        setPrearticle(data.prearticle);

        // O rascunho automático (ver a rota) é OPCIONAL mesmo num sucesso: um
        // tópico sem categoria, por exemplo, gera a pré-matéria normalmente mas
        // não consegue virar `Article`. `articleId`/`articleSlug` só existem
        // quando a matéria de fato foi criada — daí a checagem de forma, e não
        // só de presença.
        setPrearticleDraft(
          typeof data.articleId === 'string' && typeof data.articleSlug === 'string'
            ? { id: data.articleId, slug: data.articleSlug }
            : null,
        );
      } else {
        setFeedback(data.message);
      }
    } catch {
      setFeedback('Não foi possível falar com o servidor para gerar a pré-matéria.');
    } finally {
      setGeneratingPreArticle(false);
    }
  }

  /** Copia o JSON completo para a área de transferência — o editor cola onde quiser. */
  async function copyPreArticle() {
    if (!prearticle) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(prearticle, null, 2));
      setPrearticleCopied(true);
    } catch {
      setFeedback('Não foi possível copiar.');
    }
  }

  const contributions = Array.isArray(topic.contributions)
    ? (topic.contributions as {
        dimension: string;
        normalizedValue: number;
        points: number;
        available: boolean;
        measurements?: { explanation?: string; connectorId: string }[];
      }[])
    : [];

  return (
    <li className={`admin-row${topic.band === 'HOT' ? ' admin-row--hot' : ''}`}>
      <div className="admin-row__main">
        <div className="admin-row__score">
          {/* O número aparece AQUI e só aqui: o badge de temperatura é o mesmo
              do site público (sem número) e o `ScoreValue` é o componente
              exclusivo do painel. Ver ADR 0009. */}
          <HeatBadge heat={heatForBand(topic.band)} size="lg" />
          <ScoreValue
            score={topic.score}
            algorithmicScore={topic.algorithmicScore}
            size="lg"
          />

          {/* Confiança exibida SEMPRE: um score alto com confiança baixa é uma
              informação diferente de um score alto confiável. */}
          <span
            className={`admin-row__confidence${topic.confidence < 0.5 ? ' admin-row__confidence--low' : ''}`}
          >
            confiança {Math.round(topic.confidence * 100)}%
          </span>

          {topic.hasOverride && (
            <span className="admin-row__override" title={topic.overrideReason ?? ''}>
              override manual (algoritmo: {Math.round(topic.algorithmicScore)})
            </span>
          )}
        </div>

        <div className="admin-row__body">
          <h3 className="admin-row__title">{topic.title}</h3>
          <p className="form-hint">{topic.summary}</p>

          <div className="admin-row__meta">
            {/*
              ORIGEM DA PAUTA. Só aparece quando é MANUAL, e isso é deliberado:
              o normal desta fila é o tópico do pipeline, e marcar o normal com
              uma etiqueta faz a etiqueta desaparecer de tanto se repetir. O que
              precisa saltar é a exceção — inclusive porque ela explica por que
              aquela linha está com score zero (pauta da redação não passou por
              nenhum conector; ver core/topic-origin.ts).
            */}
            {topic.origin === 'manual' && (
              <span className="chip chip--sm">{TOPIC_ORIGIN_LABELS.manual}</span>
            )}
            {topic.categoryName && <span className="chip chip--sm">{topic.categoryName}</span>}
            {topic.franchises.map((name) => (
              <span key={name} className="chip chip--sm">
                {name}
              </span>
            ))}
            <span className="chip chip--sm">SEO {Math.round(topic.seoOpportunity)}</span>
            <span className="chip chip--sm">{topic.termType}</span>
          </div>

          {/* Fonte e seu nível de autoridade: define se é fato ou rumor. */}
          {topic.sourceName && (
            <p className="form-hint">
              Fonte:{' '}
              {topic.sourceUrl ? (
                <a href={topic.sourceUrl} rel="noopener noreferrer" target="_blank">
                  {topic.sourceName}
                </a>
              ) : (
                topic.sourceName
              )}{' '}
              {/* Só os dois EXTREMOS têm modificador no CSS (`official` em
                  verde, `unverified` em âmbar); os quatro tiers do meio ficam
                  neutros de propósito — se todos tivessem cor, nenhum saltaria.
                  Interpolar o tier direto gerava `.tier--tier2Press` e afins:
                  classes sem regra nenhuma. Mesmo princípio de `heatClass`. */}
              <span
                className={`chip chip--sm${
                  topic.sourceTier === 'official' || topic.sourceTier === 'unverified'
                    ? ` tier--${topic.sourceTier}`
                    : ''
                }`}
              >
                {topic.sourceTier}
              </span>
            </p>
          )}

          {/* ALERTA DE REVISÃO: automação bloqueada. */}
          {topic.requiresHumanReview && (
            <p className="admin-row__warning" role="alert">
              Revisão humana obrigatória
              {topic.emotionalTriggers.length > 0 &&
                ` — ${topic.emotionalTriggers
                  .map((t) => EMOTIONAL_TRIGGER_LABELS[t as EmotionalTrigger] ?? t)
                  .join(', ')}`}
              . Push automático bloqueado.
            </p>
          )}

          {/* Cronômetro da meta de 30 minutos. */}
          {minutesLeft !== null && topic.status !== 'published' && (
            <p className={`admin-row__timer${minutesLeft < 0 ? ' admin-row__timer--late' : ''}`}>
              {minutesLeft >= 0
                ? `${minutesLeft} min restantes para a meta de publicação`
                : `Meta estourada há ${Math.abs(minutesLeft)} min`}
            </p>
          )}
        </div>
      </div>

      {/* ---------- AÇÕES ---------- */}
      <div className="admin-row__actions">
        {topic.status === 'new' && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => callAction('claim')}
            disabled={isPending}
          >
            Assumir pauta
          </button>
        )}

        {topic.status !== 'published' && topic.status !== 'dismissed' && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              // Fechar o formulário descarta o rascunho: reabrir por "Criar
              // matéria" tem de dar o formulário VAZIO, senão o botão passaria a
              // significar duas coisas diferentes dependendo do histórico.
              if (creatingArticle) setAiDraft(null);
              setCreatingArticle(!creatingArticle);
            }}
            aria-expanded={creatingArticle}
          >
            {creatingArticle ? 'Cancelar matéria' : 'Criar matéria'}
          </button>
        )}

        {/* ---------- SUGESTÃO POR IA ---------- */}
        {/* Fica ao LADO de "Criar matéria", e não no lugar dela: são dois pontos
            de partida para o mesmo trabalho, e o vazio continua sendo um caminho
            legítimo (às vezes o redator já sabe o que escrever).

            Some enquanto o formulário está aberto — de propósito. Gerar com o
            formulário aberto teria de sobrescrever o que já estivesse digitado
            ali, que é a maneira mais rápida de fazer alguém perder texto. Para
            gerar outra, cancele e clique de novo. */}
        {aiEnabled && !creatingArticle && topic.status !== 'published' && topic.status !== 'dismissed' && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void generateSuggestion()}
            disabled={generating}
            // O rascunho leva dezenas de segundos e não tem barra de progresso:
            // `aria-busy` é o que conta a quem usa leitor de tela que o botão
            // não ficou mudo por defeito.
            aria-busy={generating}
          >
            {generating ? 'Gerando sugestão…' : 'Gerar sugestão com IA'}
          </button>
        )}

        {/* ---------- PRÉ-MATÉRIA POR IA (REDATOR-CHEFE) ---------- */}
        {/* Fica ao lado da sugestão, e não no lugar dela: são dois produtos
            diferentes — a sugestão preenche o formulário, a pré-matéria devolve
            o pacote estruturado para revisão na fila. Some enquanto o formulário
            está aberto pela mesma razão da sugestão: gerar conteúdo novo com
            texto já digitado aberto é como se perde texto. */}
        {preArticleEnabled && !creatingArticle && topic.status !== 'published' && topic.status !== 'dismissed' && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void generatePreArticle()}
            disabled={generatingPreArticle}
            aria-busy={generatingPreArticle}
          >
            {generatingPreArticle ? 'Gerando pré-matéria…' : 'Gerar pré-matéria'}
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? 'Ocultar detalhes' : 'Por que esse score?'}
        </button>

        {canCurate && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => callAction('dismiss')}
            disabled={isPending}
          >
            Descartar
          </button>
        )}
      </div>

      {/* A MENSAGEM FICA COLADA NOS BOTÕES, e não no fim da linha. Quando a
          geração falha, o formulário abre logo abaixo — e a explicação do que
          houve, empurrada para depois de um formulário de vinte campos, não
          seria lida por ninguém. `role="status"` faz o leitor de tela anunciá-la
          sem roubar o foco de quem está digitando. */}
      {feedback && (
        <p className="form-hint" role="status">
          {feedback}
        </p>
      )}

      {/* ---------- CRIAR MATÉRIA A PARTIR DESTE TÓPICO ---------- */}
      {creatingArticle && (
        <div className="admin-row__detail">
          <ArticleCreateForm
            topicId={topic.id}
            defaultTitle={topic.title}
            defaultExcerpt={topic.summary}
            defaultCategorySlug={topic.categorySlug}
            defaultFranchiseIds={topic.franchiseIds}
            aiDraft={aiDraft}
            categories={categories}
            authors={authors}
            franchises={franchises}
            canLowerSensitivity={canLowerSensitivity}
            onDone={() => {
              setCreatingArticle(false);
              setAiDraft(null);
            }}
          />
        </div>
      )}

      {/* ---------- PRÉ-MATÉRIA GERADA POR IA ---------- */}
      {/* É conteúdo transiente: some ao recarregar a fila. As seções refletem o
          JSON do REDATOR-CHEFE (contextualização, hype, popularidade, texto e
          otimização), e o botão "Copiar JSON" permite levar o pacote inteiro
          para o formulário de matéria sem perda de estrutura. */}
      {prearticle && (
        <div className="admin-row__detail admin-row__prearticle">
          <div className="admin-row__prearticle-head">
            <h4 className="admin-row__title">Pré-matéria (rascunho de IA)</h4>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void copyPreArticle()}
            >
              {prearticleCopied ? 'Copiado ✓' : 'Copiar JSON'}
            </button>
          </div>

          {/* ---------- ABRIR O RASCUNHO SALVO ---------- */}
          {/* A pré-matéria não fica mais só na tela: a rota já salvou uma
              `Article` com `status: 'draft'` a partir deste texto (ver
              `POST /api/admin/topics/[id]`, ação `prearticle`). Este link é o
              que fecha o caminho até lá.

              APONTA PARA A LISTA DE MATÉRIAS, e não para uma URL com o id do
              rascunho: a tela de edição em `/admin/materias` não tem rota
              própria por matéria — é um formulário que abre inline dentro da
              própria listagem (ver `article-row.tsx`). Como "Rascunhos" vem
              PRIMEIRO nessa lista e é ordenada por edição mais recente, o
              rascunho que acabou de nascer é a primeira linha de lá. */}
          {prearticleDraft && (
            <p className="admin-row__summary">
              <a className="btn btn--primary btn--sm" href={routes.adminArticles()}>
                Abrir rascunho para editar
              </a>
            </p>
          )}

          <p className="admin-row__summary">{prearticle.contextualizacao}</p>

          {prearticle.analise_hype.length > 0 && (
            <div className="admin-row__prearticle-section">
              <h5 className="admin-row__summary">Análise do hype</h5>
              <ul>
                {prearticle.analise_hype.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="admin-row__prearticle-section">
            <h5 className="admin-row__summary">
              Modelo de popularidade — {prearticle.modelo_popularidade.categoria}
            </h5>
            <p className="form-hint">{prearticle.modelo_popularidade.justificativa}</p>
            <p className="form-hint">
              Pico: {prearticle.modelo_popularidade.momento_pico} · Janela:{' '}
              {prearticle.modelo_popularidade.janela_publicacao} · Risco:{' '}
              {prearticle.modelo_popularidade.risco_timing}
            </p>
            <p className="form-hint">
              {prearticle.modelo_popularidade.estrategia_posicionamento}
            </p>
          </div>

          <div className="admin-row__prearticle-section">
            <h5 className="admin-row__summary">{prearticle.pre_materia.titulo}</h5>
            {prearticle.pre_materia.subtitulo && (
              <p className="admin-row__summary">{prearticle.pre_materia.subtitulo}</p>
            )}
            {prearticle.pre_materia.abertura && (
              <p className="form-hint">{prearticle.pre_materia.abertura}</p>
            )}
            {prearticle.pre_materia.corpo.map((block, i) => (
              <p key={i} className="form-hint">
                {block}
              </p>
            ))}
            {prearticle.pre_materia.fechamento_cta && (
              <p className="form-hint">{prearticle.pre_materia.fechamento_cta}</p>
            )}
            {prearticle.pre_materia.extras_retencao.length > 0 && (
              <ul>
                {prearticle.pre_materia.extras_retencao.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-row__prearticle-section">
            <h5 className="admin-row__summary">SEO & captação</h5>
            <p className="form-hint">
              Palavra-chave: {prearticle.otimizacao.palavra_chave_principal} ·{' '}
              {prearticle.otimizacao.palavras_chave_secundarias.join(', ')}
            </p>
            <p className="form-hint">Meta: {prearticle.otimizacao.meta_description}</p>
            {prearticle.otimizacao.titulos_sociais.length > 0 && (
              <ul>
                {prearticle.otimizacao.titulos_sociais.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            <p className="form-hint">#{prearticle.otimizacao.hashtags.join(' #')}</p>
          </div>
        </div>
      )}

      {/* ---------- DETALHE: DECOMPOSIÇÃO DO SCORE ---------- */}
      {expanded && (
        <div className="admin-row__detail">
          <p className="admin-row__summary">{topic.scoreSummary}</p>

          <table className="admin-table">
            <caption className="sr-only">Contribuição de cada sinal para o score</caption>
            <thead>
              <tr>
                <th scope="col">Sinal</th>
                <th scope="col">Valor</th>
                <th scope="col">Pontos</th>
                <th scope="col">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => (
                <tr key={c.dimension} className={c.available ? '' : 'admin-table__row--na'}>
                  <th scope="row">{DIMENSION_LABELS[c.dimension] ?? c.dimension}</th>
                  <td>{c.available ? c.normalizedValue.toFixed(2) : '—'}</td>
                  <td>{c.available ? `+${c.points.toFixed(1)}` : 'indisponível'}</td>
                  <td className="form-hint">
                    {c.measurements?.map((m) => m.explanation).filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ---------- OVERRIDE MANUAL ---------- */}
          {/* O humano SEMPRE pode vencer o algoritmo. A justificativa é
              obrigatória: é ela que, depois, permite distinguir "o algoritmo
              errou" de "o editor discordou" — insumo direto da recalibração.
              "O humano", aqui, é quem faz curadoria: o score que este formulário
              altera reordena a home e o ranking para todos os leitores. */}
          {canCurate && (
          <form
            className="admin-override"
            onSubmit={(event) => {
              event.preventDefault();
              callAction('override', {
                score: Number(overrideValue),
                reason: overrideReason,
              });
            }}
          >
            <h4 className="admin-row__title">Sobrepor score manualmente</h4>
            <div className="form-inline">
              <label htmlFor={`score-${topic.id}`} className="sr-only">
                Novo score
              </label>
              <input
                id={`score-${topic.id}`}
                type="number"
                min={0}
                max={100}
                step={1}
                required
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                className="input input--sm"
                placeholder="0-100"
              />
              <label htmlFor={`reason-${topic.id}`} className="sr-only">
                Justificativa
              </label>
              <input
                id={`reason-${topic.id}`}
                type="text"
                required
                minLength={5}
                maxLength={200}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="input"
                placeholder="Justificativa (obrigatória)"
              />
              <button type="submit" className="btn btn--primary btn--sm" disabled={isPending}>
                Aplicar
              </button>
            </div>
          </form>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * É mesmo um rascunho?
 *
 * A resposta do painel é genérica (`[key: string]: unknown`), então este é o
 * ponto em que o valor volta a ter forma. A checagem é mínima de propósito — a
 * validação de verdade é do servidor, e repeti-la aqui inteira só criaria duas
 * regras para divergirem. O que ela impede é o caso que a tela não sobreviveria:
 * abrir o formulário "preenchido" com `undefined` e estourar no primeiro
 * `.map()` dos blocos.
 */
function isDraft(value: unknown): value is AiDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<AiDraft>;
  return (
    typeof draft.title === 'string' &&
    typeof draft.content === 'string' &&
    Array.isArray(draft.blocks) &&
    Array.isArray(draft.tldr) &&
    Array.isArray(draft.pendencias)
  );
}

/**
 * É mesmo uma pré-matéria?
 *
 * Mesmo espírito de `isDraft`: a resposta do painel é genérica, então este é o
 * ponto em que o valor volta a ter forma. A checagem é mínima de propósito — a
 * validação de verdade é do servidor (`parsePreArticle`). O que ela impede é
 * renderizar `undefined` como se fosse a pré-matéria e estourar no primeiro
 * `.map()` das seções.
 */
function isPreArticle(value: unknown): value is PreArticleOutput {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<PreArticleOutput>;
  return (
    typeof p.contextualizacao === 'string' &&
    typeof p.pre_materia === 'object' &&
    p.pre_materia !== null &&
    typeof (p.pre_materia as { titulo?: unknown }).titulo === 'string'
  );
}

const DIMENSION_LABELS: Record<string, string> = {
  searchVelocity: 'Aceleração de busca',
  searchVolume: 'Volume de busca',
  socialMomentum: 'Redes sociais',
  platformTrending: 'Trending nativo',
  sourceAuthority: 'Autoridade da fonte',
  releaseProximity: 'Proximidade de lançamento',
  serpOpportunity: 'Janela de SERP',
  audienceAffinity: 'Afinidade da audiência',
  emotionalTrigger: 'Gatilho emocional',
};
