/**
 * =============================================================================
 * CLIENTE DEEPSEEK — mínimo, sem SDK, e que NUNCA lança
 * =============================================================================
 *
 * A API do DeepSeek é compatível com o formato OpenAI (`chat/completions`). Em
 * vez de adicionar o SDK `openai` (dezenas de dependências transitivas), fazemos
 * um `fetch` direto — o mesmo princípio do stemmer próprio do curator: precisamos
 * de UMA chamada bem definida, não de uma camada de abstração que traga risco de
 * supply chain sem pagar o custo.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO NÃO TEM `import 'server-only'` (e mesmo assim é de servidor)
 * -----------------------------------------------------------------------------
 * Mesmo motivo de `ai-draft.ts`: `'server-only'` é resolvido pelo bundler do Next
 * e NÃO existe como módulo comum, então um arquivo que o importa é impossível de
 * carregar em `node --test`. As decisões mais consequentes da chamada (o que se
 * responde quando a API falha, o teto de timeout, a leitura da chave) ficariam
 * sem teste nenhum — no lugar errado para economizar um arquivo.
 *
 * A proteção real continua valendo: este módulo lê `DEEPSEEK_API_KEY` de
 * `process.env` e é importado apenas pela camada de geração de pré-matéria, que
 * por sua vez é chamada apenas pela rota de API. A chave NUNCA aparece em prop
 * de componente, em resposta HTTP ou em log — ver `logSafeError`.
 *
 * -----------------------------------------------------------------------------
 * POR QUE O CONTRATO É "NUNCA LANÇAR"
 * -----------------------------------------------------------------------------
 * O mesmo princípio de `generateArticleDraft`: uma exceção que escapasse daqui
 * viraria 500 sem corpo, e o painel traduz 500 sem corpo como "erro de conexão" —
 * a pior mensagem possível, porque manda o redator tentar de novo em vez de
 * entender que a chave está ausente ou o serviço está fora. Toda falha vira um
 * `DeepSeekFailure` com `status` e mensagem pronta para a tela.
 */

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/**
 * MODELO PADRÃO.
 *
 * O `deepseek-chat` é o modelo de conversação de uso geral do DeepSeek, suficiente
 * para gerar uma pré-matéria estruturada em JSON. O id é um snapshot fixo e a
 * troca passa por `DEEPSEEK_MODEL` no ambiente — deliberada e reversível, nunca
 * silenciosa.
 */
const DEFAULT_MODEL = 'deepseek-chat';

/**
 * 45 segundos — o MESMO teto de `ai-draft.ts`.
 *
 * O valor não é arbitrário: o nginx à frente da aplicação usa
 * `proxy_read_timeout 60s`. Estourar o nosso limite antes do dele é o que garante
 * que o painel receba a NOSSA mensagem de "demorou demais" em JSON, e não a
 * página de erro 504 em HTML do proxy.
 */
const TIMEOUT_MS = 45_000;

/**
 * Teto de tokens de saída. ~3.000 tokens cobrem com folga uma pré-matéria de 400
 * a 800 palavras mais o JSON em volta. O teto existe como trava de CUSTO: um
 * modelo que entre em laço não pode gerar uma conta inesperada em uma requisição.
 */
const MAX_OUTPUT_TOKENS = 3_000;

// =============================================================================
// TIPOS
// =============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * POR QUE A FALHA CARREGA UM `status` HTTP.
 *
 * Quem decide o código de resposta é este módulo, e há uma armadilha concreta por
 * trás disso: `readAdminResponse` (o cliente do painel) trata QUALQUER 401 como
 * "sua sessão expirou, entre de novo". Se a rota repassasse o 401 do DeepSeek —
 * que significa "a chave da API está errada" —, o redator seria mandado a refazer
 * login para resolver um problema de configuração do servidor. Nenhuma falha
 * desta integração pode sair como 401.
 */
export type DeepSeekFailureReason =
  | 'not-configured'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-response';

export interface DeepSeekFailure {
  ok: false;
  reason: DeepSeekFailureReason;
  /** Texto pronto para a tela: diz o que aconteceu E o que fazer agora. */
  message: string;
  status: number;
  /** Status cru da API, para diagnóstico — nunca repassado ao cliente. */
  upstreamStatus?: number;
}

export type DeepSeekChatResult = { ok: true; content: string } | DeepSeekFailure;

// =============================================================================
// DISPONIBILIDADE
// =============================================================================

/**
 * A funcionalidade está ligada?
 *
 * DEGRADAÇÃO GRACIOSA, o mesmo contrato dos conectores do curator e de
 * `isAiDraftConfigured`: sem credencial, o recurso não existe — não quebra, não
 * estoura, não aparece como um botão que sempre falha.
 */
export function isDeepSeekConfigured(): boolean {
  return readApiKey() !== null;
}

function readApiKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function deepseekModel(): string {
  const configured = process.env.DEEPSEEK_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_MODEL;
}

// =============================================================================
// A CHAMADA
// =============================================================================

