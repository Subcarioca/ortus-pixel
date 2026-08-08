/**
 * Testes do motor de score.
 *
 * Rodam com o test runner nativo do Node (sem Jest/Vitest): o motor é uma
 * função pura, então não precisamos de mocks, transformadores nem ambiente de
 * DOM. Menos dependências = menos manutenção e CI mais rápido.
 *
 *   node --experimental-strip-types --test packages/scoring/src/engine.test.ts
 *
 * Os casos abaixo não testam "o código roda"; testam as PROPRIEDADES de que o
 * produto depende. Cada um corresponde a um requisito do briefing.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { SignalDimension, SignalMeasurement } from '@subcarioca/core';
import { calculateScore, isEligibleForAutomation } from './engine.ts';
import { validateWeightSet, WEIGHTS_V1 } from './weights.ts';

const NOW = new Date('2026-08-05T12:00:00Z');

/** Helper para montar medições sem repetir boilerplate. */
function measure(
  dimension: SignalDimension,
  value: number,
  confidence = 1,
  connectorId = 'test',
): SignalMeasurement {
  return { dimension, connectorId, value, confidence, observedAt: NOW };
}

/** Conjunto completo de sinais no mesmo nível — útil como linha de base. */
function allDimensionsAt(value: number): SignalMeasurement[] {
  return (
    [
      'searchVolume',
      'searchVelocity',
      'socialMomentum',
      'platformTrending',
      'sourceAuthority',
      'releaseProximity',
      'serpOpportunity',
      'audienceAffinity',
      'emotionalTrigger',
    ] as SignalDimension[]
  ).map((d) => measure(d, value));
}

