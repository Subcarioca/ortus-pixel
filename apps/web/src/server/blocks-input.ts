import 'server-only';

/**
 * =============================================================================
 * VALIDAÇÃO DO CORPO EM BLOCOS — a fronteira entre o editor e o banco
 * =============================================================================
 *
 * O array de blocos chega como JSON vindo do navegador. Isso significa que, até
 * passar por aqui, ele é ENTRADA HOSTIL: pode ter tipo inventado, campo faltando,
 * `url` com `javascript:`, texto de 5 MB, aninhamento infinito. Nada disso pode
 * chegar à coluna `Article.blocks`.
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO CENTRAL: VALIDAR NA ESCRITA, NÃO NA LEITURA
 * -----------------------------------------------------------------------------
 * A alternativa seria gravar qualquer coisa e sanear na hora de renderizar. Ela
 * é pior por dois motivos concretos:
 *   1. a página de artigo é o caminho mais quente do site (cacheado, servido a
 *      50 mil pessoas num breaking news) — validar ali é pagar o custo N vezes
 *      por uma escrita que aconteceu uma vez;
 *   2. dado inválido gravado é dado inválido para sempre. Ele sobrevive à
 *      próxima refatoração do renderizador, e o dia em que alguém escrever um
 *      renderizador novo sem lembrar de sanear é o dia do incidente.
 *
 * O renderizador AINDA ASSIM ignora bloco de tipo desconhecido em vez de
 * estourar. Banco é fronteira, e fronteira se trata com desconfiança mesmo
 * quando a gente mesmo escreveu o que está lá.
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTE MÓDULO PROTEGE, EM TERMOS DE OWASP
 * -----------------------------------------------------------------------------
 *   A03 (Injeção/XSS) — nenhuma URL passa sem `safeContentUrl`/`safeImageUrl`,
 *        que rejeitam esquema perigoso (`javascript:`, `data:`). O texto não
 *        precisa de escape porque nunca vira HTML: o renderizador produz nós
 *        React (ver o cabeçalho de article-body.tsx).
 *   A04 (Design inseguro) — teto de blocos, de tamanho de texto e de itens por
 *        bloco. Sem eles, um payload grande vira uma linha de banco gigante,
 *        replicada em toda leitura de artigo.
 *   A10 (SSRF) — a URL de imagem é restrita a uma lista de hosts autorizados
 *        (regra que já existia para a capa e que aqui passa a valer para toda
 *        imagem do corpo).
 */

import {
  BLOCK_WIDTHS,
  VIDEO_PROVIDERS,
  parseCoverImageFocus,
  toCoverImageFit,
  type ArticleBlock,
  type BlockWidth,
  type VideoProvider,
} from '@subcarioca/core';

import { ALLOWED_IMAGE_HOSTS_LABEL } from '@/lib/image-hosts';
import { safeImageUrl } from '@/lib/safe-url';

/**
 * TETOS. Todos existem por uma razão de robustez, não de gosto:
 *
 *   BLOCKS       300 blocos é uma matéria enorme (um listicle de 50 itens com
 *                imagem e três parágrafos cada). Acima disso é erro ou abuso.
 *   TEXT         8 mil caracteres num parágrafo já são ~1300 palavras. Quem
 *                precisa de mais está escrevendo a matéria inteira num bloco só,
 *                e o editor deve dizer isso em vez de aceitar em silêncio.
 *   LIST_ITEMS   uma lista de 200 itens não é uma lista, é uma tabela.
 */
const MAX_BLOCKS = 300;
const MAX_TEXT = 8_000;
const MAX_SHORT_TEXT = 300;
const MAX_LIST_ITEMS = 200;
const MAX_READ_MORE_ITEMS = 3;

export type BlocksInputResult =
  | { ok: true; blocks: ArticleBlock[] }
  | { ok: false; message: string };

