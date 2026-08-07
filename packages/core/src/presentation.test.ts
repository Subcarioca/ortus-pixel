/**
 * Testes da ponte entre o vocabulário do PRODUTO e o vocabulário do DESIGN.
 *
 * Por que este arquivo existe, e por que ele é mais importante do que parece:
 *
 * O erro que estes testes travam já aconteceu três vezes no projeto, sempre da
 * mesma forma e sempre passando despercebido. Alguém escreve `cat--${slug}` no
 * JSX, o TypeScript aceita (é só uma string), o build passa, a página renderiza
 * — e três das seis editorias perdem a cor, porque `cinema-e-series` não é
 * `cinema`. Nada quebra. Nenhum log. O bug só aparece se alguém abrir a página
 * da editoria certa e reparar que o filete está no cinza padrão.
 *
 * Um teste de unidade é a única barreira barata contra esse tipo de falha: ela
 * é silenciosa por natureza, então não vai ser pega por monitoramento nem por
 * QA manual. O que ele verifica não é "a função devolve uma string", e sim que
 * TODA editoria da taxonomia tem um token de design correspondente — a
 * propriedade que o produto realmente depende.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CATEGORIES } from './taxonomy.ts';
import { catClass, catModifier, catToken, heatClass } from './presentation.ts';

describe('slug de editoria → token do design', () => {
  it('toda editoria da taxonomia tem token — nenhuma cai no neutro por acidente', () => {
    // Este é O teste. Se amanhã entrar uma sétima editoria e alguém esquecer de
    // registrá-la em CATEGORY_DESIGN_TOKEN, o build de tipos já reclama (o mapa
    // é `as const` e indexado por CategorySlug), mas o teste falha primeiro e
    // com uma mensagem que diz o que fazer.
    for (const category of CATEGORIES) {
      assert.notEqual(
        catToken(category.slug),
        undefined,
        `A editoria "${category.slug}" não tem token de design. ` +
          'Registre-a em CATEGORY_DESIGN_TOKEN (core/presentation.ts).',
      );
    }
  });

  it('traduz os três slugs que NÃO coincidem com o nome do design', () => {
    // As outras três (games, tech, eventos) coincidem e nunca deram problema —
    // é exatamente por isso que o bug passava: metade dos casos funcionava.
    assert.equal(catToken('cinema-e-series'), 'cinema');
    assert.equal(catToken('anime-e-manga'), 'anime');
    assert.equal(catToken('hqs'), 'hq');
  });

  it('slug desconhecido degrada para o neutro em vez de inventar cor', () => {
    // Pintar uma editoria com a identidade de outra é pior do que não pintar:
    // o leitor aprende a associar cor a assunto, e a cor errada mente para ele.
    assert.equal(catToken('editoria-que-nao-existe'), undefined);
    assert.equal(catClass('editoria-que-nao-existe'), 'cat');
    assert.equal(catModifier('editoria-que-nao-existe'), '');
  });
});

describe('formato das classes geradas', () => {
  it('catClass traz a classe base junto do modificador', () => {
    // `.cat` sozinho é quem desenha o rótulo (filete + caixa-alta). Sem ele o
    // modificador não tem o que modificar.
    assert.equal(catClass('games'), 'cat cat--games');
    assert.equal(catClass('hqs'), 'cat cat--hq');
  });

  it('catModifier traz SÓ o modificador, sem a classe base', () => {
    // Usado onde o elemento só precisa da variável `--c` (o filete de 3px do
    // `.editoria-head`). Aplicar `.cat` ali transformaria um cabeçalho de
    // página num badge de 10px em caixa-alta.
    assert.equal(catModifier('games'), 'cat--games');
    assert.equal(catModifier('cinema-e-series'), 'cat--cinema');
    assert.equal(catModifier('anime-e-manga'), 'cat--anime');
  });

  it('catModifier nunca devolve undefined — é interpolado direto em className', () => {
    // `className={`editoria-head ${catModifier(slug)}`}` com undefined
    // produziria a classe literal "undefined" no HTML. String vazia não.
    for (const slug of ['games', 'inexistente', '']) {
      assert.equal(typeof catModifier(slug), 'string');
    }
  });
});

describe('temperatura → classe do bloco', () => {
  it('"base" é o estado PADRÃO: não recebe modificador onde o CSS não tem um', () => {
    // Este é o bug que estes testes existem para travar. "Relevante" é o caso
    // MAIS FREQUENTE do site, então a classe inexistente aparecia em quase todo
    // card — e como o estado sem modificador já era o visual correto, nada
    // denunciava o erro.
    assert.equal(heatClass('heatbar', 'base'), 'heatbar');
    assert.equal(heatClass('rank', 'base'), 'rank');
    assert.equal(heatClass('score', 'base'), 'score');
  });

  it('o badge é a exceção: as quatro faixas têm modificador', () => {
    // A assimetria entre `.heat--base` (existe) e `.heatbar--base` (não existe)
    // é a razão de o bug ter passado: os dois componentes ficam lado a lado no
    // mesmo `.card__head`, e copiar o padrão do vizinho parecia seguro.
    assert.equal(heatClass('heat', 'base'), 'heat heat--base');
    assert.equal(heatClass('heat', 'ever'), 'heat heat--ever');
  });

  it('`.rank` só colore as duas faixas quentes', () => {
    assert.equal(heatClass('rank', 'hot'), 'rank rank--hot');
    assert.equal(heatClass('rank', 'rise'), 'rank rank--rise');
    // "Guia" no ranking usa a linha neutra — o design não prevê `.rank--ever`.
    assert.equal(heatClass('rank', 'ever'), 'rank');
  });

  it('`.score` distingue "guia", `.rank` não — e isso é intencional', () => {
    // Não é inconsistência do design: `.score--ever` pinta o NÚMERO (visível só
    // no painel), enquanto `.rank--*` pinta a POSIÇÃO na lista pública, onde um
    // guia não deve competir com uma notícia quente.
    assert.equal(heatClass('score', 'ever'), 'score score--ever');
    assert.equal(heatClass('rank', 'ever'), 'rank');
  });

  it('a classe base sempre vem primeiro e sempre está presente', () => {
    // Sem a base, o modificador não tem o que modificar — e vários blocos
    // (`.rank`, `.score`) dependem da base para o próprio layout em grade.
    for (const heat of ['hot', 'rise', 'base', 'ever'] as const) {
      for (const block of ['heat', 'heatbar', 'rank', 'score'] as const) {
        assert.equal(heatClass(block, heat).split(' ')[0], block);
      }
    }
  });
});
