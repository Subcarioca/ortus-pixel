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
 *
 * -----------------------------------------------------------------------------
 * IDIOMA DAS PAUTAS — por que há fontes em inglês E em português (agosto/2026)
 * -----------------------------------------------------------------------------
 * A primeira execução real em produção trouxe quase tudo em inglês, e o motivo
 * era estrutural: 14 das 15 fontes eram veículos americanos. Havia dois
 * caminhos possíveis, e o dono do site escolheu conscientemente o segundo:
 *
 *   (A) TROCAR as fontes americanas por brasileiras. Resolveria o idioma, mas
 *       jogaria fora justamente as fontes que chegam PRIMEIRO — anúncio de
 *       estúdio e imprensa internacional publicam horas antes do portal
 *       brasileiro traduzir. Perderíamos vantagem de tempo, que é o produto.
 *
 *   (B) SOMAR fontes brasileiras às internacionais e REESCREVER para pt-BR tudo
 *       o que nasce em outra língua (ver `pipeline/rewrite-ptbr.ts`).
 *
 * Por isso a lista abaixo é bilíngue de propósito. O campo `lang` deixou de ser
 * documentação e virou CHAVE DE DECISÃO: é ele que diz ao pipeline quais itens
 * precisam passar pela reescrita — fonte `pt` pula a etapa (e o custo de API).
 *
 * CONSEQUÊNCIA ACEITA: publisher oficial com blog nos dois idiomas (PlayStation,
 * Xbox) aparece duas vezes na lista. Não é engano. O post em português chega
 * pronto e sem custo; o em inglês costuma sair primeiro. A deduplicação
 * (`pipeline/dedupe.ts`) resolve o encontro dos dois — e resolve BEM justamente
 * porque a reescrita roda ANTES dela, deixando os dois títulos no mesmo idioma
 * antes da comparação por tokens. Ver o comentário da etapa [1.5] em `curate.ts`.
 *
 * FONTES BRASILEIRAS PROCURADAS E NÃO INCLUÍDAS (verificado em 15/08/2026 —
 * registrado aqui para ninguém refazer a pesquisa):
 *   - Omelete: NÃO publica mais RSS. `/rss`, `/feed` e `/rss.xml` devolvem 404 e
 *     a home não declara nenhum <link rel="alternate"> de feed.
 *   - AdoroCinema: sem RSS (a plataforma AlloCiné descontinuou; devolve JSON 404).
 *   - Jovem Nerd: `/feed` e `/rss` devolvem 404.
 *   - The Enemy: domínio não resolve mais (site encerrado).
 *   - ANMTV: conexão recusada a partir do servidor (provável bloqueio de borda);
 *     mesmo que voltasse, fonte que bloqueia o nosso agente é fonte morta.
 *   - AnimeNew, Cinema em Cena, Manga Livre: sem endpoint de feed válido.
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
  /**
   * Idioma em que a fonte PUBLICA.
   *
   * NÃO é metadado decorativo: `pipeline/rewrite-ptbr.ts` usa este campo para
   * decidir quem passa pela reescrita para português. Marcar como `pt` uma fonte
   * que publica em inglês faz a pauta chegar em inglês à fila da redação; marcar
   * como `en` uma fonte brasileira gasta uma chamada de API para reescrever o
   * que já estava certo. Os dois erros são silenciosos — confira ao adicionar.
   */
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

  // ---------- FASE 1: GAMES — fontes brasileiras ----------
  // Todas verificadas em 15/08/2026 com o MESMO user-agent que o curator usa em
  // produção: um feed que responde no navegador mas bloqueia o nosso agente não
  // serve, e esse é um erro que só apareceria depois do deploy.
  {
    id: 'ign-brasil',
    name: 'IGN Brasil',
    feedUrl: 'https://br.ign.com/feed.xml',
    // Operação brasileira do IGN, com redação própria e volume alto (40 itens
    // no feed). É a fonte de games em português com maior cobertura hoje.
    categorySlug: 'games',
    tier: 'tier1Press',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline',
    feedUrl: 'https://www.adrenaline.com.br/feed/',
    categorySlug: 'games',
    tier: 'tier2Press',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'arkade',
    name: 'Arkade',
    // CADÊNCIA BAIXA (medido em 15/08/2026: post mais recente do feed era de
    // 31/07). O feed é válido e responde bem — só publica pouco. Mantido porque
    // custa uma requisição por ciclo e cobre indies e retrô, que as fontes
    // grandes ignoram. Se um dia a lista precisar encolher, comece por aqui.
    feedUrl: 'https://arkade.com.br/feed/',
    categorySlug: 'games',
    tier: 'tier2Press',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'gameblast',
    name: 'GameBlast',
    feedUrl: 'https://www.gameblast.com.br/feeds/posts/default?alt=rss',
    categorySlug: 'games',
    tier: 'tier2Press',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'playstation-blog-br',
    name: 'PlayStation.Blog Brasil',
    // ⚠ NÃO use `blog.playstation.com/pt-br/feed/`: aquele endereço responde 200
    // com um feed de COMENTÁRIOS vazio (título literal "Comments on:"), ou seja,
    // falharia em silêncio para sempre — nunca erro, nunca item. O feed editorial
    // brasileiro é este, em domínio próprio.
    feedUrl: 'https://blog.br.playstation.com/feed/',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'xbox-wire-br',
    name: 'Xbox Wire em Português',
    feedUrl: 'https://news.xbox.com/pt-br/feed/',
    categorySlug: 'games',
    tier: 'official',
    phase: 1,
    lang: 'pt',
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

  // ---------- FASE 1: CINEMA & SÉRIES — fontes brasileiras ----------
  // Esta é a editoria com MENOS opção verificável em português: os dois nomes
  // mais óbvios (Omelete e AdoroCinema) simplesmente não publicam mais RSS — ver
  // a lista de descartados no cabeçalho. Sobraram estes dois, ambos ativos.
  {
    id: 'cinepop',
    name: 'CinePOP',
    feedUrl: 'https://cinepop.com.br/feed/',
    categorySlug: 'cinema-e-series',
    tier: 'tier2Press',
    phase: 1,
    lang: 'pt',
  },
  {
    id: 'legiao-dos-herois',
    name: 'Legião dos Heróis',
    feedUrl: 'https://www.legiaodosherois.com.br/feed',
    categorySlug: 'cinema-e-series',
    tier: 'tier2Press',
    phase: 1,
    lang: 'pt',
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

  // ---------- FASE 2: ANIME & MANGÁ — fontes brasileiras ----------
  {
    id: 'jbox',
    name: 'JBox',
    feedUrl: 'https://www.jbox.com.br/feed/',
    categorySlug: 'anime-e-manga',
    tier: 'tier2Press',
    phase: 2,
    lang: 'pt',
  },
  {
    id: 'intoxianime',
    name: 'IntoxiAnime',
    feedUrl: 'https://www.intoxianime.com/feed/',
    categorySlug: 'anime-e-manga',
    tier: 'tier2Press',
    phase: 2,
    lang: 'pt',
  },
  {
    id: 'anime-united',
    name: 'Anime United',
    feedUrl: 'https://www.animeunited.com.br/feed/',
    categorySlug: 'anime-e-manga',
    tier: 'tier2Press',
    phase: 2,
    lang: 'pt',
  },

  // ---------- FASE 2: HQs — fonte brasileira ----------
  {
    id: 'universo-hq',
    name: 'Universo HQ',
    // Veterano do nicho (desde 1999) e praticamente o único feed de quadrinhos
    // em português ainda ativo. Cobre editora nacional (Panini, JBC), que
    // nenhuma fonte americana cobre — não é redundância do CBR.
    //
    // CADÊNCIA BAIXA e esperada: publica colunas, não notícia de minuto a minuto
    // (em 15/08/2026 o item mais recente do feed era de 22/07). Um ciclo que não
    // traz nada daqui é o normal, não um defeito a investigar.
    feedUrl: 'https://universohq.com/feed/',
    categorySlug: 'hqs',
    tier: 'tier2Press',
    phase: 2,
    lang: 'pt',
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

  // ---------- FASE 2: TECH — fontes brasileiras ----------
  // Editoria de maior peso de afiliados (`affiliateWeight: 1.0` na taxonomia), e
  // é onde a fonte brasileira vale MAIS que a americana: preço, disponibilidade
  // e lançamento no Brasil são exatamente o que o leitor daqui procura antes de
  // comprar — e é informação que o The Verge nunca vai dar.
  {
    id: 'tecmundo',
    name: 'TecMundo',
    // O domínio principal NÃO serve o feed (`tecmundo.com.br/rss` redireciona
    // para uma página HTML de tags); o feed vive neste subdomínio dedicado.
    feedUrl: 'https://rss.tecmundo.com.br/feed',
    categorySlug: 'tech',
    tier: 'tier1Press',
    phase: 2,
    lang: 'pt',
  },
  {
    id: 'canaltech',
    name: 'Canaltech',
    feedUrl: 'https://canaltech.com.br/rss/',
    categorySlug: 'tech',
    tier: 'tier1Press',
    phase: 2,
    lang: 'pt',
  },
  {
    id: 'tecnoblog',
    name: 'Tecnoblog',
    feedUrl: 'https://tecnoblog.net/feed/',
    categorySlug: 'tech',
    tier: 'tier2Press',
    phase: 2,
    lang: 'pt',
  },

  // ---------- FASE 3: EVENTOS (prioridade 5) ----------
  {
    id: 'ccxp-news',
    name: 'CCXP',
    // ⚠ FONTE QUEBRADA NA ORIGEM (verificado em 15/08/2026): este endereço, e
    // também `/rss`, `/feed` e `/noticias/feed`, devolvem 404 em HTML. O site da
    // CCXP foi refeito em stack JavaScript e não expõe mais feed nenhum.
    //
    // Está mantida aqui, e não removida, por decisão consciente: a categoria
    // Eventos só entra na Fase 3 (não é coletada hoje) e apagar a linha faria a
    // lacuna sumir do código junto com a entrada. Ela falha de forma barata e
    // visível — `discoverFromFeeds` a registra em `failedSources` e o ciclo
    // segue. Antes de ligar a Fase 3, é preciso decidir o substituto: nenhum
    // organizador de evento brasileiro verificado (CCXP, BGS, Anime Friends)
    // publica RSS com itens hoje. O caminho provável é cobrir evento pelas
    // fontes de imprensa que já estão nesta lista, em vez de por feed próprio.
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
  /**
   * Título como saiu do feed, preenchido APENAS quando a reescrita para pt-BR
   * trocou o texto (ver `pipeline/rewrite-ptbr.ts`).
   *
   * POR QUE GUARDAR: sem isto, um erro de reescrita ("Hollow Knight: Silksong"
   * virando "Cavaleiro Oco: Canção de Seda") seria indistinguível de um erro do
   * próprio veículo, e ninguém saberia se o problema está no nosso prompt ou na
   * fonte. O valor vai para o `AuditLog` do evento `topic.discovered` — não para
   * uma coluna nova em `Topic`, porque isto é registro de diagnóstico, não dado
   * do produto, e não vale uma migração de banco.
   */
  originalTitle?: string;
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
    // Entidades numéricas (ex.: &#8216; &#8217; &#8230; — aspas curvas e
    // reticências, comuns em feeds de imprensa em inglês). Sem isto, o
    // título chega ao painel com o código literal em vez do caractere.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
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
