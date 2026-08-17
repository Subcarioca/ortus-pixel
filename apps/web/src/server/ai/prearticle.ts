import 'server-only';

import { chatCompletion } from './deepseek';
import type { PreArticleOutput } from './prearticle-types';

/**
 * =============================================================================
 * GERAÇÃO DE PRÉ-MATÉRIA — do tópico do curator à pauta estruturada
 * =============================================================================
 *
 * Transforma uma pauta sugerida pelo curator (um `Topic` no banco) numa
 * pré-matéria pronta para o editor revisar e publicar. Toda a inteligência de
 * REDAÇÃO está no prompt; este módulo só faz três coisas mecânicas:
 *
 *   1. Monta o prompt com as variáveis reais do tópico;
 *   2. Chama o modelo em modo JSON;
 *   3. Valida/coage o JSON de volta para o contrato tipado.
 *
 * A separação de responsabilidades é proposital: mudar o tom ou a estrutura do
 * texto é editar o prompt, sem tocar em código de rede nem no painel.
 */

/** Portais de referência padrão — os maiores do nicho, em PT-BR e global. */
export const DEFAULT_REFERENCE_SOURCES = ['IGN', 'EiNerd', 'JovemNerd', 'Omelete', 'The Enemy'];

export interface PreArticleInput {
  pauta: string;
  tituloOriginal: string;
  idiomaOriginal: 'en' | 'pt';
  scorePopularidade: number;
  nicho: string;
  fontesReferencia: string;
}

/**
 * Heurística leve de idioma do título.
 *
 * Não temos o idioma do título no schema (o curator não o registra), então
 * estimamos: acentos/cedilha ou palavras funcionais portuguesas são marcadores
 * fortes o suficiente para o propósito (o prompt usa isso só como dica de
 * contexto, não como regra de tradução). Um erro aqui não quebra nada — o
 * modelo lê o próprio título.
 */
export function detectLanguage(text: string): 'en' | 'pt' {
  if (/[áàâãéêíóôõúç]/i.test(text)) return 'pt';
  if (/\b(de|do|da|em|que|para|com|não|nao|sobre|após|apos|nova|novo)\b/i.test(text)) return 'pt';
  return 'en';
}

/**
 * Monta o prompt do REDATOR-CHEFE com as variáveis do tópico.
 *
 * O texto é o contrato editorial da funcionalidade: determina o tom, a
 * estrutura da pré-matéria e o formato JSON de saída. Qualquer mudança de
 * requisito de redação entra AQUI.
 */
