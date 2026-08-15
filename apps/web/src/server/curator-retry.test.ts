/**
 * =============================================================================
 * TESTES — quando o servidor repete um ciclo do curator que morreu
 * =============================================================================
 *
 * POR QUE ESTA REGRA MERECE TESTE
 * -----------------------------------------------------------------------------
 * Porque ela decide se o servidor EXECUTA UM PROCESSO DE NOVO, e porque a única
 * evidência de que ela funciona é uma falha que não se consegue reproduzir sob
 * demanda: o panic do engine do Prisma só aparece quando o servidor
 * compartilhado está sem folga no limite de processos. Não dá para provocá-lo
 * numa máquina de desenvolvimento — mas dá para congelar aqui, para sempre, o
 * texto exato que ele produziu em produção e afirmar que o código o reconhece.
 *
 * O QUE ESTES TESTES TRAVAM, em uma frase cada:
 *   1. O stderr REAL de produção é reconhecido como panic (a regressão mais
 *      cara: um ajuste na lista de assinaturas que passa a não casar mais, e
 *      o botão volta a falhar sozinho sem ninguém perceber).
 *   2. Falhas COMUNS do curator NÃO são confundidas com panic — repetir uma
 *      falha determinística é gastar o triplo do tempo pelo mesmo erro.
 *   3. A repetição tem fim: ela para na terceira tentativa.
 *   4. A repetição respeita o orçamento de tempo do disparo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TENTATIVAS_MAXIMAS,
  decidirRepeticao,
  ehPanicoDoEngineDoPrisma,
  esperaAntesDaTentativa,
} from './curator-retry';

/**
 * O stderr REAL da falha de produção, capturado numa sessão SSH no servidor
 * junto com o suporte da hospedagem. Copiado literalmente, com os caminhos da
 * conta preservados: é justamente o formato bruto que precisa continuar sendo
 * reconhecido, e "limpar" o texto aqui enfraqueceria o teste.
 */
const STDERR_DE_PRODUCAO = `
thread 'tokio-runtime-worker' panicked at /root/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/futures-timer-3.0.2/src/native/delay.rs:112:21:
timer has gone away
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace
prisma:error
Invalid \`prisma.pipelineRun.create()\` invocation in
/home/u754239208/domains/ortuspixel.com/hbuilds/versions/01a003dd/nodejs/curator/curator.cjs:2862:40

  2861   const { phase, dryRun = false, maxAgeHours = 6 } = options;
→ 2862   const run = await prisma.pipelineRun.create(
PANIC: timer has gone away

This is a non-recoverable error which probably happens when the Prisma Query Engine has a panic.
`;

// =============================================================================
// 1. RECONHECER O PANIC
// =============================================================================

test('o stderr real da falha de produção é reconhecido como panic do engine', () => {
  assert.equal(ehPanicoDoEngineDoPrisma(STDERR_DE_PRODUCAO), true);
});

test('cada camada do panic sozinha já basta — nenhuma depende das outras', () => {
  // O panic se anuncia em camadas (thread do Rust, mensagem do timer, tradução
  // do Prisma Client) e nem toda falha carrega as três até o stderr. Se algum
  // dia o reconhecimento passar a exigir a combinação delas, estes casos falham.
  assert.equal(ehPanicoDoEngineDoPrisma('PANIC: timer has gone away'), true);
  assert.equal(ehPanicoDoEngineDoPrisma("thread 'tokio-runtime-worker' panicked at foo.rs"), true);
  assert.equal(
    ehPanicoDoEngineDoPrisma("thread '<unnamed>' panicked: OS can't spawn worker thread"),
    true,
  );
  assert.equal(ehPanicoDoEngineDoPrisma('PrismaClientRustPanicError: ...'), true);
});

test('a detecção não depende da caixa das letras', () => {
  assert.equal(ehPanicoDoEngineDoPrisma('panic: TIMER HAS GONE AWAY'), true);
});

test('stderr vazio, indefinido ou nulo não é panic', () => {
  // Caminho real: o `execFile` entrega `stderr` vazio quando o filho morre por
  // sinal. Tratar ausência de informação como panic faria o servidor repetir
  // execuções às cegas.
  assert.equal(ehPanicoDoEngineDoPrisma(''), false);
  assert.equal(ehPanicoDoEngineDoPrisma(undefined), false);
  assert.equal(ehPanicoDoEngineDoPrisma(null), false);
});

// =============================================================================
// 2. NÃO CONFUNDIR O RESTO
// =============================================================================

