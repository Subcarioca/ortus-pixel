/**
 * =============================================================================
 * TESTE DE ARQUITETURA — o firewall entre popularidade e dinheiro
 * =============================================================================
 *
 * Este arquivo não testa comportamento; testa uma RESTRIÇÃO ESTRUTURAL:
 *
 *   O algoritmo de popularidade nunca pode ser influenciado por sinais de
 *   monetização (RPM previsto, `affiliateWeight`, densidade de anúncio,
 *   comissão de loja).
 *
 * É decisão de produto fechada pelo dono do site, e a única forma de uma
 * decisão dessas sobreviver a dois anos de manutenção é sendo EXECUTÁVEL. Um
 * comentário dizendo "não faça isso" perde para o pull request de sexta-feira
 * às 18h que "só adiciona um peso de afiliado para testar". Um teste vermelho,
 * não.
 *
 * COMO ELE FUNCIONA: varre o código-fonte de `packages/scoring` procurando
 * vocabulário de monetização. Um teste que lê arquivo é incomum e, aqui,
 * proposital — o objeto sob teste é a *fronteira do módulo*, não uma função.
 *
 * SE ESTE TESTE FALHAR, a correção NÃO é adicionar uma exceção à lista. É mover
 * o código de monetização para fora do motor. O lugar dele é:
 *   - regra de negócio de oferta  -> packages/core/src/monetization.ts
 *   - política de anúncio na UI   -> apps/web/src/lib/ads.ts
 */

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { SIGNAL_DIMENSIONS } from '@canalnerd/core';
import { WEIGHTS_V1 } from './weights.ts';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Vocabulário proibido dentro do motor.
 *
 * A lista é de RADICAIS em minúsculo, comparados contra o código em minúsculo,
 * para pegar variações (`affiliateWeight`, `AFFILIATE_WEIGHT`, `adsense`...).
 */
const FORBIDDEN_TERMS = [
  'affiliate',
  'afiliado',
  'adsense',
  'adslot',
  'monetiz',
  'sponsored',
  'patrocin',
  'revenue',
  'receita',
  'rpm',
  'ecpm',
  'cpc',
  'comissao',
  'comissão',
];

/** Lê todos os `.ts` de `packages/scoring/src`, exceto os próprios testes. */
function readEngineSources(): { file: string; content: string }[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({
      file: name,
      content: readFileSync(join(SRC_DIR, name), 'utf8'),
    }));
}

/**
 * Procura um termo proibido como PALAVRA, não como pedaço de palavra.
 *
 * Esta função existe por causa de um falso positivo real, encontrado na
 * primeira execução do teste: `serpMeasurements` contém a sequência "rpm"
 * (se-RPM-easurements). Um teste de arquitetura que acusa código inocente é
 * pior do que teste nenhum — ele vira ruído, e ruído se desativa.
 *
 * A solução tem duas partes:
 *   1. Quebrar camelCase em palavras ANTES de comparar, para que
 *      `predictedRpm` vire "predicted rpm" e continue sendo pego.
 *   2. Exigir fronteira de palavra (`\b`), para que "serpmeasurements" não seja.
 */
function mentionsTerm(content: string, term: string): boolean {
  const words = content
    // camelCase / PascalCase -> "camel Case"
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();

  return new RegExp(`\\b${term}`, 'u').test(words);
}

describe('firewall de monetização', () => {
  it('nenhum arquivo do motor de score menciona vocabulário de monetização', () => {
    const violations: string[] = [];

    for (const { file, content } of readEngineSources()) {
      for (const term of FORBIDDEN_TERMS) {
        if (mentionsTerm(content, term)) {
          violations.push(`${file} contém "${term}"`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      'O motor de score não pode conhecer monetização. Mova este código para ' +
        'core/monetization.ts (regra de negócio) ou apps/web/src/lib/ads.ts (UI).\n' +
        violations.join('\n'),
    );
  });

  it('os pesos cobrem exatamente as dimensões de sinal — nada além delas', () => {
    // Se alguém acrescentar uma "dimensão" de receita ao WeightSet, ela
    // aparecerá aqui como diferença de conjunto. É a mesma proteção do teste
    // acima, porém no nível do CONTRATO de dados, e não do texto do arquivo.
    const weightKeys = Object.keys(WEIGHTS_V1.weights).sort();
    const dimensions = [...SIGNAL_DIMENSIONS].sort();

    assert.deepEqual(weightKeys, dimensions);
  });

  it('nenhuma dimensão de sinal tem nome de origem comercial', () => {
    for (const dimension of SIGNAL_DIMENSIONS) {
      for (const term of FORBIDDEN_TERMS) {
        assert.equal(
          mentionsTerm(dimension, term),
          false,
          `A dimensão "${dimension}" tem vocabulário de monetização.`,
        );
      }
    }
  });
});
