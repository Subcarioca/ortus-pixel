// Entry file de verdade (é isto que o hPanel chama). Antes de carregar o Next
// — e, por tabela, o Prisma — restaura o cliente Prisma já gerado (motor
// debian-openssl-1.1.x incluído) de `vendor/` para `node_modules/` E para
// `/tmp/prisma-engines/`.
//
// HISTÓRICO (por que isto existe nesta forma específica):
//   1. `npm install` do Hostinger roda em `hbuilds/source/`, mas o processo
//      sobe de `hbuilds/versions/<uuid>/nodejs/` — diretório diferente. Um
//      postinstall corrige o lugar errado. Corrigido fazendo a restauração
//      aqui, no entry file real.
//   2. Múltiplos processos sobem quase ao mesmo tempo do mesmo diretório;
//      `copyFileSync` direto no destino final não é atômico. Corrigido
//      escrevendo em nome temporário e usando `renameSync` (atômico em POSIX).
//   3. MESMO ASSIM o erro persistiu. Confirmado via rota de diagnóstico: o
//      arquivo final está no lugar certo, com o TAMANHO EXATO do original
//      (21782408 bytes) — não é mais ausência nem corrupção de conteúdo.
//      Isso deixa duas explicações: (a) o arquivo perdeu a permissão de
//      execução na cópia, ou (b) o diretório está montado com `noexec`
//      (prática comum de segurança em hospedagem compartilhada) e o SO
//      recusa `dlopen()` nele mesmo com permissão correta.
//
// Por isso: (a) forçamos chmod 755 explicitamente após cada cópia — não dá
// para assumir que `copyFileSync` preserva o bit de execução; e (b) copiamos
// o motor TAMBÉM para `/tmp/prisma-engines/`, que é um caminho de busca que
// o PRÓPRIO Prisma já verifica nativamente (existe precisamente para
// ambientes onde o diretório de deploy não permite executar binários, como
// AWS Lambda) — `/tmp` normalmente não tem essa restrição.
const fs = require('fs');
const path = require('path');

function copyFileAtomic(src, dest, mode) {
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(src, tmp);
  if (mode !== undefined) {
    try {
      fs.chmodSync(tmp, mode);
    } catch (e) {
      console.error(`[server.js] chmod falhou em ${tmp}:`, e);
    }
  }
  fs.renameSync(tmp, dest);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      // O motor de consulta (.so.node) precisa do bit de execução para o
      // dlopen(); os demais arquivos (JS, .d.ts, .wasm) não.
      const isEngine = entry.name.endsWith('.so.node') || entry.name.endsWith('.dll.node');
      copyFileAtomic(s, d, isEngine ? 0o755 : undefined);
    }
  }
}

const DOT_PRISMA_SRC = path.join(__dirname, 'vendor', 'dot-prisma-client');
const AT_PRISMA_SRC = path.join(__dirname, 'vendor', 'at-prisma-client');

try {
  copyRecursive(DOT_PRISMA_SRC, path.join(__dirname, 'node_modules', '.prisma', 'client'));
} catch (e) {
  console.error('[server.js] falha ao restaurar .prisma/client:', e);
}

try {
  copyRecursive(AT_PRISMA_SRC, path.join(__dirname, 'node_modules', '@prisma', 'client'));
} catch (e) {
  console.error('[server.js] falha ao restaurar @prisma/client:', e);
}

// Fallback nativo do Prisma: copia só o(s) motor(es) para /tmp/prisma-engines.
// Se node_modules estiver numa montagem noexec, este é o caminho que salva.
try {
  const TMP_ENGINES_DIR = '/tmp/prisma-engines';
  fs.mkdirSync(TMP_ENGINES_DIR, { recursive: true });
  for (const entry of fs.readdirSync(DOT_PRISMA_SRC, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.so.node') || entry.name.endsWith('.dll.node'))) {
      copyFileAtomic(path.join(DOT_PRISMA_SRC, entry.name), path.join(TMP_ENGINES_DIR, entry.name), 0o755);
    }
  }
} catch (e) {
  console.error('[server.js] falha ao restaurar engine em /tmp/prisma-engines:', e);
}

require('./next-server.js');
