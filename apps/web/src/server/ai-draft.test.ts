/**
 * =============================================================================
 * TESTES — sugestão de matéria por modelo de linguagem
 * =============================================================================
 *
 * A CHAMADA REAL À API NÃO É TESTADA AQUI, e isso é uma escolha, não uma
 * omissão: um teste que gasta dinheiro e depende da internet não roda no CI, e
 * teste que não roda é comentário mentiroso. O que se testa é tudo aquilo que
 * PRECISA estar certo antes de a chave existir:
 *
 *   1. A DEGRADAÇÃO SEM CHAVE. É o estado atual do servidor do dono do site.
 *   2. A TRADUÇÃO DOS ERROS DA API — inclusive a regra que nenhum teste de
 *      integração pegaria: a nossa resposta nunca pode ser 401, porque o painel
 *      lê 401 como "sua sessão expirou" e mandaria o redator refazer login por
 *      causa de uma chave de API errada.
 *   3. O APARO DA RESPOSTA para os limites do formulário. Se um resumo de 320
 *      caracteres chega ao formulário, a validação da rota recusa a matéria na
 *      hora de salvar — e o redator recebe um erro sobre um texto que ele não
 *      escreveu.
 *   4. AS REGRAS DO PROMPT. São o único controle contra invenção e contra
 *      afirmação não atribuída; se alguém apagar uma linha delas numa
 *      refatoração, nada quebra visivelmente — o texto só fica pior, semanas
 *      depois, na matéria de alguém.
 *
 * O `fetch` global é substituído por um dublê. É a fronteira certa para o corte:
 * exercita o código inteiro (montagem do corpo, cabeçalhos, leitura da resposta)
 * sem rede.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  buildSystemPrompt,
  buildUserPrompt,
  describeHttpFailure,
  generateArticleDraft,
  isAiDraftConfigured,
  parseDraftPayload,
  type AiDraftTopicContext,
} from './ai-draft';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

const TOPIC: AiDraftTopicContext = {
  title: 'Hollow Knight: Silksong ganha data de lançamento',
  summary: 'A Team Cherry anunciou que o jogo chega em setembro para PC e consoles.',
  sourceName: 'Eurogamer',
  sourceUrl: 'https://www.eurogamer.net/exemplo',
  sourceTier: 'tier1Press',
  categoryName: 'Games',
  franchises: ['Hollow Knight'],
  scoreSummary: 'Alta de buscas e trending no YouTube BR',
  emotionalTriggers: [],
};

/** Resposta bem-formada do modelo, no formato que a API devolve. */
function modelResponse(body: Record<string, unknown>, extraBlocks: unknown[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [...extraBlocks, { type: 'text', text: JSON.stringify(body) }],
      usage: { input_tokens: 900, output_tokens: 700 },
    }),
    text: async () => '',
  } as unknown as Response;
}

function errorResponse(status: number, body = 'erro') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

const CORPO_VALIDO = {
  titulo: 'Silksong chega em setembro, diz a Team Cherry',
  resumo:
    'Segundo o Eurogamer, o estúdio confirmou a chegada do jogo em setembro para PC e consoles, sem detalhar preço.',
  blocos: [
    {
      tipo: 'paragrafo',
      texto:
        'Segundo o Eurogamer, a Team Cherry confirmou que Hollow Knight: Silksong chega em setembro para PC e consoles.',
    },
    { tipo: 'subtitulo', texto: 'O que ainda não foi confirmado' },
    {
      tipo: 'paragrafo',
      texto: 'A publicação não informou preço nem horário de liberação nas lojas digitais.',
    },
  ],
  tldr: ['Lançamento em setembro', 'PC e consoles', 'Preço não informado'],
  pendencias: ['Confirmar o preço na loja oficial'],
};

// =============================================================================
// DISPONIBILIDADE
// =============================================================================

