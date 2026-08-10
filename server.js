// Entry file de verdade (é isto que o hPanel chama).
//
// HISTÓRICO — por que isto existe nesta forma (revisão de código confirmou o
// mecanismo lendo o runtime do Prisma desminificado, não só teoria):
//   1. `npm install` do Hostinger roda em `hbuilds/source/`, mas o processo
//      sobe de `hbuilds/versions/<uuid>/nodejs/` — diretório diferente.
//   2. Múltiplos processos-filho do LiteSpeed (`LSAPI_CHILDREN`, default 6)
//      sobem do mesmo diretório e continuam sendo criados sob demanda a
//      qualquer pico de tráfego — não é só um problema de boot único.
//   3. `Wm()` (a busca de engine do Prisma) só lança "could not locate the
//      Query Engine" quando `fs.existsSync` dá falso em TODOS os caminhos.
//      Copiar o `.so.node` (21MB) pro destino final, por mais atômica que a
//      escrita seja, sempre tem uma janela em que o destino ainda não
//      existe — e um processo-filho que nasce nessa janela falha essa
//      checagem, fica com uma Promise de engine rejeitada PARA SEMPRE (o
//      client não tenta de novo), e responde 500 em toda query pelo resto
//      da vida daquele processo. Reaparece a cada novo filho, não só no boot.
//
// A SAÍDA: `PRISMA_QUERY_ENGINE_LIBRARY`. O código do Prisma lê essa env var
// e retorna o caminho DIRETO, sem passar por `existsSync`/busca nenhuma:
//
//   let t = { library: process.env.PRISMA_QUERY_ENGINE_LIBRARY }[e] ?? r.prismaPath;
//   if (t !== void 0) return t;
//
// Setando isto ANTES do primeiro require que toque Prisma, o `.so.node`
// nunca precisa ser copiado pra lugar nenhum — ele já está em `vendor/`,
// que o `npm install` do Hostinger não tem motivo pra tocar (não é
// `node_modules`), e cujo caminho final é só concatenado a partir de
// `__dirname`, que aqui é SEMPRE `hbuilds/versions/<uuid>/nodejs` (é o
// próprio arquivo que o hPanel executa). Sem cópia, sem janela, sem race.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENGINE_PATH = path.join(
  __dirname,
  'vendor',
  'dot-prisma-client',
  'libquery_engine-debian-openssl-1.1.x.so.node',
);

if (!fs.existsSync(ENGINE_PATH)) {
  // Falhar alto, na hora, é melhor que subir "saudável" e responder 500 em
  // toda rota que toca banco — um `exit(1)` aqui vira o app inteiro
  // "unhealthy" de forma óbvia no painel, em vez de um problema silencioso
  // só visível quando alguém clica numa matéria.
  console.error('[server.js] engine do Prisma ausente em', ENGINE_PATH);
  process.exit(1);
}

process.env.PRISMA_QUERY_ENGINE_LIBRARY = ENGINE_PATH;

// O engine é resolvido pela env var acima e não precisa mais existir dentro
// de node_modules. Mas o CÓDIGO do client (a classe PrismaClient de verdade,
// gerada a partir do schema) ainda precisa estar lá — é o que `require
// ('@prisma/client')` carrega. Sem isto, o `npm install` do Hostinger (sem
// lockfile, reconciliando a árvore do zero a cada deploy) deixa só os
// arquivos "stub" que o postinstall do próprio `@prisma/client` cria — uma
// classe que só lança erro ao ser instanciada, de propósito, pra avisar que
// falta rodar `prisma generate`.
//
// Copiado de forma IDEMPOTENTE: se o destino já tem o mesmo tamanho da
// origem, não mexe — depois do primeiro processo-filho que restaura com
// sucesso, todo filho seguinte é um no-op, e a janela de corrida deixa de
// existir pro resto da vida do deploy. É a mudança de maior efeito com
// menor risco: nenhum processo depois do primeiro sequer tenta escrever.
function needsCopy(src, dest) {
  try {
    return fs.statSync(src).size !== fs.statSync(dest).size;
  } catch {
    return true; // destino não existe ainda, ou stat falhou: copia.
  }
}

function copyFileAtomic(src, dest) {
  const tmp = `${dest}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

function restoreIdempotent(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // O(s) engine(s) nativo(s) não entram mais aqui: node_modules não é mais
    // de onde o Prisma os carrega (ver PRISMA_QUERY_ENGINE_LIBRARY acima).
    // Copiar 21MB a cada processo-filho era o próprio risco que estamos
    // eliminando — pular esses arquivos também corta o maior custo de I/O
    // do restore.
    if (entry.name.endsWith('.so.node') || entry.name.endsWith('.dll.node')) continue;

    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      restoreIdempotent(s, d);
    } else if (needsCopy(s, d)) {
      copyFileAtomic(s, d);
    }
  }
}

// Só o código JS do client — o engine (o arquivo grande, o que causava a
// race) não faz mais parte deste passo, resolvido via env var acima.
try {
  restoreIdempotent(path.join(__dirname, 'vendor', 'dot-prisma-client'), path.join(__dirname, 'node_modules', '.prisma', 'client'));
  restoreIdempotent(path.join(__dirname, 'vendor', 'at-prisma-client'), path.join(__dirname, 'node_modules', '@prisma', 'client'));
} catch (e) {
  console.error('[server.js] falha ao restaurar o client Prisma:', e);
  process.exit(1);
}

require('./next-server.js');
