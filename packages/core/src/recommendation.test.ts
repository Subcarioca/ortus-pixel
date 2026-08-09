/**
 * Testes da pontuação de relacionadas.
 *
 * O que vale a pena travar aqui NÃO é "a função devolve um número". São as
 * PROPRIEDADES do ranking — as afirmações de produto que alguém pode quebrar
 * sem perceber ao ajustar um peso:
 *
 *   - franquia vence categoria (a hierarquia dos pesos);
 *   - recência desempata, mas não inverte tema;
 *   - conteúdo antigo continua elegível (o piso de recência);
 *   - artigo sem nenhuma relação não entra.
 *
 * Se um dia alguém trocar `franchise: 3.0` por `0.3` para "testar", estes
 * testes falham imediatamente — em vez de o site passar semanas recomendando
 * qualquer coisa da mesma editoria.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MAX_COUNTED_FRANCHISES,
  RECENCY_FLOOR,
  RECENCY_HALF_LIFE_DAYS,
  RECOMMENDATION_WEIGHTS,
  rankRecommendations,
  recencyFactor,
  scoreRecommendation,
  thematicAffinity,
  type RecommendationSubject,
} from './recommendation.ts';

const NOW = new Date('2026-08-09T12:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

/** Base de artigo; cada teste sobrescreve só o que está exercitando. */
function subject(overrides: Partial<RecommendationSubject> = {}): RecommendationSubject {
  return {
    id: 'base',
    franchiseSlugs: [],
    categoryKey: 'cat-games',
    subcategoryKey: null,
    publishedAt: daysAgo(0),
    ...overrides,
  };
}

describe('afinidade temática', () => {
  it('franquia em comum vale mais que mesma editoria', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'], categoryKey: 'cat-games' });

    const mesmaFranquiaOutraEditoria = subject({
      id: 'a',
      franchiseSlugs: ['zelda'],
      categoryKey: 'cat-cinema',
    });
    const mesmaEditoriaSemFranquia = subject({
      id: 'b',
      franchiseSlugs: ['mario'],
      categoryKey: 'cat-games',
    });

    assert.ok(
      thematicAffinity(seed, mesmaFranquiaOutraEditoria) >
        thematicAffinity(seed, mesmaEditoriaSemFranquia),
      'Uma franquia em comum precisa pesar mais que dividir a editoria.',
    );
  });

  it('sub-categoria pesa mais que categoria, e só conta quando ambas existem', () => {
    const seed = subject({ id: 'seed', categoryKey: 'cat-tech', subcategoryKey: 'sub-hardware' });

    const mesmaSub = subject({ id: 'a', categoryKey: 'cat-tech', subcategoryKey: 'sub-hardware' });
    const soMesmaCategoria = subject({ id: 'b', categoryKey: 'cat-tech', subcategoryKey: null });

    assert.equal(
      thematicAffinity(seed, mesmaSub),
      RECOMMENDATION_WEIGHTS.subcategory + RECOMMENDATION_WEIGHTS.category,
    );
    assert.equal(thematicAffinity(seed, soMesmaCategoria), RECOMMENDATION_WEIGHTS.category);
  });

  it('dois artigos SEM sub-categoria não "combinam" por serem ambos nulos', () => {
    // Este é o bug clássico da comparação ingênua `a === b` com nulos: a maior
    // parte do acervo não tem sub-categoria, e todo mundo passaria a ganhar o
    // bônus de "mesma sub-categoria" contra todo mundo.
    const seed = subject({ id: 'seed', categoryKey: 'cat-games', subcategoryKey: null });
    const outro = subject({ id: 'a', categoryKey: 'cat-cinema', subcategoryKey: null });

    assert.equal(thematicAffinity(seed, outro), 0);
  });

  it('crossover com muitas franquias não acumula sem limite', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['a', 'b', 'c', 'd'], categoryKey: 'x' });
    const crossover = subject({
      id: 'cross',
      franchiseSlugs: ['a', 'b', 'c', 'd'],
      categoryKey: 'y',
    });

    assert.equal(
      thematicAffinity(seed, crossover),
      MAX_COUNTED_FRANCHISES * RECOMMENDATION_WEIGHTS.franchise,
    );
  });
});