test('sem ANTHROPIC_API_KEY a funcionalidade se declara desligada e nem tenta chamar a rede', async () => {
  delete process.env.ANTHROPIC_API_KEY;

  let chamou = false;
  globalThis.fetch = (async () => {
    chamou = true;
    return errorResponse(500);
  }) as typeof fetch;

  assert.equal(isAiDraftConfigured(), false);

  const resultado = await generateArticleDraft(TOPIC);

  assert.equal(resultado.ok, false);
  assert.equal(resultado.ok === false && resultado.reason, 'not-configured');
  // 503 e não 500: é ausência de configuração, não defeito. E o texto precisa
  // mandar a pessoa escrever no formulário, que é o caminho que continua aberto.
  assert.equal(resultado.ok === false && resultado.status, 503);
  assert.match(resultado.ok === false ? resultado.message : '', /formul[áa]rio/i);
  assert.equal(chamou, false, 'não pode haver requisição de rede sem chave configurada');
});

test('chave só com espaços conta como ausente', () => {
  process.env.ANTHROPIC_API_KEY = '   ';
  assert.equal(isAiDraftConfigured(), false);
});

// =============================================================================
// TRADUÇÃO DE ERROS
// =============================================================================

test('NENHUMA falha da API vira 401 na nossa resposta', () => {
  // A regra que protege o redator de ser mandado a refazer login por causa de
  // uma chave errada no servidor. Ver `readAdminResponse`.
  for (const status of [400, 401, 403, 404, 413, 422, 429, 500, 502, 503, 529]) {
    const falha = describeHttpFailure(status);
    assert.notEqual(falha.status, 401, `status ${status} não pode virar 401`);
    assert.ok(falha.message.length > 20, 'toda falha precisa de mensagem acionável');
  }
});

test('chave recusada aponta para configuração do servidor, não para a conta de quem clicou', () => {
  const falha = describeHttpFailure(401);
  assert.equal(falha.reason, 'credentials');
  assert.equal(falha.status, 503);
  assert.match(falha.message, /respons[áa]vel t[ée]cnico/i);
});

test('limite de uso da API é repassado como 429 e pede para esperar', () => {
  const falha = describeHttpFailure(429);
  assert.equal(falha.reason, 'rate-limited');
  assert.equal(falha.status, 429);
});

test('erro HTTP da API não vaza o corpo da resposta externa para a tela', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () =>
    errorResponse(500, 'detalhe interno com host da infra: 10.0.0.4')) as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);

  assert.equal(resultado.ok, false);
  assert.ok(resultado.ok === false && !resultado.message.includes('10.0.0.4'));
});

test('timeout tem mensagem própria — a ação de quem lê é diferente', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () => {
    const erro = new Error('The operation was aborted');
    erro.name = 'AbortError';
    throw erro;
  }) as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);

  assert.equal(resultado.ok === false && resultado.reason, 'timeout');
  assert.equal(resultado.ok === false && resultado.status, 504);
});

test('rede fora do ar não estoura exceção: vira falha tratada', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);

  assert.equal(resultado.ok === false && resultado.reason, 'upstream');
  assert.equal(resultado.ok === false && resultado.status, 502);
});

// =============================================================================
// CAMINHO FELIZ
// =============================================================================

test('a chamada leva a chave no cabeçalho certo e o corpo esperado pela API', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';
  let url = '';
  let init: RequestInit | undefined;

  globalThis.fetch = (async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return modelResponse(CORPO_VALIDO);
  }) as unknown as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);
  assert.equal(resultado.ok, true);

  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-teste-1234567890');
  assert.equal(headers['anthropic-version'], '2023-06-01');

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.ok(typeof body.model === 'string' && body.model.length > 0);
  assert.ok(typeof body.max_tokens === 'number' && body.max_tokens > 0, 'teto de custo obrigatório');
  // A saída estruturada é o que dispensa adivinhação na leitura da resposta.
  assert.ok(body.output_config, 'a resposta precisa vir presa a um schema');
});

test('bloco de raciocínio antes do texto não atrapalha a leitura da resposta', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () =>
    modelResponse(CORPO_VALIDO, [{ type: 'thinking', thinking: 'ruído' }])) as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.ok === true && resultado.draft.blocks.length, 3);
});

