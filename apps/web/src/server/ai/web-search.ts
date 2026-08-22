/**
 * =============================================================================
 * CLIENTE DE BUSCA — Serper.dev, mínimo, e que NUNCA lança
 * =============================================================================
 *
 * A API do DeepSeek (`deepseek.ts`) não tem navegador embutido: é um modelo de
 * linguagem puro, sem acesso à internet. O modo entrevista (`interview.ts`)
 * documentava essa limitação e instruía o modelo a NUNCA fingir que pesquisou —
 * este módulo é o que torna a pesquisa real possível, dando ao modelo uma
 * FERRAMENTA (function calling) que o servidor executa de verdade.
 *
 * -----------------------------------------------------------------------------
 * POR QUE SERPER.DEV, E NÃO A API OFICIAL DO GOOGLE
 * -----------------------------------------------------------------------------
 * A Custom Search JSON API do Google exige um mecanismo de busca programável
 * cadastrado à parte, tem cota gratuita minúscula (100/dia) e paga por 1.000
 * consultas em lotes caros para o volume de uma redação pequena. Serper.dev é um
 * proxy dos resultados de busca do Google, mais barato por consulta e com uma
 * chamada HTTP só — mesmo princípio do cliente DeepSeek: uma chamada bem
 * definida, sem SDK, sem dependência nova além do `fetch` que o runtime já tem.
 *
 * -----------------------------------------------------------------------------
 * DEGRADAÇÃO GRACIOSA — o mesmo contrato de `isDeepSeekConfigured`
 * -----------------------------------------------------------------------------
 * Sem `SERPER_API_KEY`, a busca simplesmente NÃO é oferecida como ferramenta ao
 * modelo (ver `interview.ts`) — a entrevista continua funcionando exatamente
 * como antes desta integração existir, só sem a etapa de pesquisa real. Nunca
 * quebra, nunca aparece como botão que sempre falha.
 */

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

/**
 * 10 segundos — bem abaixo do teto de 45s do DeepSeek (`TIMEOUT_MS` em
 * `deepseek.ts`), porque a busca é UMA etapa dentro de um turno que já inclui
 * pelo menos duas chamadas ao modelo (a que pede a busca, a que lê o resultado).
 * Uma busca lenta não pode consumir o orçamento de tempo do turno inteiro.
 */
const TIMEOUT_MS = 10_000;

/** Resultados pedidos por busca. Mais que isso é ruído que o modelo teria de
 *  ler e descartar — 5 resultados de qualidade valem mais que 10 medianos. */
const RESULT_COUNT = 5;

export interface WebSearchHit {
  titulo: string;
  link: string;
  resumo: string;
}

export type WebSearchResult =
  | { ok: true; resultados: WebSearchHit[] }
  | { ok: false; message: string };

/** A busca está configurada? Mesmo papel de `isDeepSeekConfigured`. */
export function isWebSearchConfigured(): boolean {
  return readApiKey() !== null;
}

function readApiKey(): string | null {
  const key = process.env.SERPER_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Busca uma consulta. NUNCA lança — qualquer falha vira `{ ok: false }` com uma
 * mensagem que o PRÓPRIO MODELO lê (não uma pessoa): é isso que o distingue de
 * `DeepSeekFailure`, que vira tela. Aqui a "tela" é o próximo turno da
 * conversa — o modelo recebe a falha como resultado da ferramenta e decide o
 * que fazer (avisar o autor, seguir sem aquele dado, tentar outra consulta).
 */
export async function webSearch(query: string): Promise<WebSearchResult> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return { ok: false, message: 'Busca não configurada neste servidor.' };
  }

  const consulta = query.trim().slice(0, 300);
  if (consulta.length === 0) {
    return { ok: false, message: 'Consulta vazia.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: consulta,
        gl: 'br',
        hl: 'pt-br',
        num: RESULT_COUNT,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logSafeError(`HTTP ${response.status} da API do Serper`, await safeBody(response));
      return { ok: false, message: `A busca falhou (HTTP ${response.status}).` };
    }

    const data = (await response.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
      knowledgeGraph?: { title?: string; description?: string };
    };

    const resultados: WebSearchHit[] = [];

    // O painel de conhecimento (quando existe) costuma responder a pergunta
    // direto, então entra PRIMEIRO — é o resultado mais denso de informação.
    if (data.knowledgeGraph?.description) {
      resultados.push({
        titulo: data.knowledgeGraph.title ?? consulta,
        link: '',
        resumo: data.knowledgeGraph.description,
      });
    }

    for (const item of data.organic ?? []) {
      if (!item.title || !item.snippet) continue;
      resultados.push({ titulo: item.title, link: item.link ?? '', resumo: item.snippet });
      if (resultados.length >= RESULT_COUNT) break;
    }

    if (resultados.length === 0) {
      return { ok: false, message: 'Nenhum resultado encontrado para esta consulta.' };
    }

    return { ok: true, resultados };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: 'A busca demorou demais e foi cancelada.' };
    }
    logSafeError('falha de rede ao chamar a API do Serper', error);
    return { ok: false, message: 'Não foi possível pesquisar agora.' };
  } finally {
    clearTimeout(timeout);
  }
}

/** Corpo de erro para log, curto e sem estourar se a leitura falhar. */
async function safeBody(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 500);
}

/** Log sem vazar credencial — mesmo cuidado de `deepseek.ts`. */
function logSafeError(context: string, detail: unknown): void {
  const text = detail instanceof Error ? detail.message : String(detail ?? '');
  const key = process.env.SERPER_API_KEY?.trim();
  const safe = key && key.length > 8 ? text.split(key).join('[chave omitida]') : text;
  console.warn(`[web-search] ${context}: ${safe}`);
}