/**
 * Valida o array vindo do editor.
 *
 * Ausente, `null` ou `[]` devolvem lista VAZIA e `ok: true` — não é erro. É o
 * caso das matérias antigas e das novas que ainda usam o corpo em Markdown; a
 * página de artigo trata lista vazia como "renderize a partir de `content`".
 */
export function parseBlocksInput(raw: unknown): BlocksInputResult {
  if (raw === undefined || raw === null) return { ok: true, blocks: [] };
  if (!Array.isArray(raw)) return fail('O corpo em blocos veio num formato inesperado.');
  if (raw.length === 0) return { ok: true, blocks: [] };

  if (raw.length > MAX_BLOCKS) {
    return fail(`A matéria passou de ${MAX_BLOCKS} blocos. Divida-a em duas.`);
  }

  const blocks: ArticleBlock[] = [];
  // Os ids vêm do cliente e servem de chave no React. Um id repetido faria dois
  // blocos disputarem o mesmo estado no editor — o mesmo sintoma de não ter id
  // nenhum. Reescrevemos os repetidos em vez de recusar a matéria por causa de
  // um detalhe que o redator não tem como diagnosticar.
  const usedIds = new Set<string>();

  for (const [index, item] of raw.entries()) {
    const parsed = parseBlock(item, index + 1);
    if (!parsed.ok) return parsed;

    let id = parsed.block.id;
    while (usedIds.has(id)) id = `${id}-${usedIds.size}`;
    usedIds.add(id);

    blocks.push({ ...parsed.block, id });
  }

  return { ok: true, blocks };
}

type SingleBlockResult = { ok: true; block: ArticleBlock } | { ok: false; message: string };

