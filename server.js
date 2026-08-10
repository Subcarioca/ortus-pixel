// Entry file de verdade (é isto que o hPanel chama). Antes de carregar o Next
// — e, por tabela, o Prisma — restaura o cliente Prisma já gerado (motor
// debian-openssl-1.1.x incluído) de `vendor/` para `node_modules/`.
//
// POR QUE ISTO PRECISA VIVER AQUI E NÃO NUM POSTINSTALL:
// medido em produção via rota de diagnóstico: o `npm install` do Hostinger
// roda dentro de `hbuilds/source/`, mas o processo de verdade sobe a partir
// de `hbuilds/versions/<uuid>/nodejs/` — um diretório DIFERENTE, promovido a
// partir do primeiro em algum momento que não necessariamente espera o
// `postinstall` terminar. Um script de postinstall corrige o lugar errado.
//
// Este arquivo, ao contrário, É o processo que sobe a partir do diretório
// final — `__dirname` aqui É `hbuilds/versions/<uuid>/nodejs`, sempre, porque
// é o próprio arquivo que o hPanel executa como "Entry file". Corrigir aqui,
// de forma síncrona e ANTES do primeiro `require` de qualquer coisa que possa
// tocar o Prisma, é a única garantia que sobrevive a qualquer detalhe do
// pipeline de build que não controlamos.
const fs = require('fs');
const path = require('path');

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
  [path.join(__dirname, 'vendor', 'dot-prisma-client'), path.join(__dirname, 'node_modules', '.prisma', 'client')],
  [path.join(__dirname, 'vendor', 'at-prisma-client'), path.join(__dirname, 'node_modules', '@prisma', 'client')],
];

for (const [src, dest] of pairs) {
  try {
    copyRecursive(src, dest);
  } catch (e) {
    console.error(`[server.js] falha ao restaurar cliente Prisma de ${src}:`, e);
  }
}

require('./next-server.js');
