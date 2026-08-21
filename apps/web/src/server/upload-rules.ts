import path from 'node:path';

import {
  COVER_WIDTH_GOOD,
  COVER_WIDTH_POOR,
  coverResolutionAdvice,
  type ImageDimensions,
} from '@/lib/cover-resolution';

export { COVER_WIDTH_GOOD, COVER_WIDTH_POOR, coverResolutionAdvice, type ImageDimensions };

/**
 * =============================================================================
 * REGRAS DE UPLOAD — as decisões, sem nenhum efeito colateral
 * =============================================================================
 *
 * Este módulo responde três perguntas e não faz mais nada:
 *   - "isto é uma imagem que aceitamos?" (assinatura binária)
 *   - "onde os arquivos devem ficar?"    (raiz de armazenamento)
 *   - "este caminho pedido pela URL pode ser lido?" (travessia de diretório)
 *
 * -----------------------------------------------------------------------------
 * POR QUE ELE É SEPARADO DE `uploads.ts`
 * -----------------------------------------------------------------------------
 * Duas razões, e a segunda é a que motivou a separação de verdade:
 *
 *   1. SEPARAR DECISÃO DE EFEITO. Aqui não se escreve em disco, não se cria
 *      pasta, não se sorteia nome. São funções puras (ou quase: leem variável de
 *      ambiente) — as mesmas entradas devolvem as mesmas saídas. `uploads.ts`
 *      fica com o que toca o mundo.
 *
 *   2. TESTABILIDADE, e a razão é concreta: `uploads.ts` importa `'server-only'`,
 *      que é resolvido pelo bundler do Next e NÃO existe como módulo comum. Um
 *      teste rodando em `node --test` sequer consegue carregar aquele arquivo.
 *      Como as regras deste módulo são justamente as de maior consequência —
 *      travessia de diretório e "onde o arquivo vai parar" —, deixá-las
 *      impossíveis de testar seria o pior lugar possível para economizar um
 *      arquivo. Ver `upload-rules.test.ts`.
 *
 * A ausência de `'server-only'` aqui NÃO é um convite para importar isto do
 * cliente: o módulo usa `node:path` e leria variável de ambiente do servidor —
 * o build quebraria. Quem precisa do formato da URL de upload no navegador tem a
 * cópia documentada em `lib/safe-url.ts`, com o motivo escrito lá.
 */

/**
 * TETO DE TAMANHO — 1,8 MiB.
 *
 * O número é generoso para uma capa (acima disso a página já ficaria lenta no
 * celular, que é o público majoritário) e conservador para o servidor: o corpo
 * do `multipart` é materializado em memória, então o teto é também o pico de
 * memória por envio simultâneo.
 *
 * ⚠ ELE PODE NÃO SER O ÚNICO LIMITE DO CAMINHO. Todo proxy à frente da
 * aplicação tem o seu (o `nginx/ortuspixel.conf`, do caminho de deploy em VPS,
 * usa `client_max_body_size 2m`; a hospedagem compartilhada tem o dela, fora do
 * nosso controle). Quando o limite de fora for MENOR, ele vence — e o sintoma é
 * ruim: a requisição é cortada antes de chegar ao Node, e o painel recebe um
 * erro em HTML que a tela traduz como "erro de conexão". Ao mexer neste número,
 * confira o de fora primeiro.
 */
export const MAX_UPLOAD_BYTES = Math.round(1.8 * 1024 * 1024);

/**
 * Formatos aceitos, decididos por ASSINATURA BINÁRIA.
 *
 * A extensão de saída sai desta tabela, e não do nome enviado — é o que garante
 * que um arquivo gravado como `.jpg` seja mesmo um JPEG.
 *
 * SVG NÃO ESTÁ AQUI, E NÃO É ESQUECIMENTO. SVG é um documento XML que pode
 * conter `<script>`; servido do nosso domínio, ele é XSS armazenado com acesso
 * total à sessão do painel. Nenhuma sanitização de SVG é confiável a ponto de
 * valer o risco num CMS de notícias.
 */
export interface ImageFormat {
  extension: string;
  mimeType: string;
  /** `true` quando os bytes iniciais correspondem a este formato. */
  matches: (bytes: Uint8Array) => boolean;
}

