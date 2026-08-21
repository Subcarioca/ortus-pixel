/**
 * =============================================================================
 * TESTES — armazenamento de imagem enviada pelo painel
 * =============================================================================
 *
 * Dois grupos de teste, e os dois existem por um incidente concreto (um evitado
 * na revisão, outro evitado por conferência do ambiente real):
 *
 *   1. ONDE O ARQUIVO É GRAVADO. A primeira versão deste módulo usava uma pasta
 *      dentro do projeto (`var/uploads`) com valor padrão em produção. A
 *      premissa era um VPS com o repositório em disco — que é o que o README
 *      descreve, mas NÃO é o que está no ar: a produção é hospedagem
 *      compartilhada em que cada `git push` cria uma árvore de build nova. O
 *      efeito seria a perda de todas as imagens no deploy seguinte ao primeiro
 *      upload, semanas depois de o código ter sido escrito, sem nenhuma
 *      alteração que explicasse a quebra. Estes testes travam a regra que
 *      impede a premissa de voltar: em produção, caminho ABSOLUTO e explícito,
 *      ou nada feito.
 *
 *   2. QUAL CAMINHO PODE SER LIDO. `resolveUploadPath` recebe segmentos vindos
 *      da URL — ou seja, de qualquer pessoa da internet. É a função com a maior
 *      consequência por linha de todo o módulo.
 *
 * `NODE_ENV` é manipulado aqui de propósito: é a única forma de exercitar o
 * comportamento de produção sem estar em produção. Cada teste restaura o valor
 * anterior, senão a ordem de execução passaria a importar — e teste que depende
 * de ordem é teste que mente um dia.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  coverResolutionAdvice,
  detectImageFormat,
  imageDimensions,
  resolveUploadPath,
  uploadRoot,
} from './upload-rules';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/**
 * Troca o `NODE_ENV` só para o teste.
 *
 * O `as` existe porque os tipos do Next declaram `NODE_ENV` como SOMENTE
 * LEITURA — uma proteção legítima: reatribuí-lo em código de aplicação muda o
 * comportamento de bibliotecas inteiras no meio da execução. Aqui é exatamente o
 * contrário: exercitar o comportamento de produção sem estar em produção é a
 * única forma de testar a regra que impede a perda de imagens, e o valor volta
 * ao original no `afterEach` acima.
 */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

/** Caminho absoluto válido nos dois sistemas operacionais em que isto roda. */
const ABSOLUTO = process.platform === 'win32' ? 'C:\\dados\\uploads' : '/dados/uploads';

// -----------------------------------------------------------------------------
// ONDE GRAVAR
// -----------------------------------------------------------------------------

test('produção SEM UPLOADS_DIR recusa — não cai em pasta dentro do app', () => {
  // ESTE É O TESTE MAIS IMPORTANTE DO ARQUIVO. Um `?? path.join(cwd, ...)`
  // acrescentado aqui "para não quebrar o build" reintroduz a perda de imagens.
  setNodeEnv('production');
  delete process.env.UPLOADS_DIR;

  const root = uploadRoot();
  assert.equal(root.ok, false);
  assert.match(root.ok === false ? root.message : '', /não está configurado/i);
});

test('produção com caminho RELATIVO recusa em vez de resolver', () => {
  // Resolver produziria um caminho dentro da árvore de build — a configuração
  // errada, com aparência de funcionar até o próximo deploy.
  setNodeEnv('production');
  process.env.UPLOADS_DIR = 'var/uploads';

  const root = uploadRoot();
  assert.equal(root.ok, false);
  assert.match(root.ok === false ? root.message : '', /ABSOLUTO/);
});

test('produção com caminho absoluto aceita', () => {
  setNodeEnv('production');
  process.env.UPLOADS_DIR = ABSOLUTO;

  const root = uploadRoot();
  assert.equal(root.ok, true);
  assert.equal(root.ok === true ? root.path : '', path.resolve(ABSOLUTO));
});

