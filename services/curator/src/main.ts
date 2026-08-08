/**
 * =============================================================================
 * PONTO DE ENTRADA DO SERVIÇO DE CURADORIA
 * =============================================================================
 *
 * Modos de execução:
 *   npm run curator:once   -> um ciclo e encerra (ideal para cron/CI/depuração)
 *   npm run dev:curator    -> laço contínuo com recarga automática
 *
 * AGENDAMENTO EM DOIS RITMOS — decisão importante de custo e frescor:
 *
 *   DESCOBERTA (15 min)  -> lê feeds, cria tópicos, pontua e enriquece.
 *                           É o ciclo caro: aciona APIs pagas.
 *
 *   RECÁLCULO  (5 min)   -> repontua conteúdo já publicado usando apenas
 *                           conectores gratuitos. É o que faz um trailer que
 *                           viralizou 3h depois subir sozinho para o hero.
 *                           Barato, então roda três vezes mais.
 *
 * POR QUE `setTimeout` ENCADEADO E NÃO `setInterval`:
 * `setInterval` dispara em intervalo fixo INDEPENDENTE de o ciclo anterior ter
 * terminado. Se um ciclo demorar 20 minutos (API lenta), começariam a se
 * empilhar execuções concorrentes, cada uma consumindo orçamento de API e
 * disputando as mesmas linhas do banco. O encadeamento garante que o próximo
 * ciclo só comece depois que o anterior terminar.
 *
 * PARA PRODUÇÃO: este agendador em processo é adequado para uma instância
 * única. Com múltiplas réplicas, migre para BullMQ + Redis (já previsto nas
 * dependências), que oferece bloqueio distribuído, repetição e visibilidade da
 * fila. O ponto de troca está isolado nas funções abaixo.
 */

import { validateRegistry } from './connectors/registry';
import { runCurationCycle, rescorePublished } from './pipeline/curate';
import { getCircuitStates } from './pipeline/orchestrator';
import { validateWeightSet, DEFAULT_WEIGHTS } from '@subcarioca/scoring';

const DISCOVERY_INTERVAL_MS = 15 * 60 * 1000;
const RESCORE_INTERVAL_MS = 5 * 60 * 1000;

/** Fase ativa do roadmap. Controla quais fontes e categorias são coletadas. */
function getActivePhase(): 1 | 2 | 3 {
  const raw = Number(process.env.CURATOR_PHASE ?? '1');
  return raw === 2 ? 2 : raw === 3 ? 3 : 1;
}

/**
 * Validações de inicialização.
 *
 * FALHAR CEDO E ALTO: um registry com IDs duplicados ou pesos que não somam 1.0
 * produziria scores errados de forma silenciosa por semanas. Melhor não subir.
 */
function validateStartup(): void {
  const registry = validateRegistry();
  if (!registry.valid) {
    console.error('[boot] registry de conectores inválido:');
    registry.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const weights = validateWeightSet(DEFAULT_WEIGHTS);
  if (!weights.valid) {
    console.error('[boot] conjunto de pesos inválido:');
    weights.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`[boot] validações OK. Pesos: ${DEFAULT_WEIGHTS.version}.`);
}

async function runDiscoveryCycle(): Promise<void> {
  const phase = getActivePhase();
  try {
    await runCurationCycle({ phase });
  } catch (error) {
    // Um ciclo que falha não derruba o serviço: o próximo tenta de novo. Notícia
    // é fluxo contínuo; perder um ciclo é muito melhor que ficar fora do ar.
    console.error('[main] ciclo de descoberta falhou:', error);
  }
}

async function runRescoreCycle(): Promise<void> {
  try {
    const updated = await rescorePublished({ hoursBack: 48 });
    if (updated > 0) {
      console.log(`[main] recálculo: ${updated} artigo(s) com variação relevante de score.`);
    }
  } catch (error) {
    console.error('[main] ciclo de recálculo falhou:', error);
  }
}

/** Laço encadeado: só agenda o próximo depois que o atual termina. */
function scheduleLoop(task: () => Promise<void>, intervalMs: number, label: string): void {
  const tick = async () => {
    const startedAt = Date.now();
    await task();
    const elapsed = Date.now() - startedAt;

    // Se o ciclo demorou MAIS que o intervalo, roda o próximo imediatamente
    // (com um respiro de 1s), em vez de agendar um tempo negativo.
    const delay = Math.max(1000, intervalMs - elapsed);

    if (elapsed > intervalMs) {
      console.warn(
        `[main] ciclo "${label}" levou ${(elapsed / 1000).toFixed(0)}s, acima do intervalo de ${intervalMs / 1000}s.`,
      );
    }

    setTimeout(tick, delay);
  };

  void tick();
}

async function main(): Promise<void> {
  const runOnce = process.argv.includes('--once');

  console.log('Ortus Pixel — serviço de curadoria');
  console.log(`Fase ativa: ${getActivePhase()} | Modo: ${runOnce ? 'ciclo único' : 'contínuo'}\n`);

  validateStartup();

  if (runOnce) {
    await runDiscoveryCycle();
    await runRescoreCycle();

    const circuits = getCircuitStates();
    const open = Object.entries(circuits).filter(([, c]) => c.state === 'open');
    if (open.length > 0) {
      console.warn(`\n[main] conectores suspensos: ${open.map(([id]) => id).join(', ')}`);
    }

    console.log('\nCiclo único concluído.');
    process.exit(0);
  }

  scheduleLoop(runDiscoveryCycle, DISCOVERY_INTERVAL_MS, 'descoberta');
  scheduleLoop(runRescoreCycle, RESCORE_INTERVAL_MS, 'recálculo');

  // ENCERRAMENTO GRACIOSO: sem isso, um deploy no meio de um ciclo deixaria
  // registros de PipelineRun eternamente com status 'running' e corromperia as
  // métricas de saúde do pipeline.
  const shutdown = (signal: string) => {
    console.log(`\n[main] recebido ${signal}, encerrando...`);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[main] falha fatal:', error);
  process.exit(1);
});