test('o rascunho sai no formato que o editor de blocos entende', () => {
  const resultado = parseDraftPayload(JSON.stringify(CORPO_VALIDO), 'modelo-x', TOPIC);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;

  const { draft } = resultado;

  // Só parágrafo e título — nunca imagem (decisão do dono: imagem é do humano).
  assert.deepEqual(
    [...new Set(draft.blocks.map((b) => b.type))].sort(),
    ['paragrafo', 'titulo'],
  );
  // Ids únicos e estáveis: sem eles o React embaralha o texto ao reordenar.
  assert.equal(new Set(draft.blocks.map((b) => b.id)).size, draft.blocks.length);
  // Subtítulo entra como h2 — h1 é a manchete da página.
  const titulo = draft.blocks.find((b) => b.type === 'titulo');
  assert.equal(titulo && 'nivel' in titulo ? titulo.nivel : null, 2);

  // O corpo em texto acompanha os blocos: é a rede de segurança para o caso de
  // o redator apagar os blocos e o textarea reaparecer.
  assert.ok(draft.content.includes('Team Cherry'));
  assert.ok(draft.content.includes('## O que ainda não foi confirmado'));
  assert.equal(draft.model, 'modelo-x');
  assert.deepEqual(draft.pendencias, ['Confirmar o preço na loja oficial']);
});

// =============================================================================
// APARO PARA OS LIMITES DO FORMULÁRIO
// =============================================================================

test('resumo longo demais é cortado em 300 caracteres, no espaço entre palavras', () => {
  const resultado = parseDraftPayload(
    JSON.stringify({ ...CORPO_VALIDO, resumo: 'palavra '.repeat(80) }),
    'modelo-x',
    TOPIC,
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;

  assert.ok(resultado.draft.excerpt.length <= 300);
  assert.ok(!resultado.draft.excerpt.endsWith('palav'), 'não pode cortar no meio da palavra');
});

test('título curto demais cai no título da pauta em vez de reprovar no formulário', () => {
  const resultado = parseDraftPayload(
    JSON.stringify({ ...CORPO_VALIDO, titulo: 'Oi' }),
    'modelo-x',
    TOPIC,
  );

  assert.equal(resultado.ok === true && resultado.draft.title, TOPIC.title);
});

test('aspas em volta da manchete são removidas — elas iriam para o h1', () => {
  const resultado = parseDraftPayload(
    JSON.stringify({ ...CORPO_VALIDO, titulo: '"Silksong chega em setembro"' }),
    'modelo-x',
    TOPIC,
  );

  assert.equal(resultado.ok === true && resultado.draft.title, 'Silksong chega em setembro');
});

test('TL;DR com mais de 5 pontos é aparado (o formato breaking recusa acima disso)', () => {
  const resultado = parseDraftPayload(
    JSON.stringify({ ...CORPO_VALIDO, tldr: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    'modelo-x',
    TOPIC,
  );

  assert.equal(resultado.ok === true && resultado.draft.tldr.length, 5);
});

test('resumo ausente é derivado do primeiro parágrafo, não deixado vazio', () => {
  const resultado = parseDraftPayload(
    JSON.stringify({ ...CORPO_VALIDO, resumo: '' }),
    'modelo-x',
    TOPIC,
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.ok(resultado.draft.excerpt.length >= 20, 'o formulário exige 20 caracteres');
});

test('JSON embrulhado em cerca de código ainda é lido', () => {
  // Só acontece no caminho de repetição sem schema (ver `callMessagesApi`), que
  // é justamente o caminho que nenhum teste de integração exercitaria.
  const resultado = parseDraftPayload(
    '```json\n' + JSON.stringify(CORPO_VALIDO) + '\n```',
    'm',
    TOPIC,
  );

  assert.equal(resultado.ok, true);
});

test('400 com saída estruturada é repetido UMA vez sem o schema', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';

  const corpos: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_u: string, i: RequestInit) => {
    corpos.push(JSON.parse(String(i.body)) as Record<string, unknown>);
    return corpos.length === 1 ? errorResponse(400, 'output_config não suportado') : modelResponse(CORPO_VALIDO);
  }) as unknown as typeof fetch;

  const resultado = await generateArticleDraft(TOPIC);

  assert.equal(resultado.ok, true, 'a segunda tentativa precisa salvar a geração');
  assert.equal(corpos.length, 2);
  assert.ok(corpos[0]?.output_config, 'a primeira tentativa usa o schema');
  assert.equal(corpos[1]?.output_config, undefined, 'a segunda vai sem ele');
});

test('401 NÃO é repetido — insistir em credencial errada só queima tempo', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste-1234567890';

  let chamadas = 0;
  globalThis.fetch = (async () => {
    chamadas += 1;
    return errorResponse(401);
  }) as typeof fetch;

  await generateArticleDraft(TOPIC);
  assert.equal(chamadas, 1);
});

