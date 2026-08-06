/**
 * =============================================================================
 * CONECTOR: GATILHOS EMOCIONAIS (interno, custo zero)
 * =============================================================================
 *
 * Item 10 do briefing: classificar morte de personagem, cancelamento, polêmica,
 * nostalgia, vazamento e exclusividade.
 *
 * POSICIONAMENTO ÉTICO E DE PRODUTO — vale ler antes do código:
 *
 * Este conector poderia facilmente virar uma máquina de caça-clique. Bastaria
 * dar peso alto a "polêmica" e "morte" para o algoritmo passar a promover
 * tragédia e briga o dia inteiro. Funcionaria em cliques no curto prazo e
 * destruiria a marca no médio.
 *
 * As decisões que evitam isso:
 *   1. O peso da dimensão no score é 0.02 — quase nada.
 *   2. O papel principal é MARCAR PARA REVISÃO HUMANA, não pontuar.
 *   3. Gatilhos sensíveis (vazamento, polêmica, morte, cancelamento) BLOQUEIAM
 *      automações: nada de push automático nesses casos (ver engine.ts).
 *
 * O resultado é um sistema que avisa a redação "olha, isso aqui é delicado e
 * está crescendo" em vez de publicar sozinho e pedir desculpas depois.
 *
 * IMPLEMENTAÇÃO: casamento por palavras-chave, deliberadamente simples.
 * Um classificador por LLM seria mais preciso, mas custaria por tópico, teria
 * latência e traria não determinismo num ponto do sistema onde previsibilidade
 * vale mais que sofisticação. A migração está prevista na Fase 3, quando
 * houver dados rotulados para medir se o ganho compensa.
 */

import type { EmotionalTrigger, SignalConnector, SignalContext, SignalMeasurement } from '@canalnerd/core';

/**
 * Padrões por gatilho, em português e inglês (as fontes primárias costumam ser
 * internacionais).
 *
 * `weight` = quão intenso é o gatilho quando presente.
 */
const TRIGGER_PATTERNS: Record<EmotionalTrigger, { patterns: RegExp[]; weight: number }> = {
  'character-death': {
    patterns: [
      /\b(morre|morte|morreu|matou|assassinad[oa])\b/i,
      /\b(dies|death|killed|dead)\b/i,
      /\bfim d[eoa] .{0,20}(personagem|arco)\b/i,
    ],
    weight: 0.9,
  },
  'cast-departure': {
    patterns: [
      /\b(deixa|sai d[oae]|abandona|substituíd[oa]|demitid[oa])\b.{0,30}\b(elenco|série|franquia|papel)\b/i,
      /\b(exits?|leaving|quits?|replaced|steps down)\b/i,
      /\bnovo (ator|atriz|intérprete)\b/i,
    ],
    weight: 0.8,
  },
  cancellation: {
    patterns: [
      /\b(cancelad[oa]|cancelamento|encerrad[oa]|não terá (continuação|segunda temporada))\b/i,
      /\b(cancell?ed|cancellation|axed|shelved|scrapped)\b/i,
    ],
    weight: 0.85,
  },
  controversy: {
    patterns: [
      /\b(polêmica|controvérsia|críticas|revolta|protesto|boicote|acusaç)\b/i,
      /\b(controversy|backlash|outrage|boycott|criticism|accused)\b/i,
      /\breview.?bomb/i,
    ],
    weight: 0.75,
  },
  nostalgia: {
    patterns: [
      /\b(retorno|volta|remake|remaster|reboot|relançamento|aniversário|clássico)\b/i,
      /\b(returns?|remake|remaster|reboot|anniversary|classic|throwback)\b/i,
      /\b\d{1,2} anos d[eo]\b/i,
    ],
    weight: 0.5,
  },
  leak: {
    patterns: [
      /\b(vazou|vazamento|vazad[oa]|leak)\b/i,
      /\b(leaked?|leaks)\b/i,
      /\b(suposto|rumor|boato|não confirmad[oa])\b/i,
    ],
    weight: 0.7,
  },
  exclusive: {
    patterns: [
      /\b(exclusiv[oa]|em primeira mão|furo)\b/i,
      /\b(exclusive|first look|breaking)\b/i,
    ],
    weight: 0.6,
  },
};

/**
 * Detecta gatilhos num texto. Exportado à parte para poder ser usado no
 * momento da descoberta (quando ainda não há `SignalContext` completo) e
 * testado isoladamente.
 */
export function detectTriggers(text: string): { trigger: EmotionalTrigger; weight: number }[] {
  const found: { trigger: EmotionalTrigger; weight: number }[] = [];

  for (const [trigger, config] of Object.entries(TRIGGER_PATTERNS)) {
    if (config.patterns.some((pattern) => pattern.test(text))) {
      found.push({ trigger: trigger as EmotionalTrigger, weight: config.weight });
    }
  }

  return found;
}

/** O orquestrador injeta o texto a analisar (título + resumo). */
export interface TextAwareContext extends SignalContext {
  analysisText?: string;
}

export const emotionalTriggerConnector: SignalConnector = {
  id: 'emotional-triggers',
  displayName: 'Gatilhos emocionais',
  dimensions: ['emotionalTrigger'],
  cost: 'free',
  stage: 'discovery',
  timeoutMs: 500,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const extended = context as TextAwareContext;
    // Sem texto de análise, usamos ao menos a query — melhor que nada.
    const text = extended.analysisText ?? context.query;

    const triggers = detectTriggers(text);

    if (triggers.length === 0) {
      return [
        {
          dimension: 'emotionalTrigger',
          connectorId: this.id,
          value: 0,
          rawValue: 'nenhum',
          explanation: 'Nenhum gatilho emocional detectado',
          confidence: 0.7,
          observedAt: new Date(),
        },
      ];
    }

    // Usamos o gatilho MAIS FORTE, não a soma. Somar faria um texto com cinco
    // gatilhos fracos superar um com "morte de personagem" — o que inverte a
    // intuição editorial. Intensidade emocional não é aditiva.
    const strongest = triggers.reduce((max, t) => (t.weight > max.weight ? t : max));

    return [
      {
        dimension: 'emotionalTrigger',
        connectorId: this.id,
        value: strongest.weight,
        rawValue: triggers.map((t) => t.trigger).join(','),
        explanation: `Gatilho(s): ${triggers.map((t) => t.trigger).join(', ')}`,
        // Confiança moderada: casamento por palavra-chave gera falso positivo
        // (ex.: "morte" no título de um jogo chamado "Death Stranding"). O
        // número reflete essa limitação honestamente, em vez de fingir certeza.
        confidence: 0.65,
        observedAt: new Date(),
      },
    ];
  },
};
