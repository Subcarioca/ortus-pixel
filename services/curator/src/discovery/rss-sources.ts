/**
 * =============================================================================
 * DESCOBERTA DE TÓPICOS VIA FEEDS RSS
 * =============================================================================
 *
 * Esta é a PORTA DE ENTRADA do pipeline: é aqui que assuntos novos entram no
 * sistema. Todo o resto (scoring, alertas, publicação) opera sobre o que este
 * módulo descobre.
 *
 * POR QUE RSS COMO FONTE PRIMÁRIA DE DESCOBERTA:
 *   - Custo zero e explicitamente permitido (feed existe para ser consumido).
 *   - Latência baixíssima: o feed do estúdio atualiza no instante do anúncio.
 *   - Cobertura excelente no nicho: praticamente todo estúdio, publisher e
 *     veículo mantém feed.
 *   - Resiliente: são dezenas de fontes independentes. Se cinco caírem, as
 *     outras continuam alimentando o sistema.
 *
 * A ORDEM DAS FONTES SEGUE A PRIORIZAÇÃO DE NEGÓCIO do briefing:
 *   1) Games  2) Cinema & Séries  3) Anime/HQ  4) Tech  5) Eventos
 * Cada fonte declara a fase do roadmap em que entra, então "ligar a Fase 2" é
 * mudar um número — não escrever código novo.
 */

import type { CategorySlug } from '@subcarioca/core';
import { fetchText } from '../connectors/http';
import type { SourceTier } from '@subcarioca/core';

export interface NewsSource {
  id: string;
  name: string;
  feedUrl: string;
  categorySlug: CategorySlug;
  /** Autoridade da fonte — alimenta diretamente o sinal `sourceAuthority`. */
  tier: SourceTier;
  /** Fase do roadmap em que esta fonte passa a ser coletada. */
  phase: 1 | 2 | 3;
  /** Idioma, para escolher o pipeline de tradução/normalização no futuro. */
  lang: 'pt' | 'en' | 'ja';
}

/**
 * CATÁLOGO DE FONTES.
 *
 * Note a mistura entre fontes OFICIAIS (blogs de estúdio) e IMPRENSA. As
 * oficiais são as mais valiosas: chegam primeiro e têm autoridade máxima, o que
 * as torna as candidatas naturais a publicação rápida com push.
 */
export const NEWS_SOURCES: NewsSource[] = [
  // ---------- FASE 1: GAMES (prioridade 1) ----------
  {
    id: 'rockstar-newswire',
    name: 'Rockstar Newswire',
    feedUrl: 'https://www.rockstargames.com/newswire/rss',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'playstation-blog',
    name: 'PlayStation Blog',
    feedUrl: 'https://blog.playstation.com/feed/',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'xbox-wire',
    name: 'Xbox Wire',
    feedUrl: 'https://news.xbox.com/en-us/feed/',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'nintendo-news',
    name: 'Nintendo News',
    feedUrl: 'https://www.nintendo.com/whatsnew/rss/',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'ign-games',
    name: 'IGN Games',
    feedUrl: 'https://feeds.feedburner.com/ign/games-all',
    categorySlug: 'games',
    tier: 'tier1Press',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'eurogamer',
    name: 'Eurogamer',
    feedUrl: 'https://www.eurogamer.net/feed',
    categorySlug: 'games',
    tier: 'tier1Press',
    phase: 1,
    lang: 'en',
  },

  // ---------- FASE 1: CINEMA & SÉRIES (prioridade 2) ----------
  {
    id: 'variety-film',
    name: 'Variety',
    feedUrl: 'https://variety.com/feed/',
    categorySlug: 'cinema-e-series',
    tier: 'tier1Press',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'hollywood-reporter',
    name: 'The Hollywood Reporter',
    feedUrl: 'https://www.hollywoodreporter.com/feed/',
    categorySlug: 'cinema-e-series',
    tier: 'tier1Press',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'deadline',
    name: 'Deadline',
    feedUrl: 'https://deadline.com/feed/',
    categorySlug: 'cinema-e-series',
    tier: 'tier1Press',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'marvel-news',
    name: 'Marvel.com',
    feedUrl: 'https://www.marvel.com/articles/rss',
    categorySlug: 'cinema-e-series',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },
  {
    id: 'starwars-news',
    name: 'StarWars.com',
    feedUrl: 'https://www.starwars.com/news/feed',
    categorySlug: 'cinema-e-series',
    tier: 'official',
    phase: 1,
    lang: 'en',
  },

  // ---------- FASE 2: ANIME & MANGÁ / HQs (prioridade 3) ----------
  {
    id: 'anime-news-network',
    name: 'Anime News Network',
    feedUrl: 'https://www.animenewsnetwork.com/all/rss.xml',
    categorySlug: 'anime-e-manga',
    tier: 'tier1Press',
    phase: 2,
    lang: 'en',
  },
  {
    id: 'crunchyroll-news',
    name: 'Crunchyroll News',
    feedUrl: 'https://www.crunchyroll.com/news/rss',
    categorySlug: 'anime-e-manga',
    tier: 'official',
    phase: 2,
    lang: 'en',
  },
  {
    id: 'comicbook-resources',
    name: 'CBR',
    feedUrl: 'https://www.cbr.com/feed/',
    categorySlug: 'hqs',
    tier: 'tier2Press',
    phase: 2,
    lang: 'en',
  },

  // ---------- FASE 2: TECH (prioridade 4, monetização por afiliados) ----------
  {
    id: 'the-verge',
    name: 'The Verge',
    feedUrl: 'https://www.theverge.com/rss/index.xml',
    categorySlug: 'tech',
    tier: 'tier1Press',
    phase: 2,
    lang: 'en',
  },

  // ---------- FASE 3: EVENTOS (prioridade 5) ----------
  {
    id: 'ccxp-news',
    name: 'CCXP',
    feedUrl: 'https://www.ccxp.com.br/feed/',
    categorySlug: 'eventos',
    tier: 'official',
    phase: 3,
    lang: 'pt',
  },
];

