/**
 * =============================================================================
 * TESTES — enquadramento da capa e das imagens do corpo
 * =============================================================================
 *
 * `toCoverImageFit` é lido numa fronteira hostil (o formulário do painel) e
 * numa desconfiada (a coluna do banco, que nasce com `@default("cover")` mas
 * pode um dia receber lixo por uma migração malfeita). Cair em qualquer outro
 * modo que não 'cover' para um valor desconhecido mudaria a APARÊNCIA de
 * matérias já publicadas sem ninguém ter pedido — o efeito colateral que este
 * campo existe para evitar.
 *
 * `parseCoverImageFocus` é a mesma regra usada duas vezes (capa e bloco de
 * imagem) — os testes aqui cobrem as duas fronteiras de uma vez, já que a
 * função não sabe qual delas está chamando.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COVER_IMAGE_FITS,
  COVER_IMAGE_FIT_LABELS,
  isCoverImageFit,
  isValidFocalCoordinate,
  parseCoverImageFocus,
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
});

test('isCoverImageFit recusa lixo', () => {
  for (const valor of [undefined, null, '', 'crop', 42]) {
    assert.equal(isCoverImageFit(valor), false);
  }
});

test('coordenada focal válida é 0-100, número finito', () => {
  assert.ok(isValidFocalCoordinate(0));
  assert.ok(isValidFocalCoordinate(50.5));
  assert.ok(isValidFocalCoordinate(100));
  for (const valor of [-1, 100.1, NaN, Infinity, '50', null, undefined]) {
    assert.equal(isValidFocalCoordinate(valor), false);
  }
});

test("fora de 'focal', as coordenadas viram null mesmo se o cliente mandou algo", () => {
  const cover = parseCoverImageFocus('cover', 30, 70);
  assert.deepEqual(cover, { focalX: null, focalY: null });

  const contain = parseCoverImageFocus('contain', 30, 70);
  assert.deepEqual(contain, { focalX: null, focalY: null });
});

test("em 'focal', coordenadas válidas passam e viram número", () => {
  const result = parseCoverImageFocus('focal', 12.5, 87.5);
  assert.deepEqual(result, { focalX: 12.5, focalY: 87.5 });
});

test("em 'focal', coordenadas ausentes ou fora do range são recusadas", () => {
  for (const [x, y] of [
    [null, null],
    [undefined, undefined],
    [-1, 50],
    [50, 101],
    ['abc', 50],
  ]) {
    const result = parseCoverImageFocus('focal', x, y);
    assert.ok('error' in result, `esperava erro para (${x}, ${y})`);
  }
});

test("em 'focal', string numérica é coagida (formulário HTML manda string)", () => {
  const result = parseCoverImageFocus('focal', '33.3', '66.6');
  assert.deepEqual(result, { focalX: 33.3, focalY: 66.6 });
});
