/**
 * =============================================================================
 * TIPOS DE SCORE E FAIXAS DE AÇÃO
 * =============================================================================
 *
 * Uma decisão de produto que vale explicar antes do código:
 *
 * O briefing pede UM score de 0 a 100. Mas ao modelar os sinais ficou claro que
 * um número só não resolve, por causa do item 7 (cauda longa vs. cabeça).
 * Um exemplo concreto:
 *
 *   - "GTA VI atrasado"        → volume gigante, mas 40 portais publicaram em 10min.
 *   - "easter egg do Ellie na fase 3" → volume pequeno, zero concorrência, e quem
 *     busca isso é fã raiz que lê 4 páginas e assina newsletter.
 *
 * Se colapsarmos os dois num único número, o segundo caso sempre perde e a gente
 * nunca constrói o ativo de SEO de cauda longa — que é justamente o que sustenta
 * tráfego orgânico entre um breaking news e outro.
 *
 * Por isso o motor produz DOIS números com finalidades distintas:
 *   - `score` (0-100)        → URGÊNCIA. "Isso precisa ir ao ar AGORA?"
 *                              É ele que define as faixas QUENTE/EM ALTA/etc.,
 *                              o push e a posição na home. É o score do briefing.
 *   - `seoOpportunity` (0-100) → VALOR DE PAUTA. "Vale escrever, mesmo sem pressa?"
 *                              Alimenta a fila de conteúdo evergreen.
 *
 * Um tópico com score 35 e seoOpportunity 82 não é lixo: é uma ótima pauta que
 * simplesmente não é breaking news. Com um número só, ele seria descartado.
 */

import type { SignalDimension, SignalMeasurement } from './signals';

/** Faixas de ação. Os nomes são os do briefing e aparecem literalmente no painel. */
export type ScoreBand = 'HOT' | 'RISING' | 'RELEVANT' | 'EVERGREEN';

export interface ScoreBandDefinition {
  band: ScoreBand;
  label: string;
  /** Limite inferior, inclusivo. */
  min: number;
  /** Limite superior, inclusivo. */
  max: number;
  /** Meta de tempo até publicação, em minutos. `null` = sem meta de velocidade. */
  publishTargetMinutes: number | null;
  /** Dispara alerta para a redação (Slack/e-mail/som no painel)? */
  alertsNewsroom: boolean;
  /** É candidato automático a push notification? */
  pushCandidate: boolean;
  /** Posição sugerida na home. */
  homePlacement: 'hero' | 'trending' | 'feed' | 'none';
  description: string;
  color: string;
}

export const SCORE_BANDS: readonly ScoreBandDefinition[] = [
  {
    band: 'HOT',
    label: 'QUENTE / BREAKING',
    min: 80,
    max: 100,
    publishTargetMinutes: 30,
    alertsNewsroom: true,
    pushCandidate: true,
    homePlacement: 'hero',
    description:
      'Alerta imediato para a redação. Meta de publicação em 30 minutos, candidato a push e ao hero da home.',
    color: '#DC2626',
  },
  {
    band: 'RISING',
    label: 'EM ALTA',
    min: 60,
    max: 79,
    publishTargetMinutes: 240,
    alertsNewsroom: false,
    pushCandidate: false,
    homePlacement: 'trending',
    description: 'Meta de publicação em poucas horas. Entra na seção Trending da home.',
    color: '#EA580C',
  },
  {
    band: 'RELEVANT',
    label: 'RELEVANTE',
    min: 40,
    max: 59,
    publishTargetMinutes: null,
    alertsNewsroom: false,
    pushCandidate: false,
    homePlacement: 'feed',
    description: 'Fluxo editorial normal, sem meta de velocidade.',
    color: '#0891B2',
  },
  {
    band: 'EVERGREEN',
    label: 'EVERGREEN / EDITORIAL',
    min: 0,
    max: 39,
    publishTargetMinutes: null,
    alertsNewsroom: false,
    pushCandidate: false,
    homePlacement: 'none',
    description:
      'Fora da curadoria de velocidade. Vira insumo de pauta evergreen e SEO de cauda longa.',
    color: '#64748B',
  },
] as const;