const IMAGE_FORMATS: ImageFormat[] = [
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    extension: 'gif',
    mimeType: 'image/gif',
    // "GIF87a" ou "GIF89a".
    matches: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a',
  },
  {
    extension: 'webp',
    mimeType: 'image/webp',
    // Contêiner RIFF com o marcador WEBP no byte 8. Checar só "RIFF" aceitaria
    // um .wav, que é o mesmo contêiner.
    matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
  },
  {
    extension: 'avif',
    mimeType: 'image/avif',
    // Caixa ISO-BMFF: o tipo fica logo depois de "ftyp", no byte 4.
    matches: (b) => ascii(b, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 4)),
  },
];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Buffer.from(bytes.slice(start, start + length)).toString('latin1');
}

/**
 * Descobre o formato pelos primeiros bytes. `null` = não é imagem que aceitamos.
 *
 * 16 bytes bastam para todas as assinaturas acima (a mais longa é a do AVIF, que
 * termina no byte 12).
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 16) return null;
  return IMAGE_FORMATS.find((format) => format.matches(bytes)) ?? null;
}

/** Extensões aceitas, para a mensagem de erro e para o `accept` do `<input>`. */
export const ACCEPTED_IMAGE_EXTENSIONS = IMAGE_FORMATS.map((f) => f.extension);
export const ACCEPTED_IMAGE_MIME_TYPES = IMAGE_FORMATS.map((f) => f.mimeType);

/**
 * PREFIXO PÚBLICO das imagens enviadas.
 *
 * Está declarado aqui, e não escrito à mão nos lugares que precisam dele (a rota
 * que grava, a rota que serve, o validador de URL), porque é ele que faz
 * `safeImageUrl` aceitar um caminho interno sem abrir a porta para caminho
 * interno qualquer.
 */
export const UPLOAD_URL_PREFIX = '/uploads/';

/**
 * Raiz do armazenamento no disco.
 *
 * DEVOLVE UM RESULTADO, NÃO LANÇA. É o mesmo formato de `requireStaffApi`
 * (`{ ok: false, response }` em vez de exceção), e pela mesma razão registrada
 * lá: com exceção, esquecer um `try/catch` transforma uma falha de CONFIGURAÇÃO
 * num erro 500 sem corpo, que a tela do painel traduz como "Erro de conexão." —
 * a pior mensagem possível, porque manda tentar de novo algo que nunca vai
 * funcionar. Aqui o TypeScript obriga cada chamador a tratar o caso.
 *
 * EM PRODUÇÃO, `UPLOADS_DIR` É OBRIGATÓRIO e não tem padrão. Ver o cabeçalho de
 * `uploads.ts`: qualquer caminho relativo à raiz do app vive numa árvore de
 * build que é recriada a cada `git push`, e um padrão silencioso aqui
 * reintroduziria exatamente o bug que este módulo existe para evitar.
 *
 * EM DESENVOLVIMENTO há padrão (`<cwd>/var/uploads`), porque o custo do erro é
 * zero — a pasta local não é recriada por deploy nenhum — e exigir configuração
 * para rodar o projeto na própria máquina é atrito sem contrapartida.
 */
export type UploadRootResult = { ok: true; path: string } | { ok: false; message: string };

const isProduction = () => process.env.NODE_ENV === 'production';