function buildSystemPrompt(input: PreArticleInput): string {
  return `Você é o REDATOR-CHEFE de um portal de cultura pop/geek chamado OrtusPixel. Sua função é transformar uma pauta quente em uma pré-matéria pronta para publicação, em português do Brasil, que maximize captação de tráfego, retenção de leitura e exploração do hype atual.

## ENTRADA (variáveis fornecidas pelo site)
- PAUTA: ${input.pauta}  (assunto/tópico escolhido pelo usuário a partir das sugestões do curator)
- TÍTULO ORIGINAL: ${input.tituloOriginal}
- IDIOMA ORIGINAL: ${input.idiomaOriginal}  (en ou pt)
- SCORE DE POPULARIDADE: ${input.scorePopularidade}  (0–100, calculado pelo curator)
- NICHO: ${input.nicho}  (games, cinema, séries, animes, tech, esports, etc.)
- FONTES DE REFERÊNCIA: ${input.fontesReferencia}  (ex.: IGN, EiNerd, JovemNerd e os maiores do nicho)

## TAREFA (execute nesta ordem)

### 1. CONTEXTUALIZAÇÃO DA PAUTA
Reescreva a pauta em português do Brasil, em até 3 frases, deixando claro: o que aconteceu, por que importa agora e para quem importa. Preserve fatos verificáveis; não invente datas, nomes, números ou declarações.

### 2. ANÁLISE DO HYPE (base factual)
Identifique os motivos objetivos do assunto estar em alta, citando os sinais observados em ${input.fontesReferencia} e nos maiores portais do nicho: volume de cobertura, picos de busca, movimentação em redes sociais, anúncios/trailers/lançamentos, controvérsias ou eventos recentes.

### 3. MODELO PROVÁVEL DE POPULARIDADE
Classifique a trajetória provável da popularidade desse assunto usando UMA destas categorias (e justifique em 2–3 frases):

- "SPIKE VIRAL" — pico imediato e queda rápida (ex.: meme, polêmica, vazamento pontual).
- "CRESCIMENTO SUSTENTADO" — alta mantida por semanas/meses (ex.: lançamento com roadmap, saga em andamento).
- "ONDA CÍCLICA" — picos que se repetem a cada novo anúncio/episódio/atualização (ex.: temporada de série, DLC de jogo).
- "EVERGREEN COM PICO" — assunto sempre relevante que sofre picos pontuais (ex.: guias, listas, curiosidades).
- "DECLÍNIO IMINENTE" — hype já no topo, com tendência de esfriar (cuidado com timing).

Para o modelo escolhido, informe:
a) Momento estimado do pico (agora / em dias / em semanas / já passou);
b) Janela ideal de publicação e risco de chegar tarde;
c) Estratégia de posicionamento do título e da abertura para surfar essa curva.

### 4. PRÉ-MATÉRIA (o texto principal)
Escreva a pré-matéria em português do Brasil, com estrutura pensada para RETER o leitor até o fim:

- TÍTULO (máx. 70 caracteres): magnético, com a palavra-chave do hype, sem clickbait enganoso. Use números, nomes fortes ou urgência quando verdadeiros.
- SUBTÍTULO/DEQUE (1–2 linhas): promessa clara do que o leitor ganha ao continuar.
- ABERTURA (1 parágrafo): gancho forte nos primeiros 10 segundos — a novidade mais impactante primeiro, sem enrolação.
- CORPO (3–6 blocos): desenvolva a informação em ordem decrescente de importância (pirâmide invertida). Inclua contexto, o "porquê isso é grande", e o que vem a seguir (o que se sabe/rumores claramente sinalizados como rumores).
- FECHAMENTO + CTA: encerre com uma pergunta ou convite à opinião do leitor ("O que você acha? Comente abaixo") e, se houver, uma chamada para acompanhar atualizações futuras.
- EXTRAS DE RETENÇÃO (escolha 2): uma lista, uma pergunta ao leitor, um "o que esperar a seguir", uma comparação ou um "por que você deveria se importar".

### 5. OTIMIZAÇÃO PARA CAPTAÇÃO
- SEO: inclua 1 palavra-chave principal + 2 secundárias naturais no título e no primeiro parágrafo. Sugira a meta description (máx. 155 caracteres).
- COMPARTILHAMENTO: sugira 3 títulos alternativos otimizados para redes sociais (cada um com tom diferente: informativo, provocativo, emocional).
- HASHTAGS: liste 5 hashtags relevantes ao nicho e ao hype.

## REGRAS DE QUALIDADE (obrigatórias)
1. LINGUAGEM: português do Brasil, tom informal e apaixonado de cultura pop, mas jornalístico — sem achismo apresentado como fato.
2. FATOS vs. RUMORES: separe claramente o que é confirmado do que é rumor/expectativa. Sinalize rumores com "segundo rumores" ou "ainda não confirmado".
3. PROIBIÇÕES: nada de clickbait enganoso, plágio de texto das fontes, ou fabricação de citações/dados.
4. TAMANHO: pré-matéria entre 400 e 800 palavras.
5. FORMATO DE SAÍDA: siga exatamente a estrutura JSON abaixo, sem texto fora dela.

## FORMATO DE SAÍDA (JSON)
{
  "contextualizacao": "...",
  "analise_hype": ["...", "..."],
  "modelo_popularidade": {
    "categoria": "...",
    "justificativa": "...",
    "momento_pico": "...",
    "janela_publicacao": "...",
    "risco_timing": "...",
    "estrategia_posicionamento": "..."
  },
  "pre_materia": {
    "titulo": "...",
    "subtitulo": "...",
    "abertura": "...",
    "corpo": ["...", "..."],
    "fechamento_cta": "...",
    "extras_retencao": ["...", "..."]
  },
  "otimizacao": {
    "palavra_chave_principal": "...",
    "palavras_chave_secundarias": ["...", "..."],
    "meta_description": "...",
    "titulos_sociais": ["...", "...", "..."],
    "hashtags": ["...", "...", "...", "...", "..."]
  }
}`;
}

