/**
 * =============================================================================
 * Ortus Pixel — configuração do PM2 (caminho A: processos direto no VPS)
 * =============================================================================
 *
 * Este arquivo descreve os DOIS processos de longa duração do sistema:
 *
 *   ortuspixel-web      -> o site Next.js já compilado (`next start`)
 *   ortuspixel-curator  -> o serviço de curadoria em laço contínuo
 *
 * NOTA SOBRE NOMES: os pacotes internos ainda se chamam `@subcarioca/*` — o
 * rebrand do código-fonte é uma tarefa separada. Os nomes de PROCESSO aqui já
 * usam a marca final de propósito: eles aparecem no `pm2 list`, nos logs e nos
 * alertas de produção, e renomeá-los depois quebraria o `pm2 save`/`startup`
 * já registrado no systemd. Trocar o nome do pacote npm não afeta este arquivo.
 *
 * Uso no VPS (a partir da raiz do projeto):
 *
 *   npm ci --omit=dev=false        # o curator precisa de tsx (devDependency)
 *   npm run db:generate
 *   npm run build
 *   pm2 start ecosystem.config.js
 *   pm2 save                       # persiste a lista de processos
 *   pm2 startup                    # imprime o comando que registra o systemd
 *
 * O arquivo é CommonJS de propósito: o `package.json` da raiz não declara
 * `"type": "module"`, então `.js` aqui é CJS e `__dirname` existe. Usar caminho
 * absoluto derivado de `__dirname` evita a classe de erro mais comum com PM2:
 * "funciona quando eu rodo de dentro da pasta, quebra quando o systemd sobe".
 *
 * -----------------------------------------------------------------------------
 * DECISÃO 1 — POR QUE NÃO CHAMAMOS `npm run start`
 * -----------------------------------------------------------------------------
 * Seria mais curto (`script: 'npm', args: 'run start -w @subcarioca/web'`), mas
 * cria um processo intermediário: PM2 gerencia o `npm`, e o `npm` gerencia o
 * Node. Quando o PM2 manda SIGTERM num deploy, quem recebe é o `npm` — e ele
 * nem sempre repassa o sinal. O efeito prático é o pior possível: o Next é
 * morto no SIGKILL do timeout, com requisições em voo, e o curator é derrubado
 * no meio de um ciclo (deixando `PipelineRun` eternamente em `running`, que é
 * exatamente o que o `shutdown()` do `main.ts` existe para evitar).
 *
 * Executando o binário real direto, PM2 fala com o processo Node de verdade e
 * o encerramento gracioso funciona.
 *
 * -----------------------------------------------------------------------------
 * DECISÃO 2 — COMO AS VARIÁVEIS DE AMBIENTE CHEGAM AOS PROCESSOS
 * -----------------------------------------------------------------------------
 * O projeto NÃO usa dotenv em runtime (auditado: zero ocorrências no código).
 * O Next carrega `.env` da pasta do app (`apps/web/`), não da raiz do monorepo,
 * e o curator lê `process.env` cru. Ou seja: sem um passo explícito, os dois
 * subiriam com metade das variáveis indefinidas — e, pior, em silêncio, caindo
 * nos fallbacks (`?? 'http://localhost:3000'`).
 *
 * A solução usada aqui é o `--env-file` NATIVO do Node (>= 20.6, e o projeto já
 * exige >= 20.9): nenhuma dependência nova, e se o arquivo não existir o
 * processo falha ALTO no boot em vez de subir mal configurado.
 *
 * ATENÇÃO — variáveis `NEXT_PUBLIC_*` NÃO são lidas aqui.
 * Elas são embutidas no bundle do navegador durante o `next build`. Trocar
 * `NEXT_PUBLIC_SITE_URL` no `.env.production` e só reiniciar o PM2 não muda
 * nada no HTML entregue: é preciso REBUILDAR. O `scripts/deploy.sh` já faz o
 * build com o env carregado, por isso.
 */

const path = require('node:path');