export function uploadRoot(): UploadRootResult {
  const configured = process.env.UPLOADS_DIR?.trim();

  if (!configured) {
    if (isProduction()) {
      return {
        ok: false,
        message:
          'O armazenamento de imagens não está configurado no servidor (UPLOADS_DIR). ' +
          'Avise um administrador — enquanto isso, use a URL de uma imagem já hospedada.',
      };
    }
    return { ok: true, path: path.join(process.cwd(), 'var', 'uploads') };
  }

  /**
   * CAMINHO RELATIVO É RECUSADO, e não "consertado" com `path.resolve`.
   *
   * Resolver um caminho relativo produziria algo DENTRO da árvore do app — que é
   * precisamente a configuração errada. E o modo de falha seria o pior de todos:
   * tudo funcionaria perfeitamente até o deploy seguinte. Recusar na hora
   * transforma um erro invisível de daqui a três semanas num erro visível agora.
   */
  if (!path.isAbsolute(configured)) {
    return {
      ok: false,
      message:
        'UPLOADS_DIR precisa ser um caminho ABSOLUTO, fora da pasta do aplicativo. ' +
        'Caminho relativo vive dentro da árvore de build, que é recriada a cada deploy — ' +
        'as imagens enviadas sumiriam na próxima publicação.',
    };
  }

  const resolved = path.resolve(configured);

  /**
   * AVISO (não recusa) quando o caminho está DENTRO da pasta do app em produção.
   *
   * É o sintoma exato do erro que este módulo evita, e vale gritar no log. Mas
   * não é recusa porque existe uma configuração legítima com essa aparência: um
   * volume persistente montado dentro da árvore. Recusar quebraria uma
   * instalação que funciona; avisar dá a quem opera a informação para decidir.
   */
  if (isProduction() && isInside(process.cwd(), resolved)) {
    console.error(
      `[uploads] ATENÇÃO: UPLOADS_DIR (${resolved}) está dentro da pasta do aplicativo. ` +
        'Se esta pasta for recriada a cada deploy, as imagens enviadas serão perdidas na próxima publicação.',
    );
  }

  return { ok: true, path: resolved };
}

/**
 * `filho` está dentro de `pai`?
 *
 * O TESTE INGÊNUO — `!path.relative(pai, filho).startsWith('..')` — TEM UM BUG,
 * e ele foi pego pelo próprio teste desta função: quando os dois caminhos estão
 * em VOLUMES diferentes (`C:\` e `R:\` no Windows), `path.relative` não tem como
 * expressar a relação com `..` e devolve o caminho ABSOLUTO do destino. Esse
 * valor não começa com `..`, então o teste ingênuo conclui "está dentro" para um
 * caminho que está em outro disco.
 *
 * Na prática isso disparava um aviso alarmante e FALSO justamente na
 * configuração correta. Um aviso que grita quando está tudo certo é pior do que
 * aviso nenhum: em duas semanas todo mundo aprende a ignorá-lo, inclusive quando
 * ele estiver certo.
 *
 * As três condições, então: relação não vazia (não é o mesmo caminho), não sobe
 * (`..`) e não é absoluta (não trocou de volume).
 */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Traduz um caminho pedido em `GET /uploads/...` para um caminho absoluto no
 * disco — ou um motivo de recusa.
 *
 * -----------------------------------------------------------------------------
 * ESTA É A FUNÇÃO MAIS PERIGOSA DO MÓDULO, e ela é curta de propósito
 * -----------------------------------------------------------------------------
 * Ela recebe um caminho vindo da URL, ou seja, de qualquer pessoa da internet.
 * A defesa tem DUAS camadas independentes, e as duas existem porque a primeira
 * sozinha já foi contornada em muitos projetos:
 *
 *   1. FORMATO FECHADO. Cada segmento precisa casar com `[a-z0-9_-]` mais uma
 *      extensão conhecida. Isso rejeita `..`, `.`, barra invertida, NUL,
 *      codificação percentual sobrevivente e nome com espaço.
 *
 *   2. CONFERÊNCIA DO RESULTADO. Depois de montar o caminho, verificamos que
 *      ele começa DENTRO da raiz de uploads. É a camada que continuaria de pé
 *      se a primeira tivesse um furo — inclusive um vindo do `path.join`, que
 *      normaliza `..` em silêncio, sem reclamar de nada.
 */
export type ResolvedUploadPath =
  | { ok: true; path: string }
  /** O caminho pedido não é aceitável (formato, travessia). Responda 404. */
  | { ok: false; reason: 'rejected' }
  /** O armazenamento não está configurado. Responda 503 e registre no log. */
  | { ok: false; reason: 'unconfigured'; message: string };

