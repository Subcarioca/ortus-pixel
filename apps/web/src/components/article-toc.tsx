/**
 * =============================================================================
 * ÍNDICE DA MATÉRIA (`.toc`) — derivado, nunca escrito à mão
 * =============================================================================
 *
 * O `.toc` já existia na folha de estilo do design e nunca foi usado, porque só
 * apareceria se alguém montasse a lista manualmente no corpo do texto — o que
 * significa, na prática, nunca. Aqui ele nasce dos TÍTULOS: dos blocos `titulo`
 * nas matérias novas, dos `##` do Markdown nas antigas. Uma matéria ganha índice
 * por ter sido bem estruturada, e não por alguém ter lembrado.
 *
 * REGRA DE EXIBIÇÃO: mínimo de 2 entradas (aplicada em `blocksToToc`). Um índice
 * de um item só ocupa espaço acima da dobra para oferecer um salto que a rolagem
 * já resolve — é ruído com aparência de recurso.
 *
 * NÃO é sticky por conta própria: a variante fixa (`.toc--sticky`) é aplicada
 * por quem renderiza.
 *
 * ⚠ `sticky` NÃO SIGNIFICA "grude agora". Significa "este índice está dentro de
 * um trilho que pode grudar". Quem decide se a grudada acontece é o CSS, e ele
 * só a liga a partir de 1480px de largura — abaixo disso o mesmo elemento
 * continua em fluxo, dentro da coluna de texto (ver ortuspixel.css §19.2). Essa
 * divisão existe para que o HTML tenha UM índice só: duas cópias alternadas por
 * `display:none` fariam um leitor de tela anunciar o sumário duas vezes.
 *
 * A regra vale para o modificador porque ele é inerte fora do trilho: fora de
 * `.article-toc-rail`, `.toc--sticky` não casa com regra nenhuma.
 */

import type { TocEntry } from '@subcarioca/core';

interface ArticleTocProps {
  entries: TocEntry[];
  /** `true` quando o índice está dentro de um trilho que acompanha a rolagem. */
  sticky?: boolean;
}

export function ArticleToc({ entries, sticky = false }: ArticleTocProps) {
  if (entries.length === 0) return null;

  return (
    // `<nav>` porque é navegação dentro da página: o leitor de tela lista os
    // pontos de referência e a pessoa pula direto para o índice.
    <nav className={`toc${sticky ? ' toc--sticky' : ''}`} aria-labelledby="toc-titulo">
      {/*
        `<h2>` com a CLASSE do rótulo, e não um `<p class="toc__label">` como no
        protótipo: a seção é rotulada por ele (`aria-labelledby`) e precisa entrar
        no sumário de headings. A classe carrega a aparência; o elemento, a
        semântica. É a mesma ponte já usada no `.tldr__label`.
      */}
      <h2 id="toc-titulo" className="toc__label">
        Neste texto
      </h2>
      <ol>
        {entries.map((entry) => (
          // Os h3 recebem recuo por classe, e não por lista aninhada: aninhar
          // `<ol>` dentro de `<li>` exigiria reconstruir a hierarquia a partir de
          // uma lista plana, e um h3 sem h2 antes (que acontece) produziria
          // marcação inválida.
          <li key={entry.anchor} className={entry.nivel === 3 ? 'toc__sub' : undefined}>
            <a href={`#${entry.anchor}`}>{entry.texto}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