/**
 * Converte o texto cru do modelo no contrato tipado.
 *
 * O modelo devolve JSON válido (modo JSON ativo), mas a forma exata pode variar
 * levemente (cerca ```json```, campo ausente). Coagimos para o tipo em vez de
 * confiar cegamente — um campo faltando vira string vazia, nunca `undefined`
 * que estouraria o painel. Ver o princípio da guarda defensiva no dispatcher.
 */
function parsePreArticle(raw: string): PreArticleOutput {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('A IA devolveu uma resposta que não é JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A IA devolveu uma resposta sem a estrutura esperada.');
  }

  const obj = parsed as {
    contextualizacao?: unknown;
    analise_hype?: unknown;
    modelo_popularidade?: {
      categoria?: unknown;
      justificativa?: unknown;
      momento_pico?: unknown;
      janela_publicacao?: unknown;
      risco_timing?: unknown;
      estrategia_posicionamento?: unknown;
    };
    pre_materia?: {
      titulo?: unknown;
      subtitulo?: unknown;
      abertura?: unknown;
      corpo?: unknown;
      fechamento_cta?: unknown;
      extras_retencao?: unknown;
    };
    otimizacao?: {
      palavra_chave_principal?: unknown;
      palavras_chave_secundarias?: unknown;
      meta_description?: unknown;
      titulos_sociais?: unknown;
      hashtags?: unknown;
    };
  };

  return {
    contextualizacao: str(obj.contextualizacao),
    analise_hype: strArray(obj.analise_hype),
    modelo_popularidade: {
      categoria: str(obj.modelo_popularidade?.categoria),
      justificativa: str(obj.modelo_popularidade?.justificativa),
      momento_pico: str(obj.modelo_popularidade?.momento_pico),
      janela_publicacao: str(obj.modelo_popularidade?.janela_publicacao),
      risco_timing: str(obj.modelo_popularidade?.risco_timing),
      estrategia_posicionamento: str(obj.modelo_popularidade?.estrategia_posicionamento),
    },
    pre_materia: {
      titulo: str(obj.pre_materia?.titulo),
      subtitulo: str(obj.pre_materia?.subtitulo),
      abertura: str(obj.pre_materia?.abertura),
      corpo: strArray(obj.pre_materia?.corpo),
      fechamento_cta: str(obj.pre_materia?.fechamento_cta),
      extras_retencao: strArray(obj.pre_materia?.extras_retencao),
    },
    otimizacao: {
      palavra_chave_principal: str(obj.otimizacao?.palavra_chave_principal),
      palavras_chave_secundarias: strArray(obj.otimizacao?.palavras_chave_secundarias),
      meta_description: str(obj.otimizacao?.meta_description),
      titulos_sociais: strArray(obj.otimizacao?.titulos_sociais),
      hashtags: strArray(obj.otimizacao?.hashtags),
    },
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Gera a pré-matéria completa.
 * @throws {Error} com mensagem legível quando a chave falta, a API falha ou o
 * JSON de resposta é inválido — o chamador traduz para o painel.
 */
export async function generatePreArticle(input: PreArticleInput): Promise<PreArticleOutput> {
  const content = await chatCompletion({
    messages: [
      { role: 'system', content: buildSystemPrompt(input) },
      { role: 'user', content: 'Execute a tarefa e devolva APENAS o JSON, sem texto fora dele.' },
    ],
    jsonMode: true,
  });

  return parsePreArticle(content);
}
