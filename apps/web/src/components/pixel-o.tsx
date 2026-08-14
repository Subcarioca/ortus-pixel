/**
 * =============================================================================
 * O "O" PIXELADO DO WORDMARK
 * =============================================================================
 *
 * O primeiro caractere da marca deixou de ser uma letra e virou um desenho: um
 * "O" em pixel art, vermelho, seguido de "Pixel" na cor de texto padrão. É a
 * INVERSÃO pedida pelo dono do produto — antes o vermelho estava em "Pixel" e o
 * "O" era só uma letra do texto.
 *
 * -----------------------------------------------------------------------------
 * POR QUE SVG INLINE E NÃO UMA IMAGEM
 * -----------------------------------------------------------------------------
 * A marca aparece no topo de TODA página do site. Como <img>, seria uma
 * requisição a mais no caminho crítico do primeiro paint — e, pior, uma
 * requisição que não sabe a cor do tema. Inline, o desenho:
 *
 *   - herda a cor por CSS (`.logo__o { fill: var(--brand) }`), então acompanha
 *     os temas claro e escuro sem um segundo arquivo;
 *   - escala com a tipografia (o tamanho é em `em`, não em px), então continua
 *     alinhado ao wordmark se a fonte do header mudar;
 *   - não gera requisição nenhuma. São ~200 bytes dentro do HTML que já ia ser
 *     baixado.
 *
 * `aria-hidden`: o "O" é uma LETRA desenhada, não uma imagem com conteúdo. Quem
 * anuncia a marca é o `aria-label` do link que envolve o wordmark — sem isso, o
 * leitor de tela leria "imagem, rtus Pixel". `focusable="false"` existe para o
 * Internet Explorer/Edge legado, que insere SVG na ordem de tabulação.
 */

import { PIXEL_O_SIZE, pixelOPath } from '@/lib/brand-mark';

/**
 * Calculado UMA VEZ no carregamento do módulo, e não a cada render: o desenho é
 * constante, e um componente que aparece em todas as páginas não deveria
 * recalcular a mesma string a cada requisição.
 */
const PATH = pixelOPath();
const VIEW_BOX = `0 0 ${PIXEL_O_SIZE} ${PIXEL_O_SIZE}`;

export function PixelO({ className = 'logo__o' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={VIEW_BOX}
      aria-hidden="true"
      focusable="false"
      /* Em desenho pixelado, o antialiasing é o inimigo: ele arredonda a borda
         de cada célula e transforma o quadrado em bolinha nos tamanhos
         pequenos. `crispEdges` desliga isso e mantém a aresta reta. */
      shapeRendering="crispEdges"
    >
      <path d={PATH} />
    </svg>
  );
}
