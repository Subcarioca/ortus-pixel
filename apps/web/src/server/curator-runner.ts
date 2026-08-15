import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prisma } from '@subcarioca/db';

import { resolveCuratorBundle } from './curator-bundle';

/**
 * =============================================================================
 * DISPARO MANUAL DO CURATOR — o servidor do site executa o bundle já publicado
 * =============================================================================
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * -----------------------------------------------------------------------------
 * O ciclo de curadoria era agendado pelo cron do hPanel. Depois de um dia de
 * depuração ficou estabelecido que o cron desta conta NÃO dispara de forma
 * confiável (chamado aberto com o suporte; a suspeita é limite de execução do
 * plano). Sem ciclo, a fila de pautas simplesmente para de receber assunto novo
 * — e o painel não tem como saber a diferença entre "não há notícia" e "o
 * agendador está morto".
 *
 * A SACADA: o processo do Next JÁ RODA CONTINUAMENTE em produção. Ele é o
 * próprio site, e é a única coisa naquele ambiente que comprovadamente fica de
 * pé. Então quem dispara o ciclo passa a ser ele, sob demanda, quando alguém da
 * curadoria clicar no botão — em vez de um agendador do sistema operacional que
 * não responde.
 *
 * -----------------------------------------------------------------------------
 * POR QUE PROCESSO FILHO, E NÃO IMPORTAR O PIPELINE DENTRO DO NEXT
 * -----------------------------------------------------------------------------
 * A alternativa óbvia seria `import { runCurationCycle } from '@subcarioca/...'`
 * e chamar a função na rota. Foi considerada e descartada, por três razões em
 * ordem crescente de gravidade:
 *
 *   1. O curator NÃO é um workspace do apps/web. Ele viveria como mais uma
 *      dependência a empacotar no `next build`, arrastando os conectores e o
 *      `@subcarioca/scoring` para dentro do bundle do site.
 *
 *   2. O ARTEFATO TESTADO SERIA OUTRO. O que está validado em produção é o
 *      `curator.cjs` gerado pelo `build.mjs`, com o prelúdio de runtime dele e
 *      o Prisma Client dele. Executar esse MESMO arquivo é o que garante que o
 *      clique no botão faz exatamente o que o cron fazia — nem mais, nem menos.
 *
 *   3. ISOLAMENTO DE FALHA, que é o argumento decisivo. Um ciclo roda por ~15s,
 *      fala com APIs externas e faz muita escrita. Rodando DENTRO do processo do
 *      site, um vazamento de memória, um `process.exit(1)` do prelúdio ou um
 *      erro não capturado num `setTimeout` de conector derrubaria o SITE. Num
 *      filho, o pior caso é a requisição falhar: o site nem percebe.
 *
 * -----------------------------------------------------------------------------
 * ⚠ DUAS ARMADILHAS DESTE AMBIENTE QUE CUSTAM CARO E NÃO SÃO ÓBVIAS
 * -----------------------------------------------------------------------------
 * As duas foram encontradas LENDO o código de produção, não em teste — e as
 * duas falhariam de um jeito que manda quem investiga para o lugar errado. Elas
 * estão documentadas em detalhe nos pontos onde são tratadas, abaixo:
 *
 *   (A) `PRISMA_QUERY_ENGINE_LIBRARY` herdada apontaria o curator para o engine
 *       do SITE. Ver `ambienteParaOFilho`.
 *   (B) `maxBuffer` padrão de 1 MB MATA o filho no meio do ciclo. Ver
 *       `MAX_BUFFER_BYTES`.
 */

const execFileAsync = promisify(execFile);

/**
 * TETO DE TEMPO — 75 segundos.
 *
 * O ciclo real mede ~15s. O teto é generoso de propósito: um conector externo
 * lento não pode virar "o botão está quebrado". Mas ele PRECISA existir, e não
 * pode ser alto: sem `timeout`, uma requisição HTTP do painel ficaria pendurada
 * indefinidamente e o administrador não teria como distinguir "está rodando" de
 * "travou para sempre".
 *
 * ⚠ ELE PROVAVELMENTE NÃO É O PRIMEIRO LIMITE DO CAMINHO. Em produção há um
 * LiteSpeed na frente, e o tempo limite de proxy dele (tipicamente 60s) está
 * FORA do nosso controle. Quando o de fora for menor, ele vence — e o sintoma é
 * enganoso: o navegador recebe um erro de gateway enquanto o processo filho
 * continua rodando e termina o ciclo com sucesso. É por isso que o botão do
 * painel, diante de falha de rede, manda RECARREGAR e conferir o KPI "Último
 * ciclo" em vez de afirmar que a busca falhou (ver `curator-run-button.tsx`).
 *
 * Ajustável por ambiente para que essa calibração possa ser feita no servidor,
 * sem deploy.
 */