/** Raiz do monorepo — este arquivo mora nela. */
const ROOT = __dirname;

/**
 * Arquivo de segredos de produção. Fica FORA do controle de versão
 * (o `.gitignore` já cobre `.env*` menos o `.example`).
 *
 * Permissão recomendada no VPS: `chmod 600 .env.production` e dono = usuário
 * que roda o PM2. Ele contém DATABASE_URL e as chaves de API.
 */
const ENV_FILE = path.join(ROOT, '.env.production');

/**
 * Binários resolvidos a partir da raiz.
 *
 * Com npm workspaces as dependências são içadas ("hoisted") para o
 * `node_modules` da raiz, então `next` e `tsx` vivem aqui, e não dentro de
 * `apps/web` ou `services/curator`.
 *
 * Apontamos para o arquivo de entrada real (`dist/bin/next`, `dist/cli.mjs`) e
 * não para `node_modules/.bin/next`: os `.bin` são shims de shell, e pedir ao
 * PM2 para interpretá-los como JavaScript é outra fonte clássica de falha.
 */
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const TSX_BIN = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Opções compartilhadas pelos dois processos. */
const shared = {
  // Reinicia se o processo morrer por qualquer motivo.
  autorestart: true,

  // Recuo exponencial entre reinícios. Sem isso, um processo que falha no boot
  // (ex.: banco fora do ar) entra em laço de reinício a 10x por segundo, enche
  // o disco de log e mascara a causa real no meio do ruído.
  exp_backoff_restart_delay: 200,

  // Prefixa cada linha de log com timestamp. Num incidente às 3h da manhã,
  // log sem hora é quase inútil.
  time: true,

  // Junta stdout dos workers no mesmo arquivo (relevante se um dia houver
  // mais de uma instância).
  merge_logs: true,

  // NÃO reiniciar quando arquivos mudarem. Em produção o disco muda durante o
  // `git pull` do deploy; com `watch: true` o PM2 reiniciaria no meio do
  // `npm ci`, com a árvore de arquivos pela metade.
  watch: false,

  // Tempo que o PM2 espera após o SIGTERM antes de mandar SIGKILL.
  // O curator precisa disso para fechar o ciclo corrente; o Next, para
  // terminar as requisições em voo.
  kill_timeout: 10000,

  // Considera o processo "online" só depois de N ms de pé. Abaixo disso, o PM2
  // conta como falha de boot e aciona o recuo exponencial — é o que impede um
  // crash-loop de ser reportado como "online".
  min_uptime: 20000,
  max_restarts: 10,
};

