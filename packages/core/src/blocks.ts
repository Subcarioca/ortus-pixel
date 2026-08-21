/**
 * =============================================================================
 * CORPO DA MATÉRIA EM BLOCOS — tipos e derivações
 * =============================================================================
 *
 * Substitui o textarea único de Markdown por uma lista ORDENADA de blocos
 * tipados. O que muda de verdade, para além da interface: o corpo deixa de ser
 * uma string que só o parser entende e passa a ser um dado que o sistema pode
 * PERGUNTAR COISAS — quantos títulos existem (índice), quantas palavras
 * (tempo de leitura), há vídeo? há spoiler? — sem reparsear texto a cada vez.
 *
 * -----------------------------------------------------------------------------
 * DUAS REGRAS DE ARQUITETURA QUE ESTE ARQUIVO CODIFICA
 * -----------------------------------------------------------------------------
 *
 * 1. BLOCO É CORPO; O RESTO É CAMPO.
 *    TL;DR, veredito, ficha técnica e ofertas de afiliado NÃO são blocos que o
 *    redator posiciona. A posição deles é política editorial (§5 e §7 do
 *    design/README) e não pode depender de quem estava de plantão: o TL;DR
 *    sempre antes do texto, o disclosure sempre antes do primeiro link
 *    comercial. O que o redator ordena é o CORPO, e é só isso que está aqui.
 *
 * 2. TEXTO É TEXTO, NUNCA HTML.
 *    Todo campo de texto de bloco guarda Markdown REDUZIDO (negrito, itálico,
 *    código, link) — o mesmo subconjunto que `renderInline` já processa em
 *    article-body.tsx, produzindo elementos React. Nenhum bloco guarda HTML, e
 *    nenhum renderizador usa `dangerouslySetInnerHTML`. Isso não é uma
 *    convenção que alguém precisa lembrar: como o dado nunca é HTML e o
 *    renderizador nunca interpola HTML, não existe caminho para injeção. A
 *    garantia é da arquitetura, não da disciplina.
 *
 * -----------------------------------------------------------------------------
 * ANINHAMENTO: UM NÍVEL, NÃO MAIS
 * -----------------------------------------------------------------------------
 * Nenhum bloco P0 aceita filhos. Quando `spoiler` e `callout` entrarem (P1),
 * eles aceitarão uma lista de blocos SIMPLES (parágrafo, imagem, lista) e nada
 * além disso. Recursão livre estilo Notion custa caro em três lugares ao mesmo
 * tempo — validação, editor e renderizador — e paga em um caso de uso que
 * nenhum dos oito portais analisados usa.
 */

import type { CoverImageFit } from './cover-image';
import { slugify } from './utils';

// =============================================================================
// TIPOS
// =============================================================================

/**
 * Larguras possíveis de um bloco de mídia.
 *
 * O `.article` tem 44rem de medida de leitura, calibrada para o texto. Imagem,
 * galeria e vídeo podem furar essa medida (decisão aprovada pelo dono do
 * produto) — o TEXTO continua onde sempre esteve, e só a mídia respira.
 *
 *   medida         → acompanha a coluna de texto. O padrão.
 *   larga          → estoura a medida em telas grandes, ainda com margem.
 *   borda-a-borda  → ocupa a largura do contêiner. Para abertura de review e
 *                    captura de tela em que o detalhe importa.
 */
export const BLOCK_WIDTHS = ['medida', 'larga', 'borda-a-borda'] as const;
export type BlockWidth = (typeof BLOCK_WIDTHS)[number];