export function resolveUploadPath(segments: string[]): ResolvedUploadPath {
  if (segments.length === 0 || segments.length > 4) return { ok: false, reason: 'rejected' };

  const safeSegment = /^[a-z0-9][a-z0-9_-]*$/i;
  const safeFile = new RegExp(`^[a-z0-9][a-z0-9_-]*\\.(${ACCEPTED_IMAGE_EXTENSIONS.join('|')})$`, 'i');

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (!(isLast ? safeFile : safeSegment).test(segment)) return { ok: false, reason: 'rejected' };
  }

  /**
   * A validação de FORMATO vem antes da leitura da configuração de propósito:
   * um caminho hostil é recusado do mesmo jeito, configurado ou não, e assim
   * nenhuma tentativa de travessia consegue distinguir "servidor mal
   * configurado" de "caminho recusado" pelo tempo de resposta.
   */
  const root = uploadRoot();
  if (!root.ok) return { ok: false, reason: 'unconfigured', message: root.message };

  const candidate = path.join(root.path, ...segments);

  // Segunda camada: o caminho final PRECISA estar sob a raiz. `path.relative`
  // devolvendo algo que sobe (`..`) ou um caminho absoluto significa que
  // escapamos — e aí a resposta certa é recusar, não "corrigir".
  const relative = path.relative(root.path, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, reason: 'rejected' };

  return { ok: true, path: candidate };
}

/** Tipo MIME a partir da extensão JÁ VALIDADA do arquivo em disco. */
export function mimeTypeForStoredFile(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_FORMATS.find((f) => f.extension === extension)?.mimeType ?? 'application/octet-stream';
}

/**
 * =============================================================================
 * RESOLUÇÃO DA IMAGEM ENVIADA — a metade da pixelização que só se resolve aqui
 * =============================================================================
 *
 * O PROBLEMA, EM UMA FRASE: nenhuma configuração de front-end torna nítida uma
 * imagem que chegou pequena.
 *
 * O contexto completo está em `next.config.ts` (bloco `images`), mas o resumo é
 * este: a capa de matéria é exibida com até 1088px de LARGURA EM CSS, e um
 * navegador em tela de alta densidade multiplica isso pela densidade —
 * 1,5× no Windows a 150%, 2× num notebook retina, até 3× no celular. Uma capa
 * enviada com 900px de largura é esticada em TODOS esses casos, e não existe
 * `deviceSizes`, `quality` ou `sizes` que conserte: o otimizador do Next nunca
 * amplia além do arquivo de origem (e faz bem — ampliar só produziria um
 * arquivo maior igualmente borrado).
 *
 * POR QUE ISSO ESTAVA ACONTECENDO DE FORMA SISTEMÁTICA: este projeto NÃO
 * processa a imagem no upload (sem `sharp`, sem redimensionamento, sem
 * recompressão — ver `uploads.ts`), e o teto é de 1,8 MB. A combinação empurra
 * a redação a encolher a imagem no computador antes de enviar, que é
 * exatamente o passo em que a resolução se perde — e ninguém percebe, porque no
 * monitor de quem enviou a prévia de 220px do painel fica ótima.
 *
 * -----------------------------------------------------------------------------
 * A ESCOLHA: AVISAR, NUNCA RECUSAR
 * -----------------------------------------------------------------------------
 * A tentação é barrar o envio abaixo de um mínimo. Seria errado por dois
 * motivos concretos. Primeiro, nem toda imagem enviada é capa: o editor de
 * blocos usa a mesma rota para ilustração de miolo, print de tuíte e recorte de
 * tabela, onde 700px é o tamanho certo. Segundo, e mais importante: isto é uma
 * redação de notícia. Bloquear o único frame disponível de um vídeo às 23h de
 * uma quinta-feira, em nome da nitidez, é o tipo de regra que faz alguém
 * publicar sem imagem nenhuma — resultado pior que uma imagem macia.
 *
 * Então em vez de recusar, avisamos — e o aviso cobre os DOIS caminhos do
 * campo de imagem (arquivo enviado e URL colada), não só o primeiro:
 * `coverResolutionAdvice` mora em `lib/cover-resolution.ts` (sem `node:path`,
 * de propósito) justamente para que `components/admin/image-url-field.tsx`
 * possa chamá-la direto no cliente, lendo `naturalWidth` da própria prévia —
 * sem depender desta rota, que só existe para quem ENVIA arquivo. Este
 * módulo reexporta os três nomes por compatibilidade com quem já os importa
 * daqui (ver `uploads.ts`, `upload-rules.test.ts`).
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM LEITOR DE CABEÇALHO PRÓPRIO, E NÃO `sharp`/`image-size`
 * -----------------------------------------------------------------------------
 * `sharp` existe na árvore de dependências (é opcional do Next, usado pelo
 * otimizador), mas depender dele AQUI significaria declará-lo como dependência
 * direta do app e passar a carregar um binário nativo numa rota de upload que
 * hoje não tem nenhum — numa hospedagem compartilhada onde o processo Node é o
 * mesmo que serve o site. Ler os primeiros bytes do arquivo responde a pergunta
 * que precisamos responder ("quantos pixels tem?") sem decodificar a imagem,
 * sem alocar bitmap e sem dependência nova. E, como é função pura, entra na
 * suíte de `node --test` que este módulo já tem — que é justamente a razão de
 * ele existir separado de `uploads.ts`.
 */