module.exports = {
  apps: [
    {
      // -----------------------------------------------------------------
      // SITE (Next.js)
      // -----------------------------------------------------------------
      name: 'ortuspixel-web',
      script: NEXT_BIN,
      args: 'start',

      // O `next start` precisa rodar de dentro do app para achar `.next/`.
      cwd: path.join(ROOT, 'apps', 'web'),

      interpreter: 'node',
      interpreter_args: `--env-file=${ENV_FILE}`,

      /**
       * UMA INSTÂNCIA, MODO `fork` — decisão deliberada, não preguiça.
       *
       * O modo `cluster` do PM2 é tentador num VPS com vários núcleos, mas
       * neste projeto ele quebraria duas coisas que o README já documenta:
       *
       *   1. O rate limiting é EM MEMÓRIA (README > Segurança, pendência 2).
       *      Com N processos, o limite real vira N x o configurado — o
       *      "5 tentativas de login por 15 min" viraria 20 num VPS de 4 vCPU.
       *
       *   2. O cache de ISR do Next é por processo + disco. Duas instâncias
       *      revalidam a mesma página em duplicidade e podem servir versões
       *      diferentes da home para leitores diferentes no mesmo segundo.
       *
       * O caminho correto para escalar está documentado e é outro: Redis para
       * rate limit distribuído + `cacheHandler` compartilhado. Só DEPOIS disso
       * `instances: 'max'` passa a ser seguro.
       */
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        // Porta interna. O Nginx é quem fala com a internet (ver nginx/ortuspixel.conf).
        PORT: 3000,
        // Escuta só no loopback: mesmo que o firewall do VPS falhe, ninguém
        // alcança a porta 3000 direto de fora, pulando o Nginx (e pulando o
        // HTTPS junto).
        HOSTNAME: '127.0.0.1',
      },

      // O Next em produção é estável em memória, mas um vazamento numa
      // dependência não deve derrubar o site por dias. 700 MB é folgado para
      // um portal deste porte e ainda cabe num VPS de 2 GB.
      max_memory_restart: '700M',

      out_file: path.join(ROOT, 'logs', 'web-out.log'),
      error_file: path.join(ROOT, 'logs', 'web-error.log'),
    },

    {
      // -----------------------------------------------------------------
      // CURADORIA (pipeline)
      // -----------------------------------------------------------------
      name: 'ortuspixel-curator',

      /**
       * MODO CONTÍNUO — verificado no código, não presumido.
       *
       * `services/curator/src/main.ts` tem dois modos: com `--once` roda um
       * ciclo e sai; SEM `--once` entra em laço permanente com agendador
       * próprio (descoberta a cada 15 min, recálculo a cada 5 min) usando
       * `setTimeout` ENCADEADO — o próximo ciclo só começa quando o anterior
       * termina. Ele também trata SIGINT/SIGTERM para encerrar graciosamente.
       *
       * Portanto: `cron_restart` NÃO é usado aqui, e usá-lo seria um erro.
       * Matar e reerguer o processo a cada intervalo jogaria fora o estado do
       * circuit breaker (que abre após 3 falhas e testa de novo em 5 min) e o
       * controle de orçamento das APIs pagas, ambos em memória. Um processo
       * reiniciado a cada 15 min reabriria o circuito toda vez e voltaria a
       * gastar 8s por tópico numa API sabidamente fora do ar.
       *
       * Se um dia o modo cron for necessário mesmo assim (ex.: para caber num
       * VPS pequeno demais para manter o processo vivo), a configuração seria:
       *
       *   args: 'services/curator/src/main.ts --once',
       *   cron_restart: '*(barra)15 * * * *',   // a cada 15 min
       *   autorestart: false,
       *
       * 15 minutos é o intervalo que faz sentido, e não algo menor: é o mesmo
       * ritmo do ciclo de descoberta interno, e a home tem `revalidate` de 60s
       * COM invalidação por evento (README > Cache em duas velocidades). Ou
       * seja, o frescor da home não depende da frequência do curator — quando
       * um score muda de faixa, o próprio curator chama `/api/revalidate` e a
       * home é regenerada na hora. Rodar de 1 em 1 minuto só multiplicaria
       * custo de API sem tornar o site mais fresco.
       */
      script: TSX_BIN,
      args: 'services/curator/src/main.ts',
      cwd: ROOT,

      interpreter: 'node',
      interpreter_args: `--env-file=${ENV_FILE}`,

      /**
       * EXATAMENTE UMA INSTÂNCIA — aqui não é preferência, é correção.
       *
       * O agendador vive no processo e não tem trava distribuída (está escrito
       * no comentário do `main.ts`). Duas instâncias fariam dois ciclos de
       * descoberta simultâneos: orçamento de API consumido em dobro, disputa
       * pelas mesmas linhas do banco e deduplicação furada, porque dois ciclos
       * criariam o mesmo tópico antes de qualquer um dos dois enxergar o outro.
       *
       * Multi-instância só depois do BullMQ + Redis (Fase 2 do roadmap).
       */
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
      },

      // O curator faz fetch de muitos feeds e mantém cache de sinais em
      // memória; 500 MB é teto confortável e ainda protege o VPS.
      max_memory_restart: '500M',

      out_file: path.join(ROOT, 'logs', 'curator-out.log'),
      error_file: path.join(ROOT, 'logs', 'curator-error.log'),
    },
  ].map((app) => ({ ...shared, ...app })),
};
