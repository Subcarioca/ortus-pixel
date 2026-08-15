/**
 * =============================================================================
 * CONECTOR: CONCORRÊNCIA DE SERP — a janela de oportunidade
 * =============================================================================
 *
 * Item 8 do briefing: quantos grandes portais já publicaram sobre o tópico.
 * Quanto MENOS concorrência, maior a oportunidade — por isso a dimensão se
 * chama `serpOpportunity` e é INVERTIDA: valor alto = janela aberta.
 *
 * DECISÃO DE ARQUITETURA QUE ECONOMIZA MUITO DINHEIRO:
 *
 * A abordagem óbvia seria consultar uma API de SERP (DataForSEO, SerpApi) e
 * contar quantos concorrentes aparecem. Funciona, mas custa por consulta e,
 * pior, tem LATÊNCIA DE INDEXAÇÃO: o Google leva minutos a horas para indexar
 * uma matéria nova. Justamente na primeira hora — quando a decisão de publicar
 * rápido precisa ser tomada — a SERP ainda está vazia e o sinal seria inútil.
 *
 * A abordagem adotada aqui: monitorar os FEEDS RSS dos concorrentes
 * diretamente. Vantagens:
 *   - Custo ZERO e totalmente dentro dos termos de uso (RSS existe para isso).
 *   - LATÊNCIA QUASE ZERO: o feed atualiza no instante da publicação, muito
 *     antes de o Google indexar. Descobrimos que o Omelete publicou em 2
 *     minutos, não em 2 horas.
 *   - Precisão maior: sabemos exatamente QUEM publicou e QUANDO, em vez de
 *     inferir por posição no buscador.
 *
 * A API paga fica como complemento opcional para tópicos evergreen, onde a
 * dificuldade real de rankear (autoridade de domínio dos que já estão lá)
 * importa mais do que a velocidade.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@subcarioca/core';
import { clamp } from '@subcarioca/core';

import { deterministicRandom, fetchText } from './http';

/**
 * Feeds dos concorrentes diretos citados no briefing.
 * `weight` reflete o quanto a presença de cada um reduz nossa oportunidade:
 * se o Omelete (alta autoridade) publicou, a janela fecha mais do que se um
 * portal menor publicou.
 */
const COMPETITOR_FEEDS: { name: string; url: string; weight: number }[] = [
  { name: 'Omelete', url: 'https://www.omelete.com.br/rss', weight: 1.0 },
  { name: 'JovemNerd', url: 'https://jovemnerd.com.br/feed', weight: 1.0 },
  { name: 'IGN Brasil', url: 'https://br.ign.com/feed.xml', weight: 0.95 },
  { name: 'Legião dos Heróis', url: 'https://www.legiaodosherois.com.br/feed', weight: 0.8 },
  { name: 'EiNerd', url: 'https://www.einerd.com.br/feed/', weight: 0.7 },
  { name: 'The Enemy', url: 'https://www.theenemy.com.br/rss', weight: 0.75 },
];

interface FeedItem {
  title: string;
  publishedAt: Date;
  source: string;
  sourceWeight: number;
}

/**
 * Cache dos feeds, compartilhado por todos os tópicos do ciclo.
 * Sem isso, 200 tópicos x 6 feeds = 1.200 requisições por ciclo — o que nos
 * transformaria, na prática, num atacante de negação de serviço dos
 * concorrentes. Com cache de 5 minutos, são 6 requisições por ciclo.
 */
let feedCache: { items: FeedItem[]; fetchedAt: number } | null = null;
const FEED_TTL_MS = 5 * 60 * 1000;

/**
 * Parser de RSS/Atom mínimo, por expressão regular.
 *
 * POR QUE NÃO USAR UMA BIBLIOTECA DE XML: só precisamos de título e data de
 * ~30 itens por feed. Um parser completo traria dependência, superfície de
 * ataque (XXE — XML External Entity — é uma classe de vulnerabilidade clássica
 * em parsers XML mal configurados) e nenhum ganho real.
 *
 * SEGURANÇA: como usamos regex e nunca avaliamos entidades externas, XXE é
 * impossível por construção. O conteúdo extraído é tratado como TEXTO em todo
 * o percurso e jamais renderizado como HTML.
 */
function parseFeed(xml: string, source: string, sourceWeight: number): FeedItem[] {
  const items: FeedItem[] = [];

  // Casa tanto <item> (RSS) quanto <entry> (Atom).
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];

  for (const block of blocks.slice(0, 40)) {
    const titleMatch =
      block.match(/<title[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i) ??
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    const dateMatch =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ??
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ??
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

    if (!titleMatch?.[1]) continue;

    const title = decodeEntities(titleMatch[1].trim());
    const publishedAt = dateMatch?.[1] ? new Date(dateMatch[1].trim()) : new Date();

    // Data inválida vira "agora": é o pressuposto conservador (assume que o
    // concorrente publicou recentemente, o que REDUZ nossa oportunidade e evita
    // que erro de parsing nos faça correr para uma pauta já saturada).
    items.push({
      title,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
      source,
      sourceWeight,
    });
  }

  return items;
}