function tempoLimiteMs(): number {
  const bruto = Number(process.env.CURATOR_RUN_TIMEOUT_MS);
  // Faixa fechada: um valor absurdo (0, negativo, "abc", ou uma hora) é erro de
  // digitação, e obedecê-lo em silêncio é pior do que ignorá-lo.
  if (Number.isFinite(bruto) && bruto >= 10_000 && bruto <= 300_000) return bruto;
  return 75_000;
}

/**
 * ⚠ ARMADILHA (B) — 8 MiB de buffer, e isto NÃO é excesso de zelo.
 *
 * O padrão do `execFile` é 1 MiB, e o comportamento ao estourar não é truncar a
 * saída: o Node MATA O PROCESSO FILHO. Um ciclo de descoberta imprime uma linha
 * por feed, por conector e por tópico pontuado — 1 MiB é perfeitamente
 * alcançável num ciclo grande ou num conector que entre em laço de aviso.
 *
 * O modo de falha seria dos piores de diagnosticar: o ciclo morre PELA METADE,
 * a linha de `PipelineRun` fica eternamente com `status: 'running'` (o curator
 * só a fecha no fim), e a trava de concorrência daqui passa a recusar todo
 * clique por 3 minutos com "já tem uma busca em andamento" — uma mensagem que
 * aponta para o lugar errado. Tudo isso por causa de um limite de log.
 *
 * 8 MiB é folgado o bastante para nunca ser atingido na prática e continua
 * sendo um teto (a memória não cresce sem limite).
 */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * JANELA DA TRAVA DE CONCORRÊNCIA — 3 minutos.
 *
 * Generosa de propósito, bem acima dos ~15s do ciclo e acima até do teto de
 * tempo acima. A assimetria dos dois erros manda nessa escolha: uma janela curta
 * demais deixa passar duas execuções simultâneas (que é o que a trava existe
 * para impedir); uma janela longa demais faz alguém esperar alguns minutos a
 * mais depois de uma execução interrompida. O segundo erro é chato; o primeiro
 * gasta orçamento de API em dobro e coloca dois processos disputando as mesmas
 * linhas de `Topic` — que, sob o REPEATABLE READ do InnoDB, é justamente o
 * cenário de deadlock apontado no plano de migração para o MySQL.
 */
const JANELA_DA_TRAVA_MS = 3 * 60 * 1000;

/**
 * FOLGA DE RELÓGIO ao procurar o `PipelineRun` que este disparo criou — 5s.
 *
 * `PipelineRun.startedAt` usa `@default(now())`, cujo valor é gerado pelo
 * processo que grava (o FILHO), não por este. Em produção os dois estão na mesma
 * máquina e o relógio é o mesmo, então a folga é quase teórica — mas sem ela um
 * atraso de milissegundos faria a rota concluir "o ciclo não gravou nada" logo
 * depois de um ciclo perfeitamente bem-sucedido.
 */
const FOLGA_DE_RELOGIO_MS = 5_000;

// =============================================================================
// TRAVA CONTRA EXECUÇÃO CONCORRENTE
// =============================================================================

