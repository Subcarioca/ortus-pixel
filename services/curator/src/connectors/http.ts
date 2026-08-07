/**
 * =============================================================================
 * INFRAESTRUTURA HTTP COMPARTILHADA PELOS CONECTORES
 * =============================================================================
 *
 * Centralizar o acesso à rede num único lugar garante que TODO conector herde
 * as mesmas proteções: timeout, retry com backoff, user-agent identificável e
 * limite de tamanho de resposta. Se cada conector fizesse seu próprio `fetch`,
 * bastaria um esquecer o timeout para travar o ciclo inteiro.
 */

/** Erro de rede com o contexto necessário para diagnóstico e circuit breaker. */
export class ConnectorHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly isRetryable = false,
  ) {
    super(message);
    this.name = 'ConnectorHttpError';
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Sinal externo (do orquestrador) para cancelamento em cascata. */
  signal?: AbortSignal;
  maxRetries?: number;
  /** Teto de bytes aceitos. Protege contra resposta gigante que estoure a memória. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * `fetch` endurecido para uso em conectores.
 *
 * DECISÃO — quando repetir a chamada (retry):
 *   - 429 e 5xx: sim. São falhas transitórias por definição.
 *   - 4xx (exceto 429): NÃO. Credencial inválida ou parâmetro errado não
 *     melhoram com insistência; repetir só queima quota e atrasa o ciclo.
 *   - Erro de rede/timeout: sim, uma vez.
 *
 * O backoff é exponencial com jitter aleatório. O jitter existe porque, sem
 * ele, todos os conectores que falharam no mesmo instante voltariam a bater na
 * API exatamente juntos — o efeito "manada" que transforma uma instabilidade
 * momentânea em queda prolongada.
 */
export async function fetchWithResilience(
  url: string,
  options: FetchOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Um controller NOVO por tentativa: reaproveitar um já abortado faria a
    // segunda tentativa nascer morta.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    // Encadeia o cancelamento externo: se o orquestrador desistir, a requisição
    // em voo é abortada de imediato, sem esperar o timeout.
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          // User-agent identificável é boa prática e exigência explícita de
          // várias APIs (o Reddit rejeita requisições sem UA descritivo).
          'User-Agent':
            process.env.REDDIT_USER_AGENT ?? 'OrtusPixelBot/1.0 (+https://ortuspixel.com)',
          Accept: 'application/json, text/xml, application/xml, */*',
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
        redirect: 'follow',
      });

      if (response.ok) {
        assertResponseSize(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
        return response;
      }

      const retryable = response.status === 429 || response.status >= 500;
      lastError = new ConnectorHttpError(
        `HTTP ${response.status} em ${safeUrlForLog(url)}`,
        response.status,
        retryable,
      );
      if (!retryable) throw lastError;
    } catch (error) {
      if (error instanceof ConnectorHttpError && !error.isRetryable) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));

      // Cancelamento externo não é falha a ser repetida: é ordem de parar.
      if (options.signal?.aborted) {
        throw new ConnectorHttpError('Cancelado pelo orquestrador', undefined, false);
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    if (attempt < maxRetries) {
      const backoffMs = Math.min(200 * 2 ** attempt, 2000);
      const jitter = Math.random() * 100;
      await sleep(backoffMs + jitter);
    }
  }

  throw lastError ?? new ConnectorHttpError('Falha desconhecida na requisição');
}

/** JSON tipado. O chamador informa a forma esperada e valida o que precisar. */
export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
  const response = await fetchWithResilience(url, options);
  return (await response.json()) as T;
}

export async function fetchText(url: string, options: FetchOptions): Promise<string> {
  const response = await fetchWithResilience(url, options);
  return await response.text();
}

function assertResponseSize(response: Response, maxBytes: number): void {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ConnectorHttpError(
      `Resposta excede o limite de ${maxBytes} bytes (recebido: ${contentLength}).`,
      undefined,
      false,
    );
  }
}

/**
 * Remove query string antes de logar.
 *
 * SEGURANÇA: muitas APIs recebem a chave como query param (`?key=...`). Sem
 * essa limpeza, a primeira falha de rede despeja a credencial no arquivo de log
 * — e logs costumam ir para sistemas de terceiros com controle de acesso bem
 * mais frouxo que o do cofre de segredos.
 */
function safeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[url inválida]';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gerador pseudoaleatório DETERMINÍSTICO a partir de uma string.
 *
 * Usado pelos conectores em modo mock. Determinismo importa muito aqui: se os
 * mocks devolvessem `Math.random()`, o score de "GTA VI" mudaria a cada ciclo,
 * a home ficaria dançando sozinha e seria impossível distinguir bug de ruído.
 * Com hash da query, o mesmo termo sempre gera o mesmo sinal.
 *
 * Algoritmo: FNV-1a de 32 bits. Rápido, boa dispersão e trivial de auditar.
 * NÃO é criptográfico — e não precisa ser, já que só alimenta dados de teste.
 */
export function deterministicRandom(seed: string, min = 0, max = 1): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // Multiplicação pelo primo FNV via somas de shift (evita estouro de 32 bits).
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  // `>>> 0` converte para inteiro sem sinal de 32 bits.
  const normalized = (hash >>> 0) / 4294967295;
  return min + normalized * (max - min);
}