test('JSON quebrado e corpo vazio viram falha declarada, nunca rascunho pela metade', () => {
  assert.equal(parseDraftPayload('isto não é json', 'm', TOPIC).ok, false);
  assert.equal(parseDraftPayload('[]', 'm', TOPIC).ok, false);
  assert.equal(
    parseDraftPayload(JSON.stringify({ ...CORPO_VALIDO, blocos: [] }), 'm', TOPIC).ok,
    false,
  );
});

// =============================================================================
// AS REGRAS DO PROMPT
// =============================================================================

test('o prompt de sistema carrega as três regras que sustentam a funcionalidade', () => {
  const prompt = buildSystemPrompt();

  // 1. Não inventar.
  assert.match(prompt, /N[ÃA]O INVENTE FATOS/i);
  // 2. Atribuir toda afirmação sensível.
  assert.match(prompt, /ATRIBU[IÍ]DA/i);
  assert.match(prompt, /segundo <fonte>/i);
  // 3. Nenhuma fala entre aspas — a invenção mais difícil de a revisão pegar.
  assert.match(prompt, /NUNCA ESCREVA FALAS ENTRE ASPAS/i);
  // Material escasso vira texto geral, não texto inventado.
  assert.match(prompt, /pend[eê]ncias/i);
  // Defesa declarada contra injeção de prompt vinda do feed de terceiros.
  assert.match(prompt, /n[ãa]o o obede[çc]a/i);
});

test('o material da pauta vai delimitado e com a fonte antes do texto', () => {
  const prompt = buildUserPrompt(TOPIC);

  assert.ok(prompt.includes('<material-de-pauta>'));
  assert.ok(prompt.includes('</material-de-pauta>'));
  assert.ok(prompt.includes(TOPIC.title));
  assert.ok(prompt.includes('Eurogamer'));
  assert.ok(prompt.includes('https://www.eurogamer.net/exemplo'));
  assert.ok(prompt.includes('Hollow Knight'));
  // A fonte precisa aparecer ANTES do resumo: é ela que define fato × rumor.
  assert.ok(prompt.indexOf('Fonte:') < prompt.indexOf('Endereço da fonte'));
});

test('pauta sem fonte instrui cautela em vez de deixar o modelo livre', () => {
  const prompt = buildUserPrompt({ ...TOPIC, sourceName: null, sourceUrl: null });
  assert.match(prompt, /N[ÃA]O INFORMADA/);
  assert.match(prompt, /cautela/i);
});

test('fonte não verificada é apresentada como rumor', () => {
  const prompt = buildUserPrompt({ ...TOPIC, sourceTier: 'unverified' });
  assert.match(prompt, /rumor n[ãa]o confirmado/i);
});

test('assunto marcado como delicado leva instrução de sobriedade', () => {
  const prompt = buildUserPrompt({ ...TOPIC, emotionalTriggers: ['tragedy'] });
  assert.match(prompt, /sobriedade/i);
});