test('caminho absoluto em outro volume não dispara aviso falso', () => {
  /**
   * REGRESSÃO DE UM BUG REAL, pego por este próprio arquivo de teste.
   *
   * A checagem "está dentro da pasta do app?" usava
   * `!path.relative(cwd, alvo).startsWith('..')`. Em volumes diferentes
   * (`R:\projeto` e `C:\dados`), `path.relative` devolve o caminho ABSOLUTO do
   * destino — que não começa com `..` —, então a configuração CORRETA disparava
   * um aviso dizendo que ela estava errada. Aviso falso é pior que aviso nenhum:
   * ensina todo mundo a ignorar o canal.
   */
  setNodeEnv('production');
  process.env.UPLOADS_DIR = ABSOLUTO;

  const erros: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => erros.push(args);

  try {
    const root = uploadRoot();
    assert.equal(root.ok, true);
  } finally {
    console.error = original;
  }

  assert.equal(erros.length, 0, `não deveria avisar nada, mas avisou: ${JSON.stringify(erros)}`);
});

test('desenvolvimento sem configuração continua funcionando', () => {
  // Exigir configuração para rodar o projeto na própria máquina seria atrito
  // sem contrapartida: a pasta local não é recriada por deploy nenhum.
  setNodeEnv('development');
  delete process.env.UPLOADS_DIR;

  const root = uploadRoot();
  assert.equal(root.ok, true);
  assert.ok(root.ok === true && path.isAbsolute(root.path));
});

// -----------------------------------------------------------------------------
// QUAL CAMINHO PODE SER LIDO
// -----------------------------------------------------------------------------

test('caminho legítimo resolve para dentro da raiz', () => {
  process.env.UPLOADS_DIR = ABSOLUTO;

  const resolved = resolveUploadPath(['2026', '08', 'abc123.jpg']);
  assert.equal(resolved.ok, true);
  assert.ok(resolved.ok === true && resolved.path.startsWith(path.resolve(ABSOLUTO)));
});

test('travessia de diretório é recusada em todas as formas conhecidas', () => {
  process.env.UPLOADS_DIR = ABSOLUTO;

  const ataques = [
    ['..', '..', '.env'],
    ['2026', '..', '..', '.env'],
    ['....', 'x.jpg'],
    ['2026', '08', '../../../etc/passwd.jpg'],
    ['2026', '08', 'a\\b.jpg'],
    ['2026', '08', 'a/b.jpg'],
    ['2026', '08', 'arquivo.jpg\u0000.txt'],
  ];

  for (const segmentos of ataques) {
    const resolved = resolveUploadPath(segmentos);
    assert.equal(resolved.ok, false, `deveria recusar: ${JSON.stringify(segmentos)}`);
  }
});

test('extensão fora da lista é recusada — inclusive SVG', () => {
  process.env.UPLOADS_DIR = ABSOLUTO;

  // SVG é XML e executa script: servido do nosso domínio, seria XSS armazenado
  // com acesso à sessão do painel. Ele não entra na gravação e não sai na leitura.
  for (const nome of ['x.svg', 'x.php', 'x.html', 'x.js', 'x']) {
    assert.equal(resolveUploadPath(['2026', '08', nome]).ok, false, `deveria recusar: ${nome}`);
  }
});

test('sem configuração em produção, a LEITURA também para — e diz por quê', () => {
  setNodeEnv('production');
  delete process.env.UPLOADS_DIR;

  const resolved = resolveUploadPath(['2026', '08', 'abc123.jpg']);
  assert.equal(resolved.ok, false);
  // 'unconfigured' vira 503 na rota; 'rejected' vira 404. Confundir os dois
  // manda quem depura procurar a imagem em vez de olhar a configuração.
  assert.equal(resolved.ok === false ? resolved.reason : '', 'unconfigured');
});

// -----------------------------------------------------------------------------
// O QUE É ACEITO COMO IMAGEM
// -----------------------------------------------------------------------------

test('o formato sai dos BYTES, não da extensão nem do Content-Type', () => {
  const jpeg = new Uint8Array(20);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(detectImageFormat(jpeg)?.extension, 'jpg');

  const png = new Uint8Array(20);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageFormat(png)?.extension, 'png');
});

