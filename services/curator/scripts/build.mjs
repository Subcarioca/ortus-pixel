#!/usr/bin/env node
/**
 * =============================================================================
 * BUILD STANDALONE DO CURATOR — de `tsx src/main.ts` para `node curator.cjs`
 * =============================================================================
 *
 * USO:
 *   npm run build        --workspace=@subcarioca/curator   # artefato de produção
 *   npm run build:local  --workspace=@subcarioca/curator   # + engine desta máquina
 *
 * Opções (todas com padrão sensato; a de produção não precisa de nenhuma):
 *   --out-dir=<caminho>     destino (padrão: services/curator/dist)
 *   --engine=<alvo>         engine do Prisma a embarcar; repetível
 *                           (padrão: debian-openssl-1.1.x — o do servidor)
 *   --with-host-engine      embarca também o engine da máquina que está
 *                           compilando, para dar para testar localmente
 *   --minify                minifica o bundle (padrão: NÃO — ver abaixo)
 *   --no-sourcemap          não gera o .map
 *
 * -----------------------------------------------------------------------------
 * O PROBLEMA QUE ESTE SCRIPT RESOLVE
 * -----------------------------------------------------------------------------
 * Hoje o curator roda com `tsx src/main.ts`, e isso depende de duas coisas que
 * NÃO existem no servidor da Hostinger:
 *
 *   1. O `tsx` — um interpretador de TypeScript instalado via npm. Em
 *      hospedagem compartilhada não há `npm ci` do monorepo inteiro nem
 *      `node_modules` de desenvolvimento.
 *   2. A RESOLUÇÃO DE WORKSPACE. `import { prisma } from '@subcarioca/db'` só
 *      funciona porque o npm criou um link simbólico dentro de
 *      `node_modules/@subcarioca/`. Fora do monorepo, esse import não resolve.
 *
 * A saída é empacotar: um único arquivo `.cjs` com TODO o código próprio já
 * traduzido para JavaScript e com os pacotes `@subcarioca/*` embutidos.
 *
 * -----------------------------------------------------------------------------
 * POR QUE esbuild (e não tsc, tsup, rollup ou webpack)
 * -----------------------------------------------------------------------------
 *   - `tsc` NÃO resolve o problema: ele transpila arquivo a arquivo e mantém os
 *     imports. O `import '@subcarioca/db'` continuaria lá, e continuaria sem
 *     resolver no servidor. Precisamos de um EMPACOTADOR, não de um compilador.
 *   - `tsup` é uma casca em volta do esbuild. Boa, mas é mais uma dependência
 *     para uma configuração que aqui cabe em 30 linhas.
 *   - `rollup`/`webpack` exigiriam plugin de TypeScript, plugin de resolução e
 *     configuração de externals — muito mais peça móvel para o mesmo resultado.
 *   - O esbuild JÁ ESTÁ na árvore de dependências (é o motor do `tsx`, que o
 *     projeto usa em todo lugar). Ainda assim ele está declarado
 *     EXPLICITAMENTE no package.json do curator: depender de uma dependência
 *     transitiva é uma bomba-relógio — o dia em que o `tsx` mudar a faixa de
 *     versão do esbuild, o build de produção quebra sem ninguém ter mexido nele.
 *
 * -----------------------------------------------------------------------------
 * O QUE ENTRA NO BUNDLE E O QUE FICA DE FORA
 * -----------------------------------------------------------------------------
 * ENTRA: `src/**` do curator + `@subcarioca/core`, `@subcarioca/scoring` e
 * `@subcarioca/db`. Os três são TypeScript puro, sem binário nenhum: o esbuild
 * os inlina sem cerimônia.
 *
 * FICA DE FORA (marcado como `external`): `@prisma/client` e `.prisma/client`.
 * Não é escolha estética, é impossibilidade técnica:
 *
 *   - O Prisma Client é CÓDIGO GERADO a partir do schema, e a classe
 *     `PrismaClient` só existe depois do `prisma generate`. Bundlá-lo
 *     congelaria uma cópia do schema dentro do JavaScript.
 *   - Ele carrega uma BIBLIOTECA NATIVA de 21 MB
 *     (`libquery_engine-*.so.node`). Binário não vira JavaScript: precisa
 *     existir como arquivo de verdade no disco.
 *
 * Por isso o build tem duas metades: empacotar o nosso código (esbuild) e
 * COPIAR o Prisma Client para o lado do bundle (a segunda metade deste script).
 *
 * -----------------------------------------------------------------------------
 * POR QUE `dist/node_modules/` E NÃO `dist/vendor/`
 * -----------------------------------------------------------------------------
 * O deploy do apps/web usa `vendor/dot-prisma-client` + uma cópia em tempo de
 * execução para dentro de `node_modules`. Aqui NÃO reproduzimos esse arranjo, e
 * a razão é concreta: aquele malabarismo existe porque o `npm install` que a
 * Hostinger roda no diretório do site reconcilia o `node_modules` DA RAIZ e
 * apagava o client gerado. O curator é um artefato passivo numa subpasta —
 * nenhum `npm install` roda dentro dele, então não há nada de que se proteger.
 *
 * E a estrutura `node_modules` é OBRIGATÓRIA por um detalhe do código gerado:
 * `.prisma/client/index.js` faz `require('@prisma/client/runtime/library.js')`
 * — um especificador "puro", que o Node só resolve subindo a árvore de pastas
 * atrás de um diretório chamado `node_modules`. Renomear a pasta para `vendor`
 * quebraria essa resolução e exigiria monkey-patch do resolvedor do Node, que é
 * exatamente o tipo de esperteza que ninguém consegue depurar seis meses depois.
 *
 * O que NÓS reaproveitamos do aprendizado do apps/web é o que de fato importa:
 * o engine `debian-openssl-1.1.x` (o único que roda naquele servidor,
 * confirmado em log de produção) e o uso de `PRISMA_QUERY_ENGINE_LIBRARY` para
 * eliminar a busca de engine — ver `scripts/runtime-prelude.cjs`.
 */

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------------------
// Caminhos — sempre derivados da posição DESTE arquivo, nunca de `process.cwd()`.
// Sem isso, rodar o script de uma pasta diferente geraria o bundle no lugar
// errado, e o erro só apareceria no deploy.
// -----------------------------------------------------------------------------
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CURATOR_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(CURATOR_DIR, '..', '..');
const DB_PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'db');