test('as falhas determinísticas do curator NÃO são tratadas como panic', () => {
  // Todas estas vêm do prelúdio de runtime ou do próprio ciclo. São problemas de
  // configuração ou de dados: a segunda tentativa daria exatamente o mesmo erro,
  // e o administrador esperaria três vezes mais para lê-lo.
  assert.equal(ehPanicoDoEngineDoPrisma('[curator] DATABASE_URL não definida.'), false);
  assert.equal(ehPanicoDoEngineDoPrisma('[curator] Prisma Client não encontrado.'), false);
  assert.equal(
    ehPanicoDoEngineDoPrisma("Can't reach database server at `localhost`:`3306`"),
    false,
  );
  assert.equal(ehPanicoDoEngineDoPrisma('conector reddit suspenso: circuito aberto'), false);
});

test('a palavra "panic" no texto explicativo do Prisma não dispara repetição sozinha', () => {
  // Esta é a armadilha que a lista de assinaturas existe para evitar: o Prisma
  // imprime esta frase ao FIM de erros que não são o nosso panic. Casar com a
  // palavra solta faria qualquer um deles ser repetido.
  const explicacao =
    'This is a non-recoverable error which probably happens when the Prisma Query Engine has a panic.';
  assert.equal(ehPanicoDoEngineDoPrisma(explicacao), false);
});

// =============================================================================
// 3. A REPETIÇÃO TEM FIM
// =============================================================================

/** Orçamento de tempo folgado — isola os casos que não são sobre tempo. */
const ORCAMENTO_FOLGADO_MS = 70_000;

test('a primeira falha por panic é repetida, com pausa antes', () => {
  const decisao = decidirRepeticao({
    tentativa: 1,
    stderr: STDERR_DE_PRODUCAO,
    msRestantesNoOrcamento: ORCAMENTO_FOLGADO_MS,
  });

  assert.equal(decisao.repetir, true);
  // A pausa não é cortesia: sem ela, a nova tentativa disputa as threads que o
  // processo morto ainda não devolveu ao sistema — que é a causa da falha.
  assert.ok(decisao.esperarMs > 0, 'a repetição precisa esperar antes de tentar de novo');
  assert.match(decisao.motivo, /PANIC/);
});

test('a espera cresce entre as repetições', () => {
  // A segunda repetição já sabe que a pressão não era um pico de um segundo.
  assert.ok(esperaAntesDaTentativa(3) > esperaAntesDaTentativa(2));
});

test('a repetição PARA na última tentativa — não é laço infinito', () => {
  const decisao = decidirRepeticao({
    tentativa: TENTATIVAS_MAXIMAS,
    stderr: STDERR_DE_PRODUCAO,
    msRestantesNoOrcamento: ORCAMENTO_FOLGADO_MS,
  });

  assert.equal(decisao.repetir, false);
  // O motivo entra no log e é o que diz a quem investiga que o servidor tentou
  // de verdade antes de desistir.
  assert.match(decisao.motivo, /tentativas/);
});

test('falha que não é panic não é repetida nem na primeira tentativa', () => {
  const decisao = decidirRepeticao({
    tentativa: 1,
    stderr: '[curator] DATABASE_URL não definida.',
    msRestantesNoOrcamento: ORCAMENTO_FOLGADO_MS,
  });

  assert.equal(decisao.repetir, false);
});

// =============================================================================
// 4. O ORÇAMENTO DE TEMPO MANDA
// =============================================================================

test('sem tempo restante, o panic não é repetido — desistir com o diagnóstico certo', () => {
  // Repetir aqui trocaria a mensagem correta ("o motor travou") pela mensagem
  // seguinte e pior ("passou do tempo"), que esconde a causa real.
  const decisao = decidirRepeticao({
    tentativa: 1,
    stderr: STDERR_DE_PRODUCAO,
    msRestantesNoOrcamento: 5_000,
  });

  assert.equal(decisao.repetir, false);
  assert.match(decisao.motivo, /orçamento/);
});

test('a espera é descontada do orçamento antes de decidir', () => {
  // 21s de folga parecem suficientes, mas a pausa antes da tentativa consome
  // parte deles. Se a conta ignorasse a pausa, a tentativa começaria com menos
  // tempo do que o mínimo exigido para ter chance de terminar.
  const decisao = decidirRepeticao({
    tentativa: 1,
    stderr: STDERR_DE_PRODUCAO,
    msRestantesNoOrcamento: 21_000,
  });

  assert.equal(decisao.repetir, false);
});
