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
 * ⚠ DESDE O REDESENHO DE 2026-08, NINGUÉM PASSA `sticky` — e isso é
 * intencional, não esquecimento. A página de matéria perdeu a barra lateral
 * (ver app/[categoria]/[slug]/page.tsx): um índice grudado na tela ao lado do
 * texto era um dos elementos que competiam com a leitura, que é justamente o
 * que o redesenho foi feito para eliminar. A propriedade continua existindo
 * porque a variante fixa segue válida para qualquer superfície que volte a ter
 * coluna lateral — uma página de guia longo, por exemplo.
 */

import type { TocEntry } from '@subcarioca/core';

interface ArticleTocProps {
  entries: TocEntry[];
  /** `true` onde houver coluna lateral para o índice acompanhar a rolagem. */
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
