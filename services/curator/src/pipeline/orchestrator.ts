/**
 * =============================================================================
 * ORQUESTRADOR DE SINAIS — resiliência a falhas de fontes externas
 * =============================================================================
 *
 * REQUISITO ATENDIDO AQUI: "uma API de trends fora do ar não pode travar o
 * sistema".
 *
 * São QUATRO camadas de proteção, cada uma cobrindo um modo de falha diferente:
 *
 *  1. TIMEOUT POR CONECTOR — cobre a API que aceita a conexão e nunca responde.
 *     É o pior tipo de falha: sem timeout, o ciclo fica pendurado para sempre.
 *
 *  2. ISOLAMENTO DE ERRO (Promise.allSettled) — cobre a API que devolve erro ou
 *     JSON malformado. Um conector que lança exceção não contamina os demais.
 *
 *  3. CIRCUIT BREAKER — cobre a API que está fora do ar HÁ HORAS. Sem ele,
 *     continuaríamos gastando 8 segundos de timeout por tópico, por ciclo, para
 *     sempre. Depois de N falhas seguidas, o conector é suspenso e o ciclo
 *     inteiro fica mais rápido.
 *
 *  4. RENORMALIZAÇÃO DE PESOS (no motor de score) — cobre a consequência final:
 *     o score continua na escala 0-100 e comparável, mesmo com menos sinais.
 *
 * O princípio por trás de tudo: DEGRADAÇÃO GRACIOSA. O sistema nunca escolhe
 * entre "dado perfeito" e "cair". Ele entrega o melhor dado disponível e diz
 * com honestidade o quanto confia nele.
 */

import type {
  ConnectorRunResult,
  SignalConnector,
  SignalContext,
  SignalMeasurement,
} from '@subcarioca/core';

/** Estado do circuit breaker de um conector, mantido em memória. */
interface CircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
  totalRuns: number;
  totalFailures: number;
}

/**
 * Configuração do circuit breaker.
 *
 * Os números foram escolhidos para o ritmo do nosso pipeline (ciclos de 5-15
 * min), e não copiados de um artigo genérico sobre micros serviços:
 *  - 3 falhas: tolera instabilidade pontual sem ser teimoso.
 *  - 5 minutos: aproximadamente um ciclo. Retomamos rápido quando a API volta,
 *    porque perder sinal de velocidade por muito tempo custa detecção precoce.
 */
const CIRCUIT_CONFIG = {
  failureThreshold: 3,
  openDurationMs: 5 * 60 * 1000,
};

const circuits = new Map<string, CircuitState>();

function getCircuit(connectorId: string): CircuitState {
  let circuit = circuits.get(connectorId);
  if (!circuit) {
    circuit = { consecutiveFailures: 0, openUntil: null, totalRuns: 0, totalFailures: 0 };
    circuits.set(connectorId, circuit);
  }
  return circuit;
}

/** O circuito está aberto (conector suspenso) agora? */
function isCircuitOpen(connectorId: string): boolean {
  const circuit = getCircuit(connectorId);
  if (circuit.openUntil === null) return false;

  if (Date.now() >= circuit.openUntil) {
    // Passou o tempo de espera: entra em "half-open". Deixamos UMA tentativa
    // passar; se ela funcionar, o circuito fecha. É o que evita ficar
    // alternando entre aberto e fechado quando a API está intermitente.
    circuit.openUntil = null;
    circuit.consecutiveFailures = CIRCUIT_CONFIG.failureThreshold - 1;
    return false;
  }
  return true;
}

function recordSuccess(connectorId: string): void {
  const circuit = getCircuit(connectorId);
  circuit.consecutiveFailures = 0;
  circuit.openUntil = null;
  circuit.totalRuns++;
}

function recordFailure(connectorId: string): void {
  const circuit = getCircuit(connectorId);
  circuit.consecutiveFailures++;
  circuit.totalRuns++;
  circuit.totalFailures++;

  if (circuit.consecutiveFailures >= CIRCUIT_CONFIG.failureThreshold) {
    circuit.openUntil = Date.now() + CIRCUIT_CONFIG.openDurationMs;
    console.warn(
      `[orchestrator] circuito ABERTO para "${connectorId}" após ${circuit.consecutiveFailures} falhas. ` +
        `Suspenso por ${CIRCUIT_CONFIG.openDurationMs / 1000}s.`,
    );
  }
}

/** Snapshot do estado dos circuitos, para o painel de saúde do pipeline. */
export function getCircuitStates(): Record<
  string,
  { state: 'closed' | 'open'; consecutiveFailures: number; failureRate: number }
