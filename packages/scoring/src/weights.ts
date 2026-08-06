/**
 * =============================================================================
 * PESOS DO ALGORITMO — a decisão de produto mais discutível do projeto
 * =============================================================================
 *
 * Estes números são hipóteses, não verdades. Eles foram escolhidos a partir do
 * briefing e de heurísticas de redação, mas o valor real deles só aparece
 * depois de semanas medindo a correlação entre score previsto e pageviews reais
 * (o KPI de "precisão do score"). Por isso três cuidados foram tomados:
 *
 * 1) Os pesos são DADOS versionados, não constantes espalhadas pelo código.
 * 2) Cada conjunto tem uma `version`, gravada junto de cada score no banco.
 *    Sem isso é impossível responder "esse score foi calculado com quais pesos?"
 *    e a recalibração vira chute.
 * 3) O motor aceita um conjunto de pesos por parâmetro, o que permite rodar
 *    *shadow scoring*: calcular em paralelo com pesos candidatos, comparar a
 *    precisão contra o conjunto em produção e só então promover. Ver Fase 3.
 */

import type { SignalDimension } from '@canalnerd/core';

export interface WeightSet {
  version: string;
  description: string;
  weights: Record<SignalDimension, number>;
  /** Meia-vida do decaimento temporal, em horas. */
  halfLifeHours: number;
  /**
   * Piso de confiança. Se a confiança geral cair abaixo disso, o tópico é
   * marcado para revisão humana e fica INELEGÍVEL a automações (push, hero),
   * por mais alto que esteja o score. Um score 90 baseado em um único conector
   * sobrevivente não é um score 90 — é um chute com cara de precisão.
   */
  minConfidenceForAutomation: number;
}

/**
 * CONJUNTO PADRÃO v1 — o ponto de partida do MVP.
 *
 * Racional de cada peso:
 *
 * searchVelocity (0.26) — O MAIOR PESO, por exigência explícita do briefing e
 *   porque é o único sinal que chega ANTES da concorrência. Volume alto todo
 *   mundo enxerga; aceleração é o que dá vantagem de minutos. É o "breakout
 *   signal" e a razão de ser do produto.
 *
 * socialMomentum (0.16) — Segundo maior. É onde o fandom nerd de fato vive
 *   (Reddit, X, YouTube). Costuma acender antes do volume de busca: primeiro a
 *   pessoa vê no feed, depois ela vai ao Google. Funciona como confirmação
 *   independente da velocidade de busca.
 *
 * sourceAuthority (0.12) — Alta porque muda a natureza da decisão editorial.
 *   Anúncio oficial da Rockstar é fato publicável agora; a mesma informação
 *   vinda de thread anônima é rumor e exige apuração. Peso alto aqui é o que
 *   impede o sistema de tratar boato com a mesma urgência de fato confirmado.
 *
 * searchVolume (0.10) — Deliberadamente BAIXO, apesar de ser o número que mais
 *   impressiona. Volume alto sem aceleração significa interesse permanente, não
 *   notícia: "Star Wars" tem volume gigante todo santo dia e isso não é pauta.
 *   Volume é sobretudo um multiplicador de alcance, e quem captura isso é a
 *   velocidade.
 *
 * platformTrending (0.10) — Sinal binário e de alta qualidade quando presente,
 *   mas esparso (a maioria dos tópicos nunca entra em trending nativo).
 *
 * serpOpportunity (0.09) — Traduz a janela competitiva. Peso relevante porque
 *   afeta diretamente o retorno: chegar em 4º lugar numa notícia que 40 portais
 *   cobriram rende uma fração do tráfego de chegar em 1º numa que ninguém viu.
 *
 * audienceAffinity (0.08) — Nosso diferencial proprietário. Nenhum concorrente
 *   sabe que a NOSSA base engaja 3x mais com Zelda do que com FIFA. Começa
 *   baixo por falta de histórico e deve SUBIR nas próximas versões, conforme os
 *   dados internos se acumulam.
 *
 * releaseProximity (0.07) — Contexto de calendário. Sozinho não faz notícia,
 *   mas amplifica: um vazamento a 3 dias do lançamento vale muito mais que o
 *   mesmo vazamento a 8 meses.
 *
 * emotionalTrigger (0.02) — PROPOSITALMENTE QUASE IRRELEVANTE no número. O
 *   papel dos gatilhos é acionar revisão humana, não inflar score. Peso alto
 *   aqui criaria um incentivo automatizado a caçar tragédia e polêmica, o que
 *   destrói marca e retenção no médio prazo. Ver comentário em scoring-types.ts.
 */
