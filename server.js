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
// final — `__dirname` aqui É `hbuilds/versions/<uuid>/nodejs`, sempre.
//
// -----------------------------------------------------------------------
// POR QUE A CÓPIA PRECISA SER ATÔMICA (achado depois de ver o mesmo build
// funcionar e falhar sem NENHUMA mudança de código entre as tentativas):
// -----------------------------------------------------------------------
// O host sobe MAIS DE UM processo Node a partir do mesmo diretório quase ao
// mesmo tempo (visível no log: vários "✓ Ready" em milissegundos de
// diferença). Se dois processos executam este arquivo simultaneamente,
// `fs.copyFileSync` direto no destino final deixa uma janela em que o
// arquivo existe mas está PELA METADE — e o outro processo, tentando
// carregar o Prisma naquele instante exato, lê um `.so.node` truncado e
// trava com erro. Como o `PrismaClient` só tenta carregar o engine uma vez
// por processo, esse processo fica quebrado pelo resto da vida dele —
// exatamente o padrão observado (funciona numa requisição, falha na
// seguinte, sem nenhum determinismo aparente).
//
// A correção: escrever cada arquivo num nome temporário e só então
// `fs.renameSync` para o nome final. Em sistemas POSIX, `rename` dentro do
// mesmo sistema de arquivos é atômico — quem lê o destino enxerga o arquivo
// ANTERIOR (ou nada, na primeira vez) ou o COMPLETO, nunca um estado parcial.
const fs = require('fs');
const path = require('path');

function copyFileAtomic(src, dest) {
  // Nome temporário único por processo: dois processos escrevendo ao mesmo
  // tempo não pisam no arquivo temporário um do outro, só disputam o
  // `rename` final — e `rename` não tem estado parcial, só "antes" ou "depois".
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(src, tmp);
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
      copyFileAtomic(s, d);
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
