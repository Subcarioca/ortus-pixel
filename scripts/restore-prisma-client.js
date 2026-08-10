// Copia o cliente Prisma já gerado (motor debian-openssl-1.1.x incluído) de
// `vendor/` para `node_modules/`. Roda como o ÚLTIMO passo do `npm install`
// (postinstall do próprio projeto raiz sempre roda depois dos postinstall de
// cada dependência, nessa ordem, por garantia do próprio npm).
//
// POR QUE ISSO EXISTE: sem lockfile committado, `npm install` reconcilia a
// árvore de node_modules a cada deploy e não tem como saber que
// `node_modules/.prisma/client` foi colocado à mão — na visão dele, é uma
// pasta "extra" que não corresponde a nenhuma dependência declarada, e o
// próprio postinstall do pacote `@prisma/client` recria ali só os arquivos
// de stub (que lançam erro se alguém tentar instanciar o client sem rodar
// `prisma generate`). O resultado, medido em produção, era mais um cliente
// funcional às vezes e quebrado às vezes, dependendo de quem escrevia por
// último. Este script garante que a versão de verdade é sempre a última a
// escrever.
//
// Sem dependências: só `fs`/`path` do Node, porque roda antes de qualquer
// outra coisa poder ser confiada como instalada.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const pairs = [
  [path.join(ROOT, 'vendor', 'dot-prisma-client'), path.join(ROOT, 'node_modules', '.prisma', 'client')],
  [path.join(ROOT, 'vendor', 'at-prisma-client'), path.join(ROOT, 'node_modules', '@prisma', 'client')],
];

for (const [src, dest] of pairs) {
  if (!fs.existsSync(src)) {
    console.error(`[restore-prisma-client] fonte ausente, pulando: ${src}`);
    continue;
  }
  copyRecursive(src, dest);
  console.log(`[restore-prisma-client] restaurado: ${dest}`);
}
