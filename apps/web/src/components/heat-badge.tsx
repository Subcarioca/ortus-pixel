/**
 * =============================================================================
 * BADGE DE TEMPERATURA
 * =============================================================================
 *
 * Componente pequeno, mas é o que carrega a decisão central do design: fazer o
 * leitor "sentir" a urgência sem ler legenda nenhuma.
 *
 * DUAS REGRAS DE ACESSIBILIDADE, herdadas do design system:
 *
 *  1. COR NUNCA SOZINHA. Todo badge tem ícone + rótulo textual. Cerca de 8% dos
 *     homens têm alguma deficiência de visão de cores; e num celular sob sol
 *     forte, TODO MUNDO tem. Vermelho puro sem rótulo não comunica nada.
 *     (WCAG 1.4.1 — Uso da cor.)
 *
 *  2. ANIMAÇÃO SÓ NO "QUENTE", e respeitando `prefers-reduced-motion`. O ponto
 *     pulsante é o único elemento animado da tela. Se tudo pulsasse, nada
 *     chamaria atenção — e usuários com sensibilidade vestibular passariam mal.
 *
 * O componente NÃO recebe `score` para decidir a cor: recebe `heat` já
 * calculado no servidor. Ver core/presentation.ts para o porquê.
 *
 * =============================================================================
 * O SCORE NUMÉRICO NÃO EXISTE MAIS NESTE COMPONENTE (decisão do dono do site)
 * =============================================================================
 *
 * Até a v0.1 este badge aceitava uma prop `score` e exibia "94" ao lado do
 * rótulo. O número saiu de toda a interface pública — home, categoria, em alta,
 * artigo, hub de franquia — e ficou visível SÓ no /admin, que é o uso interno
 * da redação.
 *
 * COMO A DECISÃO FOI IMPLEMENTADA, E POR QUÊ ASSIM:
 *
 * A forma óbvia seria manter a prop e controlá-la por uma flag
 * (`SHOW_NUMERIC_SCORE`). Foi o que existia antes, e é frágil: basta alguém
 * criar uma tela nova passando `score={item.score}` e o número volta ao ar sem
 * que ninguém perceba — uma decisão de produto revertida por descuido.
 *
 * Removemos a capacidade em vez de desligá-la. Hoje, para exibir o número, é
 * preciso importar `components/admin/score-value.tsx` — um caminho que grita
 * "isto é do painel" em qualquer revisão de código, e que a página pública não
 * tem motivo nenhum para importar. A distinção `heat` (público) x `score`
 * (interno) deixa de ser convenção e passa a ser estrutura.
 *
 * O dado continua existindo no banco, no domínio e na API interna. É só a
 * apresentação pública que mudou.
 */

import type { Heat } from '@subcarioca/core';
import { HEAT_LABELS, heatClass } from '@subcarioca/core';

interface HeatBadgeProps {
  heat: Heat;
  size?: 'sm' | 'lg';
}

/**
 * O "+38" também saiu.
 *
 * A primeira versão desta entrega manteve o delta, com o argumento de que ele
 * comunica movimento sem revelar a escala. O design v0.2 (§4) foi mais longe e
 * está certo: "+38" É um número da mesma escala — observado algumas vezes ao
 * dia, ele permite reconstruir a curva tão bem quanto o valor absoluto. E, para
 * quem não conhece a régua, ele não significa nada.
 *
 * No lugar dele entrou `TrendTag` ("Disparando", "Subindo", "Esfriando"), que
 * comunica melhor e não vaza a metodologia. Ver components/heat-bar.tsx.
 */
export function HeatBadge({ heat, size = 'sm' }: HeatBadgeProps) {
  return (
    <span
      // O badge é o único bloco em que as QUATRO faixas têm modificador, então
      // aqui `heatClass` devolve exatamente o que a interpolação direta
      // devolveria. Usamos mesmo assim: é a mesma tabela que responde por
      // `.heatbar`, `.rank` e `.score`, e ter um único caminho evita que o
      // próximo bloco de temperatura nasça com a interpolação ingênua de novo.
      className={`${heatClass('heat', heat)}${size === 'lg' ? ' heat--lg' : ''}`}
      // O rótulo textual já está no conteúdo; o `title` acrescenta contexto no
      // hover para quem quiser entender o que a faixa significa.
      title={`Faixa de popularidade: ${HEAT_LABELS[heat]}`}
    >
      {/* Ponto pulsante exclusivo do "quente". */}
      {heat === 'hot' && <span className="live-dot" aria-hidden="true" />}

      {/* Rótulo textual — o que garante a leitura sem depender da cor. */}
      <span>{HEAT_LABELS[heat]}</span>
    </span>
  );
}
