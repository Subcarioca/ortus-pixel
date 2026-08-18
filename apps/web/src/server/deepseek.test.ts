/**
 * =============================================================================
 * TESTES — cliente DeepSeek (pré-matéria por IA)
 * =============================================================================
 *
 * A CHAMADA REAL À API NÃO É TESTADA AQUI, pelo mesmo motivo de `ai-draft.test.ts`:
 * um teste que gasta dinheiro e depende da internet não roda no CI, e teste que
 * não roda é comentário mentiroso. O que se testa é tudo aquilo que PRECISA estar
 * certo antes de a chave existir:
 *
 *   1. A DEGRADAÇÃO SEM CHAVE — estado atual do servidor sem `DEEPSEEK_API_KEY`.
 *   2. A TRADUÇÃO DOS ERROS DA API — inclusive a regra que nenhum teste de
 *      integração pegaria: NENHUMA falha pode sair como 401, porque o painel lê
 *      401 como "sua sessão expirou" e mandaria o redator refazer login por causa
 *      de uma chave errada no servidor.
 *   3. O FORMATO DO CORPO — `response_format` só quando `jsonMode` pede, teto de
 *      custo (`max_tokens`) sempre presente, chave só no cabeçalho correto.
 *
 * O `fetch` global é substituído por um dublê — a mesma fronteira de `ai-draft.ts`.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  chatCompletion,
  deepseekModel,
  describeHttpFailure,
  isDeepSeekConfigured,
  type ChatMessage,
} from './ai/deepseek';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

const MENSAGENS: ChatMessage[] = [
  { role: 'system', content: 'prompt de sistema' },
  { role: 'user', content: 'material da pauta' },
];

/** Resposta bem-formada do DeepSeek, no formato OpenAI-compatible. */
function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
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

// =============================================================================
// DISPONIBILIDADE
// =============================================================================

test('sem DEEPSEEK_API_KEY a funcionalidade se declara desligada e nem tenta chamar a rede', async () => {
  delete process.env.DEEPSEEK_API_KEY;

  let chamou = false;
  globalThis.fetch = (async () => {
    chamou = true;
    return errorResponse(500);
  }) as typeof fetch;

  assert.equal(isDeepSeekConfigured(), false);

  const resultado = await chatCompletion({ messages: MENSAGENS });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.ok === false && resultado.reason, 'not-configured');
  // 503 e não 500: ausência de configuração, não defeito.
  assert.equal(resultado.ok === false && resultado.status, 503);
  assert.match(resultado.ok === false ? resultado.message : '', /formul[áa]rio/i);
  assert.equal(chamou, false, 'não pode haver requisição de rede sem chave configurada');
});

test('chave só com espaços conta como ausente', () => {
  process.env.DEEPSEEK_API_KEY = '   ';
  assert.equal(isDeepSeekConfigured(), false);
});

test('modelo explícito no ambiente vence o padrão; ausente cai no deepseek-chat', () => {
  delete process.env.DEEPSEEK_MODEL;
  assert.equal(deepseekModel(), 'deepseek-chat');

  process.env.DEEPSEEK_MODEL = 'deepseek-reasoner';
  assert.equal(deepseekModel(), 'deepseek-reasoner');
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
  for (const status of [401, 403]) {
    const falha = describeHttpFailure(status);
    assert.equal(falha.reason, 'http');
    assert.equal(falha.status, 503);
    assert.equal(falha.upstreamStatus, status);
    assert.match(falha.message, /respons[áa]vel t[ée]cnico/i);
  }
});

test('limite de uso da API é repassado como 429 e pede para esperar', () => {
  const falha = describeHttpFailure(429);
  assert.equal(falha.status, 429);
  assert.equal(falha.upstreamStatus, 429);
  assert.match(falha.message, /espere um minuto/i);
});

test('pedido recusado (modelo inválido) vira 502 e aponta configuração, não a pauta', () => {
  for (const status of [400, 404, 413, 422]) {
    const falha = describeHttpFailure(status);
    assert.equal(falha.status, 502);
    assert.match(falha.message, /modelo inv[áa]lido/i);
  }
});

test('erro HTTP da API não vaza o corpo da resposta externa para a tela', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () =>
    errorResponse(500, 'detalhe interno com host da infra: 10.0.0.4')) as typeof fetch;

  const resultado = await chatCompletion({ messages: MENSAGENS });

  assert.equal(resultado.ok, false);
  assert.ok(resultado.ok === false && !resultado.message.includes('10.0.0.4'));
});

test('timeout tem mensagem própria — a ação de quem lê é diferente', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () => {
    const erro = new Error('The operation was aborted');
    erro.name = 'AbortError';
    throw erro;
  }) as typeof fetch;

  const resultado = await chatCompletion({ messages: MENSAGENS });

  assert.equal(resultado.ok === false && resultado.reason, 'timeout');
  assert.equal(resultado.ok === false && resultado.status, 504);
});

test('rede fora do ar não estoura exceção: vira falha tratada', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  const resultado = await chatCompletion({ messages: MENSAGENS });

  assert.equal(resultado.ok === false && resultado.reason, 'network');
  assert.equal(resultado.ok === false && resultado.status, 502);
});

// =============================================================================
// CAMINHO FELIZ — O CORPO DA CHAMADA
// =============================================================================

test('a chamada leva a chave no cabeçalho certo e o corpo esperado pela API', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  let url = '';
  let init: RequestInit | undefined;

  globalThis.fetch = (async (u: string, i: RequestInit) => {
    url = u;
    init = i;
    return okResponse('texto gerado');
  }) as unknown as typeof fetch;

  const resultado = await chatCompletion({ messages: MENSAGENS });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.ok === true && resultado.content, 'texto gerado');

  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  const headers = init?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer sk-teste-1234567890');
  assert.equal(headers['Content-Type'], 'application/json');

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.model, 'deepseek-chat');
  assert.ok(typeof body.max_tokens === 'number' && body.max_tokens > 0, 'teto de custo obrigatório');
  assert.deepEqual(body.messages, MENSAGENS);
  // Sem `jsonMode`, não deve existir `response_format` — o provedor rejeita se
  // a palavra "json" não estiver no prompt.
  assert.equal('response_format' in body, false);
});

test('jsonMode liga response_format json_object e o desliga por padrão', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  const corpos: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_u: string, i: RequestInit) => {
    corpos.push(JSON.parse(String(i.body)) as Record<string, unknown>);
    return okResponse('texto');
  }) as unknown as typeof fetch;

  await chatCompletion({ messages: MENSAGENS, jsonMode: true });

  assert.deepEqual(corpos[0]?.response_format, { type: 'json_object' });
});

test('resposta sem conteúdo vira falha declarada, não string vazia', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-teste-1234567890';
  globalThis.fetch = (async () =>
    okResponse('   ')) as typeof fetch;

  const resultado = await chatCompletion({ messages: MENSAGENS });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.ok === false && resultado.reason, 'invalid-response');
  assert.equal(resultado.ok === false && resultado.status, 502);
});