/** Provedores de vídeo aceitos. Lista fechada: ver `videoEmbedUrl`. */
export const VIDEO_PROVIDERS = ['youtube', 'vimeo'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

interface BlockBase {
  /**
   * Identificador ESTÁVEL do bloco dentro da matéria.
   *
   * Não é chave de banco — o array inteiro vive numa coluna Json. Ele existe
   * para o React: sem uma chave estável, reordenar dois blocos faz o React
   * reconciliar por índice, e o conteúdo digitado num campo "pula" para o bloco
   * vizinho na hora que a lista muda de ordem. É o bug clássico de editor de
   * blocos, e ele é invisível até alguém reordenar com texto não salvo na tela.
   */
  id: string;
}

/** Parágrafo. O bloco que representa 80% de qualquer matéria. */
export interface ParagraphBlock extends BlockBase {
  type: 'paragrafo';
  /** Markdown reduzido: **negrito**, *itálico*, `código`, [link](url). */
  texto: string;
}

/** Título de seção. Alimenta o índice (`.toc`) automaticamente. */
export interface HeadingBlock extends BlockBase {
  type: 'titulo';
  /**
   * Só h2 e h3. O h1 é a manchete da página — um segundo h1 quebra o sumário
   * que o leitor de tela navega e confunde a hierarquia para o buscador
   * (WCAG 1.3.1 / 2.4.6).
   */
  nivel: 2 | 3;
  texto: string;
}

/** Imagem no meio do corpo, com legenda e crédito SEPARADOS. */
export interface ImageBlock extends BlockBase {
  type: 'imagem';
  url: string;
  /**
   * Texto alternativo. SUBSTITUI a imagem para quem não a vê.
   *
   * Vazio só é aceito com `decorativa: true` — e essa é a diferença que o
   * produto errava antes: `coverImageAlt` fazia papel de legenda, o que é um
   * erro semântico. `alt` substitui a imagem; legenda COMPLEMENTA para quem vê.
   * Uma imagem informativa com alt vazio simplesmente não existe para parte da
   * audiência.
   */
  alt: string;
  /** Marcação consciente de "esta imagem não acrescenta informação". */
  decorativa: boolean;
  legenda?: string;
  /**
   * Crédito ("Imagem: Team Cherry / Divulgação").
   *
   * Campo próprio, e não um sufixo colado na legenda, porque é obrigação
   * jurídica e sinal de E-E-A-T: precisa de tratamento visual subordinado
   * (mono, menor, caixa-alta) para o leitor não confundir a fonte da foto com
   * informação da matéria.
   */
  credito?: string;
  largura: BlockWidth;
  /**
   * ENQUADRAMENTO — mesmo vocabulário e mesmo motivo da capa (ver
   * `cover-image.ts`, ao lado): `.thumb` (a moldura 16:9 fixa) é a MESMA
   * classe usada pela capa e por este bloco (ver `article-blocks.tsx`), então
   * a imagem do corpo sofre o mesmo corte automático — um print vertical de
   * jogo ou um pôster no meio do texto perde exatamente a mesma parte que uma
   * capa perderia.
   *
   * OPCIONAL, e não obrigatório como no Article: todo bloco de imagem já
   * publicado antes deste campo existir simplesmente não tem a chave no JSON
   * — `ausente` e `'cover'` significam a MESMA coisa (o comportamento de
   * sempre), então não há necessidade de backfill nenhum, ao contrário da
   * coluna do Article (que precisou de `@default` porque é `NOT NULL` no
   * banco). `parseImageBlockFit`, em `server/blocks-input.ts`, normaliza os
   * três campos JUNTOS pela mesma razão de `parseCoverImageFocus` no
   * `article-input.ts`: fora de 'focal', as coordenadas nunca sobrevivem à
   * gravação.
   */
  fit?: CoverImageFit;
  focalX?: number | null;
  focalY?: number | null;
}

/** Item da caixa "Leia também". */
export interface ReadMoreItem {
  titulo: string;
  /** Sempre interna (começa com `/`). Ver a validação no servidor. */
  url: string;
}

/**
 * Caixa "Leia também" NO MEIO do texto.
 *
 * É o mecanismo nº 1 de páginas por sessão dos portais do nicho (verificado em
 * ScreenRant e CBR) e o bloco que mais faltava ao produto: hoje o site só
 * oferece relacionadas DEPOIS do último parágrafo, quando boa parte do público
 * já saiu.
 */
export interface ReadMoreBlock extends BlockBase {
  type: 'leia-tambem';
  /** Rótulo da caixa. Padrão: "Leia também". */
  rotulo?: string;
  /** De 1 a 3 itens. Acima disso vira lista de links e deixa de ser destaque. */
  itens: ReadMoreItem[];
}

export interface ListBlock extends BlockBase {
  type: 'lista';
  ordenada: boolean;
  /** Cada item aceita a mesma marcação inline do parágrafo. */
  itens: string[];
}

/** Citação COM atribuição — o que o `blockquote` de hoje não tem. */
export interface QuoteBlock extends BlockBase {
  type: 'citacao';
  texto: string;
  autor?: string;
  /** Cargo ou veículo ("diretor da Team Cherry", "à Eurogamer"). */
  cargo?: string;
  fonteUrl?: string;
}

/**
 * Vídeo — renderizado como FACHADA (miniatura + botão), nunca como iframe direto.
 *
 * O iframe do YouTube custa perto de 1 MB e várias conexões a domínios de
 * terceiro no primeiro byte, em TODA visita, inclusive das pessoas que nunca
 * clicam em play. A fachada é uma imagem e um botão; o iframe só é criado no
 * clique. Além do desempenho, é privacidade: sem clique, nenhum IP de leitor é
 * entregue ao Google — a mesma razão pela qual o projeto não hospeda avatar de
 * provedor OAuth nos comentários.
 */
export interface VideoBlock extends BlockBase {
  type: 'video';
  provedor: VideoProvider;
  /** ID no provedor (não a URL completa) — ver `parseVideoId` no servidor. */
  videoId: string;
  /** Título acessível do vídeo; vira o rótulo do botão de play. */
  titulo: string;
  duracaoSegundos?: number;
  /** Miniatura própria. Ausente no YouTube = usa a do provedor. */
  thumbUrl?: string;
  legenda?: string;
  largura: BlockWidth;
}

export type ArticleBlock =
  | ParagraphBlock
  | HeadingBlock
  | ImageBlock
  | ReadMoreBlock
  | ListBlock
  | QuoteBlock
  | VideoBlock;

export type BlockType = ArticleBlock['type'];

/** Tipos disponíveis no editor, na ordem em que aparecem no menu de inserção. */
export const BLOCK_TYPES = [
  'paragrafo',
  'titulo',
  'imagem',
  'leia-tambem',
  'lista',
  'citacao',
  'video',
] as const satisfies readonly BlockType[];

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragrafo: 'Parágrafo',
  titulo: 'Título de seção',
  imagem: 'Imagem',
  'leia-tambem': 'Leia também',
  lista: 'Lista',
  citacao: 'Citação',
  video: 'Vídeo',
};