function parseBlock(raw: unknown, position: number): SingleBlockResult {
  if (typeof raw !== 'object' || raw === null) {
    return fail(`O bloco ${position} veio vazio.`);
  }

  const data = raw as Record<string, unknown>;
  const id = typeof data.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(data.id) ? data.id : `b${position}`;

  switch (data.type) {
    // -------------------------------------------------------------------------
    case 'paragrafo': {
      const texto = text(data.texto, MAX_TEXT);
      if (texto === null) return fail(`O parágrafo do bloco ${position} está vazio.`);
      return ok({ id, type: 'paragrafo', texto });
    }

    // -------------------------------------------------------------------------
    case 'titulo': {
      const texto = text(data.texto, MAX_SHORT_TEXT);
      if (texto === null) return fail(`O título do bloco ${position} está vazio.`);
      // Só h2 e h3: o h1 é a manchete. Qualquer outro valor cai em 2 — o campo
      // vem de um `<select>` fechado, e um valor fora da lista só chega por
      // requisição forjada.
      return ok({ id, type: 'titulo', nivel: data.nivel === 3 ? 3 : 2, texto });
    }

    // -------------------------------------------------------------------------
    case 'imagem': {
      const image = safeImageUrl(typeof data.url === 'string' ? data.url : '');
      if (!image.href) {
        return fail(
          image.reason === 'host'
            ? `A imagem do bloco ${position} precisa estar num domínio autorizado (${ALLOWED_IMAGE_HOSTS_LABEL}). ` +
                'Suba a imagem para o nosso servidor e cole a URL de lá.'
            : `A URL da imagem do bloco ${position} é inválida. Ela precisa começar com https://.`,
        );
      }

      const decorativa = data.decorativa === true;
      const alt = text(data.alt, MAX_SHORT_TEXT) ?? '';

      /**
       * ALT OBRIGATÓRIO — validação BLOQUEANTE, e não um aviso.
       *
       * É a mesma disciplina que o §7 do design já aplica ao comercial: a regra
       * mora no sistema, não na boa vontade de quem está com pressa. Uma imagem
       * informativa sem alt simplesmente NÃO EXISTE para quem usa leitor de tela
       * (WCAG 1.1.1), e "a gente arruma depois" nunca acontece num fluxo de
       * breaking news.
       *
       * A saída legítima existe e é consciente: marcar "imagem decorativa", que
       * grava `alt=""` — a forma correta de dizer ao leitor de tela "pule esta".
       */
      if (!decorativa && alt.length === 0) {
        return fail(
          `A imagem do bloco ${position} está sem texto alternativo. ` +
            'Descreva o que a imagem mostra — ou marque "imagem decorativa" se ela não acrescenta informação.',
        );
      }

      // ENQUADRAMENTO — mesma regra da capa (`server/article-input.ts`), e por
      // isso a mesma função (`parseCoverImageFocus`, de `@subcarioca/core`):
      // fora de 'focal', as coordenadas são sempre `null`, nunca resíduo de um
      // modo anterior. `data.fit` ausente (todo bloco publicado antes deste
      // campo existir) cai em 'cover' — o `object-fit: cover` sem posição que
      // este bloco já tinha, então nenhuma matéria publicada muda de aparência.
      const fit = toCoverImageFit(data.fit);
      const focus = parseCoverImageFocus(fit, data.focalX, data.focalY);
      if ('error' in focus) return fail(`A imagem do bloco ${position}: ${focus.error}`);

      return ok({
        id,
        type: 'imagem',
        url: image.href,
        alt: decorativa ? '' : alt,
        decorativa,
        legenda: optional(data.legenda, MAX_SHORT_TEXT),
        credito: optional(data.credito, 120),
        largura: width(data.largura),
        fit,
        focalX: focus.focalX,
        focalY: focus.focalY,
      });
    }

    // -------------------------------------------------------------------------
    case 'leia-tambem': {
      const rawItems = Array.isArray(data.itens) ? data.itens : [];
      const itens: { titulo: string; url: string }[] = [];

      for (const item of rawItems.slice(0, MAX_READ_MORE_ITEMS)) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        const titulo = text(entry.titulo, MAX_SHORT_TEXT);
        const url = internalUrl(entry.url);
        if (titulo && url) itens.push({ titulo, url });
      }

      if (itens.length === 0) {
        return fail(
          `O "Leia também" do bloco ${position} está sem nenhuma matéria válida. ` +
            'O endereço precisa ser interno (começar com /), como /games/nome-da-materia.',
        );
      }

      return ok({
        id,
        type: 'leia-tambem',
        rotulo: optional(data.rotulo, 60),
        itens,
      });
    }

    // -------------------------------------------------------------------------
    case 'lista': {
      const itens = (Array.isArray(data.itens) ? data.itens : [])
        .slice(0, MAX_LIST_ITEMS)
        .map((item) => text(item, MAX_TEXT))
        .filter((item): item is string => item !== null);

      if (itens.length === 0) return fail(`A lista do bloco ${position} está vazia.`);

      return ok({ id, type: 'lista', ordenada: data.ordenada === true, itens });
    }

    // -------------------------------------------------------------------------
    case 'citacao': {
      const texto = text(data.texto, MAX_TEXT);
      if (texto === null) return fail(`A citação do bloco ${position} está vazia.`);

      // A fonte é um link EXTERNO legítimo (a entrevista original, o post
      // oficial), então passa por `safeImageUrl`? Não: por `internalOrExternalUrl`,
      // que aceita http(s) e recusa qualquer outro esquema.
      const fonteUrl = optionalUrl(data.fonteUrl);

      return ok({
        id,
        type: 'citacao',
        texto,
        autor: optional(data.autor, 120),
        cargo: optional(data.cargo, 120),
        ...(fonteUrl ? { fonteUrl } : {}),
      });
    }

    // -------------------------------------------------------------------------
    case 'video': {
      const provedor: VideoProvider = (VIDEO_PROVIDERS as readonly string[]).includes(
        data.provedor as string,
      )
        ? (data.provedor as VideoProvider)
        : 'youtube';

      const videoId = parseVideoId(data.videoId, provedor);
      if (!videoId) {
        return fail(
          `O vídeo do bloco ${position} não tem um endereço reconhecível. ` +
            'Cole a URL do YouTube ou do Vimeo, ou só o identificador do vídeo.',
        );
      }

      const titulo = text(data.titulo, MAX_SHORT_TEXT);
      if (titulo === null) {
        return fail(
          `O vídeo do bloco ${position} está sem título. ` +
            'Ele é o rótulo do botão de reproduzir para quem usa leitor de tela.',
        );
      }

      const duracao = Number(data.duracaoSegundos);
      const thumb = typeof data.thumbUrl === 'string' && data.thumbUrl.trim().length > 0
        ? safeImageUrl(data.thumbUrl).href
        : null;

      return ok({
        id,
        type: 'video',
        provedor,
        videoId,
        titulo,
        // Duração absurda (negativa, NaN, 40 horas) é descartada em vez de
        // recusar a matéria: ela só alimenta um rótulo e a estimativa de leitura.
        ...(Number.isFinite(duracao) && duracao > 0 && duracao < 86_400
          ? { duracaoSegundos: Math.round(duracao) }
          : {}),
        ...(thumb ? { thumbUrl: thumb } : {}),
        legenda: optional(data.legenda, MAX_SHORT_TEXT),
        largura: width(data.largura),
      });
    }

    // -------------------------------------------------------------------------
    default:
      return fail(`O bloco ${position} tem um tipo que o sistema não conhece.`);
  }
}

