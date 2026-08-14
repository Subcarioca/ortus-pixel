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

import { detectImageFormat, resolveUploadPath, uploadRoot } from './upload-rules';

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
