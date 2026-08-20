/**
 * =============================================================================
 * TESTES — cota de pautas novas por ciclo
 * =============================================================================
 *
 * O QUE ESTÁ AQUI, E POR QUÊ: a cota é a única parte dos tetos do requisito que
 * é DETERMINÍSTICA e não toca em nada externo. O laço que a consome
 * (`curate.ts`, etapa [2]) é E/S de ponta a ponta — upsert, lookup, log — e
 * testá-lo exigiria MySQL de pé; o corte é o mesmo do resto do serviço (ver o
 * cabeçalho de `expire-topics.test.ts`): teste que precisa de infraestrutura é
 * teste que não roda em CI, e teste que não roda é comentário mentiroso.
 *
 * O QUE ESTES CASOS PROTEGEM, EM ORDEM DE PERIGO:
 *
 *   1. `evaluate()` NÃO CONTAR. É o erro mais provável e o mais caro: se avaliar
 *      já consumisse vaga, 20 reposts da mesma notícia — que a deduplicação
 *      descarta e que jamais viram pauta — gastariam o ciclo inteiro, e o
 *      curator simplesmente pararia de trazer pautas novas sem uma única linha
 *      de erro em lugar nenhum.
 *   2. A PRIORIDADE DO TETO GLOBAL sobre o de categoria. Não é preciosismo: é o
 *      motivo relatado que faz o laço PARAR em vez de varrer centenas de itens
 *      que não poderiam virar pauta de jeito nenhum.
 *   3. O TETO DE UMA EDITORIA NÃO CONTAMINAR AS OUTRAS. É o requisito em letra
 *      ("o buscador passará para o próximo, mesmo que tenham outros assuntos em
 *      alta") e o efeito de produto inteiro depende disso.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createTopicQuota,
  MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE,
  MAX_NEW_TOPICS_PER_CYCLE,
  UNCATEGORIZED_QUOTA_KEY,
} from './topic-quota.ts';

describe('os números do requisito', () => {
  it('são 20 por ciclo e 5 por editoria', () => {
    // Escritos num lugar só e usados no laço, no log e no evento agregado. Este
    // teste é o que impede alguém de "subir para 50 só para testar" e esquecer.
    assert.equal(MAX_NEW_TOPICS_PER_CYCLE, 20);
    assert.equal(MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE, 5);
  });

  it('o teto global obriga pelo menos 4 editorias diferentes para encher um ciclo', () => {
    // A PLURALIDADE DA FILA É CONSEQUÊNCIA DA RAZÃO 20/5, e não de nenhuma regra
    // escrita em algum lugar — por isso ela precisa de asserção. Se um dia
    // alguém subir o teto por categoria para 20 "para não perder pauta em dia de
    // E3", esta linha falha e a conversa acontece ANTES do deploy, não depois de
    // a home passar um dia inteiro monotemática.
    const editoriasNecessarias = Math.ceil(
      MAX_NEW_TOPICS_PER_CYCLE / MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE,
    );
    assert.equal(editoriasNecessarias, 4);
  });
});

describe('avaliar não é contar', () => {
  it('avaliar mil vezes o mesmo item não consome vaga nenhuma', () => {
    const quota = createTopicQuota({ perCycle: 2, perCategory: 2 });

    for (let i = 0; i < 1_000; i++) {
      assert.equal(quota.evaluate('games').allowed, true);
    }

    assert.equal(quota.created, 0);
  });

  it('só `registerCreated` move o contador', () => {
    const quota = createTopicQuota({ perCycle: 3, perCategory: 3 });

    quota.evaluate('games');
    quota.evaluate('games');
    quota.registerCreated('games');

    assert.equal(quota.created, 1);
    assert.deepEqual(quota.createdByCategory(), { games: 1 });
  });
});

describe('teto por editoria', () => {
  it('libera as 5 primeiras e barra a sexta da MESMA editoria', () => {
    const quota = createTopicQuota();

    for (let i = 0; i < MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE; i++) {
      assert.equal(quota.evaluate('games').allowed, true, `a pauta ${i + 1} de games deveria caber`);
      quota.registerCreated('games');
    }

    const sexta = quota.evaluate('games');
    assert.equal(sexta.allowed, false);
    assert.equal(sexta.allowed === false && sexta.reason, 'category_limit');
    assert.equal(sexta.allowed === false && sexta.limit, MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE);
  });

  it('editoria cheia NÃO bloqueia as outras', () => {
    // O requisito em letra: "o buscador passará para o próximo, mesmo que tenham
    // outros assuntos em alta".
    const quota = createTopicQuota();

    for (let i = 0; i < MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE; i++) {
      quota.registerCreated('games');
    }

    assert.equal(quota.evaluate('games').allowed, false);
    assert.equal(quota.evaluate('cinema-e-series').allowed, true);
    assert.equal(quota.evaluate('tech').allowed, true);
  });

  it('itens sem categoria dividem um balde só', () => {
    // Se cada `null` fosse um balde próprio, um cadastro de fonte quebrado
    // furaria o teto por editoria em silêncio e tomaria o ciclo inteiro.
    const quota = createTopicQuota({ perCycle: 100, perCategory: 2 });

    quota.registerCreated(null);
    quota.registerCreated(null);

    assert.equal(quota.evaluate(null).allowed, false);
    assert.deepEqual(quota.createdByCategory(), { [UNCATEGORIZED_QUOTA_KEY]: 2 });
  });
});

describe('teto global do ciclo', () => {
  it('barra tudo depois de 20 criações, mesmo em editoria virgem', () => {
    const quota = createTopicQuota();

    // 4 editorias × 5 = exatamente o teto global, sem estourar nenhum teto de
    // categoria. É o único jeito de chegar a 20 com os números atuais.
    for (const categoria of ['games', 'cinema-e-series', 'anime-e-manga', 'hqs']) {
      for (let i = 0; i < MAX_NEW_TOPICS_PER_CATEGORY_PER_CYCLE; i++) {
        quota.registerCreated(categoria);
      }
    }

    assert.equal(quota.created, MAX_NEW_TOPICS_PER_CYCLE);

    // 'tech' não criou nada neste ciclo e mesmo assim está barrada: acabou a
    // vaga para todo mundo.
    const decisao = quota.evaluate('tech');
    assert.equal(decisao.allowed, false);
    assert.equal(decisao.allowed === false && decisao.reason, 'cycle_limit');
    assert.equal(decisao.allowed === false && decisao.limit, MAX_NEW_TOPICS_PER_CYCLE);
  });

  it('quando os dois tetos estouram juntos, o motivo relatado é o GLOBAL', () => {
    // A ordem importa para o chamador: 'cycle_limit' manda ENCERRAR o laço;
    // 'category_limit' manda PULAR para o próximo item. Invertido, o ciclo
    // varreria centenas de itens que nunca poderiam virar pauta.
    const quota = createTopicQuota({ perCycle: 2, perCategory: 2 });

    quota.registerCreated('games');
    quota.registerCreated('games');

    const decisao = quota.evaluate('games');
    assert.equal(decisao.allowed === false && decisao.reason, 'cycle_limit');
  });
});

describe('relatório para o log', () => {
  it('mostra quem encheu o ciclo, por editoria', () => {
    const quota = createTopicQuota();

    quota.registerCreated('games');
    quota.registerCreated('games');
    quota.registerCreated('tech');

    assert.equal(quota.created, 3);
    assert.deepEqual(quota.createdByCategory(), { games: 2, tech: 1 });
  });

  it('o relatório é uma cópia: mexer nele não mexe na cota', () => {
    const quota = createTopicQuota({ perCycle: 10, perCategory: 1 });

    quota.registerCreated('games');
    const relatorio = quota.createdByCategory();
    relatorio.games = 0;

    // Se o objeto devolvido fosse o estado interno, a linha acima teria
    // "devolvido" a vaga de games — e um ajuste inocente no log viraria um furo
    // no teto, do tipo que ninguém liga a essa linha meses depois.
    assert.equal(quota.evaluate('games').allowed, false);
  });
});
