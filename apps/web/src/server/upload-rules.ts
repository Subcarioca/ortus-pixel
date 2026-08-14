import path from 'node:path';

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