describe('fator de recência', () => {
  it('artigo recém-publicado não sofre desconto', () => {
    assert.equal(recencyFactor(daysAgo(0), NOW), 1);
  });

  it('nunca zera: o piso mantém o evergreen elegível', () => {
    const antigo = recencyFactor(daysAgo(3650), NOW);
    assert.ok(antigo >= RECENCY_FLOOR, 'O fator não pode cair abaixo do piso.');
    assert.ok(antigo > 0, 'Conteúdo antigo não pode ser eliminado por idade.');
  });

  it('data no futuro não vira bônus', () => {
    const agendado = new Date(NOW.getTime() + 5 * 86_400_000);
    assert.equal(recencyFactor(agendado, NOW), 1);
  });
});

describe('ranking', () => {
  it('recência desempata entre candidatos de mesma afinidade', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'] });
    const antigo = subject({ id: 'antigo', franchiseSlugs: ['zelda'], publishedAt: daysAgo(60) });
    const novo = subject({ id: 'novo', franchiseSlugs: ['zelda'], publishedAt: daysAgo(1) });

    const ranked = rankRecommendations(seed, [antigo, novo], NOW, 4);
    assert.equal(ranked[0]?.item.id, 'novo');
  });

  it('recência NÃO inverte tema: franquia antiga vence editoria fresca', () => {
    // A afirmação de produto mais importante do arquivo. Se o desconto por
    // idade ficasse forte demais, as relacionadas voltariam a ser "o que saiu
    // ontem" — exatamente o comportamento que esta função existe para corrigir.
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'], categoryKey: 'cat-games' });

    const franquiaAntiga = subject({
      id: 'franquia-antiga',
      franchiseSlugs: ['zelda'],
      categoryKey: 'cat-cinema',
      publishedAt: daysAgo(120),
    });
    const editoriaHoje = subject({
      id: 'editoria-hoje',
      franchiseSlugs: ['outra'],
      categoryKey: 'cat-games',
      publishedAt: daysAgo(0),
    });

    const ranked = rankRecommendations(seed, [editoriaHoje, franquiaAntiga], NOW, 4);
    assert.equal(ranked[0]?.item.id, 'franquia-antiga');
  });

  it('descarta quem não tem relação nenhuma e remove o próprio artigo', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'], categoryKey: 'cat-games' });
    const semRelacao = subject({ id: 'nada', franchiseSlugs: ['x'], categoryKey: 'cat-tech' });

    const ranked = rankRecommendations(seed, [seed as never, semRelacao], NOW, 4);
    assert.deepEqual(ranked, []);
  });

  it('respeita o limite pedido', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'] });
    const candidatos = Array.from({ length: 10 }, (_, i) =>
      subject({ id: `c${i}`, franchiseSlugs: ['zelda'], publishedAt: daysAgo(i) }),
    );

    assert.equal(rankRecommendations(seed, candidatos, NOW, 4).length, 4);
  });
});

describe('pontuação combinada', () => {
  it('é a afinidade multiplicada pelo fator de recência', () => {
    const seed = subject({ id: 'seed', franchiseSlugs: ['zelda'], categoryKey: 'cat-games' });
    const candidato = subject({
      id: 'c',
      franchiseSlugs: ['zelda'],
      categoryKey: 'cat-games',
      publishedAt: daysAgo(RECENCY_HALF_LIFE_DAYS),
    });

    const esperado =
      thematicAffinity(seed, candidato) * recencyFactor(candidato.publishedAt, NOW);

    assert.equal(scoreRecommendation(seed, candidato, NOW), esperado);
  });
});
