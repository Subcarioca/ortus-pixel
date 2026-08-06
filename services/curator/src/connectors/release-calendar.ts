/**
 * =============================================================================
 * CONECTOR: CALENDÁRIO DE LANÇAMENTOS (interno, custo zero)
 * =============================================================================
 *
 * Item 6 do briefing: sazonalidade. Notícia próxima de uma data de lançamento
 * confirmada vale mais — o público já está com atenção voltada para aquilo.
 *
 * Consulta apenas nosso próprio banco (`ReleaseEvent`), então é grátis, rápido
 * e imune a instabilidade externa. É também um ATIVO PRÓPRIO que se valoriza:
 * quanto mais completo o calendário, melhor o sinal, e concorrente nenhum tem
 * acesso a ele.
 *
 * A CURVA É ASSIMÉTRICA, e vale entender o porquê:
 *   - ANTES do lançamento, o interesse cresce à medida que a data se aproxima
 *     (expectativa, trailers, pré-venda).
 *   - DEPOIS do lançamento, o interesse despenca rápido — mas não some, porque
 *     surgem reviews, guias e repercussão.
 * Uma curva simétrica (só distância absoluta em dias) trataria "3 dias antes" e
 * "3 dias depois" como equivalentes, o que contraria o comportamento real de
 * audiência.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@canalnerd/core';
import { prisma } from '@canalnerd/db';

/**
 * Converte a distância até o lançamento em um valor de sinal.
 * @param daysUntil positivo = falta esse tanto de dias; negativo = já lançou.
 */
export function proximityValue(daysUntil: number): { value: number; label: string } {
  // --- Janela pré-lançamento ---
  if (daysUntil >= 0) {
    if (daysUntil <= 3) return { value: 1.0, label: 'lança em até 3 dias' };
    if (daysUntil <= 7) return { value: 0.9, label: 'lança nesta semana' };
    if (daysUntil <= 30) return { value: 0.7, label: 'lança neste mês' };
    if (daysUntil <= 90) return { value: 0.45, label: 'lança nos próximos 3 meses' };
    if (daysUntil <= 180) return { value: 0.25, label: 'lança no próximo semestre' };
    return { value: 0.1, label: 'lançamento distante' };
  }

  // --- Janela pós-lançamento (queda mais acentuada) ---
  const daysSince = Math.abs(daysUntil);
  if (daysSince <= 7) return { value: 0.85, label: 'lançou há menos de uma semana' };
  if (daysSince <= 30) return { value: 0.5, label: 'lançou neste mês' };
  if (daysSince <= 90) return { value: 0.2, label: 'lançou há alguns meses' };
  return { value: 0.05, label: 'lançamento antigo' };
}

export const releaseCalendarConnector: SignalConnector = {
  id: 'release-calendar',
  displayName: 'Calendário de lançamentos',
  dimensions: ['releaseProximity'],
  cost: 'free',
  stage: 'discovery',
  timeoutMs: 2000,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    // Sem franquia associada não há como consultar o calendário. Devolver array
    // vazio faz o motor tratar a dimensão como indisponível e redistribuir o
    // peso — comportamento correto, já que "não sei" não é "não tem lançamento".
    if (context.franchiseSlugs.length === 0) return [];

    const now = new Date();

    // Buscamos numa janela de -180 a +365 dias. Fora disso o sinal é ruído,
    // e restringir no banco (em vez de filtrar em memória) mantém a query
    // usando o índice de `releaseDate`.
    const releases = await prisma.releaseEvent.findMany({
      where: {
        franchise: { slug: { in: context.franchiseSlugs } },
        releaseDate: {
          gte: new Date(now.getTime() - 180 * 86_400_000),
          lte: new Date(now.getTime() + 365 * 86_400_000),
        },
      },
      include: { franchise: { select: { name: true } } },
      orderBy: { releaseDate: 'asc' },
    });

    if (releases.length === 0) return [];

    // Escolhemos o lançamento de MAIOR sinal, não o mais próximo no tempo.
    // A diferença aparece quando uma franquia tem um lançamento amanhã (não
    // confirmado, peso baixo) e outro em 30 dias (confirmado): o segundo é o
    // que de fato move audiência.
    let best: { value: number; label: string; title: string; confidence: number } | null = null;

    for (const release of releases) {
      const daysUntil = Math.round(
        (release.releaseDate.getTime() - now.getTime()) / 86_400_000,
      );
      const { value, label } = proximityValue(daysUntil);

      // Data não confirmada vale menos: "2027" não gera a mesma expectativa
      // que "12 de novembro".
      const adjusted = release.isConfirmed ? value : value * 0.5;
      const confidence = release.isConfirmed ? 0.95 : 0.6;

      if (!best || adjusted > best.value) {
        best = {
          value: adjusted,
          label: `${release.title} ${label}${release.isConfirmed ? '' : ' (data não confirmada)'}`,
          title: release.title,
          confidence,
        };
      }
    }

    if (!best) return [];

    return [
      {
        dimension: 'releaseProximity',
        connectorId: this.id,
        value: best.value,
        rawValue: best.title,
        explanation: best.label,
        confidence: best.confidence,
        observedAt: now,
      },
    ];
  },
};