> {
  const result: Record<
    string,
    { state: 'closed' | 'open'; consecutiveFailures: number; failureRate: number }
  > = {};

  for (const [id, circuit] of circuits.entries()) {
    result[id] = {
      state: circuit.openUntil !== null && Date.now() < circuit.openUntil ? 'open' : 'closed',
      consecutiveFailures: circuit.consecutiveFailures,
      failureRate: circuit.totalRuns > 0 ? circuit.totalFailures / circuit.totalRuns : 0,
    };
  }
  return result;
}

/** Reseta os circuitos. Usado em testes e pelo botão "reativar" do painel. */
export function resetCircuits(connectorId?: string): void {
  if (connectorId) circuits.delete(connectorId);
  else circuits.clear();
}

/**
 * Executa um conector com todas as proteções.
 * NUNCA lança exceção: sempre devolve um `ConnectorRunResult` descrevendo o que
 * aconteceu. Essa garantia é o que permite ao chamador ser simples.
 */
async function runConnector(
  connector: SignalConnector,
  context: Omit<SignalContext, 'signal'>,
): Promise<ConnectorRunResult> {
  const startedAt = Date.now();

  if (isCircuitOpen(connector.id)) {
    return {
      connectorId: connector.id,
      status: 'circuit-open',
      measurements: [],
      durationMs: 0,
      error: 'Circuito aberto: conector suspenso após falhas consecutivas.',
    };
  }

  // AbortController por conector: o timeout de um não afeta o do outro.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), connector.timeoutMs);

  try {
    const measurements = await connector.collect({ ...context, signal: controller.signal });

    // Um conector pode devolver medições fora do contrato (bug próprio ou
    // resposta inesperada da API). Sanitizamos AQUI, na fronteira, para que o
    // motor de score possa confiar cegamente no que recebe.
    const valid = measurements.filter(isValidMeasurement);
    const discarded = measurements.length - valid.length;
    if (discarded > 0) {
      console.warn(
        `[orchestrator] "${connector.id}" devolveu ${discarded} medição(ões) inválida(s), descartada(s).`,
      );
    }

    recordSuccess(connector.id);

    return {
      connectorId: connector.id,
      status: 'ok',
      measurements: valid,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    recordFailure(connector.id);

    const isTimeout = controller.signal.aborted;
    return {
      connectorId: connector.id,
      status: isTimeout ? 'timeout' : 'failed',
      measurements: [],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // `finally` garante a limpeza mesmo com exceção. Sem isso, cada conector
    // deixaria um timer pendurado e o processo não encerraria sozinho.
    clearTimeout(timeoutId);
  }
}

/** Valida uma medição contra o contrato. Barreira entre plugin e núcleo. */
function isValidMeasurement(m: SignalMeasurement): boolean {
  return (
    typeof m.value === 'number' &&
    Number.isFinite(m.value) &&
    m.value >= 0 &&
    m.value <= 1 &&
    typeof m.confidence === 'number' &&
    Number.isFinite(m.confidence) &&
    m.confidence >= 0 &&
    m.confidence <= 1
  );
}

export interface CollectResult {
  measurements: SignalMeasurement[];
  runs: ConnectorRunResult[];
  /** Conectores que falharam — usado para logar e alimentar o painel. */
  failedConnectors: string[];
  totalDurationMs: number;
}

/**
 * Executa TODOS os conectores informados, EM PARALELO, e agrega o resultado.
 *
 * POR QUE PARALELO E NÃO SEQUENCIAL: com 6 conectores de ~3s cada, sequencial
 * levaria 18s por tópico. Com 200 tópicos, o ciclo levaria uma hora — e um
 * ciclo de uma hora não detecta breaking news, que é o produto inteiro. Em
 * paralelo, cada tópico custa o tempo do conector mais lento (~8s no pior caso).
 *
 * `Promise.allSettled` (e não `Promise.all`) é o detalhe que garante o
 * isolamento: `all` rejeitaria tudo na primeira falha, jogando fora os sinais
 * que já haviam sido coletados com sucesso.
 */
export async function collectSignals(
  connectors: SignalConnector[],
  context: Omit<SignalContext, 'signal'>,
): Promise<CollectResult> {
  const startedAt = Date.now();

  const settled = await Promise.allSettled(
    connectors.map((connector) => runConnector(connector, context)),
  );

  const runs: ConnectorRunResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;

    // Caminho teoricamente inalcançável (runConnector captura tudo), mas
    // tratado assim mesmo: "impossível acontecer" é a origem da maior parte
    // dos incidentes de produção às 3h da manhã.
    return {
      connectorId: connectors[index]?.id ?? 'desconhecido',
      status: 'failed' as const,
      measurements: [],
      durationMs: 0,
      error: String(result.reason),
    };
  });

  const measurements = runs.flatMap((run) => run.measurements);
  const failedConnectors = runs
    .filter((run) => run.status === 'failed' || run.status === 'timeout')
    .map((run) => run.connectorId);

  return {
    measurements,
    runs,
    failedConnectors,
    totalDurationMs: Date.now() - startedAt,
  };
}
