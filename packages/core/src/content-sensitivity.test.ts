/**
 * =============================================================================
 * TESTES — sensibilidade de conteúdo e a escada que só sobe sozinha
 * =============================================================================
 *
 * O que está sendo protegido aqui não é uma função: é uma REGRA DE NEGÓCIO com
 * consequência financeira. "Conteúdo adulto não exibe anúncio automático" é a
 * diferença entre ter e não ter conta no AdSense, e a única forma de garantir
 * que ela sobreviva às próximas cinquenta alterações do projeto é falhar o build
 * quando alguém a inverter por descuido.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTENT_SENSITIVITY_LEVELS,
  allowsAffiliateLinks,
  allowsAutomaticAds,
  sensitivityNotice,
  sensitivityRank,
  toContentSensitivity,
} from './content-sensitivity';
import { canLowerSensitivity } from './staff';

test('conteúdo adulto NUNCA exibe anúncio automático', () => {
  assert.equal(allowsAutomaticAds('adult'), false);
});

test('tema sensível continua monetizável por anúncio, mas não por afiliado', () => {
  // A distinção inteira entre os dois níveis está nestas duas linhas: se elas
  // devolvessem a mesma coisa, o campo poderia ser um booleano.
  assert.equal(allowsAutomaticAds('sensitive'), true);
  assert.equal(allowsAffiliateLinks('sensitive'), false);
});

test('só conteúdo comum aceita link comercial', () => {
  assert.equal(allowsAffiliateLinks('none'), true);
  assert.equal(allowsAffiliateLinks('adult'), false);
});

test('valor desconhecido vindo do banco vira "none", e não explode', () => {
  assert.equal(toContentSensitivity(undefined), 'none');
  assert.equal(toContentSensitivity(null), 'none');
  assert.equal(toContentSensitivity('ADULT'), 'none');
  assert.equal(toContentSensitivity(42), 'none');
  assert.equal(toContentSensitivity('adult'), 'adult');
});

test('a ordem da escada é a da lista — e a lista é a fonte da verdade', () => {
  assert.deepEqual([...CONTENT_SENSITIVITY_LEVELS], ['none', 'sensitive', 'adult']);
  assert.ok(sensitivityRank('none') < sensitivityRank('sensitive'));
  assert.ok(sensitivityRank('sensitive') < sensitivityRank('adult'));
});

test('só conteúdo comum passa sem aviso ao leitor', () => {
  assert.equal(sensitivityNotice('none'), null);
  assert.ok(sensitivityNotice('sensitive'));
  assert.ok(sensitivityNotice('adult'));
});

// -----------------------------------------------------------------------------
// A ESCADA (permissão) — a parte que um redator poderia usar para escalar
// -----------------------------------------------------------------------------

const redator = { accessLevel: 'redator' as const };
const admin = { accessLevel: 'admin' as const };

test('redator PODE subir a restrição', () => {
  assert.equal(
    canLowerSensitivity(redator, sensitivityRank('none'), sensitivityRank('adult')),
    true,
  );
});

test('redator NÃO pode baixar a restrição', () => {
  assert.equal(
    canLowerSensitivity(redator, sensitivityRank('adult'), sensitivityRank('none')),
    false,
  );
  // Nem um degrau. O caminho 'adult' → 'sensitive' devolve a matéria para as
  // superfícies de anúncio automático, que é exatamente o risco.
  assert.equal(
    canLowerSensitivity(redator, sensitivityRank('adult'), sensitivityRank('sensitive')),
    false,
  );
});

test('redator pode salvar sem mexer no campo (o caso mais comum de todos)', () => {
  // Sem este comportamento, corrigir uma vírgula numa matéria marcada como
  // adulta seria impossível para quem a escreveu.
  assert.equal(
    canLowerSensitivity(redator, sensitivityRank('adult'), sensitivityRank('adult')),
    true,
  );
});

test('administrador baixa a restrição', () => {
  assert.equal(
    canLowerSensitivity(admin, sensitivityRank('adult'), sensitivityRank('none')),
    true,
  );
});
