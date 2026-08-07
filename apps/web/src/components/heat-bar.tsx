/**
 * =============================================================================
 * TERMÔMETRO E TENDÊNCIA — o que substituiu o número na interface pública
 * =============================================================================
 *
 * Ao esconder o score (ADR 0009), o site perderia duas informações que o leitor
 * de fato usa: INTENSIDADE e MOVIMENTO. O design v0.2 devolveu as duas sem
 * expor a escala:
 *
 *   HeatBar  → 4 blocos preenchidos proporcionalmente à faixa. Comunica
 *              "quão quente" numa escala ORDINAL: dá para comparar dois itens
 *              lado a lado, mas não dá para reconstruir a curva de calibração
 *              a partir de observações repetidas — que é o que o número
 *              permitia a qualquer concorrente com um script.
 *   TrendTag → "Disparando", "Subindo", "Esfriando". Um leitor entende isso no
 *              primeiro contato; "+38" só significa algo para quem conhece a
 *              escala, ou seja, para nós. (Nielsen #2.)
 *
 * ACESSIBILIDADE: a barra é `role="img"` com `aria-label` descritivo. Sem isso,
 * um leitor de tela anunciaria quatro `<i>` vazios — ou seja, nada. Cor
 * sozinha nunca informa (WCAG 1.4.1), e por isso o badge textual continua ao
 * lado em todos os usos.
 */

import type { Heat, HeatLevel, Trend } from '@canalnerd/core';
import { HEAT_LABELS, TREND_LABELS, heatClass } from '@canalnerd/core';

interface HeatBarProps {
  heat: Heat;
  level: HeatLevel;
  size?: 'sm' | 'md';
}

export function HeatBar({ heat, level, size = 'md' }: HeatBarProps) {
  return (
    <span
      // `heatClass` e não `heatbar--${heat}`: a faixa `base` NÃO tem modificador
      // no design (`.heatbar` já nasce com `--h: var(--heat-base)`), então a
      // interpolação direta produzia `.heatbar--base` — a classe mais frequente
      // do site — sem nenhuma regra correspondente. A assimetria é traiçoeira
      // porque o BADGE ao lado, no mesmo `.card__head`, tem os quatro
      // modificadores. Ver HEAT_BLOCK_MODIFIERS em core/presentation.ts.
      className={`${heatClass('heatbar', heat)}${size === 'sm' ? ' heatbar--sm' : ''}`}
      data-on={level}
      role="img"
      aria-label={`Temperatura: ${HEAT_LABELS[heat].toLowerCase()}`}
    >
      {/* Quatro blocos SEMPRE renderizados; o CSS pinta os `level` primeiros.
          Renderizar só os acesos faria a barra encolher e o layout dançar
          entre um card e outro. */}
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function TrendTag({ trend }: { trend: Trend }) {
  // 'flat' não vira etiqueta: "Estável" é a ausência de notícia sobre o
  // movimento, e uma etiqueta para cada card tiraria o peso das que importam.
  if (trend === 'flat') return null;

  const modifier = trend === 'down' ? 'down' : trend === 'new' ? 'new' : 'up';

  return <span className={`trend trend--${modifier}`}>{TREND_LABELS[trend]}</span>;
}
