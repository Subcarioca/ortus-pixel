/**
 * =============================================================================
 * TESTES — ordenação da fila de pautas pelo score EFETIVO
 * =============================================================================
 *
 * Estes testes existem por causa de um bug concreto, e o mais importante deles é
 * o segundo: a fila era ordenada pelo score do ALGORITMO enquanto a tela exibia
 * o score com OVERRIDE MANUAL aplicado. Uma pauta que um editor forçou para 95
 * aparecia etiquetada como 95 e listada em último — ou fora da lista, porque o
 * corte de 50 também acontecia antes do override entrar na conta.
 *
 * O bug era invisível em qualquer teste de "a página renderiza": os dados
 * estavam certos, o número na tela estava certo, só a ORDEM estava errada. É
 * exatamente o tipo de regra que só um teste da função de ordenação segura.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  effectiveTopicScore,
  rankTopicQueue,
  TOPIC_QUEUE_SIZE,
} from './topic-queue';

/** Tópico mínimo, com um rótulo para as asserções ficarem legíveis. */
function topico(label: string, currentScore: number, manualScoreOverride: number | null = null) {
  return { label, currentScore, manualScoreOverride };
}

// -----------------------------------------------------------------------------
// SCORE EFETIVO
// -----------------------------------------------------------------------------

test('sem override, o score efetivo é o do algoritmo', () => {
  assert.equal(effectiveTopicScore(topico('a', 42)), 42);
});

test('com override, o humano vence o algoritmo', () => {
  assert.equal(effectiveTopicScore(topico('a', 12, 95)), 95);
});

test('override ZERO é um valor, não uma ausência', () => {
  // A armadilha clássica: com `||` no lugar de `??`, um editor que zera o score
  // para tirar a pauta do topo veria ela voltar com o score do algoritmo.
  assert.equal(effectiveTopicScore(topico('a', 88, 0)), 0);
});

// -----------------------------------------------------------------------------
// ORDENAÇÃO — o bug que motivou o módulo
// -----------------------------------------------------------------------------

test('a fila é ordenada pelo score efetivo, não pelo algorítmico', () => {
  const fila = [
    topico('algoritmo-alto', 80),
    topico('forcado-pelo-editor', 12, 95),
    topico('algoritmo-medio', 50),
  ];

  const ordenada = rankTopicQueue(fila).map((t) => t.label);

  assert.deepEqual(ordenada, ['forcado-pelo-editor', 'algoritmo-alto', 'algoritmo-medio']);
});

test('override para BAIXO também vale: a pauta desce na fila', () => {
  // O override não serve só para promover. Um editor que sabe que uma pauta
  // inflada pelo algoritmo não rende nada precisa que ela realmente saia do topo.
  const fila = [topico('inflada', 99, 5), topico('honesta', 40)];

  assert.deepEqual(rankTopicQueue(fila).map((t) => t.label), ['honesta', 'inflada']);
});

test('o corte acontece DEPOIS da ordenação, nunca antes', () => {
  // Reproduz o corte que o banco fazia: 60 pautas com score algorítmico alto e,
  // no fim da lista, uma com score algorítmico rasteiro e override máximo. Com o
  // `take: 50` no banco, essa última nem chegava à tela.
  const fila = [
    ...Array.from({ length: 60 }, (_, i) => topico(`algoritmica-${i}`, 90 - i * 0.1)),
    topico('resgatada-pelo-override', 1, 100),
  ];

  const ordenada = rankTopicQueue(fila);

  assert.equal(ordenada.length, TOPIC_QUEUE_SIZE);
  assert.equal(ordenada[0]?.label, 'resgatada-pelo-override');
});

test('empate preserva a ordem de chegada (fila determinística)', () => {
  // `sort` estável (ES2019+). Sem isso, duas cargas seguidas da mesma tela
  // poderiam mostrar a fila em ordens diferentes, sem nada ter mudado no banco —
  // e a redação passaria a desconfiar do painel por um motivo invisível.
  const fila = [topico('primeiro', 70), topico('segundo', 70), topico('terceiro', 70, 70)];

  assert.deepEqual(
    rankTopicQueue(fila).map((t) => t.label),
    ['primeiro', 'segundo', 'terceiro'],
  );
});

test('a lista original não é modificada', () => {
  const fila = [topico('a', 10), topico('b', 90)];
  const antes = fila.map((t) => t.label);

  rankTopicQueue(fila);

  assert.deepEqual(fila.map((t) => t.label), antes);
});

test('fila vazia devolve lista vazia, sem estourar', () => {
  assert.deepEqual(rankTopicQueue([]), []);
});