export interface DiscoveredItem {
  title: string;
  summary: string;
  url: string;
  publishedAt: Date;
  source: NewsSource;
}

/**
 * Parser de RSS/Atom.
 *
 * SEGURANÇA (XXE): usamos casamento por regex e NUNCA um parser de XML com
 * resolução de entidades. XML External Entity é uma vulnerabilidade clássica em
 * que o atacante publica no próprio feed algo como
 * `<!ENTITY x SYSTEM "file:///etc/passwd">` e faz o servidor ler arquivos
 * locais ou disparar requisições internas (SSRF). Como não interpretamos
 * entidades, o vetor não existe aqui.
 *
 * O conteúdo extraído é tratado como TEXTO em todo o percurso — nunca é
 * renderizado como HTML no site.
 */
function parseFeedItems(xml: string, source: NewsSource): DiscoveredItem[] {
  const items: DiscoveredItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];

  for (const block of blocks.slice(0, 30)) {
    const title = extractTag(block, 'title');
    if (!title) continue;

    const link = extractLink(block);
    if (!link) continue;

    const rawDate =
      extractTag(block, 'pubDate') ??
      extractTag(block, 'published') ??
      extractTag(block, 'updated');

    const parsedDate = rawDate ? new Date(rawDate) : new Date();
    const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    const summary =
      extractTag(block, 'description') ?? extractTag(block, 'summary') ?? '';

    items.push({
      // ⚠ O CORTE EM 250 NÃO É COSMÉTICO — ele protege uma coluna do banco.
      //
      // Este título vai parar em `Topic.title`, que é `@db.VarChar(255)`. O
      // valor vem do feed RSS de um TERCEIRO: não temos controle nenhum sobre o
      // tamanho, e manchete de 300 caracteres existe. Sem o corte, e como o
      // servidor MySQL não está em `sql_mode` estrito, o título seria TRUNCADO
      // em silêncio na gravação — dentro do `$transaction` do curator, num
      // processo de fundo, sem erro em lugar nenhum.
      //
      // 250 e não 255: a margem de 5 existe porque o truncamento do MySQL conta
      // em CARACTERES para `VARCHAR`, mas quem grava é o Prisma e quem lê o
      // limite é este arquivo — deixar exatamente no limite é convidar um
      // off-by-one que só aparece na manchete mais longa do ano.
      //
      // POR QUE AQUI E NÃO EM `curate.ts`: esta é a FRONTEIRA por onde o dado
      // externo entra no sistema. `curate.ts` já corta `query` em 200, mas isso
      // é um segundo cinto; se o corte só existisse lá, qualquer caminho novo
      // que consumisse `DiscoveredItem` herdaria o bug de novo. Dado hostil se
      // trata na porta.
      title: stripHtml(title).slice(0, 250),
      // Limitamos o tamanho: alguns feeds mandam o artigo inteiro na descrição,
      // e não precisamos guardar 40 KB por item só para gerar um resumo.
      // (`Topic.summary` é `@db.Text`, então aqui o motivo é econômico, não de
      // integridade — ao contrário do título acima.)
      summary: stripHtml(summary).slice(0, 500),
      url: link,
      publishedAt,
      source,
    });
  }

  return items;
}

function extractTag(block: string, tag: string): string | null {
  const cdata = block.match(
    new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'),
  );
  if (cdata?.[1]) return decodeEntities(cdata[1].trim());

  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain?.[1] ? decodeEntities(plain[1].trim()) : null;
}

/** Atom usa <link href="..."/>; RSS usa <link>...</link>. Tratamos os dois. */
function extractLink(block: string): string | null {
  const atom = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (atom?.[1]) return atom[1];

  const rss = extractTag(block, 'link');
  return rss;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Lê todas as fontes ativas da fase informada.
 *
 * RESILIÊNCIA: `Promise.allSettled` + limite de concorrência. Feeds que falham
 * são registrados e ignorados; os demais seguem. Uma fonte fora do ar nunca
 * impede a descoberta pelas outras.
 */
export async function discoverFromFeeds(options: {
  phase: 1 | 2 | 3;
  /** Só itens publicados nas últimas N horas. */
  maxAgeHours?: number;
  timeoutMs?: number;
}): Promise<{ items: DiscoveredItem[]; failedSources: string[] }> {
  const { phase, maxAgeHours = 6, timeoutMs = 8000 } = options;

  const activeSources = NEWS_SOURCES.filter((s) => s.phase <= phase);
  const cutoff = Date.now() - maxAgeHours * 3_600_000;

  const results = await Promise.allSettled(
    activeSources.map(async (source) => {
      const xml = await fetchText(source.feedUrl, { timeoutMs, maxRetries: 1 });
      return parseFeedItems(xml, source);
    }),
  );

  const items: DiscoveredItem[] = [];
  const failedSources: string[] = [];

  results.forEach((result, index) => {
    const source = activeSources[index]!;
    if (result.status === 'fulfilled') {
      items.push(...result.value.filter((item) => item.publishedAt.getTime() > cutoff));
    } else {
      failedSources.push(source.id);
    }
  });

  if (failedSources.length > 0) {
    console.warn(
      `[discovery] ${failedSources.length}/${activeSources.length} fontes falharam: ${failedSources.join(', ')}`,
    );
  }

  // Mais recentes primeiro: se houver limite de processamento por ciclo,
  // queremos gastar o orçamento com o que é novo.
  return {
    items: items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
    failedSources,
  };
}