// =============================================================================
// DERIVAÇÕES — o que o sistema passa a saber de graça
// =============================================================================

/**
 * Âncora de um título de seção.
 *
 * Uma implementação só, usada pelo índice, pelo renderizador de blocos E pelo
 * renderizador de Markdown legado. Se fossem duas, o índice geraria `#a-abertura`
 * e o título receberia `#abertura` — links de índice que não levam a lugar
 * nenhum, sem erro em canto nenhum.
 */
export function headingAnchor(text: string): string {
  return slugify(text).slice(0, 60);
}

export interface TocEntry {
  nivel: 2 | 3;
  texto: string;
  anchor: string;
}

/**
 * Índice a partir dos blocos de título.
 *
 * Devolve vazio com menos de 2 títulos: um índice de um item só é ruído — ele
 * ocupa espaço acima da dobra para oferecer um salto que a rolagem já resolve.
 */
export function blocksToToc(blocks: ArticleBlock[], minEntries = 2): TocEntry[] {
  const entries = blocks
    .filter((block): block is HeadingBlock => block.type === 'titulo')
    .map((block) => ({
      nivel: block.nivel,
      texto: block.texto,
      anchor: headingAnchor(block.texto),
    }));

  return entries.length >= minEntries ? entries : [];
}

/**
 * Projeção do corpo em TEXTO PURO.
 *
 * Dois usos, os dois invisíveis para o leitor e os dois importantes:
 *   1. alimenta `Article.content`, que é a origem do `searchVector` — sem isso,
 *      matéria escrita em blocos não seria encontrada pela busca do site;
 *   2. é a base da contagem de palavras do tempo de leitura.
 *
 * A marcação inline é removida de forma deliberadamente grosseira: para contar
 * palavras e para indexar, `**Silksong**` e `Silksong` são a mesma coisa, e um
 * parser fiel aqui seria precisão sem consequência.
 */