/**
 * Largura e altura a partir dos PRIMEIROS BYTES do arquivo — sem decodificar a
 * imagem.
 *
 * Cobre os cinco formatos que `IMAGE_FORMATS` aceita. `null` significa "não
 * consegui ler com segurança", e é o retorno certo para qualquer dúvida: esta
 * função alimenta um AVISO, então um palpite errado seria pior que o silêncio
 * (mandaria alguém trocar uma imagem que estava boa, ou aprovaria uma ruim).
 *
 * Ela nunca lança e nunca lê fora dos limites do buffer: recebe bytes vindos da
 * internet, e um arquivo truncado ou deliberadamente malformado precisa
 * resultar em `null`, não em exceção dentro da rota de upload.
 */
export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const format = detectImageFormat(bytes);
  if (!format) return null;

  switch (format.extension) {
    case 'png':
      return pngDimensions(bytes);
    case 'gif':
      return gifDimensions(bytes);
    case 'jpg':
      return jpegDimensions(bytes);
    case 'webp':
      return webpDimensions(bytes);
    case 'avif':
      return avifDimensions(bytes);
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Leitores de inteiro com verificação de limite.
//
// Cada um devolve `null` quando o buffer acaba antes — é o que transforma
// "arquivo truncado" em `null` lá em cima, em vez de `NaN` se propagando pelos
// cálculos até virar um aviso absurdo ("sua imagem tem NaN px").
// -----------------------------------------------------------------------------

function u16be(b: Uint8Array, at: number): number | null {
  if (at + 1 >= b.length) return null;
  return ((b[at] as number) << 8) | (b[at + 1] as number);
}

function u16le(b: Uint8Array, at: number): number | null {
  if (at + 1 >= b.length) return null;
  return (b[at] as number) | ((b[at + 1] as number) << 8);
}

function u24le(b: Uint8Array, at: number): number | null {
  if (at + 2 >= b.length) return null;
  return (b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16);
}

function u32be(b: Uint8Array, at: number): number | null {
  if (at + 3 >= b.length) return null;
  // `>>> 0` porque um valor com o bit mais alto ligado viraria negativo no
  // deslocamento com sinal do JavaScript.
  return (
    (((b[at] as number) << 24) |
      ((b[at + 1] as number) << 16) |
      ((b[at + 2] as number) << 8) |
      (b[at + 3] as number)) >>>
    0
  );
}

/** Só aceita um par que faça sentido como imagem de verdade. */
function validated(width: number | null, height: number | null): ImageDimensions | null {
  if (width === null || height === null) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  // Teto de sanidade: acima disso é cabeçalho corrompido lido como número, não
  // uma foto. (O maior sensor de câmera comercial não passa de ~15.000px.)
  if (width > 100_000 || height > 100_000) return null;
  return { width, height };
}

/**
 * PNG: o IHDR é OBRIGATORIAMENTE o primeiro chunk, então as posições são fixas.
 * 8 bytes de assinatura + 4 de tamanho + 4 de tipo = largura no byte 16.
 */
function pngDimensions(b: Uint8Array): ImageDimensions | null {
  return validated(u32be(b, 16), u32be(b, 20));
}

/** GIF: o "logical screen descriptor" vem logo depois dos 6 bytes de versão. */
function gifDimensions(b: Uint8Array): ImageDimensions | null {
  return validated(u16le(b, 6), u16le(b, 8));
}

/**
 * JPEG: não há posição fixa. É preciso percorrer os segmentos até achar um
 * "Start Of Frame", que é o único que carrega as dimensões.
 *
 * Os marcadores C4 (tabela de Huffman), C8 (extensão JPEG) e CC (codificação
 * aritmética) estão na mesma faixa numérica dos SOF e NÃO são SOF — confundi-los
 * é o erro clássico deste parser e produziria dimensões aleatórias.
 */
function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  // Começa depois do SOI (FF D8).
  let at = 2;

  while (at + 3 < b.length) {
    // Todo marcador começa com FF. Bytes FF repetidos são preenchimento legal.
    if (b[at] !== 0xff) {
      at += 1;
      continue;
    }

    const marker = b[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }

    // Marcadores sem carga: SOI, EOI e os RSTn.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }

    const length = u16be(b, at + 2);
    if (length === null || length < 2) return null;

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      // Dentro do SOF: [tamanho:2][precisão:1][altura:2][largura:2]
      return validated(u16be(b, at + 7), u16be(b, at + 5));
    }

    // SOS (FF DA) marca o início dos dados comprimidos: se chegamos aqui sem
    // achar o SOF, não vamos achar depois.
    if (marker === 0xda) return null;

    at += 2 + length;
  }

  return null;
}