describe('configuração de pesos', () => {
  it('o conjunto padrão é válido (soma 1.0, sem negativos)', () => {
    const result = validateWeightSet(WEIGHTS_V1);
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('rejeita pesos que não somam 1.0', () => {
    const broken = { ...WEIGHTS_V1, weights: { ...WEIGHTS_V1.weights, searchVelocity: 0.9 } };
    assert.equal(validateWeightSet(broken).valid, false);
  });

  it('rejeita NaN, que envenenaria o score silenciosamente', () => {
    const broken = { ...WEIGHTS_V1, weights: { ...WEIGHTS_V1.weights, searchVolume: NaN } };
    assert.equal(validateWeightSet(broken).valid, false);
  });
});

describe('cálculo de score', () => {
  it('sinais no máximo produzem score próximo de 100', () => {
    const result = calculateScore({
      measurements: allDimensionsAt(1),
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.ok(result.score >= 99, `esperado >= 99, obtido ${result.score}`);
    assert.equal(result.band, 'HOT');
  });

  it('ausência de sinais produz score 0 e faixa EVERGREEN', () => {
    const result = calculateScore({ measurements: [], firstSeenAt: NOW, now: NOW });
    assert.equal(result.score, 0);
    assert.equal(result.band, 'EVERGREEN');
    assert.equal(result.confidence, 0);
  });

  it('nunca devolve NaN, mesmo com medições corrompidas', () => {
    // Regressão: um NaN vindo de conector já causou "score NaN" na home.
    const result = calculateScore({
      measurements: [
        measure('searchVelocity', NaN),
        measure('searchVolume', Infinity),
        measure('socialMomentum', 0.5),
      ],
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.ok(Number.isFinite(result.score));
    assert.ok(Number.isFinite(result.confidence));
  });

  it('VELOCIDADE pesa mais que VOLUME (requisito central do briefing)', () => {
    const highVelocity = calculateScore({
      measurements: [measure('searchVelocity', 1), measure('searchVolume', 0)],
      firstSeenAt: NOW,
      now: NOW,
    });
    const highVolume = calculateScore({
      measurements: [measure('searchVelocity', 0), measure('searchVolume', 1)],
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.ok(
      highVelocity.score > highVolume.score,
      `velocidade (${highVelocity.score}) deveria superar volume (${highVolume.score})`,
    );
  });
});

describe('resiliência a fontes indisponíveis', () => {
  it('RENORMALIZA os pesos: perder um conector não derruba o score na marra', () => {
    // Esta é A propriedade mais importante do sistema. Um tópico com todos os
    // sinais em 0.8 deve pontuar praticamente igual quando metade das fontes
    // some — porque a MÉDIA dos sinais disponíveis continua 0.8. O preço da
    // informação faltante é pago na confiança, não no score.
    const complete = calculateScore({
      measurements: allDimensionsAt(0.8),
      firstSeenAt: NOW,
      now: NOW,
    });
    const degraded = calculateScore({
      measurements: [
        measure('searchVelocity', 0.8),
        measure('socialMomentum', 0.8),
        measure('sourceAuthority', 0.8),
      ],
      firstSeenAt: NOW,
      now: NOW,
    });

    assert.ok(
      Math.abs(complete.score - degraded.score) < 2,
      `scores deveriam ser equivalentes: completo=${complete.score}, degradado=${degraded.score}`,
    );
    // Mas a confiança precisa cair, senão estaríamos mentindo sobre a qualidade.
    assert.ok(
      degraded.confidence < complete.confidence,
      'confiança deveria cair quando faltam sinais',
    );
  });

  it('marca as dimensões ausentes como indisponíveis para o painel', () => {
    const result = calculateScore({
      measurements: [measure('searchVelocity', 0.9)],
      firstSeenAt: NOW,
      now: NOW,
    });
    const unavailable = result.contributions.filter((c) => !c.available);
    assert.equal(unavailable.length, 8);
    assert.match(result.summary, /indisponível/);
  });

  it('confiança baixa do conector reduz a confiança geral', () => {
    const confident = calculateScore({
      measurements: allDimensionsAt(0.7),
      firstSeenAt: NOW,
      now: NOW,
    });
    const unsure = calculateScore({
      measurements: allDimensionsAt(0.7).map((m) => ({ ...m, confidence: 0.3 })),
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.ok(unsure.confidence < confident.confidence);
  });
});

describe('decaimento temporal', () => {
  it('tópico antigo pontua menos que tópico novo com os mesmos sinais', () => {
    const fresh = calculateScore({
      measurements: allDimensionsAt(0.9),
      firstSeenAt: NOW,
      now: NOW,
    });
    const old = calculateScore({
      measurements: allDimensionsAt(0.9),
      firstSeenAt: new Date(NOW.getTime() - 48 * 3_600_000),
      now: NOW,
    });
    assert.ok(old.score < fresh.score);
    // ...mas o piso de 0.35 impede que um tópico forte desapareça por completo.
    assert.ok(old.score > fresh.score * 0.3, 'o piso de decaimento deve preservar a hierarquia');
  });
});

describe('elegibilidade para automação (push / hero)', () => {
  it('score alto + confiança boa + sem gatilho sensível = elegível', () => {
    const result = calculateScore({
      measurements: allDimensionsAt(0.95),
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.equal(isEligibleForAutomation(result).eligible, true);
  });

  it('BLOQUEIA push quando há vazamento — risco editorial e jurídico', () => {
    const result = calculateScore({
      measurements: allDimensionsAt(0.95),
      firstSeenAt: NOW,
      now: NOW,
      emotionalTriggers: ['leak'],
    });
    const eligibility = isEligibleForAutomation(result);
    assert.equal(eligibility.eligible, false);
    assert.match(eligibility.reason, /aprovação humana/);
  });

  it('BLOQUEIA push quando a confiança está abaixo do mínimo', () => {
    // Score alto vindo de um único conector: parece 90, mas é um palpite.
    const result = calculateScore({
      measurements: [measure('searchVelocity', 1, 0.4)],
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.equal(isEligibleForAutomation(result).eligible, false);
  });
});

describe('classificação cabeça vs. cauda longa', () => {
  it('volume alto + concorrência alta = cabeça', () => {
    const result = calculateScore({
      measurements: [measure('searchVolume', 0.9), measure('serpOpportunity', 0.1)],
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.equal(result.termType, 'head');
  });

  it('volume baixo + concorrência baixa = cauda longa com bom score de SEO', () => {
    const result = calculateScore({
      measurements: [measure('searchVolume', 0.2), measure('serpOpportunity', 0.95)],
      firstSeenAt: NOW,
      now: NOW,
    });
    assert.equal(result.termType, 'long-tail');
    // O ponto central da separação em dois scores: urgência baixa, pauta boa.
    assert.ok(
      result.seoOpportunity > result.score,
      `SEO (${result.seoOpportunity}) deveria superar urgência (${result.score})`,
    );
  });
});