export const WEIGHTS_V1: WeightSet = {
  version: 'v1.0.0-mvp',
  description:
    'Conjunto inicial do MVP (Games + Cinema & Séries). Prioriza velocidade de crescimento sobre volume absoluto. Pesos não calibrados com dados reais ainda.',
  weights: {
    searchVelocity: 0.26,
    socialMomentum: 0.16,
    sourceAuthority: 0.12,
    searchVolume: 0.1,
    platformTrending: 0.1,
    serpOpportunity: 0.09,
    audienceAffinity: 0.08,
    releaseProximity: 0.07,
    emotionalTrigger: 0.02,
  },
  halfLifeHours: 12,
  minConfidenceForAutomation: 0.55,
};

/**
 * PESOS DO SCORE DE SEO (cauda longa) — objetivo oposto ao de urgência.
 *
 * Aqui a lógica se inverte de propósito:
 *  - `serpOpportunity` domina (0.40): baixa concorrência é O fator que decide
 *    se conseguimos rankear.
 *  - `searchVolume` importa mais que velocidade: para conteúdo evergreen, o que
 *    interessa é demanda estável e recorrente, não um pico que morre em 6h.
 *  - `searchVelocity` pesa pouco (0.05): um pico de hoje não sustenta tráfego
 *    de daqui a 6 meses.
 *  - `audienceAffinity` pesa alto: se nossa base ama a franquia, o conteúdo
 *    evergreen dela converte em newsletter e retorno.
 */
export const SEO_WEIGHTS_V1: Record<SignalDimension, number> = {
  serpOpportunity: 0.4,
  searchVolume: 0.22,
  audienceAffinity: 0.15,
  releaseProximity: 0.1,
  socialMomentum: 0.05,
  searchVelocity: 0.05,
  sourceAuthority: 0.02,
  platformTrending: 0.01,
  emotionalTrigger: 0.0,
};

/** Registro de conjuntos disponíveis, para shadow scoring e rollback rápido. */
export const WEIGHT_SETS: Record<string, WeightSet> = {
  [WEIGHTS_V1.version]: WEIGHTS_V1,
};

export const DEFAULT_WEIGHTS = WEIGHTS_V1;

/**
 * Valida um conjunto de pesos. Chamado no boot e ao aplicar pesos vindos do
 * painel administrativo.
 *
 * SEGURANÇA: se os pesos passarem a ser editáveis pela UI (planejado para a
 * Fase 3), este payload vira entrada não confiável. Sem validação, um peso
 * negativo ou NaN poderia inverter a lógica do sistema — e um NaN se propaga
 * silenciosamente até a home inteira ficar com score "NaN". Falhar aqui, alto e
 * cedo, é muito mais barato.
 */
export function validateWeightSet(set: WeightSet): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const values = Object.values(set.weights);

  if (values.some((w) => !Number.isFinite(w))) {
    errors.push('Todos os pesos devem ser números finitos (NaN/Infinity não são aceitos).');
  }
  if (values.some((w) => w < 0)) {
    errors.push('Pesos negativos não são permitidos: inverteriam o sentido do sinal.');
  }

  const sum = values.reduce((a, b) => a + b, 0);
  // Tolerância para erro de ponto flutuante (0.1 + 0.2 !== 0.3 em IEEE 754).
  if (Math.abs(sum - 1) > 0.001) {
    errors.push(`A soma dos pesos deve ser 1.0 (atual: ${sum.toFixed(4)}).`);
  }
  if (set.halfLifeHours <= 0) {
    errors.push('halfLifeHours deve ser positivo.');
  }
  if (set.minConfidenceForAutomation < 0 || set.minConfidenceForAutomation > 1) {
    errors.push('minConfidenceForAutomation deve estar entre 0 e 1.');
  }

  return { valid: errors.length === 0, errors };
}
