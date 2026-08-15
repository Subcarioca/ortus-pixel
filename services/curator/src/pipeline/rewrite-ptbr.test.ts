/**
 * Testes da reescrita para pt-BR.
 *
 * O QUE É TESTADO AQUI: só a parte determinística — quem precisa de reescrita,
 * o que se aceita da resposta do modelo e o que se faz quando ela vem torta.
 * Nada de rede: a chamada real depende de chave, custa dinheiro e devolve texto
 * diferente a cada execução, o que a torna inútil como teste automatizado.
 *
 * E é justamente a parte determinística que concentra o risco: um erro em
 * `parseRewritePayload` não quebra nada — ele grava um título ruim no banco e
 * ninguém descobre até um leitor reclamar.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  isRewriteConfigured,
  needsRewrite,
  parseRewritePayload,
  rewriteItemsToPtBr,
} from './rewrite-ptbr.ts';
import type { DiscoveredItem } from '../discovery/rss-sources.ts';
import { NEWS_SOURCES } from '../discovery/rss-sources.ts';

/** Item mínimo de teste. A fonte é o que decide o comportamento. */
function makeItem(lang: 'pt' | 'en' | 'ja', overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
  return {
    title: 'Rockstar delays GTA VI to November',
    summary: 'The publisher confirmed the new window in a post.',
    url: 'https://example.com/noticia',
    publishedAt: new Date(),
    source: {
      id: 'fonte-teste',
      name: 'Fonte de Teste',
      feedUrl: 'https://example.com/feed',
      categorySlug: 'games',
      tier: 'tier1Press',
      phase: 1,
      lang,
    },
    ...overrides,
  };
}

describe('quem precisa de reescrita', () => {
  it('fonte em inglês precisa', () => {
    assert.equal(needsRewrite(makeItem('en')), true);
  });

  it('fonte em português é pulada (não gasta chamada de API)', () => {
    assert.equal(needsRewrite(makeItem('pt')), false);
  });

  it('qualquer idioma que não seja português precisa', () => {
    assert.equal(needsRewrite(makeItem('ja')), true);
  });
});

describe('prompt', () => {
  it('descreve as MESMAS chaves declaradas no responseSchema', () => {
    // O `responseSchema` da requisição obriga o modelo a devolver "titulo" e
    // "resumo". Se alguém renomear os campos no prompt (para "manchete", por
    // exemplo) sem mexer no schema, a API continua respondendo com as chaves do
    // schema e o prompt passa a pedir uma coisa e o código a ler outra — erro
    // que não quebra nada e só aparece como reescrita de qualidade pior.
    const prompt = buildRewriteSystemPrompt();
    assert.ok(prompt.includes('"titulo"'));
    assert.ok(prompt.includes('"resumo"'));
  });

  it('delimita o material do feed, para separar dado de instrução', () => {
    const prompt = buildRewriteUserPrompt(makeItem('en'));
    assert.ok(prompt.includes('<material>'));
    assert.ok(prompt.includes('</material>'));
  });

  it('leva título e resumo do item', () => {
    const prompt = buildRewriteUserPrompt(makeItem('en'));
    assert.ok(prompt.includes('Rockstar delays GTA VI to November'));
    assert.ok(prompt.includes('The publisher confirmed the new window in a post.'));
  });
});

