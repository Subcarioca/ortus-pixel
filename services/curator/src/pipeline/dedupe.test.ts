/**
 * Testes de deduplicação.
 *
 * Esta é a lógica mais sutil do pipeline: errar para um lado enche a home de
 * repetição; errar para o outro faz notícias desaparecerem silenciosamente.
 * Os casos abaixo travam o comportamento nas duas direções.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  canonicalHash,
  findDuplicate,
  jaccardSimilarity,
  normalizeTitle,
  significantTokens,
  stem,
} from './dedupe.ts';

describe('normalização de título', () => {
  it('remove acentos, pontuação e caixa', () => {
    assert.equal(normalizeTitle('Ação & Ficção: O Retorno!'), 'acao ficcao o retorno');
  });

  it('colapsa espaços múltiplos', () => {
    assert.equal(normalizeTitle('GTA    VI   adiado'), 'gta vi adiado');
  });
});

describe('tokens significativos', () => {
  it('descarta stopwords e palavras curtas', () => {
    const tokens = significantTokens('A Rockstar adia o GTA VI para novembro');
    // As asserções usam `stem()` em vez de literais porque os tokens são
    // RADICAIS, não palavras. Escrever "rockst" na mão aqui deixaria o teste
    // acoplado ao detalhe interno do stemmer — bastaria ajustar um sufixo para
    // quebrar um teste que não deveria se importar com isso.
    assert.ok(tokens.has(stem('rockstar')));
    assert.ok(tokens.has(stem('adia')));
    assert.ok(tokens.has(stem('novembro')));
    // "a", "o" e "para" são stopwords; "vi" tem 2 letras.
    assert.ok(!tokens.has('a'));
    assert.ok(!tokens.has('para'));
    assert.ok(!tokens.has('vi'));
  });

  it('reduz variações morfológicas ao mesmo radical', () => {
    // A propriedade que motivou a criação do stemmer. Sem ela, a deduplicação
    // falhava no caso mais comum da redação: veículos diferentes descrevendo o
    // mesmo fato com flexões verbais distintas.
    assert.equal(stem('adia'), stem('adiado'));
    assert.equal(stem('confirma'), stem('confirmado'));
    assert.equal(stem('anuncia'), stem('anunciado'));
  });

  it('preserva palavras curtas que já são radicais', () => {
    // "gta" não pode virar "gt": abaixo do radical mínimo, siglas colidiriam.
    assert.equal(stem('gta'), 'gta');
  });
});

describe('hash canônico', () => {
  it('é INSENSÍVEL à ordem das palavras', () => {
    // Esta é a propriedade central: os mesmos conceitos em ordens diferentes
    // precisam colidir no mesmo hash.
    const a = canonicalHash('Rockstar adia GTA VI', 'games');
    const b = canonicalHash('GTA VI adiado pela Rockstar', 'games');
    assert.equal(a, b);
  });

  it('separa assuntos de categorias diferentes', () => {
    const game = canonicalHash('The Last of Us novidades', 'games');
    const series = canonicalHash('The Last of Us novidades', 'cinema-e-series');
    assert.notEqual(game, series);
  });

  it('produz hashes distintos para assuntos distintos', () => {
    const a = canonicalHash('Rockstar adia GTA VI', 'games');
    const b = canonicalHash('Nintendo anuncia novo Zelda', 'games');
    assert.notEqual(a, b);
  });
});

describe('similaridade de Jaccard', () => {
  it('conjuntos idênticos = 1', () => {
    assert.equal(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  });

  it('conjuntos disjuntos = 0', () => {
    assert.equal(jaccardSimilarity(new Set(['a']), new Set(['b'])), 0);
  });

  it('distingue notícias OPOSTAS sobre o mesmo assunto', () => {
    // O caso que motivou escolher Jaccard em vez de Levenshtein: por distância
    // de edição, "adiado" e "confirmado" são parecidos; semanticamente, não.
    const adiado = significantTokens('GTA VI adiado para novembro');
    const confirmado = significantTokens('GTA VI confirmado para novembro');
    assert.ok(
      jaccardSimilarity(adiado, confirmado) < 0.6,
      'notícias opostas não deveriam ser tratadas como duplicata',
    );
  });
});

describe('detecção de duplicata', () => {
  const existentes = [
    { id: 't1', title: 'Rockstar confirma novo atraso de GTA VI para novembro', categorySlug: 'games' },
    { id: 't2', title: 'Nintendo anuncia Switch 2 com data de lançamento', categorySlug: 'games' },
  ];

  it('detecta a mesma notícia com redação diferente', () => {
    // Cenário real: cinco veículos noticiando o mesmo anúncio.
    const found = findDuplicate(
      'GTA VI tem novo atraso confirmado pela Rockstar para novembro',
      'games',
      existentes,
    );
    assert.ok(found, 'deveria ter detectado a duplicata');
    assert.equal(found.topicId, 't1');
  });

  it('NÃO agrupa notícias diferentes da mesma franquia', () => {
    // O erro mais perigoso: fundir duas notícias reais faz uma sumir.
    const found = findDuplicate('GTA VI ganha novo trailer com gameplay', 'games', existentes);
    assert.equal(found, null);
  });

  it('não agrupa assuntos de categorias diferentes', () => {
    const found = findDuplicate(
      'Rockstar confirma novo atraso de GTA VI para novembro',
      'cinema-e-series',
      existentes,
    );
    assert.equal(found, null);
  });

  it('lida com título sem tokens significativos', () => {
    // Regressão: título só de stopwords gerava conjunto vazio e Jaccard 1,
    // fazendo tudo virar duplicata de tudo.
    const found = findDuplicate('E o que é isso', 'games', existentes);
    assert.equal(found, null);
  });
});
