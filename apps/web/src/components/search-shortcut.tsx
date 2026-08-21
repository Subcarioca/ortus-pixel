'use client';

/**
 * =============================================================================
 * ATALHO "/" PARA A BUSCA DO CABEÇALHO
 * =============================================================================
 *
 * Componente separado de `search-form.tsx`, DE PROPÓSITO: aquele formulário é
 * comentado, no próprio cabeçalho, como "componente de servidor, sem uma linha
 * de JavaScript" — a busca funciona antes de qualquer script carregar, e
 * continua funcionando se um script quebrar. Colocar o atalho de teclado ALI
 * dentro exigiria transformar o formulário inteiro em Client Component só
 * para ganhar uma tecla de atalho, trocando uma garantia real por uma
 * conveniência. Este componente, montado ao lado (`site-header.tsx`), é puro
 * acréscimo: se o script não carregar, a busca continua exatamente como
 * sempre foi — clique na lupa, Enter no campo.
 *
 * NÃO RENDERIZA NADA (`return null`): é só o `useEffect` do listener. Focar
 * `#busca-header` pelo id em vez de guardar uma ref é o que permite isto viver
 * fora do `<form>` sem precisar repassar ref através de `search-form.tsx`.
 */

import { useEffect } from 'react';

export function SearchShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return;
      // Atalhos do próprio navegador (Ctrl+/, Cmd+/ etc.) não são nossos.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // Já digitando em algum campo (este ou outro — a página de busca tem o
      // seu próprio `#busca-pagina`, por exemplo): "/" deve virar caractere,
      // não atalho. `isContentEditable` cobre o editor de blocos do painel.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const field = document.getElementById('busca-header');
      if (!(field instanceof HTMLInputElement)) return;

      event.preventDefault();
      field.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