// =============================================================================
// AUXILIARES
// =============================================================================

function ok(block: ArticleBlock): SingleBlockResult {
  return { ok: true, block };
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** Texto obrigatório, aparado e limitado. `null` quando vazio. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/** Texto opcional: string vazia e ausência viram `undefined`, nunca `""`. */
function optional(value: unknown, max: number): string | undefined {
  return text(value, max) ?? undefined;
}

function width(value: unknown): BlockWidth {
  return (BLOCK_WIDTHS as readonly string[]).includes(value as string)
    ? (value as BlockWidth)
    : 'medida';
}

/**
 * URL INTERNA — para o "Leia também".
 *
 * A rejeição de `//` não é preciosismo: `//evil.com` é uma URL absoluta de
 * protocolo relativo. Sem esta checagem, ela passaria por "começa com barra" e
 * o bloco de navegação editorial do site viraria um redirecionador para fora,
 * com a aparência de link interno. É a mesma armadilha já documentada em
 * `renderLink`, em article-body.tsx.
 */
function internalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.length > 300) return null;
  // Sem espaço, sem caractere de controle: o que sobra é um caminho de URL.
  return /^\/[a-z0-9\-_/.?=&%]*$/i.test(trimmed) ? trimmed : null;
}

/** URL externa opcional (fonte de citação). Só http(s). */
function optionalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Aceita a URL COMPLETA do vídeo ou só o identificador.
 *
 * O redator cola o que tem na mão — e o que ele tem na mão é a URL da barra de
 * endereços. Exigir "extraia o id daqui" seria transferir a ele um trabalho que
 * uma regex faz, e todo trabalho transferido ao humano acaba virando erro em dia
 * de correria.
 *
 * A lista de hosts é FECHADA: sem ela, `parseVideoId` aceitaria o id vindo de
 * qualquer domínio e o `videoEmbedUrl` montaria um iframe apontando para o
 * provedor certo com um id que veio de outro lugar — inútil na melhor hipótese.
 */
function parseVideoId(value: unknown, provider: VideoProvider): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.length === 0) return null;

  // Já é um id puro? (YouTube: 11 caracteres; Vimeo: dígitos.)
  if (provider === 'youtube' && /^[\w-]{11}$/.test(raw)) return raw;
  if (provider === 'vimeo' && /^\d{6,12}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');

    if (provider === 'youtube') {
      if (host === 'youtu.be') {
        const id = url.pathname.slice(1);
        return /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const fromQuery = url.searchParams.get('v');
        if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;
        // /embed/ID e /shorts/ID
        const fromPath = url.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/)?.[1];
        return fromPath ?? null;
      }
      return null;
    }

    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = url.pathname.match(/(\d{6,12})/)?.[1];
      return id ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