/**
 * Uma única chamada `chat/completions`. NUNCA lança.
 *
 * `jsonMode` liga `response_format: { type: 'json_object' }`, que faz o provedor
 * garantir um objeto JSON válido na resposta. O DeepSeek exige que a palavra
 * "json" apareça no prompt quando esse modo está ativo — o prompt de pré-matéria
 * contém "FORMATO DE SAÍDA (JSON)".
 */
export async function chatCompletion(options: {
  messages: ChatMessage[];
  jsonMode?: boolean;
}): Promise<DeepSeekChatResult> {
  const apiKey = readApiKey();

  if (!apiKey) {
    return {
      ok: false,
      reason: 'not-configured',
      status: 503,
      message:
        'A geração por IA não está configurada neste servidor (falta a chave do DeepSeek). ' +
        'Escreva a matéria normalmente pelo formulário — nada foi perdido.',
    };
  }

  const model = deepseekModel();

  // Um controller por chamada, com timeout próprio. Sem ele, uma requisição
  // pendurada seguraria uma conexão do pool do servidor até o proxy desistir.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // A chave existe só nesta variável local: não é logada, não volta na
        // resposta e não vira prop de componente.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: 0.3,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // O corpo do erro é lido para o LOG, nunca para a tela: mensagem de API
      // externa pode conter detalhe de infraestrutura que não interessa a quem
      // está escrevendo uma matéria.
      logSafeError(`HTTP ${response.status} da API do DeepSeek`, await safeBody(response));
      return describeHttpFailure(response.status);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      logSafeError('resposta sem conteúdo', JSON.stringify(data).slice(0, 500));
      return {
        ok: false,
        reason: 'invalid-response',
        status: 502,
        message:
          'O serviço de geração devolveu uma resposta vazia. Tente de novo ou ' +
          'escreva a matéria pelo formulário.',
      };
    }

    return { ok: true, content };
  } catch (error) {
    // `AbortError` é o nosso próprio timeout disparando — merece mensagem
    // própria porque a ação do usuário é diferente: esperar e tentar de novo,
    // em vez de avisar o responsável técnico.
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        reason: 'timeout',
        status: 504,
        message:
          'A geração demorou mais de 45 segundos e foi cancelada. Tente de novo em instantes ' +
          'ou escreva a matéria pelo formulário — nada foi perdido.',
      };
    }

    logSafeError('falha de rede ao chamar a API do DeepSeek', error);
    return {
      ok: false,
      reason: 'network',
      status: 502,
      message:
        'Não foi possível falar com o serviço de geração de texto. Tente de novo em alguns ' +
        'minutos ou escreva a matéria pelo formulário.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Do código HTTP para uma frase que diz O QUE FAZER.
 *
 * Separada e exportada porque é a lógica mais fácil de errar em silêncio da
 * integração inteira — e a mais chata de exercitar de verdade (429 e 401 da API
 * real não são reproduzíveis à vontade).
 */
export function describeHttpFailure(status: number): DeepSeekFailure {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: 'http',
      // NUNCA 401 na nossa resposta: ver o comentário de `DeepSeekFailure`.
      status: 503,
      upstreamStatus: status,
      message:
        'A chave da API do DeepSeek foi recusada. Isso é configuração do servidor, ' +
        'não da sua conta — avise o responsável técnico. Escreva a matéria pelo formulário enquanto isso.',
    };
  }

  if (status === 429) {
    return {
      ok: false,
      reason: 'http',
      status: 429,
      upstreamStatus: status,
      message:
        'O limite de uso da API de geração foi atingido agora. Espere um minuto e tente de novo, ' +
        'ou escreva a matéria pelo formulário.',
    };
  }

  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return {
      ok: false,
      reason: 'http',
      status: 502,
      upstreamStatus: status,
      message:
        'O serviço de geração recusou o pedido (possível modelo inválido na configuração). ' +
        'Avise o responsável técnico e escreva a matéria pelo formulário.',
    };
  }

  return {
    ok: false,
    reason: 'http',
    status: 502,
    upstreamStatus: status,
    message:
      'O serviço de geração de texto está indisponível no momento. Tente de novo em alguns minutos ' +
      'ou escreva a matéria pelo formulário.',
  };
}

// =============================================================================
// AUXILIARES
// =============================================================================

/** Corpo de erro para log, curto e sem estourar se a leitura falhar. */
async function safeBody(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 500);
}

/**
 * Log de falha SEM vazar credencial.
 *
 * A chave não passa por aqui — mas o detalhe da resposta pode conter cabeçalhos
 * ecoados, e log costuma ir parar em sistema de terceiro com controle de acesso
 * mais frouxo que o do cofre de segredos. Mesmo cuidado de `logSafeError` do
 * `ai-draft.ts`.
 */
function logSafeError(context: string, detail: unknown): void {
  const text = detail instanceof Error ? detail.message : String(detail ?? '');
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  const safe = key && key.length > 8 ? text.split(key).join('[chave omitida]') : text;
  console.warn(`[deepseek] ${context}: ${safe}`);
}