describe('leitura da resposta do modelo', () => {
  const item = makeItem('en');

  it('aceita o caso feliz', () => {
    const result = parseRewritePayload(
      '{"titulo": "Rockstar adia GTA VI para novembro", "resumo": "A publisher confirmou a nova janela."}',
      item,
    );
    assert.ok(result?.ok);
    assert.equal(result.title, 'Rockstar adia GTA VI para novembro');
    assert.equal(result.summary, 'A publisher confirmou a nova janela.');
  });

  it('tolera cerca de código em volta do JSON', () => {
    const result = parseRewritePayload(
      '```json\n{"titulo": "Rockstar adia GTA VI", "resumo": "Nova janela."}\n```',
      item,
    );
    assert.ok(result?.ok);
    assert.equal(result.title, 'Rockstar adia GTA VI');
  });

  it('recusa resposta que não é JSON (fica com o original)', () => {
    assert.equal(parseRewritePayload('Claro! Aqui está a tradução.', item), null);
  });

  it('recusa título vazio ou degenerado', () => {
    // Título vazio na fila é PIOR que título em inglês: o editor não tem o que
    // ler e a pauta some visualmente. Melhor recusar a reescrita inteira.
    assert.equal(parseRewritePayload('{"titulo": "", "resumo": "algo"}', item), null);
    assert.equal(parseRewritePayload('{"titulo": "Notícia", "resumo": "algo"}', item), null);
  });

  it('recusa JSON que não é objeto', () => {
    assert.equal(parseRewritePayload('["Rockstar adia GTA VI"]', item), null);
  });

  it('preserva o resumo original quando o modelo devolve resumo vazio', () => {
    const result = parseRewritePayload('{"titulo": "Rockstar adia GTA VI", "resumo": ""}', item);
    assert.ok(result?.ok);
    assert.equal(result.summary, item.summary);
  });

  it('corta título e resumo nos limites das colunas do banco', () => {
    // `Topic.title` é VarChar(255) e trunca em SILÊNCIO neste MySQL — o corte
    // aqui é o que evita perder o fim de uma manchete sem nenhum erro aparecer.
    const gigante = {
      titulo: 'A'.repeat(400),
      resumo: 'B'.repeat(900),
    };
    const result = parseRewritePayload(JSON.stringify(gigante), item);
    assert.ok(result?.ok);
    assert.equal(result.title.length, 250);
    assert.equal(result.summary.length, 500);
  });

  it('normaliza espaços e quebras de linha', () => {
    const result = parseRewritePayload(
      '{"titulo": "  Rockstar   adia\\n GTA VI  ", "resumo": "Nova   janela."}',
      item,
    );
    assert.ok(result?.ok);
    assert.equal(result.title, 'Rockstar adia GTA VI');
  });
});

describe('degradação sem chave de API', () => {
  /**
   * Este é o caminho que MAIS vai rodar na vida real: qualquer ambiente sem a
   * chave (máquina de dev, CI, servidor antes de o dono configurar) passa por
   * aqui a cada 15 minutos. Ele precisa ser inerte e honesto.
   */
  it('devolve os itens intactos, sem nenhuma requisição de rede', async () => {
    const anterior = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      assert.equal(isRewriteConfigured(), false);

      const entrada = [makeItem('en'), makeItem('pt'), makeItem('pt')];
      const saida = await rewriteItemsToPtBr(entrada);

      assert.equal(saida.rewritten, 0);
      assert.equal(saida.items[0]!.title, entrada[0]!.title);
      // Ninguém recebe `originalTitle` quando nada foi reescrito: o campo é a
      // marca de que a etapa mexeu no texto.
      assert.equal(saida.items[0]!.originalTitle, undefined);

      // A contagem de "já estava em português" precisa valer MESMO sem chave —
      // é dela que sai o número no aviso do ciclo. Contando errado, o log
      // acusaria de estrangeira a pauta que veio do TecMundo.
      assert.equal(saida.skippedPt, 2);
    } finally {
      if (anterior !== undefined) process.env.GEMINI_API_KEY = anterior;
    }
  });
});

describe('catálogo de fontes', () => {
  it('não tem id duplicado', () => {
    // Id duplicado não quebra nada visivelmente — só faz `failedSources`
    // reportar a fonte errada e confunde qualquer diagnóstico futuro.
    const ids = NEWS_SOURCES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('não tem feedUrl duplicada', () => {
    const urls = NEWS_SOURCES.map((s) => s.feedUrl);
    assert.equal(new Set(urls).size, urls.length);
  });

  it('toda categoria coberta pelo produto tem ao menos uma fonte em português', () => {
    // Este é o teste que trava a regressão que originou toda esta mudança: a
    // lista inteira em inglês. Se alguém remover a última fonte pt-BR de uma
    // editoria, o teste falha aqui em vez de o problema aparecer na fila da
    // redação uma semana depois.
    const categorias = [...new Set(NEWS_SOURCES.map((s) => s.categorySlug))];

    for (const categoria of categorias) {
      const temPt = NEWS_SOURCES.some((s) => s.categorySlug === categoria && s.lang === 'pt');
      assert.ok(temPt, `categoria "${categoria}" ficou sem nenhuma fonte em português`);
    }
  });

  it('toda fonte declara uma URL https', () => {
    // Feed em http seria requisição em texto claro a partir do servidor — e o
    // conteúdo dela vira título publicado no site.
    for (const source of NEWS_SOURCES) {
      assert.ok(source.feedUrl.startsWith('https://'), `${source.id} não usa https`);
    }
  });
});