/**
 * Converte score numérico em faixa.
 * O `?? ` no fim existe porque `noUncheckedIndexedAccess` está ligado: mesmo
 * sabendo que as faixas cobrem 0-100, o compilador exige o caminho de escape.
 * Preferimos EVERGREEN como padrão seguro (nunca dispara push por engano).
 */
export function bandForScore(score: number): ScoreBandDefinition {
  const clamped = Math.max(0, Math.min(100, score));
  return SCORE_BANDS.find((b) => clamped >= b.min && clamped <= b.max) ?? SCORE_BANDS[3]!;
}

/** Contribuição de uma dimensão ao score final — a "prestação de contas" do algoritmo. */
export interface DimensionContribution {
  dimension: SignalDimension;
  /** Média ponderada das medições normalizadas desta dimensão, em [0,1]. */
  normalizedValue: number;
  /** Peso configurado para a dimensão. */
  weight: number;
  /** Peso após renormalização (quando alguma dimensão está indisponível). */
  effectiveWeight: number;
  /** Pontos que esta dimensão adicionou ao score final (0-100). */
  points: number;
  /** Medições brutas que geraram o valor — para o painel abrir o detalhe. */
  measurements: SignalMeasurement[];
  /** `false` quando nenhum conector conseguiu medir esta dimensão neste ciclo. */
  available: boolean;
}

/** Resultado completo de um cálculo de score. */
export interface ScoreResult {
  /** Score de URGÊNCIA (0-100). É o score das faixas de ação. */
  score: number;
  band: ScoreBand;
  /** Score de VALOR DE PAUTA / SEO (0-100). Ver explicação no topo do arquivo. */
  seoOpportunity: number;
  /**
   * Confiança geral em [0,1]. Cai quando conectores falham ou quando os dados
   * são rasos. O painel usa isso para mostrar "score 84 (confiança baixa)" —
   * um score alto com confiança baixa não deveria disparar push automático.
   */
  confidence: number;
  /** Classificação cabeça vs. cauda longa, derivada de volume + concorrência. */
  termType: 'head' | 'mid' | 'long-tail';
  /** Gatilhos emocionais detectados — sinalizam revisão humana. */
  emotionalTriggers: EmotionalTrigger[];
  contributions: DimensionContribution[];
  /** Versão do conjunto de pesos usada. Essencial para recalibrar depois. */
  weightsVersion: string;
  calculatedAt: Date;
  /** Frase pronta para o painel: "Alta velocidade de busca (+18 pts) e trending no r/games". */
  summary: string;
}

/**
 * Gatilhos emocionais (item 10 do briefing).
 *
 * ATENÇÃO EDITORIAL: estes gatilhos NÃO aumentam o score de forma agressiva de
 * propósito. Peso alto aqui transformaria o algoritmo numa máquina de caçar
 * polêmica e morte de personagem — ótimo para clique de curto prazo, péssimo
 * para a marca e para a retenção da base. O papel deles é sobretudo LEVANTAR A
 * MÃO para um humano decidir (`requiresHumanReview`), não decidir sozinho.
 */
export const EMOTIONAL_TRIGGERS = [
  'character-death',
  'cast-departure',
  'cancellation',
  'controversy',
  'nostalgia',
  'leak',
  'exclusive',
] as const;

export type EmotionalTrigger = (typeof EMOTIONAL_TRIGGERS)[number];

export const EMOTIONAL_TRIGGER_LABELS: Record<EmotionalTrigger, string> = {
  'character-death': 'Morte de personagem',
  'cast-departure': 'Saída do elenco',
  cancellation: 'Cancelamento',
  controversy: 'Polêmica / controvérsia',
  nostalgia: 'Nostalgia',
  leak: 'Vazamento',
  exclusive: 'Exclusividade',
};

/**
 * Gatilhos que exigem revisão humana antes de qualquer automação (push, hero).
 * Vazamento e polêmica podem ser falsos, difamatórios ou juridicamente
 * arriscados — publicar rápido sem checagem é como um portal perde credibilidade
 * (e ganha processo). Ver README > Segurança e risco editorial.
 */
export const TRIGGERS_REQUIRING_REVIEW: readonly EmotionalTrigger[] = [
  'leak',
  'controversy',
  'character-death',
  'cancellation',
] as const;