/**
 * Engine padrão. É o alvo do servidor da Hostinger — confirmado em log de
 * produção do apps/web, não presumido (commit b61b066). Se um dia a imagem do
 * servidor mudar para uma com OpenSSL 3, o sintoma é claro
 * ("Unable to require libquery_engine...") e a correção é
 * `--engine=debian-openssl-3.0.x` — que o schema já gera.
 */
const ENGINE_PADRAO = 'debian-openssl-1.1.x';

/**
 * Versão de Node alvo da transpilação.
 *
 * O `engines` do monorepo exige >= 20.9, e a Hostinger permite escolher entre
 * 18/20/22/24. Miramos em `node20`: é o PISO suportado pelo projeto, e código
 * gerado para o piso roda sem problema em qualquer versão acima. Mirar em
 * `node22` economizaria alguns bytes de polyfill e, em troca, quebraria em
 * silêncio se alguém selecionasse Node 20 no painel.
 */
const NODE_ALVO = 'node20';

// =============================================================================
// ARGUMENTOS
// =============================================================================
function parseArgs(argv) {
  const opts = {
    outDir: path.join(CURATOR_DIR, 'dist'),
    engines: [],
    withHostEngine: false,
    minify: false,
    sourcemap: true,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out-dir=')) opts.outDir = path.resolve(arg.slice('--out-dir='.length));
    else if (arg.startsWith('--engine=')) opts.engines.push(arg.slice('--engine='.length));
    else if (arg === '--with-host-engine') opts.withHostEngine = true;
    else if (arg === '--minify') opts.minify = true;
    else if (arg === '--no-sourcemap') opts.sourcemap = false;
    else {
      // Falhar num argumento desconhecido, em vez de ignorá-lo: um
      // `--engines=` (com "s") ignorado em silêncio produziria um artefato sem
      // o engine certo, e o erro só apareceria no servidor.
      console.error(`[build] argumento desconhecido: ${arg}`);
      process.exit(1);
    }
  }

  if (opts.engines.length === 0) opts.engines.push(ENGINE_PADRAO);
  return opts;
}