export function blocksToPlainText(blocks: ArticleBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'paragrafo':
      case 'titulo':
        parts.push(stripInline(block.texto));
        break;
      case 'lista':
        parts.push(block.itens.map(stripInline).join('\n'));
        break;
      case 'citacao':
        parts.push(stripInline(block.texto));
        if (block.autor) parts.push(block.autor);
        break;
      case 'imagem':
        // A LEGENDA entra; o `alt` NÃO. O alt é uma descrição para quem não vê a
        // imagem, e jogá-lo no índice de busca faria a matéria casar com termos
        // que ela não discute ("mulher de vermelho segurando um controle").
        if (block.legenda) parts.push(block.legenda);
        break;
      case 'video':
        parts.push(block.titulo);
        if (block.legenda) parts.push(block.legenda);
        break;
      case 'leia-tambem':
        // Títulos de OUTRAS matérias ficam de fora de propósito: indexá-los faria
        // esta matéria competir na busca por assuntos que ela só menciona de
        // passagem, roubando o resultado da matéria certa.
        break;
    }
  }

  return parts.filter((part) => part.trim().length > 0).join('\n\n');
}

/** Remove a marcação inline, preservando o texto visível. */
function stripInline(text: string): string {
  return text
    // [rótulo](url) → rótulo
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Tempo de leitura a partir dos blocos.
 *
 * Por que não reaproveitar `estimateReadingMinutes(content)` direto: o corpo em
 * blocos tem conteúdo que não se lê em 200 palavras por minuto. Um vídeo de 8
 * minutos embutido no meio da matéria vale mais que as três palavras do título
 * dele, e uma imagem custa alguns segundos de atenção. Ignorar isso subestima
 * sistematicamente a review — justamente o formato mais longo e mais mídia-pesado
 * do site.
 *
 * Os pesos são deliberadamente conservadores: 12s por imagem (Medium usa 12s
 * para a primeira imagem, decrescendo; simplificamos para um valor fixo) e um
 * TERÇO da duração do vídeo (a maioria não assiste inteiro, e prometer 8 minutos
 * a mais afugenta o leitor mais do que informa).
 */
export function blocksReadingMinutes(blocks: ArticleBlock[]): number {
  const words = blocksToPlainText(blocks).trim().split(/\s+/).filter(Boolean).length;
  let seconds = (words / 200) * 60;

  for (const block of blocks) {
    if (block.type === 'imagem') seconds += 12;
    if (block.type === 'video') seconds += (block.duracaoSegundos ?? 0) / 3;
  }

  return Math.max(1, Math.round(seconds / 60));
}

// =============================================================================
// DESTAQUE PROPORCIONAL DA IMAGEM — quanto menos imagem, maior cada uma
// =============================================================================

/**
 * Largura SUGERIDA para uma imagem, dado quantas existem no corpo.
 *
 * -----------------------------------------------------------------------------
 * O PEDIDO, NAS PALAVRAS DE QUEM PEDIU: "se só tem uma imagem, ela deve ter
 * destaque bem maior do que quando tem 3 imagens, uma por parágrafo".
 * -----------------------------------------------------------------------------
 *
 * É uma regra de RITMO, e ela é mais interessante do que parece. Uma imagem
 * sozinha no meio de uma matéria é a ÚNICA pausa visual do texto: ela carrega
 * todo o peso de "respirar" e merece furar a medida de leitura. Três imagens,
 * uma por parágrafo, já criam esse ritmo POR REPETIÇÃO — e, se cada uma delas
 * também estourar a medida, o resultado não é uma matéria mais bonita, é uma
 * matéria em que o texto vira legenda de galeria.
 *
 * A escada, portanto, é decrescente:
 *
 *   1 imagem   → 'borda-a-borda' (é o momento visual da matéria)
 *   2 imagens  → 'larga'         (respiram, sem competir entre si)
 *   3 ou mais  → 'medida'        (acompanham o texto, criam ritmo repetido)
 *
 * -----------------------------------------------------------------------------
 * O PISO É 'medida', E ISSO É UMA GARANTIA, NÃO UM DETALHE
 * -----------------------------------------------------------------------------
 * Foi pedido explicitamente que a imagem NUNCA fique menor ou menos chamativa
 * que o texto ao redor. `'medida'` é exatamente a largura da coluna de texto —
 * ou seja, o menor valor que esta função pode devolver JÁ É "do tamanho do
 * texto". Não existe combinação de argumentos que produza uma imagem mais
 * estreita que o parágrafo vizinho: a garantia está na FORMA da função, e não na
 * disciplina de quem a chama. (O mesmo princípio de `homeAdSlots`, em lib/ads.)
 *
 * ⚠ O QUE ESTA FUNÇÃO NÃO FAZ: ela escolhe a LARGURA, que é um valor semântico
 * do domínio. O tratamento visual de cada largura — quantos rem, que margem, que
 * comportamento no celular, se 'borda-a-borda' sangra até a borda da viewport ou
 * até a do contêiner — é CSS, é decisão de design e não está aqui.
 */
export function suggestedImageWidth(imageCount: number): BlockWidth {
  if (imageCount <= 1) return 'borda-a-borda';
  if (imageCount === 2) return 'larga';
  return 'medida';
}

/** Quantas imagens há no corpo. */
export function countImageBlocks(blocks: ArticleBlock[]): number {
  return blocks.filter((block) => block.type === 'imagem').length;
}

/**
 * Devolve os blocos com a largura das IMAGENS ajustada à regra acima.
 *
 * PURA E SEM EFEITO COLATERAL: devolve um array novo e não toca no recebido.
 * Isso é o que permite o editor chamá-la dentro de um `setState` do React sem
 * criar o clássico bug de mutação de estado (a tela não redesenha porque a
 * referência do array não mudou).
 *
 * POR QUE ELA É CHAMADA PELO EDITOR E NÃO PELO SERVIDOR, embora o servidor
 * também pudesse: porque isto é uma SUGESTÃO, e sugestão que o servidor aplica
 * na gravação vira imposição silenciosa. O redator que escolheu 'medida' de
 * propósito para uma imagem específica (um print de tela vertical, por exemplo)
 * salvaria e descobriria depois, na página publicada, que o sistema desfez a
 * escolha dele sem avisar. No editor, ele vê o valor mudar na hora e pode
 * reverter no `<select>` que continua ali.
 */
export function withSuggestedImageWidths(blocks: ArticleBlock[]): ArticleBlock[] {
  const largura = suggestedImageWidth(countImageBlocks(blocks));

  return blocks.map((block) =>
    block.type === 'imagem' ? { ...block, largura } : block,
  );
}

/** Há blocos de verdade? Trata `null`, `[]` e Json malformado como "não". */
export function hasBlocks(blocks: unknown): blocks is ArticleBlock[] {
  return Array.isArray(blocks) && blocks.length > 0;
}

/**
 * URL de incorporação do vídeo — montada só no CLIQUE, no cliente.
 *
 * `youtube-nocookie.com` não é detalhe: o domínio padrão grava cookies de
 * rastreio no navegador do leitor no instante em que o iframe carrega. Como o
 * iframe só nasce depois do clique, e ainda assim no domínio sem cookie, o custo
 * de privacidade fica restrito a quem pediu para assistir.
 */
export function videoEmbedUrl(provider: VideoProvider, videoId: string): string {
  const id = encodeURIComponent(videoId);
  return provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
    : `https://player.vimeo.com/video/${id}?autoplay=1`;
}

/** Miniatura padrão do provedor, quando o redator não informa uma própria. */
export function videoThumbnailUrl(provider: VideoProvider, videoId: string): string | null {
  // O Vimeo exige uma chamada de API (oEmbed) para descobrir a miniatura; como o
  // renderizador é síncrono e no servidor, devolvemos nulo e o bloco cai no
  // placeholder de editoria — que é o mesmo tratamento de um card sem capa.
  return provider === 'youtube'
    ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
    : null;
}

/** URL pública de assistir (a que se cola na barra de endereços). */
export function videoWatchUrl(provider: VideoProvider, videoId: string): string {
  const id = encodeURIComponent(videoId);
  return provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${id}`
    : `https://vimeo.com/${id}`;
}

/**
 * O primeiro vídeo do corpo, no formato que o schema.org/VideoObject pede.
 *
 * ESTA FUNÇÃO EXISTE PARA CORRIGIR UM BUG DE DADO ESTRUTURADO, e vale explicar
 * qual: o site declarava um `VideoObject` completo (contentUrl, embedUrl,
 * duration) a partir dos campos `videoUrl`/`videoThumbnailUrl` do artigo — que
 * NENHUM template renderizava. Ou seja, o site prometia ao Google um player que
 * não existia na página. Isso não é um detalhe de conformidade: dado estruturado
 * que não corresponde ao conteúdo visível é, na política do Google, motivo de
 * ação manual sobre o domínio inteiro.
 *
 * Agora a fonte do schema é a MESMA do que aparece na tela: o bloco de vídeo.
 * Sem bloco de vídeo, não há `VideoObject` — que é a resposta honesta.
 */
export function schemaVideoFromBlocks(blocks: ArticleBlock[]): {
  name: string;
  embedUrl: string;
  contentUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
} | null {
  const video = blocks.find((block): block is VideoBlock => block.type === 'video');
  if (!video) return null;

  return {
    name: video.titulo,
    embedUrl: videoEmbedUrl(video.provedor, video.videoId),
    contentUrl: videoWatchUrl(video.provedor, video.videoId),
    thumbnailUrl: video.thumbUrl ?? videoThumbnailUrl(video.provedor, video.videoId),
    durationSeconds: video.duracaoSegundos ?? 0,
  };
}

/** "8:12" a partir de segundos. Devolve null quando a duração é desconhecida. */
export function formatVideoDuration(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

// =============================================================================
// CONVERSÃO DO ACERVO ANTIGO
// =============================================================================

/**
 * Markdown legado → blocos.
 *
 * Usada quando o editor abre uma matéria escrita antes deste sistema: em vez de
 * começar do zero (ou de jogar o texto inteiro num parágrafo gigante, que
 * destruiria os títulos e o índice), convertemos o que o parser de Markdown do
 * produto já entende.
 *
 * A conversão é EXPLÍCITA e acontece só quando alguém clica no botão. Converter
 * automaticamente na leitura seria pior de duas formas: reescreveria matérias no
 * banco sem ninguém pedir, e faria a mesma matéria renderizar por dois caminhos
 * diferentes dependendo de já ter sido aberta no editor ou não.
 *
 * O que ela NÃO faz: imagem, vídeo e "leia também" não existem no Markdown do
 * acervo, então não há o que converter. Blocos de código viram parágrafo — o
 * acervo não tem nenhum, e um tipo de bloco a mais só para esse caso seria peso
 * morto no editor.
 */
export function markdownToBlocks(markdown: string, makeId: () => string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const trimmed = (lines[i] ?? '').trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    const heading = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (heading?.[1] && heading[2]) {
      blocks.push({
        id: makeId(),
        type: 'titulo',
        nivel: heading[1].length === 2 ? 2 : 3,
        texto: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('> ')) {
        quote.push((lines[i] ?? '').trim().slice(2));
        i++;
      }
      blocks.push({ id: makeId(), type: 'citacao', texto: quote.join(' ') });
      continue;
    }

    const bulletMatch = /^[-*]\s+/;
    const numberedMatch = /^\d+\.\s+/;

    if (bulletMatch.test(trimmed) || numberedMatch.test(trimmed)) {
      const ordenada = numberedMatch.test(trimmed);
      const pattern = ordenada ? numberedMatch : bulletMatch;
      const itens: string[] = [];
      while (i < lines.length && pattern.test((lines[i] ?? '').trim())) {
        itens.push((lines[i] ?? '').trim().replace(pattern, ''));
        i++;
      }
      blocks.push({ id: makeId(), type: 'lista', ordenada, itens });
      continue;
    }

    // Parágrafo: junta linhas até a próxima linha em branco ou o início de outro
    // tipo de bloco.
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const current = (lines[i] ?? '').trim();
      if (/^(#{2,3}\s|>\s|[-*]\s|\d+\.\s|```)/.test(current) && paragraph.length > 0) break;
      // Cerca de bloco de código não vira tipo próprio: a linha de crase some e
      // o conteúdo continua como texto.
      if (!current.startsWith('```')) paragraph.push(current);
      i++;
    }
    if (paragraph.length > 0) {
      blocks.push({ id: makeId(), type: 'paragrafo', texto: paragraph.join(' ') });
    }
  }

  return blocks;
}

/** Bloco novo, no estado inicial de cada tipo. Usado pelo botão "+ Adicionar". */
export function emptyBlock(type: BlockType, id: string): ArticleBlock {
  switch (type) {
    case 'paragrafo':
      return { id, type, texto: '' };
    case 'titulo':
      return { id, type, nivel: 2, texto: '' };
    case 'imagem':
      return { id, type, url: '', alt: '', decorativa: false, largura: 'medida' };
    case 'leia-tambem':
      return { id, type, itens: [{ titulo: '', url: '' }] };
    case 'lista':
      return { id, type, ordenada: false, itens: [''] };
    case 'citacao':
      return { id, type, texto: '' };
    case 'video':
      return { id, type, provedor: 'youtube', videoId: '', titulo: '', largura: 'medida' };
  }
}
