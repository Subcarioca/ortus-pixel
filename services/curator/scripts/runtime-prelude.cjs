/* =============================================================================
 * PRELÚDIO DE RUNTIME DO BUNDLE STANDALONE DO CURATOR
 * =============================================================================
 *
 * ESTE ARQUIVO NÃO É EXECUTADO DIRETAMENTE. Ele é lido por `scripts/build.mjs`
 * e injetado como `banner` no topo de `dist/curator.cjs`. Ou seja: é a PRIMEIRA
 * coisa que roda quando o cron chama o bundle, antes de qualquer `require` do
 * código empacotado — e é justamente por isso que ele existe.
 *
 * POR QUE UM ARQUIVO SEPARADO EM VEZ DE UMA STRING DENTRO DO build.mjs:
 * um banner escrito como template string vira código sem destaque de sintaxe,
 * sem lint e sem type-check — exatamente o tipo de código onde um erro de
 * digitação só aparece em produção, às 3h, dentro de um cron silencioso.
 * Como arquivo `.cjs` de verdade, o editor e o `node --check` continuam
 * valendo.
 *
 * -----------------------------------------------------------------------------
 * POR QUE TUDO ESTÁ DENTRO DE UMA IIFE
 * -----------------------------------------------------------------------------
 * O banner é concatenado LITERALMENTE no topo do arquivo gerado, fora do
 * empacotamento do esbuild. Se declarássemos `const fs = ...` no escopo do
 * módulo e o bundle também declarasse um `fs` no topo (o esbuild não sabe da
 * existência deste texto e não renomeia nada por causa dele), o resultado
 * seria um `SyntaxError: Identifier 'fs' has already been declared` — um erro
 * de build invisível até a hora de rodar. A IIFE isola tudo e não vaza
 * identificador nenhum.
 *
 * -----------------------------------------------------------------------------
 * AS TRÊS COISAS QUE ELE FAZ
 * -----------------------------------------------------------------------------
 *  1. Confere que o Prisma Client gerado veio junto no artefato.
 *  2. Confere que existe uma fonte de DATABASE_URL.
 *  3. Fixa o caminho do engine nativo do Prisma via
 *     `PRISMA_QUERY_ENGINE_LIBRARY`.
 *
 * Os três são checagens de PARTIDA: falham em 5ms com mensagem em português,
 * em vez de deixar o processo morrer 40 segundos depois com um erro do Prisma
 * que manda o leitor procurar no lugar errado. Num processo de fundo agendado,
 * onde ninguém está olhando a tela, a qualidade da mensagem de erro é a
 * diferença entre "consertei em 2 minutos" e "o site ficou uma semana sem
 * atualizar score e ninguém percebeu".
 * ========================================================================== */

