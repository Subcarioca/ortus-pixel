/**
 * =============================================================================
 * TESTES — origem do corpo da matéria
 * =============================================================================
 *
 * Duas afirmações, e as duas são sobre a MESMA decisão: para que lado o valor
 * desconhecido cai.
 *
 * Parece pequeno demais para merecer teste, e não é. `toContentOrigin` é lido em
 * uma fronteira hostil (o corpo JSON que o navegador manda) e em outra
 * desconfiada (a coluna do banco, que tem linhas anteriores à existência dela).
 * Inverter o padrão — cair em 'ai-assisted' — não quebraria nada visivelmente:
 * apenas passaria a marcar como automática toda matéria antiga e todo payload
 * malformado, colocando uma etiqueta de suspeita sobre trabalho humano. É o tipo
 * de erro que só é notado quando alguém pergunta "por que essa matéria de 2025
 * está marcada como IA?", meses depois.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTENT_ORIGIN_LABELS, CONTENT_ORIGINS, toContentOrigin } from './content-origin';

test("qualquer valor que não seja exatamente 'ai-assisted' cai em 'human'", () => {
  // O caminho que importa: linha antiga (coluna nula), payload sem o campo,
  // valor forjado, e a variação de grafia que alguém tentaria um dia.
  for (const valor of [undefined, null, '', 'humano', 'AI-ASSISTED', 'ia', 0, true, {}, []]) {
    assert.equal(toContentOrigin(valor), 'human');
  }
});

test("'ai-assisted' é reconhecido e tem rótulo próprio", () => {
  assert.equal(toContentOrigin('ai-assisted'), 'ai-assisted');

  // Todo valor do vocabulário precisa de rótulo: um `CONTENT_ORIGINS` que cresça
  // sem o rótulo correspondente aparece na tela como um `undefined`.
  for (const origem of CONTENT_ORIGINS) {
    assert.equal(typeof CONTENT_ORIGIN_LABELS[origem], 'string');
    assert.ok(CONTENT_ORIGIN_LABELS[origem].length > 0);
  }
});
