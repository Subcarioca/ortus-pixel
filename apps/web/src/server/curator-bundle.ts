import path from 'node:path';
import fs from 'node:fs';

/**
 * =============================================================================
 * ONDE ESTÁ O BUNDLE DO CURATOR — a decisão de caminho, isolada
 * =============================================================================
 *
 * Este módulo responde UMA pergunta: "qual arquivo o servidor deve executar
 * quando alguém clicar em «Buscar pautas agora»?". Ele não spawna nada, não
 * toca no banco e não conhece HTTP — isso é de `curator-runner.ts`.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ELE É SEPARADO DE `curator-runner.ts`
 * -----------------------------------------------------------------------------
 * Pelo mesmo motivo de `upload-rules.ts` × `uploads.ts`, e a razão é concreta:
 * `curator-runner.ts` importa `'server-only'`, que é resolvido pelo bundler do
 * Next e NÃO existe como módulo comum — um teste em `node --test` sequer
 * consegue carregar aquele arquivo (ver o `//test` do package.json de apps/web).
 *
 * E a regra de MAIOR consequência desta funcionalidade é justamente esta: um
 * caminho errado significa "o botão não funciona em produção", descoberto por
 * quem clicou, não por quem escreveu. Deixá-la impossível de testar seria o pior
 * lugar do projeto para economizar um arquivo. Ver `curator-bundle.test.ts`.
 *
 * A ausência de `'server-only'` aqui NÃO é convite para importar isto do
 * cliente: o módulo usa `node:fs` e `node:path`, e o build quebraria.
 *
 * =============================================================================
 * A PARTE QUE VALE MAIS QUE O RESTO DO ARQUIVO: A ÁRVORE DE PRODUÇÃO
 * =============================================================================
 *
 * A produção NÃO é um VPS com o repositório clonado (ver o cabeçalho de
 * `server/uploads.ts`, que já documentou esse engano). O que roda é o "Node.js
 * App Hosting" da Hostinger: cada publicação cria uma árvore nova em
 * `hbuilds/versions/<uuid>/nodejs/` e o link `hbuilds/current` passa a apontar
 * para ela.
 *
 * O conteúdo dessa árvore é EXATAMENTE a raiz da branch `deploy-standalone`:
 *
 *   hbuilds/current/nodejs/
 *   ├── server.js          <- entry file que o hPanel executa
 *   ├── next-server.js     <- sobe o Next de verdade
 *   ├── .next/  node_modules/  prisma/  public/  vendor/  package.json
 *   └── curator/
 *       ├── curator.cjs             <- O ALVO
 *       ├── build-info.json
 *       └── node_modules/{.prisma,@prisma}/client/...
 *
 * Ou seja: o bundle é um IRMÃO do `server.js`, dentro de `curator/`. O caminho
 * é `./curator/curator.cjs` a partir da raiz do app — nunca
 * `/home/u754239208/...`, que quebraria em qualquer outra conta, em qualquer
 * ambiente de teste e no dia em que a hospedagem mudar.
 *
 * -----------------------------------------------------------------------------
 * POR QUE `process.cwd()` É CONFIÁVEL AQUI (e não um chute)
 * -----------------------------------------------------------------------------
 * Porque foi VERIFICADO, não presumido. O `next-server.js` gerado pelo modo
 * standalone faz, na quarta linha do arquivo:
 *
 *     process.chdir(__dirname)
 *
 * E `__dirname` ali é a raiz da árvore do build (é o arquivo que o `server.js`
 * do hPanel dá `require`). Logo, para TODO processo do site em produção —
 * inclusive cada um dos até 6 filhos do LiteSpeed — `process.cwd()` é
 * `hbuilds/versions/<uuid>/nodejs/`. E ele continua sendo isso mesmo que o
 * LiteSpeed dispare o processo a partir de `$HOME`, porque o `chdir` é a
 * primeira coisa que roda.
 *
 * NÃO usamos `__dirname` deste módulo: em código empacotado pelo Next, ele
 * aponta para dentro de `.next/server/...`, e a distância até a raiz do app
 * depende de detalhes de bundling que mudam entre versões do framework. Seria
 * um caminho que funciona hoje e quebra num upgrade menor, sem ninguém ter
 * mexido nele.
 */

/**
 * Nome do arquivo, uma vez só. Ele é fixado por `services/curator/scripts/
 * build.mjs` (`outfile: path.join(opts.outDir, 'curator.cjs')`) — este módulo
 * apenas CONSOME o artefato, e não deve influenciar o build.
 */
const NOME_DO_BUNDLE = 'curator.cjs';

