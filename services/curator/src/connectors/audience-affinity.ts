/**
 * =============================================================================
 * CONECTOR: AFINIDADE DA AUDIÊNCIA (interno — o diferencial proprietário)
 * =============================================================================
 *
 * Item 9 do briefing: desempenho histórico interno por franquia/fandom.
 *
 * ESTE É O CONECTOR MAIS ESTRATÉGICO DO SISTEMA, ainda que não seja o de maior
 * peso. Motivo: todos os outros sinais são públicos — Trends, Reddit e YouTube
 * estão igualmente disponíveis para JovemNerd, Omelete e IGN Brasil. Este aqui
 * não. Só nós sabemos que a NOSSA base engaja 1,8x com GTA e 0,7x com futebol
 * eletrônico.
 *
 * É o sinal que transforma o portal em algo que aprende com a própria
 * audiência, em vez de apenas reagir ao que o mundo está buscando. Com o
 * tempo, ele deve GANHAR peso nas versões seguintes do algoritmo — hoje começa
 * em 0.08 apenas porque o histórico ainda é curto.
 *
 * COMO O ÍNDICE É CALCULADO (job separado, ver pipeline/affinity-recalc.ts):
 *   afinidade = (média de pageviews da franquia / média geral do site)
 *               ponderada por tempo de sessão e compartilhamentos
 * Um índice 1.0 significa "performa como a média"; 2.0, "o dobro da média".
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@subcarioca/core';
import { clamp } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

/**
 * Converte o índice de afinidade (0 a ~3, centrado em 1) para o intervalo [0,1]
 * que o motor de score espera.
 *
 * O mapeamento é deliberadamente NÃO linear em torno de 1.0:
 *   índice 0.5 (metade da média) -> ~0.25
 *   índice 1.0 (na média)        -> 0.50
 *   índice 2.0 (dobro da média)  -> ~0.83
 *   índice 3.0 (triplo)          -> ~0.95
 *
 * A saturação no topo evita que uma franquia campeã domine a home
 * eternamente: sem ela, todo conteúdo de Marvel entraria no hero por
 * inércia histórica, e o portal viraria monotemático — o que mata a
 * descoberta de novos fandoms e engessa a audiência.
 */
export function affinityToSignal(index: number): number {
  if (index <= 0) return 0;
  // Curva logística centrada em 1.0.
  return clamp(1 / (1 + Math.exp(-1.6 * (index - 1))));
}

export const audienceAffinityConnector: SignalConnector = {
  id: 'audience-affinity',
  displayName: 'Afinidade da audiência (interno)',
  dimensions: ['audienceAffinity'],
  cost: 'free',
  stage: 'discovery',
  timeoutMs: 2000,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    if (context.franchiseSlugs.length === 0) return [];

    const franchises = await prisma.franchise.findMany({
      where: { slug: { in: context.franchiseSlugs } },
      select: { name: true, audienceAffinityIndex: true, followerCount: true },
    });

    if (franchises.length === 0) return [];

    // Com múltiplas franquias, usamos a de MAIOR afinidade. Racional editorial:
    // um crossover Marvel x Star Wars deve herdar o interesse do fandom mais
    // engajado, não a média dos dois — quem vai clicar é o fã mais fervoroso.
    const best = franchises.reduce((top, f) =>
      f.audienceAffinityIndex > top.audienceAffinityIndex ? f : top,
    );

    // A confiança cresce com o tamanho do fandom: um índice calculado sobre
    // 12.000 seguidores é bem mais estável do que sobre 50. Sem esse ajuste,
    // franquias recém-criadas com 3 artigos gerariam índices extremos e
    // instáveis que bagunçariam a home.
    const confidence = clamp(0.5 + Math.min(best.followerCount / 10_000, 1) * 0.45);

    return [
      {
        dimension: 'audienceAffinity',
        connectorId: this.id,
        value: affinityToSignal(best.audienceAffinityIndex),
        rawValue: best.audienceAffinityIndex,
        explanation:
          best.audienceAffinityIndex >= 1.3
            ? `${best.name}: fandom forte na nossa base (${best.audienceAffinityIndex.toFixed(2)}x a média)`
            : best.audienceAffinityIndex >= 0.8
              ? `${best.name}: desempenho na média do site (${best.audienceAffinityIndex.toFixed(2)}x)`
              : `${best.name}: abaixo da média do site (${best.audienceAffinityIndex.toFixed(2)}x)`,
        confidence,
        observedAt: new Date(),
      },
    ];
  },
};