/**
 * WebP: três codificações possíveis dentro do mesmo contêiner RIFF, cada uma
 * guardando o tamanho de um jeito. O tipo está nos 4 bytes do byte 12.
 */
function webpDimensions(b: Uint8Array): ImageDimensions | null {
  const chunk = ascii(b, 12, 4);

  // VP8X (estendido, usado por WebP animado ou com canal alfa/metadados):
  // depois do cabeçalho do chunk (8 bytes) vêm 4 bytes de flags e então a
  // largura e a altura da TELA, cada uma em 24 bits, guardadas como (valor - 1).
  if (chunk === 'VP8X') {
    const width = u24le(b, 24);
    const height = u24le(b, 27);
    return validated(width === null ? null : width + 1, height === null ? null : height + 1);
  }

  // VP8 (lossy): o "sync code" 9D 01 2A confirma que estamos no lugar certo; as
  // dimensões vêm logo depois, em 14 bits úteis cada (os 2 bits altos são a
  // escala, que não interessa aqui).
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const rawWidth = u16le(b, 26);
    const rawHeight = u16le(b, 28);
    return validated(
      rawWidth === null ? null : rawWidth & 0x3fff,
      rawHeight === null ? null : rawHeight & 0x3fff,
    );
  }

  // VP8L (lossless): 1 byte de assinatura (0x2F) e então 28 bits contendo
  // (largura - 1) em 14 bits e (altura - 1) nos 14 seguintes, em little-endian
  // de bits. Montamos um inteiro de 32 bits e fatiamos.
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    if (24 >= b.length) return null;
    const bits =
      ((b[21] as number) |
        ((b[22] as number) << 8) |
        ((b[23] as number) << 16) |
        ((b[24] as number) << 24)) >>>
      0;
    return validated((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }

  return null;
}

/**
 * AVIF: as dimensões vivem numa caixa `ispe` ("image spatial extents"), em
 * profundidade variável dentro da árvore ISO-BMFF.
 *
 * Em vez de percorrer a árvore inteira (meta → iprp → ipco → ispe, com
 * tamanhos de 32 ou 64 bits e caixas de extensão), procuramos a assinatura
 * `ispe` diretamente. É uma sequência de 4 bytes com estrutura fixa logo
 * depois, e o risco de falso positivo é remoto — mas existe, então usamos duas
 * proteções: `validated()` recusa números absurdos, e ficamos com a MAIOR
 * ocorrência.
 *
 * A maior, e não a primeira, porque um AVIF pode carregar miniatura embutida
 * (`thmb`), que tem `ispe` própria e às vezes aparece antes da imagem
 * principal. Pegar a primeira faria a rota avisar "sua imagem tem 240px" sobre
 * uma foto de 4000px — o pior erro possível para um aviso cuja função é ser
 * levado a sério.
 */
function avifDimensions(b: Uint8Array): ImageDimensions | null {
  let best: ImageDimensions | null = null;

  for (let at = 0; at + 15 < b.length; at += 1) {
    if (b[at] !== 0x69 || b[at + 1] !== 0x73 || b[at + 2] !== 0x70 || b[at + 3] !== 0x65) {
      continue; // não é "ispe"
    }

    // [tipo:4][versão+flags:4][largura:4][altura:4]
    const candidate = validated(u32be(b, at + 8), u32be(b, at + 12));
    if (candidate && (!best || candidate.width > best.width)) best = candidate;
  }

  return best;
}