/**
 * Já existe um ciclo em andamento?
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTA TRAVA PRECISA EXISTIR AQUI, E NÃO NO CURATOR
 * -----------------------------------------------------------------------------
 * O próprio `services/curator/src/main.ts` documenta que a proteção contra
 * ciclos sobrepostos existe SÓ no modo contínuo, e como: `setTimeout`
 * encadeado, que nunca agenda o próximo antes de o atual terminar. O modo
 * `--once` não tem proteção nenhuma — e nunca precisou ter, porque o único
 * chamador era um cron de 15 em 15 minutos.
 *
 * O botão muda esse pressuposto de forma concreta: agora os chamadores são
 * humanos impacientes (dois cliques, duas pessoas, duas abas) e, quando o
 * suporte resolver o problema do agendamento, um cron que volta a disparar
 * podendo coincidir com um clique.
 *
 * -----------------------------------------------------------------------------
 * A TRAVA É CONSULTIVA, E ISSO ESTÁ ASSUMIDO
 * -----------------------------------------------------------------------------
 * Entre o SELECT daqui e o INSERT que o filho faz existe uma janela — é um
 * clássico "verifica e age". Dois cliques no mesmo milissegundo passariam os
 * dois. Não fingimos o contrário, e a escolha é deliberada por três razões:
 *
 *   1. A JANELA É GRANDE, mas o alvo é minúsculo: entre esta consulta e o
 *      INSERT do filho passam o `spawn` do Node e a partida do Prisma Client —
 *      centenas de milissegundos em que os dois cliques teriam de cair.
 *   2. A CONSEQUÊNCIA É BRANDA. O cabeçalho de `runCurationCycle` estabelece que
 *      o ciclo é idempotente: "rodar duas vezes seguidas não duplica tópicos nem
 *      redispara alertas já enviados". O custo de perder essa corrida é
 *      orçamento de API, não dado corrompido.
 *   3. O CUSTO DE FECHÁ-LA DE VERDADE É ALTO. Exigiria uma tabela de bloqueio
 *      própria com índice único (ou `GET_LOCK` do MySQL, que é específico do
 *      motor). É o caminho de evolução natural se um dia a fila tiver mais gente
 *      clicando — e está registrado aqui para não precisar ser redescoberto.
 *
 * ⚠ NOTA DE ÍNDICE: `PipelineRun` tem `@@index([stage, startedAt(sort: Desc)])`
 * e nada em `status`. Esta consulta, portanto, não é servida por índice.
 * É aceitável hoje: a tabela cresce ~96 linhas/dia e a consulta roda uma vez por
 * clique num painel interno. Deliberadamente NÃO filtramos por `stage` (o que
 * usaria o índice): hoje só existe `'full'`, mas amarrar a trava a esse valor
 * faria um estágio futuro passar despercebido — e uma trava que silenciosamente
 * deixa de travar é pior do que uma consulta sem índice.
 */
