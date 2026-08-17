import 'server-only';

/**
 * =============================================================================
 * CLIENTE DEEPSEEK — mínimo, sem SDK
 * =============================================================================
 *
 * A API do DeepSeek é compatível com o formato OpenAI (`chat/completions`). Em
 * vez de adicionar o SDK `openai` (dezenas de dependências transitivas),
 * fazemos um `fetch` direto. É o mesmo princípio do stemmer próprio do curator:
 * precisamos de UMA chamada bem definida, não de uma camada de abstração que
 * traga risco de supply chain sem pagar o custo.
 *
 * A chave NUNCA sai do servidor: o `import 'server-only'` faz qualquer
 * importação a partir de um componente cliente quebrar em build.
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(options: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  // Falha clara e cedo: sem chave, não há o que tentar. (Deixar o fetch estourar
  // com 401 devolveria ao editor uma mensagem enigmática em vez da causa real.)
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY não configurada. Adicione a chave no ambiente.');
  }

  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      // Modo JSON: o provedor garante que a resposta é um objeto JSON válido.
      // O DeepSeek exige que a palavra "json" apareça no prompt quando este modo
      // está ativo — nosso prompt contém "FORMATO DE SAÍDA (JSON)".
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    // Sem timeout artificial: uma pré-matéria pode levar alguns segundos, e um
    // corte prematuro custaria a geração inteira. O painel já lida com a espera.
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek respondeu ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('DeepSeek devolveu resposta vazia.');
  }

  return content;
}