/**
 * Monta a lista de lugares onde o bundle PODE estar, em ordem de prioridade.
 *
 * É uma função PURA de propósito: recebe o diretório e o ambiente em vez de
 * lê-los do processo. É isso que permite ao teste conferir o caminho de
 * PRODUÇÃO rodando numa máquina Windows de desenvolvimento — que é exatamente
 * o cenário em que este código é escrito e em que ele nunca poderia ser
 * validado de outra forma.
 *
 * @param cwd Diretório de trabalho do processo do servidor.
 * @param env Ambiente do processo (só `CURATOR_BUNDLE_PATH` é consultado).
 */
export function curatorBundleCandidates(
  cwd: string,
  env: Record<string, string | undefined> = {},
): string[] {
  /**
   * ESCOTILHA DE EMERGÊNCIA — um caminho explícito vence tudo.
   *
   * Ela existe para o dia em que a hospedagem reorganizar a árvore e o site
   * estiver no ar com o botão quebrado: dá para consertar mexendo numa variável
   * de ambiente no hPanel, sem esperar um deploy. Quando está definida, ela é a
   * ÚNICA candidata — cair para os palpites depois de alguém ter dito
   * explicitamente onde o arquivo está esconderia o erro de digitação no
   * caminho, que é justamente o que se quer ver.
   */
  const explicito = env.CURATOR_BUNDLE_PATH?.trim();
  if (explicito) return [path.resolve(explicito)];

  return [
    // (1) PRODUÇÃO — árvore standalone da Hostinger. Ver o cabeçalho.
    path.join(cwd, 'curator', NOME_DO_BUNDLE),

    // (2) DEV com `npm run dev` — o npm roda o script do workspace com o `cwd`
    //     no diretório DELE, ou seja `<repo>/apps/web`. Daqui, o `dist/` do
    //     curator está dois níveis acima.
    path.join(cwd, '..', '..', 'services', 'curator', 'dist', NOME_DO_BUNDLE),

    // (3) DEV rodando a partir da RAIZ do monorepo (`npm run dev` na raiz,
    //     `next dev` chamado à mão, ou um runner que não troca de diretório).
    path.join(cwd, 'services', 'curator', 'dist', NOME_DO_BUNDLE),
  ];
}

/** O que a resolução descobriu — sucesso com caminho, ou falha com o porquê. */
export type CuratorBundleLookup =
  | { found: true; bundlePath: string; cwd: string }
  | { found: false; searched: string[]; message: string };

/**
 * Procura o bundle no disco e devolve o primeiro que existir.
 *
 * O `existsSync` é aceitável aqui (e não uma checagem assíncrona) por dois
 * motivos: acontece uma vez por clique num painel interno, e o custo de uma
 * chamada de `stat` é irrelevante perto dos ~15s do ciclo que vem depois.
 *
 * NÃO memorizamos o resultado em módulo. A tentação é óbvia ("o caminho não
 * muda"), e ela erra num caso real: em desenvolvimento, a pessoa clica, recebe
 * "rode `npm run curator:build`", roda o build e clica de novo. Com cache, ela
 * continuaria vendo o mesmo erro até reiniciar o servidor — e concluiria que a
 * instrução estava errada.
 */
export function resolveCuratorBundle(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): CuratorBundleLookup {
  const searched = curatorBundleCandidates(cwd, env);

  for (const candidato of searched) {
    // `statSync` em vez de `existsSync` para distinguir arquivo de diretório:
    // uma pasta chamada `curator.cjs` passaria no `existsSync` e o erro
    // apareceria só no `execFile`, como um EACCES obscuro.
    try {
      if (fs.statSync(candidato).isFile()) {
        return { found: true, bundlePath: candidato, cwd: path.dirname(candidato) };
      }
    } catch {
      // ENOENT é o caso NORMAL desta varredura (é assim que se descobre que o
      // candidato não serve), então ele não vira log nem exceção.
    }
  }

  return { found: false, searched, message: mensagemDeBundleAusente(searched) };
}

/**
 * A mensagem que o administrador vê quando o arquivo não está lá.
 *
 * Ela lista os caminhos TENTADOS, e isso não é verbosidade: sem a lista, um
 * "bundle não encontrado" em produção obriga quem for investigar a reler este
 * módulo para descobrir onde o código olhou. Com a lista, a resposta da própria
 * tela já diz se o problema é o build que não rodou (dev) ou a árvore de deploy
 * que mudou de forma (produção).
 */
function mensagemDeBundleAusente(searched: string[]): string {
  return (
    'O bundle do curator não foi encontrado neste servidor, então não há o que executar. ' +
    'Em desenvolvimento, gere-o com `npm run curator:build`. ' +
    'Em produção, ele deve viajar no deploy em `curator/curator.cjs`, ao lado do `server.js`. ' +
    `Caminhos procurados: ${searched.join(' | ')}`
  );
}