// =============================================================================
// LOCALIZAR O PRISMA CLIENT
// =============================================================================
/**
 * Descobre onde estão, de verdade, `@prisma/client` e o client gerado
 * (`.prisma/client`).
 *
 * POR QUE RESOLVER EM VEZ DE CHUTAR `<raiz>/node_modules/...`: o `.npmrc` deste
 * projeto usa `install-strategy=nested`, então a pasta pode estar na raiz OU
 * dentro de `packages/db/node_modules`, dependendo de como o npm resolveu a
 * árvore naquele dia. Um caminho fixo funcionaria hoje e quebraria depois de um
 * `npm ci` qualquer — e quebraria em quem clonou o repositório, não em quem
 * escreveu o script.
 *
 * Resolvemos a partir de `packages/db` porque é ele que declara o
 * `@prisma/client` como dependência: é o mesmo caminho que o código de
 * produção percorre.
 */
function localizarPrismaClient() {
  const requireFromDb = createRequire(path.join(DB_PACKAGE_DIR, 'package.json'));

  let atPrismaDir;
  try {
    atPrismaDir = path.dirname(requireFromDb.resolve('@prisma/client/package.json'));
  } catch {
    console.error(
      '\n[build] @prisma/client não encontrado.\n' +
        'Instale as dependências do monorepo antes de compilar:\n' +
        '  npm install\n',
    );
    process.exit(1);
  }

  // O client GERADO não é um pacote publicado: é uma pasta que o
  // `prisma generate` cria ao lado do `@prisma/client`. Resolvemos a partir de
  // lá, que é exatamente como o `index.js` do `@prisma/client` o encontra em
  // tempo de execução.
  const requireFromAtPrisma = createRequire(path.join(atPrismaDir, 'index.js'));
  let dotPrismaDir;
  try {
    dotPrismaDir = path.dirname(requireFromAtPrisma.resolve('.prisma/client/package.json'));
  } catch {
    console.error(
      '\n[build] Prisma Client gerado (.prisma/client) não encontrado.\n' +
        'Ele é CÓDIGO GERADO e não vem do npm. Gere-o antes de compilar:\n' +
        '  npm run db:generate\n',
    );
    process.exit(1);
  }

  return { atPrismaDir, dotPrismaDir };
}

// =============================================================================
// CÓPIA DO PRISMA CLIENT (a metade não-bundlável do build)
// =============================================================================

/**
 * Arquivos do pacote `@prisma/client` que o caminho CommonJS + engine nativo
 * realmente carrega. É uma LISTA DE PERMISSÃO, e não uma lista de exclusão, por
 * um motivo de tamanho difícil de exagerar: o pacote inteiro ocupa 74 MB, dos
 * quais ~73 MB são cópias em base64 dos engines WebAssembly de TODOS os bancos
 * suportados (Postgres, SQLite, SQL Server, CockroachDB...). Nada disso é
 * tocado por um processo Node com engine nativo — e um artefato de deploy de
 * 74 MB numa hospedagem compartilhada é um problema real, não teórico.
 *
 * A lista foi conferida seguindo os `require` de verdade, não por adivinhação:
 *   dist/curator.cjs
 *     -> require('@prisma/client')            = index.js
 *        -> require('.prisma/client/default') = default.js do client gerado
 *           -> require('#main-entry-point')   = index.js do client gerado
 *              -> require('@prisma/client/runtime/library.js')
 *                 -> só módulos nativos do Node (node:fs, node:path, ...)
 *
 * `package.json` entra porque é ele que faz o mapa de `exports` funcionar, e
 * `LICENSE` entra por higiene jurídica: estamos redistribuindo o pacote dentro
 * do nosso artefato.
 *
 * SE ALGUM DIA FALTAR ALGO: o sintoma é um `MODULE_NOT_FOUND` com o caminho
 * exato do arquivo ausente. Acrescente-o aqui e refaça o build.
 */