test('SVG e HTML disfarçados de imagem não passam', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  assert.equal(detectImageFormat(svg), null);

  const html = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
  assert.equal(detectImageFormat(html), null);
});

test('arquivo curto demais para ter assinatura é recusado', () => {
  // Sem esta guarda, a leitura dos bytes de assinatura sairia do array e o
  // resultado dependeria de `undefined` em comparação — frágil e imprevisível.
  assert.equal(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff])), null);
});

test('RIFF que não é WEBP (um .wav renomeado) é recusado', () => {
  // "RIFF" sozinho é contêiner genérico: checar só ele aceitaria áudio.
  const wav = new Uint8Array(20);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVE'), 8);
  assert.equal(detectImageFormat(wav), null);
});

// -----------------------------------------------------------------------------
// RESOLUÇÃO DA IMAGEM ENVIADA
// -----------------------------------------------------------------------------
//
// POR QUE ESTES TESTES EXISTEM: `imageDimensions` alimenta um AVISO exibido à
// redação ("sua capa vai ficar pixelada"). Um aviso que erra o número é pior
// que aviso nenhum — manda a pessoa trocar uma imagem que estava boa e, na
// terceira vez, ensina todo mundo a ignorar a frase. Como os cabeçalhos são
// binários e cada formato guarda o tamanho de um jeito diferente (posição fixa
// no PNG, varredura de segmentos no JPEG, três codificações no WebP, caixa
// aninhada no AVIF), é exatamente o tipo de código que "parece certo" e erra.

/** JPEG mínimo: SOI, um APP0 de tamanho conhecido e um SOF0 de 640×360. */
function jpegDe(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    // APP0 com 4 bytes de carga — existe para provar que o parser PULA
    // segmentos em vez de assumir posição fixa.
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    // SOF0: tamanho 17, precisão 8, altura, largura, 3 componentes
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    // Descritores dos 3 componentes (não lidos, mas presentes num arquivo real).
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

test('PNG: dimensões saem do IHDR', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Largura 1920 (0x780) no byte 16, altura 1080 (0x438) no byte 20.
  png.set([0x00, 0x00, 0x07, 0x80], 16);
  png.set([0x00, 0x00, 0x04, 0x38], 20);

  assert.deepEqual(imageDimensions(png), { width: 1920, height: 1080 });
});

test('GIF: dimensões saem do descritor de tela, em little-endian', () => {
  const gif = new Uint8Array(20);
  gif.set(new TextEncoder().encode('GIF89a'), 0);
  gif.set([0x20, 0x03], 6); // 800
  gif.set([0x58, 0x02], 8); // 600

  assert.deepEqual(imageDimensions(gif), { width: 800, height: 600 });
});

test('JPEG: o parser percorre os segmentos até o SOF, sem posição fixa', () => {
  assert.deepEqual(imageDimensions(jpegDe(2400, 1350)), { width: 2400, height: 1350 });
});

test('JPEG: FF C4 (tabela de Huffman) NÃO é confundido com SOF', () => {
  // Este é o erro clássico do parser de JPEG: C4, C8 e CC estão na mesma faixa
  // numérica dos SOF (C0–CF) e não carregam dimensão nenhuma. Tratá-los como
  // SOF devolveria dois números aleatórios lidos de dentro de uma tabela.
  const comHuffman = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc4, 0x00, 0x08, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // DHT falso
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x1c, 0x03, 0xc0, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);

  assert.deepEqual(imageDimensions(comHuffman), { width: 960, height: 540 });
});

test('WebP lossy (VP8): dimensões vêm depois do sync code, em 14 bits', () => {
  const webp = new Uint8Array(32);
  webp.set(new TextEncoder().encode('RIFF'), 0);
  webp.set(new TextEncoder().encode('WEBP'), 8);
  webp.set(new TextEncoder().encode('VP8 '), 12);
  webp.set([0x9d, 0x01, 0x2a], 23); // sync code
  webp.set([0x00, 0x05], 26); // 1280
  webp.set([0xd0, 0x02], 28); // 720

  assert.deepEqual(imageDimensions(webp), { width: 1280, height: 720 });
});

