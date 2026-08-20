/**
 * =============================================================================
 * TESTES — enquadramento da capa
 * =============================================================================
 *
 * `toCoverImageFit` é lido numa fronteira hostil (o formulário do painel) e
 * numa desconfiada (a coluna do banco, que nasce com `@default("cover")` mas
 * pode um dia receber lixo por uma migração malfeita). Cair em qualquer outro
 * modo que não 'cover' para um valor desconhecido mudaria a APARÊNCIA de
 * matérias já publicadas sem ninguém ter pedido — o efeito colateral que este
 * campo existe para evitar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COVER_IMAGE_FITS,
  COVER_IMAGE_FIT_LABELS,
  isCoverImageFit,
  isValidFocalCoordinate,
  toCoverImageFit,
} from './cover-image';

test("qualquer valor fora do vocabulário cai em 'cover'", () => {
  for (const valor of [undefined, null, '', 'crop', 'CONTAIN', 0, true, {}, []]) {
    assert.equal(toCoverImageFit(valor), 'cover');
  }
});

test("'contain' e 'focal' são reconhecidos e têm rótulo próprio", () => {
  assert.equal(toCoverImageFit('contain'), 'contain');
  assert.equal(toCoverImageFit('focal'), 'focal');

  for (const modo of COVER_IMAGE_FITS) {
    assert.equal(typeof COVER_IMAGE_FIT_LABELS[modo], 'string');
    assert.ok(COVER_IMAGE_FIT_LABELS[modo].length > 0);
    assert.ok(isCoverImageFit(modo));
  }

  assert.equal(isCoverImageFit('crop'), false);
});

test('coordenada focal válida é um número entre 0 e 100, inclusive', () => {
  for (const valor of [0, 50, 100, 12.5]) {
    assert.equal(isValidFocalCoordinate(valor), true);
  }

  for (const valor of [-1, 100.1, NaN, Infinity, '50', null, undefined]) {
    assert.equal(isValidFocalCoordinate(valor), false);
  }
});