const ARQUIVOS_AT_PRISMA = [
  'package.json',
  'LICENSE',
  'index.js',
  'default.js',
  path.join('runtime', 'library.js'),
];

/**
 * Do client GERADO copiamos tudo que o caminho Node/CommonJS usa, mais o
 * engine escolhido. Ficam de fora:
 *   - os outros engines (21 MB cada — a razão de o pacote ter 140 MB aqui);
 *   - `index.d.ts` (2 MB de tipos que só o compilador lê);
 *   - `query_engine_bg.wasm` e companhia (caminho edge/WASM, que não usamos);
 *   - sobras de `.tmp*` que o `prisma generate` deixa no Windows.
 *
 * `schema.prisma` é OBRIGATÓRIO: o `index.js` gerado faz
 * `fs.existsSync(path.join(__dirname, 'schema.prisma'))` e, se não achar,
 * passa a procurar o client a partir de `process.cwd()` — que, num cron, é a
 * pasta do usuário, e aí nada funciona.
 */
const ARQUIVOS_DOT_PRISMA = ['package.json', 'index.js', 'default.js', 'schema.prisma'];

/** Casa o nome de arquivo de um engine nativo (e ignora sobras `.tmp1234`). */
const REGEX_ENGINE = /^(lib)?query_engine-.+\.(so|dll|dylib)\.node$/;

/**
 * Descobre o nome do arquivo de engine correspondente a um binaryTarget do
 * Prisma. Fazemos por varredura em vez de montar o nome na mão porque a
 * convenção muda por sistema (`libquery_engine-<alvo>.so.node` no Linux,
 * `query_engine-windows.dll.node` no Windows, `.dylib.node` no macOS) e
 * duplicar essa tabela aqui seria mais uma coisa para envelhecer mal.
 */
function acharEngine(dotPrismaDir, alvo) {
  const arquivos = fs.readdirSync(dotPrismaDir).filter((n) => REGEX_ENGINE.test(n));
  return arquivos.find((n) => n.includes(`query_engine-${alvo}.`)) ?? null;
}

/** O engine que roda NESTA máquina — usado só pelo `--with-host-engine`. */
function acharEngineDoHost(dotPrismaDir) {
  const padrao =
    process.platform === 'win32'
      ? /^query_engine-windows\..*\.node$/
      : process.platform === 'darwin'
        ? /^libquery_engine-darwin.*\.dylib\.node$/
        : /^libquery_engine-.*\.so\.node$/;

  return fs.readdirSync(dotPrismaDir).find((n) => REGEX_ENGINE.test(n) && padrao.test(n)) ?? null;
}

/** Copia um arquivo criando os diretórios intermediários. */
function copiar(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
  return fs.statSync(destino).size;
}

