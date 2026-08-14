/**
 * =============================================================================
 * TESTES — destaque proporcional da imagem
 * =============================================================================
 *
 * A regra testada aqui é curta o bastante para parecer dispensável de testar. O
 * que justifica os testes não é a complexidade: é que ela codifica uma PROMESSA
 * feita a quem pediu a funcionalidade ("a imagem nunca fica menor que o texto"),
 * e promessa sem teste é promessa que a próxima refatoração quebra em silêncio.
 *
 * O teste do PISO, em particular, é o que impede alguém de, no futuro,
 * acrescentar uma largura 'pequena' ao vocabulário e usá-la aqui achando que
 * "com 5 imagens, menorzinhas fica melhor".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countImageBlocks,
  suggestedImageWidth,
  withSuggestedImageWidths,
  type ArticleBlock,
} from './blocks';

function imagem(id: string): ArticleBlock {
  return { id, type: 'imagem', url: 'https://x/y.jpg', alt: 'a', decorativa: false, largura: 'medida' };
}

function paragrafo(id: string): ArticleBlock {
  return { id, type: 'paragrafo', texto: 'texto' };
}

test('imagem única recebe o destaque máximo', () => {
  assert.equal(suggestedImageWidth(1), 'borda-a-borda');
});

test('duas imagens respiram, mas não competem', () => {
  assert.equal(suggestedImageWidth(2), 'larga');
});

test('três ou mais imagens acompanham a coluna de texto', () => {
  assert.equal(suggestedImageWidth(3), 'medida');
  assert.equal(suggestedImageWidth(12), 'medida');
});

test('A PROMESSA: nenhuma quantidade produz imagem mais estreita que o texto', () => {
  // 'medida' É a largura da coluna de texto. Se algum dia esta função devolver
  // qualquer coisa fora deste conjunto, foi porque alguém acrescentou uma
  // largura menor — e é exatamente isso que este teste existe para barrar.
  const permitidas = new Set(['medida', 'larga', 'borda-a-borda']);
  for (let count = 0; count <= 50; count += 1) {
    assert.ok(permitidas.has(suggestedImageWidth(count)));
  }
});

test('zero imagens não quebra (a função é chamada a cada remoção de bloco)', () => {
  assert.equal(suggestedImageWidth(0), 'borda-a-borda');
  assert.deepEqual(withSuggestedImageWidths([]), []);
});

test('a aplicação ajusta só as imagens e preserva o resto', () => {
  const blocos = [paragrafo('p1'), imagem('i1'), paragrafo('p2')];
  const resultado = withSuggestedImageWidths(blocos);

  assert.equal(countImageBlocks(resultado), 1);
  assert.equal(resultado[1]?.type === 'imagem' && resultado[1].largura, 'borda-a-borda');
  // O parágrafo atravessa intacto — inclusive na identidade do objeto não
  // importar: o que importa é o conteúdo não ter sido tocado.
  assert.deepEqual(resultado[0], paragrafo('p1'));
});

test('a função é pura: o array recebido não é mutado', () => {
  // Se ela mutasse, o `setState` do React receberia a MESMA referência e a tela
  // não redesenharia — o bug clássico, e um dos mais difíceis de diagnosticar
  // porque o dado está certo e só a tela está velha.
  const original = [imagem('i1')];
  const copia = structuredClone(original);

  withSuggestedImageWidths(original);

  assert.deepEqual(original, copia);
});

test('com três imagens, TODAS descem juntas (não só a nova)', () => {
  // O erro fácil aqui seria ajustar apenas o bloco recém-inserido, deixando a
  // primeira imagem 'borda-a-borda' e as outras 'medida' — uma matéria com uma
  // imagem gigante e duas pequenas, que é justamente o que a regra evita.
  const resultado = withSuggestedImageWidths([imagem('i1'), imagem('i2'), imagem('i3')]);

  for (const bloco of resultado) {
    assert.equal(bloco.type === 'imagem' && bloco.largura, 'medida');
  }
});