test('WebP estendido (VP8X): a largura é guardada como valor MENOS UM', () => {
  // O deslocamento de 1 é a pegadinha do formato: gravar 1600 no cabeçalho
  // significa 1601 pixels. Sem o `+ 1`, todo aviso sairia com um pixel a menos —
  // invisível no teste errado e visível numa comparação exata como esta.
  const webp = new Uint8Array(32);
  webp.set(new TextEncoder().encode('RIFF'), 0);
  webp.set(new TextEncoder().encode('WEBP'), 8);
  webp.set(new TextEncoder().encode('VP8X'), 12);
  webp.set([0x3f, 0x06, 0x00], 24); // 1599 + 1 = 1600
  webp.set([0x7f, 0x03, 0x00], 27); // 895 + 1 = 896

  assert.deepEqual(imageDimensions(webp), { width: 1600, height: 896 });
});

test('AVIF: fica com a MAIOR caixa ispe, não com a primeira', () => {
  // Um AVIF pode carregar miniatura embutida, com `ispe` própria, às vezes
  // ANTES da imagem principal. Pegar a primeira faria a rota avisar "sua imagem
  // tem 240px" sobre uma foto de 2400px — o pior erro possível para um aviso
  // cuja função é ser levado a sério.
  const avif = new Uint8Array(64);
  avif.set(new TextEncoder().encode('ftyp'), 4);
  avif.set(new TextEncoder().encode('avif'), 8);

  // ispe da miniatura: 240×135
  avif.set(new TextEncoder().encode('ispe'), 16);
  avif.set([0, 0, 0, 0], 20);
  avif.set([0x00, 0x00, 0x00, 0xf0], 24);
  avif.set([0x00, 0x00, 0x00, 0x87], 28);

  // ispe da imagem principal: 2400×1350
  avif.set(new TextEncoder().encode('ispe'), 40);
  avif.set([0, 0, 0, 0], 44);
  avif.set([0x00, 0x00, 0x09, 0x60], 48);
  avif.set([0x00, 0x00, 0x05, 0x46], 52);

  assert.deepEqual(imageDimensions(avif), { width: 2400, height: 1350 });
});

test('arquivo truncado devolve null em vez de estourar ou inventar número', () => {
  // A rota de upload recebe bytes de fora. Um PNG cortado no meio do cabeçalho
  // precisa virar "não sei", nunca uma exceção dentro da rota nem um NaN que
  // vira "sua imagem tem NaN px" na tela de quem está fechando uma matéria.
  // 18 bytes: passa na checagem de assinatura (que exige 16) e MORRE no meio
  // do campo de largura do IHDR, que ocupa os bytes 16 a 19.
  const pngCortado = new Uint8Array(18);
  pngCortado.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  pngCortado.set([0x00, 0x00], 16);

  assert.equal(imageDimensions(pngCortado), null);
  assert.equal(imageDimensions(new Uint8Array(0)), null);
  assert.equal(imageDimensions(new TextEncoder().encode('<svg/>')), null);
});

test('o aviso de capa só aparece quando há algo útil a dizer', () => {
  // Silêncio quando não conseguimos medir: "não consegui ler sua imagem" é
  // ruído puro para quem está fechando uma matéria — não muda nada do que a
  // pessoa pode fazer.
  assert.equal(coverResolutionAdvice(null), null);
  // Acima do recomendado: nada a dizer.
  assert.equal(coverResolutionAdvice({ width: 2400, height: 1350 }), null);
  assert.equal(coverResolutionAdvice({ width: 1600, height: 900 }), null);

  // Zona intermediária e zona ruim têm textos diferentes porque pedem ações
  // diferentes ("trocar se der" × "trocar antes de publicar como capa").
  const media = coverResolutionAdvice({ width: 1280, height: 720 });
  const ruim = coverResolutionAdvice({ width: 900, height: 506 });

  assert.ok(media && media.includes('1280px'));
  assert.ok(ruim && ruim.includes('900px'));
  assert.notEqual(media, ruim);
});