// =============================================================================
// PROGRAMA
// =============================================================================
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { atPrismaDir, dotPrismaDir } = localizarPrismaClient();

  console.log('Ortus Pixel — build standalone do curator\n');
  console.log(`  destino : ${opts.outDir}`);
  console.log(`  engines : ${opts.engines.join(', ')}${opts.withHostEngine ? ' (+ host)' : ''}`);
  console.log(`  alvo    : ${NODE_ALVO}\n`);

  // ---------------------------------------------------------------------------
  // Limpeza do destino.
  // Refazer o build por cima do anterior deixaria para trás arquivos de uma
  // versão antiga — inclusive um engine de outra plataforma que o prelúdio de
  // runtime então veria como "dois candidatos" e desistiria de fixar.
  // ---------------------------------------------------------------------------
  fs.rmSync(opts.outDir, { recursive: true, force: true });
  fs.mkdirSync(opts.outDir, { recursive: true });

  // ---------------------------------------------------------------------------
  // ETAPA 1 — EMPACOTAR O NOSSO CÓDIGO
  // ---------------------------------------------------------------------------
  const prelude = fs.readFileSync(path.join(SCRIPT_DIR, 'runtime-prelude.cjs'), 'utf8');
  const outfile = path.join(opts.outDir, 'curator.cjs');

  const resultado = await build({
    entryPoints: [path.join(CURATOR_DIR, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: NODE_ALVO,

    // FORMATO CommonJS, e não ESM, de propósito:
    //   - o Prisma Client gerado é CommonJS; em CJS o `require` dele é direto,
    //     sem `createRequire` nem interoperabilidade de `default`;
    //   - `__dirname` existe de graça, e é dele que o prelúdio depende para
    //     achar o client e o engine sem depender do diretório de onde o cron
    //     chamou o processo.
    // A extensão `.cjs` é o que garante isso: o `package.json` do curator
    // declara `"type": "module"`, então um arquivo `.js` aqui dentro seria
    // interpretado como ESM e o `require` do prelúdio explodiria.
    format: 'cjs',

    // O engine nativo e o código gerado ficam FORA do bundle — ver o cabeçalho.
    // `.prisma/client` está na lista por garantia: hoje ninguém o importa
    // diretamente, mas se alguém o fizer amanhã, o esbuild tentaria empacotar
    // um arquivo de 21 MB e o erro seria bem obscuro.
    external: ['@prisma/client', '.prisma/client'],

    // Minificar economiza ~40% do tamanho de um arquivo que já é pequeno, e em
    // troca transforma toda pilha de erro em `a.b(c)`. Num processo agendado,
    // sem ninguém olhando, o log É a única ferramenta de diagnóstico. O padrão
    // fica em não minificar; quem quiser, passa `--minify`.
    minify: opts.minify,

    // O mapa não é lido automaticamente pelo Node: só com
    // `node --enable-source-maps`. Custa um arquivo extra e devolve pilhas de
    // erro apontando para o .ts original quando você precisar.
    sourcemap: opts.sourcemap,

    banner: { js: prelude },
    logLevel: 'warning',
    metafile: true,
  });

  const tamanhoBundle = fs.statSync(outfile).size;
  console.log(`[1/2] bundle gerado: curator.cjs (${(tamanhoBundle / 1024).toFixed(0)} KB)`);

  // Quais pacotes acabaram DE FATO embutidos. Isto não é enfeite de log: é a
  // verificação de que a fronteira do bundle é a que documentamos. Se um dia
  // alguém acrescentar uma dependência npm de verdade ao curator, ela aparece
  // aqui — e se aparecer algo com binário nativo, é sinal de que precisa virar
  // `external` e ser copiado, como o Prisma.
  //
  // Os pacotes do workspace entram pelo caminho REAL (`packages/<nome>/src`),
  // e não por `node_modules/@subcarioca/...`, porque o npm os instala como
  // link simbólico e o esbuild registra o destino do link.
  const embutidos = new Set();
  for (const arquivo of Object.keys(resultado.metafile.inputs)) {
    const daNpm = arquivo.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//);
    if (daNpm) {
      embutidos.add(daNpm[1]);
      continue;
    }
    const doWorkspace = arquivo.match(/(?:^|\/)packages\/([^/]+)\//);
    if (doWorkspace) embutidos.add(`@subcarioca/${doWorkspace[1]}`);
  }
  if (embutidos.size > 0) {
    console.log(`      pacotes embutidos: ${[...embutidos].sort().join(', ')}`);
  }

  // ---------------------------------------------------------------------------
  // ETAPA 2 — COPIAR O PRISMA CLIENT PARA O LADO DO BUNDLE
  // ---------------------------------------------------------------------------
  const destAtPrisma = path.join(opts.outDir, 'node_modules', '@prisma', 'client');
  const destDotPrisma = path.join(opts.outDir, 'node_modules', '.prisma', 'client');

  let bytes = 0;

  for (const relativo of ARQUIVOS_AT_PRISMA) {
    const origem = path.join(atPrismaDir, relativo);
    if (!fs.existsSync(origem)) {
      console.error(`\n[build] arquivo esperado não existe em @prisma/client: ${relativo}`);
      console.error('A estrutura do pacote mudou (upgrade do Prisma?). Ajuste ARQUIVOS_AT_PRISMA.');
      process.exit(1);
    }
    bytes += copiar(origem, path.join(destAtPrisma, relativo));
  }

  for (const relativo of ARQUIVOS_DOT_PRISMA) {
    const origem = path.join(dotPrismaDir, relativo);
    if (!fs.existsSync(origem)) {
      console.error(`\n[build] arquivo esperado não existe no client gerado: ${relativo}`);
      console.error('Rode `npm run db:generate` e tente de novo.');
      process.exit(1);
    }
    bytes += copiar(origem, path.join(destDotPrisma, relativo));
  }

  // --- os engines ---
  // Monta a lista final de ARQUIVOS a copiar. Usamos um Set porque o engine do
  // host pode ser o mesmo que o de produção (quando se compila no Linux) e
  // copiar 21 MB duas vezes para o mesmo destino, além de inútil, deixaria o
  // relatório mentindo sobre o que foi embarcado.
  const arquivosDeEngine = new Set();

  for (const alvo of opts.engines) {
    const arquivo = acharEngine(dotPrismaDir, alvo);
    if (!arquivo) {
      console.error(
        `\n[build] engine "${alvo}" não encontrado em ${dotPrismaDir}.\n` +
          'Ele precisa estar em `binaryTargets` no packages/db/prisma/schema.prisma\n' +
          'e o `npm run db:generate` precisa ter rodado depois disso.',
      );
      process.exit(1);
    }
    arquivosDeEngine.add(arquivo);
  }

  if (opts.withHostEngine) {
    const host = acharEngineDoHost(dotPrismaDir);
    if (!host) {
      console.error(
        `\n[build] --with-host-engine: nenhum engine para ${process.platform} em ${dotPrismaDir}.\n` +
          'O schema precisa ter "native" em binaryTargets e o generate precisa ter\n' +
          'rodado NESTA máquina. Tente: npm run db:generate',
      );
      process.exit(1);
    }
    arquivosDeEngine.add(host);
  }

  const enginesCopiados = [...arquivosDeEngine];
  for (const arquivo of enginesCopiados) {
    bytes += copiar(path.join(dotPrismaDir, arquivo), path.join(destDotPrisma, arquivo));
  }

  console.log(`[2/2] Prisma Client copiado (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  for (const e of enginesCopiados) console.log(`      engine: ${e}`);

  // ---------------------------------------------------------------------------
  // Manifesto do build.
  // Serve para responder, olhando só o servidor, à pergunta que sempre aparece
  // num incidente: "esse artefato aí é de quando, e tem o engine certo?".
  // ---------------------------------------------------------------------------
  fs.writeFileSync(
    path.join(opts.outDir, 'build-info.json'),
    `${JSON.stringify(
      {
        geradoEm: new Date().toISOString(),
        nodeDoBuild: process.version,
        alvoDeTranspilacao: NODE_ALVO,
        engines: enginesCopiados,
        minificado: opts.minify,
        comando: 'node --env-file=.env curator.cjs --once',
      },
      null,
      2,
    )}\n`,
  );

  console.log('\nPronto. Para rodar:');
  console.log(`  cd ${opts.outDir}`);
  console.log('  node --env-file=.env curator.cjs --once\n');
}

main().catch((erro) => {
  console.error('\n[build] falhou:', erro);
  process.exit(1);
});
