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
  heatForBand,
  type EmotionalTrigger,
  type ScoreBand,
} from '@subcarioca/core';

import type { PreArticleOutput } from '@/server/ai/prearticle-types';

import { HeatBadge } from '../heat-badge';
import { ScoreValue } from './score-value';

interface TopicRowProps {
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
    franchises: string[];
    becameHotAt: Date | null;
    claimedAt: Date | null;
    status: string;
    contributions: unknown;
  };
}

export function TopicRow({ topic }: TopicRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState('');
  const [prearticle, setPrearticle] = useState<PreArticleOutput | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [copied, setCopied] = useState(false);

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
   * Gera a pré-matéria com IA para esta pauta.
   *
   * Diferente de `callAction`, esta chamada NÃO recarrega a página ao terminar:
   * o resultado é conteúdo transiente para o editor revisar, não um novo estado
   * do tópico. Mantemos o resultado em memória até o usuário recarregar, então
   * ele pode copiar o JSON ou reler a redação sem perder a geração.
   */
  async function generatePreArticle() {
    setPrearticle(null);
    setCopied(false);
    setGenStatus('');
    setGenerating(true);
    try {
      const response = await fetch(`/api/admin/topics/${topic.id}/prearticle`, {
        method: 'POST',
      });
      const data = (await response.json()) as {
        ok: boolean;
        message?: string;
        data?: PreArticleOutput;
      };
      if (data.ok && data.data) {
        setPrearticle(data.data);
        setGenStatus('Pré-matéria gerada.');
      } else {
        setGenStatus(data.message ?? 'Falha ao gerar pré-matéria.');
      }
    } catch {
      setGenStatus('Erro de conexão ao gerar pré-matéria.');
    } finally {
      setGenerating(false);
    }
  }

  /** Copia o JSON completo para a área de transferência — o editor cola onde quiser. */
  async function copyPreArticle() {
    if (!prearticle) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(prearticle, null, 2));
      setCopied(true);
    } catch {
      setGenStatus('Não foi possível copiar.');
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

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={generatePreArticle}
          disabled={generating}
        >
          {generating ? 'Gerando…' : 'Gerar pré-matéria'}
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? 'Ocultar detalhes' : 'Por que esse score?'}
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => callAction('dismiss')}
          disabled={isPending}
        >
          Descartar
        </button>
      </div>

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
              errou" de "o editor discordou" — insumo direto da recalibração. */}
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
        </div>
      )}

      {/* ---------- PRÉ-MATÉRIA GERADA POR IA ---------- */}
      {prearticle && (
        <div className="admin-row__detail admin-row__prearticle">
          <div className="admin-row__prearticle-head">
            <h4 className="admin-row__title">Pré-matéria (rascunho de IA)</h4>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={copyPreArticle}
            >
              {copied ? 'Copiado ✓' : 'Copiar JSON'}
            </button>
          </div>

          <p className="admin-row__summary">{prearticle.contextualizacao}</p>

          {prearticle.analise_hype.length > 0 && (
            <div className="admin-row__prearticle-section">
              <h5 className="admin-row__summary">Análise do hype</h5>
              <ul className="admin-row__list">
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
              <ul className="admin-row__list">
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
              <ul className="admin-row__list">
                {prearticle.otimizacao.titulos_sociais.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            <p className="form-hint">#{prearticle.otimizacao.hashtags.join(' #')}</p>
          </div>
        </div>
      )}

      {feedback && (
        <p className="form-hint" role="status">
          {feedback}
        </p>
      )}

      {genStatus && (
        <p className="form-hint" role="status">
          {genStatus}
        </p>
      )}
    </li>
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