/** Decodifica as entidades XML básicas e as numéricas — suficiente para títulos. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Entidades numéricas (ex.: &#8216; &#8217; &#8230; — aspas curvas e
    // reticências, comuns em feeds de imprensa em inglês).
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    // `&amp;` por último, senão desfaz as substituições anteriores.
    .replace(/&amp;/g, '&');
}

async function getCompetitorItems(timeoutMs: number): Promise<FeedItem[]> {
  if (feedCache && Date.now() - feedCache.fetchedAt < FEED_TTL_MS) {
    return feedCache.items;
  }

  // `allSettled` e não `all`: se o feed do EiNerd estiver fora do ar, queremos
  // os outros cinco mesmo assim. Com `all`, uma falha zeraria tudo.
  const results = await Promise.allSettled(
    COMPETITOR_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url, { timeoutMs, maxRetries: 1 });
      return parseFeed(xml, feed.name, feed.weight);
    }),
  );

  const items = results
    .filter((r): r is PromiseFulfilledResult<FeedItem[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[serp-competition] ${failed}/${COMPETITOR_FEEDS.length} feeds falharam.`);
  }

  // Só cacheamos se ao menos um feed respondeu — cachear vazio esconderia uma
  // falha total de rede por 5 minutos.
  if (items.length > 0) {
    feedCache = { items, fetchedAt: Date.now() };
  }

  return items;
}

/** Mesma heurística de casamento do conector de YouTube (ver comentário lá). */
function matchesTopic(title: string, terms: string[]): boolean {
  const lower = title.toLowerCase();
  return terms.some((term) => {
    const words = term
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    if (words.length === 0) return false;
    return words.filter((w) => lower.includes(w)).length / words.length >= 0.6;
  });
}

export const serpCompetitionConnector: SignalConnector = {
  id: 'serp-competition',
  displayName: 'Concorrência publicada',
  dimensions: ['serpOpportunity'],
  // Grátis (RSS), mas fica no enriquecimento porque faz I/O de rede e o cache
  // já é preenchido pelo primeiro tópico do ciclo.
  cost: 'free',
  stage: 'enrichment',
  timeoutMs: 8000,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const observedAt = new Date();
    const terms = [context.query, ...context.aliases];

    let items: FeedItem[];
    let confidence = 0.85;

    try {
      items = await getCompetitorItems(this.timeoutMs);
      if (items.length === 0) {
        return mockMeasurement(context, this.id, observedAt);
      }
    } catch (error) {
      console.warn(
        '[serp-competition] falha ao ler feeds:',
        error instanceof Error ? error.message : error,
      );
      return mockMeasurement(context, this.id, observedAt, 0.15);
    }

    // Consideramos só as últimas 48h: o que o Omelete publicou mês passado não
    // afeta a janela de oportunidade da notícia de hoje.
    const cutoff = Date.now() - 48 * 3_600_000;
    const competing = items.filter(
      (item) => item.publishedAt.getTime() > cutoff && matchesTopic(item.title, terms),
    );

    // Soma ponderada pela autoridade de cada concorrente.
    const competitionScore = competing.reduce((acc, item) => acc + item.sourceWeight, 0);

    // Mapeamento para oportunidade (invertido):
    //   0 concorrentes    -> 1.00 (janela totalmente aberta: furo!)
    //   1 concorrente     -> ~0.75
    //   2 concorrentes    -> ~0.55
    //   4 concorrentes    -> ~0.30
    //   6+ concorrentes   -> ~0.10 (assunto saturado)
    const opportunity = clamp(Math.exp(-0.35 * competitionScore));

    const uniqueSources = [...new Set(competing.map((c) => c.source))];

    return [
      {
        dimension: 'serpOpportunity',
        connectorId: this.id,
        value: opportunity,
        rawValue: competing.length,
        explanation:
          competing.length === 0
            ? 'FURO: nenhum concorrente publicou ainda'
            : `${competing.length} matéria(s) concorrente(s) em ${uniqueSources.join(', ')}`,
        confidence,
        observedAt,
      },
    ];
  },
};

function mockMeasurement(
  context: SignalContext,
  connectorId: string,
  observedAt: Date,
  confidenceOverride?: number,
): SignalMeasurement[] {
  const seed = context.query.toLowerCase();
  const competitors = Math.floor(deterministicRandom(seed + ':serp', 0, 6));
  return [
    {
      dimension: 'serpOpportunity',
      connectorId,
      value: clamp(Math.exp(-0.35 * competitors)),
      rawValue: competitors,
      explanation: `${competitors} concorrente(s) (simulado)`,
      confidence: confidenceOverride ?? 0.3,
      observedAt,
    },
  ];
}
