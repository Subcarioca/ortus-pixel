/**
 * =============================================================================
 * SCORE NUMÉRICO — EXCLUSIVO DO PAINEL EDITORIAL
 * =============================================================================
 *
 * ESTE COMPONENTE NÃO PODE SER IMPORTADO POR NENHUMA PÁGINA PÚBLICA.
 *
 * O dono do site decidiu que o número de 0 a 100 deixa de aparecer no site e
 * fica visível apenas para a redação. O motivo é competitivo: o score é o
 * resultado de meses de calibração, e uma página pública que o exibe permite a
 * qualquer concorrente coletar (título, horário, número) todos os dias e
 * reconstruir por engenharia reversa boa parte da nossa curva — sem gastar um
 * centavo em API de sinal.
 *
 * A REDAÇÃO, ao contrário, PRECISA do número. O README já registrava o
 * princípio: "o jornalista precisa CONFIAR no número; um score que ele não
 * entende é um score que ele ignora". Faixa sem número não permite comparar
 * duas pautas dentro da mesma faixa nem perceber que uma delas está a 1 ponto
 * de virar QUENTE.
 *
 * O componente mora em `components/admin/` por razão estrutural, não de
 * organização: numa revisão de código, `import { ScoreValue } from
 * '@/components/admin/score-value'` dentro de uma página pública é visível a
 * olho nu. Uma prop opcional `score` num componente compartilhado não seria.
 */

import { bandForScore } from '@subcarioca/core';

interface ScoreValueProps {
  /** Score efetivo (com override humano aplicado, quando houver). */
  score: number;
  /**
   * Score puramente algorítmico. Quando difere do efetivo, exibimos os dois:
   * o editor precisa enxergar que existe um override, senão ele acha que o
   * algoritmo "acertou" o que na verdade um colega corrigiu à mão.
   */
  algorithmicScore?: number;
  /** Confiança de 0 a 1. Um 84 com 30% de confiança não é um 84. */
  confidence?: number;
  size?: 'sm' | 'lg';
}

export function ScoreValue({ score, algorithmicScore, confidence, size = 'sm' }: ScoreValueProps) {
  const rounded = Math.round(score);
  const hasOverride =
    typeof algorithmicScore === 'number' && Math.round(algorithmicScore) !== rounded;

  return (
    <span className={`score-value${size === 'lg' ? ' score-value--lg' : ''}`}>
      <span className="score-value__num" aria-label={`Score ${rounded} de 100`}>
        {rounded}
      </span>

      {hasOverride && (
        <span className="score-value__original" title="Score calculado pelo algoritmo">
          algoritmo: {Math.round(algorithmicScore)}
        </span>
      )}

      {typeof confidence === 'number' && (
        <span
          className="score-value__conf"
          title={`Confiança do cálculo: ${Math.round(confidence * 100)}%`}
        >
          {Math.round(confidence * 100)}% conf.
        </span>
      )}

      <span className="sr-only">Faixa: {bandForScore(score).label}</span>
    </span>
  );
}