export async function cicloEmAndamento(): Promise<{ startedAt: Date } | null> {
  const limite = new Date(Date.now() - JANELA_DA_TRAVA_MS);

  return prisma.pipelineRun.findFirst({
    where: { status: 'running', startedAt: { gte: limite } },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
}

// =============================================================================
// AMBIENTE DO PROCESSO FILHO
// =============================================================================

/**
 * ⚠ ARMADILHA (A) — o ambiente do filho é o nosso, MENOS uma variável.
 *
 * HERDAR É O QUE QUEREMOS, na maior parte. O processo do Next já tem
 * `DATABASE_URL` (é como ele mesmo funciona), mais as chaves de API dos
 * conectores e o `CURATOR_PHASE`. Por isso NÃO passamos `--env-file`: não há
 * arquivo de ambiente a apontar, e exigir um recriaria o acoplamento a um
 * caminho absoluto que este trabalho existe para eliminar.
 *
 * Herdar por engano UMA variável, porém, seria caro:
 *
 *   `PRISMA_QUERY_ENGINE_LIBRARY`. Em produção, o `server.js` do deploy a define
 *   apontando para o engine do SITE (`vendor/dot-prisma-client/libquery_engine-
 *   debian-openssl-1.1.x.so.node`). E o prelúdio do bundle do curator
 *   (`scripts/runtime-prelude.cjs`, item 3) RESPEITA um valor já definido — de
 *   propósito, para não atropelar quem esteja depurando.
 *
 *   O resultado da herança seria o curator carregando o engine do site em vez do
 *   engine que viajou dentro do artefato dele. Hoje os dois são o mesmo alvo e
 *   funcionaria por coincidência; no dia em que o Prisma de um dos dois for
 *   atualizado sem o outro, o curator carrega um engine cujo protocolo não bate
 *   com o client gerado dele. O erro apareceria como falha de query, longe da
 *   causa, e ninguém procuraria por uma variável de ambiente herdada.
 *
 * Removendo-a, o prelúdio faz o que foi projetado para fazer: acha o engine ao
 * lado do próprio bundle. E — o que mais importa — o bundle passa a rodar sob
 * EXATAMENTE as mesmas condições do cron que foi testado. O objetivo aqui é que
 * o botão seja um chamador novo, não um comportamento novo.
 */
function ambienteParaOFilho(): NodeJS.ProcessEnv {
  const { PRISMA_QUERY_ENGINE_LIBRARY: _descartada, ...restante } = process.env;
  return restante;
}

// =============================================================================
// RESULTADO
// =============================================================================

/** O que o ciclo produziu, lido do banco — nunca do stdout do processo. */
export interface ResumoDoCiclo {
  status: string;
  topicsDiscovered: number;
  topicsScored: number;
  topicsPromoted: number;
  connectorsRun: number;
  connectorsFailed: number;
  durationMs: number | null;
  error: string | null;
}

export type CuratorRunResult =
  | { ok: true; resumo: ResumoDoCiclo | null; message: string }
  | { ok: false; status: number; message: string };

/**
 * Executa um ciclo único e devolve o que ele produziu.
 *
 * A função é `async` e SÓ retorna quando o filho termina. É uma escolha, e a
 * alternativa (responder 202 na hora e deixar o filho rodando em segundo plano)
 * foi descartada: sem um lugar para o painel consultar o andamento, o "202
 * aceito" viraria um botão que nunca diz se deu certo. Esperando, a resposta
 * carrega o resultado real, e o custo é uma requisição HTTP de alguns segundos
 * numa tela interna — onde isso é aceitável.
 */
export async function runCuratorOnce(): Promise<CuratorRunResult> {
  // -------------------------------------------------------------------------
  // 1. O ARTEFATO EXISTE?
  // -------------------------------------------------------------------------
  const lookup = resolveCuratorBundle();
  if (!lookup.found) {
    // 503 e não 500: o servidor está saudável, falta um artefato de deploy. A
    // distinção importa para quem lê log de produção e para quem monitora.
    return { ok: false, status: 503, message: lookup.message };
  }

  // Marco temporal ANTES do spawn: é o que separa "o ciclo que eu disparei" de
  // um `PipelineRun` que já estava no banco de antes.
  const inicio = new Date(Date.now() - FOLGA_DE_RELOGIO_MS);
  const comecou = Date.now();

  try {
    /**
     * `process.execPath` é o MESMO binário Node que executa este servidor.
     *
     * É a peça que dispensa procurar interpretador. A hospedagem instala o Node
     * em caminhos versionados (`/opt/alt/alt-nodejs20/root/usr/bin/node` e
     * variantes), que mudam quando se troca a versão no painel — e um caminho
     * desses escrito no código é uma bomba-relógio silenciosa. Usando o
     * `execPath`, o filho roda sob a MESMA versão de Node já validada pelo site,
     * seja ela qual for, hoje e depois de qualquer troca no hPanel.
     *
     * `execFile` (e não `exec`) porque não há shell no caminho: os argumentos
     * vão como array direto para o `execve`. Não existe entrada de usuário
     * nenhuma aqui — nem no caminho, nem nos argumentos —, então injeção de
     * comando não é o risco; usar `execFile` é o que MANTÉM assim, mesmo que
     * alguém, um dia, resolva tornar a fase do pipeline configurável pela tela.
     */
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [lookup.bundlePath, '--once'],
      {
        // `cwd` na pasta do bundle: é o que o cron fazia, e é o que mantém o
        // comportamento idêntico. O prelúdio do bundle não depende disso (ele
        // resolve tudo a partir do `__dirname` dele, justamente porque o cron
        // chamava de `$HOME`), mas rodar num diretório diferente do testado é
        // uma variável a mais sem nenhum ganho.
        cwd: lookup.cwd,
        env: ambienteParaOFilho(),
        timeout: tempoLimiteMs(),
        maxBuffer: MAX_BUFFER_BYTES,
        // O curator escreve em português com acento. Sem isto o retorno seria
        // Buffer e o log do servidor sairia ilegível.
        encoding: 'utf8',
      },
    );

    /**
     * O stdout vai para o LOG DO SERVIDOR, e não para a tela.
     *
     * São dezenas de linhas técnicas (conectores, scores, avisos de circuito)
     * que não ajudam quem está curando a fila e que, jogadas na resposta HTTP,
     * virariam um paredão de texto no painel. Quem precisa delas é quem depura,
     * e essa pessoa tem acesso ao log — que é onde elas ficam.
     */
    registrarSaida(stdout, stderr, Date.now() - comecou);

    const resumo = await lerUltimoCiclo(inicio);
    return { ok: true, resumo, message: mensagemDeSucesso(resumo) };
  } catch (erro) {
    return traduzirFalha(erro, Date.now() - comecou);
  }
}

/**
 * Lê do banco o `PipelineRun` que este disparo criou.
 *
 * A fonte da verdade é o BANCO, e não a saída do processo. Não é preciosismo:
 * é a mesma linha que alimenta o KPI "Último ciclo" do painel. Se o resumo
 * devolvido ao clique viesse de um `parse` do stdout, os dois números poderiam
 * divergir na mesma tela — e aí o painel deixa de ser confiável, que é
 * exatamente o que o cabeçalho de `admin/page.tsx` estabelece que não pode
 * acontecer.
 */
async function lerUltimoCiclo(desde: Date): Promise<ResumoDoCiclo | null> {
  const run = await prisma.pipelineRun.findFirst({
    where: { startedAt: { gte: desde } },
    orderBy: { startedAt: 'desc' },
    select: {
      status: true,
      topicsDiscovered: true,
      topicsScored: true,
      topicsPromoted: true,
      connectorsRun: true,
      connectorsFailed: true,
      durationMs: true,
      error: true,
    },
  });

  return run;
}

/**
 * Traduz o resumo em uma frase para quem está curando a fila.
 *
 * O vocabulário é o da REDAÇÃO ("pautas novas"), não o do pipeline ("topics
 * discovered"): quem clica no botão quer saber se apareceu assunto para
 * escrever, não como o pipeline se chama por dentro.
 */
function mensagemDeSucesso(resumo: ResumoDoCiclo | null): string {
  if (!resumo) {
    // Caminho raro mas real: o processo terminou com código 0 e nenhuma linha
    // nova apareceu. Dizer "0 pautas" seria mentira confortável; dizer o que se
    // sabe permite a quem lê decidir se investiga.
    return (
      'O ciclo terminou, mas nenhum registro de execução foi gravado no banco. ' +
      'Confira o log do servidor antes de confiar no resultado.'
    );
  }

  if (resumo.status === 'failed') {
    return (
      'O ciclo rodou e falhou no meio. Nada foi corrompido — a fila continua ' +
      `como estava. Motivo registrado: ${resumo.error ?? 'não informado'}.`
    );
  }

  if (resumo.status === 'running') {
    // O processo saiu, mas a linha não foi fechada. Sintoma clássico de morte
    // abrupta do filho (ver a nota de `maxBuffer` no topo).
    return (
      'O processo encerrou sem fechar o registro do ciclo. Provavelmente foi ' +
      'interrompido no meio — confira o log do servidor.'
    );
  }

  const partes = [
    `${resumo.topicsDiscovered} pauta(s) descoberta(s)`,
    `${resumo.topicsScored} pontuada(s)`,
  ];
  if (resumo.topicsPromoted > 0) partes.push(`${resumo.topicsPromoted} QUENTE(S)`);
  if (resumo.connectorsFailed > 0) {
    // A falha de conector aparece SEMPRE que houver, mesmo num ciclo bem
    // sucedido: é degradação silenciosa (o ciclo "deu certo" com menos fontes),
    // e o único jeito de alguém notar é a tela contar.
    partes.push(`${resumo.connectorsFailed} conector(es) com falha`);
  }

  const segundos = resumo.durationMs ? ` em ${(resumo.durationMs / 1000).toFixed(0)}s` : '';
  return `Busca concluída${segundos}: ${partes.join(', ')}.`;
}

/** Log do servidor. Truncado: o objetivo é depurar, não arquivar. */
function registrarSaida(stdout: string, stderr: string, decorridoMs: number): void {
  console.log(
    `[curator-run] ciclo manual concluído em ${(decorridoMs / 1000).toFixed(1)}s\n` +
      `${stdout.slice(-8_000)}`,
  );
  // O stderr sai separado e só quando existe: o curator escreve avisos legítimos
  // ali (conector suspenso, por exemplo), então stderr não-vazio NÃO significa
  // falha — e misturá-lo ao stdout faria parecer que significa.
  if (stderr.trim()) console.warn(`[curator-run] stderr:\n${stderr.slice(-4_000)}`);
}

/**
 * Converte a exceção do `execFile` numa resposta que o administrador entende.
 *
 * Cada ramo existe porque a AÇÃO da pessoa muda: esperar, avisar o responsável
 * técnico ou rodar um build. Um "falha ao executar o curator" genérico não
 * distingue nada disso.
 */
function traduzirFalha(erro: unknown, decorridoMs: number): CuratorRunResult {
  const e = erro as {
    killed?: boolean;
    signal?: string;
    code?: number | string;
    stdout?: string;
    stderr?: string;
    message?: string;
  };

  // O log do servidor recebe TUDO — inclusive o que não vai para a tela.
  console.error(
    `[curator-run] falhou após ${(decorridoMs / 1000).toFixed(1)}s ` +
      `(code=${String(e.code)} signal=${String(e.signal)} killed=${String(e.killed)})`,
  );
  if (e.stdout) console.error(`[curator-run] stdout:\n${e.stdout.slice(-8_000)}`);
  if (e.stderr) console.error(`[curator-run] stderr:\n${e.stderr.slice(-4_000)}`);

  // --- Estouro do teto de tempo -------------------------------------------
  // O Node mata com SIGTERM e marca `killed`. O filho já morreu quando chegamos
  // aqui: não há processo órfão consumindo API no servidor.
  if (e.killed || e.signal === 'SIGTERM') {
    return {
      ok: false,
      status: 504,
      message:
        `A busca passou de ${Math.round(tempoLimiteMs() / 1000)}s e foi interrompida — ` +
        'quase sempre é uma fonte externa lenta. A fila não foi corrompida. ' +
        'Espere alguns minutos e tente de novo; se repetir, avise o responsável técnico.',
    };
  }

  // --- O binário não pôde nem ser executado --------------------------------
  // `code` como STRING é erro do próprio spawn (ENOENT, EACCES), não código de
  // saída do programa. É problema de instalação, não de execução.
  if (typeof e.code === 'string') {
    return {
      ok: false,
      status: 500,
      message:
        `Não foi possível iniciar o processo do curator (${e.code}). ` +
        'É um problema de instalação no servidor, não da fila. Avise o responsável técnico.',
    };
  }

  // --- Rodou e saiu com código != 0 ----------------------------------------
  // Inclui as abortadas do prelúdio de runtime (Prisma Client ausente,
  // DATABASE_URL ausente), que já escrevem uma explicação em português no
  // stderr — ver `diagnosticoDoStderr` para como ela é extraída.
  return {
    ok: false,
    status: 500,
    message:
      'O curator iniciou e encerrou com erro. A fila não foi alterada. ' +
      `Detalhe: ${diagnosticoDoStderr(e.stderr) ?? e.message ?? 'sem detalhe'}`,
  };
}

/**
 * Extrai do stderr a UMA linha que serve como diagnóstico na tela.
 *
 * -----------------------------------------------------------------------------
 * POR QUE NÃO É SIMPLESMENTE "A ÚLTIMA LINHA"
 * -----------------------------------------------------------------------------
 * Porque foi tentado assim e o teste de fumaça mostrou que dá errado — e dá
 * errado do jeito pior, produzindo uma frase plausível e inútil.
 *
 * O `abortar()` do prelúdio (`services/curator/scripts/runtime-prelude.cjs`)
 * escreve `\n[curator] <título>\n<detalhe>\n`, onde o DETALHE tem várias linhas
 * de instrução. Rodando o bundle sem `DATABASE_URL`, a última linha não vazia é:
 *
 *     "ela fica visível para outros usuários no `ps aux`."
 *
 * ...um fragmento solto de conselho de segurança. O administrador leria isso no
 * painel e não teria a menor ideia do que fazer. O diagnóstico de verdade é o
 * TÍTULO, na primeira linha: "DATABASE_URL não definida."
 *
 * Por isso a preferência é pela linha marcada com `[curator]`, que é o formato
 * garantido pelo prelúdio. A última linha continua como reserva, para os erros
 * que NÃO vêm do prelúdio (uma exceção do Node, por exemplo), onde ela costuma
 * ser de fato a informação mais recente.
 */
function diagnosticoDoStderr(stderr: string | undefined): string | null {
  if (!stderr) return null;

  const linhas = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // O prefixo `[curator]` marca o título do aborto — o diagnóstico em si.
  const doPreludio = linhas.find((l) => l.startsWith('[curator]'));

  // `.at(-1)` em vez de `linhas[linhas.length - 1]`: o projeto compila com
  // `noUncheckedIndexedAccess`, e o acesso por índice é (corretamente) tipado
  // como possivelmente indefinido. O `.at()` deixa isso explícito em vez de
  // exigir uma asserção de tipo que só serviria para calar o compilador.
  //
  // Limite de tamanho: a mensagem vai para a tela, e uma pilha de erro inteira
  // ali não ajuda ninguém — ela está no log, completa.
  return (doPreludio ?? linhas.at(-1))?.slice(0, 300) ?? null;
}