(() => {
  const fs = require('node:fs');
  const path = require('node:path');

  // `__dirname` aqui é a pasta do PRÓPRIO arquivo gerado (dist/), porque este
  // texto é colado num arquivo CommonJS de verdade. É o que permite montar
  // todos os caminhos abaixo sem depender do diretório de onde o cron chamou o
  // processo — e o cron da Hostinger chama de `$HOME`, não da pasta do bundle.
  const CLIENT_DIR = path.join(__dirname, 'node_modules', '.prisma', 'client');

  /** Escreve no stderr e encerra com código != 0 (é o que o cron reporta). */
  function abortar(titulo, detalhe) {
    console.error(`\n[curator] ${titulo}\n${detalhe}\n`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. O PRISMA CLIENT GERADO VEIO JUNTO?
  // ---------------------------------------------------------------------------
  // O bundle contém todo o código TypeScript do projeto, mas NÃO contém o
  // Prisma Client: ele é código gerado que carrega uma biblioteca nativa
  // (`.so.node`), e binário não entra em bundle de JavaScript. Ele viaja ao
  // lado, em `dist/node_modules/`. Se alguém copiar só o `.cjs` para o
  // servidor — o erro mais provável deste deploy — a mensagem precisa dizer
  // exatamente isso.
  if (!fs.existsSync(path.join(CLIENT_DIR, 'index.js'))) {
    abortar(
      'Prisma Client não encontrado ao lado do bundle.',
      `Esperado em: ${CLIENT_DIR}\n` +
        'O bundle não funciona sozinho: a pasta node_modules/ gerada pelo build\n' +
        'precisa ser copiada JUNTO com o curator.cjs, preservando a estrutura:\n' +
        '  curator.cjs\n' +
        '  node_modules/.prisma/client/...\n' +
        '  node_modules/@prisma/client/...',
    );
  }

  // ---------------------------------------------------------------------------
  // 2. EXISTE UMA FONTE DE DATABASE_URL?
  // ---------------------------------------------------------------------------
  // Duas formas válidas, e o código aceita as duas:
  //
  //   (a) variável já no ambiente — é o caso de `node --env-file=.env ...`,
  //       que é o modo recomendado, porque também popula as variáveis
  //       OPCIONAIS (REVALIDATE_SECRET, NEXT_PUBLIC_SITE_URL, chaves de API).
  //
  //   (b) um arquivo `.env` ao lado do bundle. O próprio Prisma Client o
  //       carrega sozinho (o client gerado guarda `schemaEnvPath` apontando
  //       três níveis acima de si mesmo, que daqui dá exatamente `dist/.env`).
  //       Funciona, mas alimenta SÓ o Prisma — as demais variáveis ficam de
  //       fora. Por isso (a) é o caminho recomendado.
  //
  // ⚠ SEGURANÇA: NÃO coloque a senha direto na linha do cron
  // (`DATABASE_URL='mysql://...' node curator.cjs`). Em hospedagem
  // COMPARTILHADA, a linha de comando de um processo é legível por outros
  // usuários da máquina via `ps aux` — a senha do banco vazaria para vizinhos
  // de servidor. Um arquivo `.env` com `chmod 600` não tem esse problema.
  const ENV_LOCAL = path.join(__dirname, '.env');
  if (!process.env.DATABASE_URL && !fs.existsSync(ENV_LOCAL)) {
    abortar(
      'DATABASE_URL não definida.',
      'É a ÚNICA variável obrigatória. Escolha uma das duas formas:\n\n' +
        `  1) arquivo de ambiente (recomendado) — crie ${ENV_LOCAL}\n` +
        '     com  DATABASE_URL="mysql://usuario:senha@host:3306/banco"\n' +
        '     depois  chmod 600 .env\n' +
        '     e rode  node --env-file=.env curator.cjs --once\n\n' +
        '  2) exportando no ambiente do processo, a partir de um arquivo:\n' +
        '     set -a; . ./.env; set +a; node curator.cjs --once\n\n' +
        'Evite passar a senha inline no comando: em hospedagem compartilhada\n' +
        'ela fica visível para outros usuários no `ps aux`.',
    );
  }

  // ---------------------------------------------------------------------------
  // 3. FIXAR O CAMINHO DO ENGINE NATIVO
  // ---------------------------------------------------------------------------
  // O Prisma acha o engine sozinho quando ele está ao lado do client gerado —
  // que é exatamente o nosso caso. Então por que fixar?
  //
  // Porque a busca automática passa por `fs.existsSync` numa lista de
  // candidatos e, quando FALHA, o client guarda uma Promise rejeitada e nunca
  // mais tenta: o processo inteiro passa a responder erro em toda consulta.
  // Esse foi o modo de falha real que derrubou o apps/web nesta mesma
  // hospedagem (ver o cabeçalho de `server.js` na branch `deploy-standalone`).
  // `PRISMA_QUERY_ENGINE_LIBRARY` é lido antes de qualquer busca e devolve o
  // caminho direto — custo zero, elimina uma classe inteira de falha.
  //
  // Se o operador já definiu a variável, respeitamos: quem define isso à mão
  // está depurando alguma coisa, e sobrescrever seria hostil.
  if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    // O nome do arquivo do engine muda por sistema operacional. Só olhamos os
    // que fazem sentido para a plataforma atual — assim o mesmo bundle pode
    // carregar o engine do Linux no servidor e o do Windows na máquina de
    // desenvolvimento, sem nenhuma flag.
    const padrao =
      process.platform === 'win32'
        ? /^query_engine-windows.*\.dll\.node$/
        : process.platform === 'darwin'
          ? /^libquery_engine-darwin.*\.dylib\.node$/
          : /^libquery_engine-.*\.so\.node$/;

    const candidatos = fs.readdirSync(CLIENT_DIR).filter((nome) => padrao.test(nome));

    if (candidatos.length === 0) {
      abortar(
        `Nenhum engine do Prisma compatível com esta plataforma (${process.platform}).`,
        `Procurado em: ${CLIENT_DIR}\n` +
          'O build empacota, por padrão, apenas o engine do servidor\n' +
          '(debian-openssl-1.1.x). Para rodar o bundle na sua máquina, gere-o com:\n' +
          '  npm run build:local --workspace=@subcarioca/curator',
      );
    } else if (candidatos.length === 1) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(CLIENT_DIR, candidatos[0]);
    }
    // Mais de um candidato (ex.: dois engines de Linux com libssl diferentes):
    // escolher o errado seria PIOR que não escolher — daria erro de símbolo do
    // OpenSSL, muito mais difícil de diagnosticar do que a busca padrão. Nesse
    // caso deixamos o Prisma detectar a plataforma como ele já sabe fazer.
  }
})();
