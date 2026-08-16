'use client';

/**
 * =============================================================================
 * MENU DE EDITORIAS DO TABLET/MOBILE — o botão hambúrguer que faltava
 * =============================================================================
 *
 * O GAP QUE ISTO FECHA: `.bottom-nav` (menu inferior mobile) some a partir de
 * 768px; `.header__nav` (menu de editorias do cabeçalho) só aparece a partir
 * de 1024px. Entre os dois breakpoints não havia NENHUM jeito de trocar de
 * editoria — o tablet inteiro ficava sem navegação por editoria.
 *
 * O botão `.nav-toggle` já existia no protótipo (`design/index.html`), com o
 * CSS de ocultação em desktop já em produção (`.nav-toggle { display: none }`
 * a partir de 1024px, em ortuspixel.css). O que faltava era o componente em
 * si: o protótipo nunca chegou a desenhar o painel que o botão deveria abrir
 * — é um `<button>` sem `onclick`, sem drawer, sem nada. Este arquivo é essa
 * peça que faltava.
 *
 * POR QUE É UM COMPONENTE DE CLIENTE À PARTE (e não dentro de `site-header.tsx`):
 * precisa de estado (aberto/fechado) e de `usePathname` — nem um nem outro
 * existem em Server Component. Isolar isso num arquivo próprio mantém
 * `SiteHeader` como Server Component cacheado como HTML estático (mesmo
 * raciocínio de `adsense-loader.tsx` e `header-nav.tsx`): só este botão e o
 * painel que ele controla carregam JavaScript, não o cabeçalho inteiro.
 *
 * O painel também marca `aria-current="page"` nos links (mesma técnica de
 * `header-nav.tsx`) — é o mesmo menu de editorias, só que em formato de
 * gaveta, então a mesma informação de "onde eu estou" faz sentido aqui.
 *
 * DECISÕES DE ACESSIBILIDADE:
 *   - `inert` (e não `hidden`) no painel fechado: `hidden` tiraria o painel do
 *     layout instantaneamente, e a transição de fechamento (deslizar para
 *     fora) nunca chegaria a rodar. `inert` impede foco e leitura por leitor
 *     de tela sem remover o elemento do fluxo, então a transição CSS continua
 *     funcionando nos dois sentidos.
 *   - Esc fecha e devolve o foco ao botão que abriu (Nielsen #3: controle e
 *     liberdade).
 *   - O `<body>` trava a rolagem enquanto o painel está aberto, para não dar
 *     a impressão de que a página por trás continua interativa.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { routes, type CategoryDefinition } from '@subcarioca/core';

export function NavDrawer({ categories }: { categories: readonly CategoryDefinition[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fecha sozinho quando a rota muda: sem isso, escolher uma editoria pelo
  // próprio drawer deixaria o painel aberto por cima da página de destino.
  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    // Trava a rolagem do fundo enquanto o painel está aberto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Esc fecha e devolve o foco ao botão — sem isso, quem navega por teclado
    // fica preso dentro do painel sem saber como sair.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    // O foco parte do título do painel: quem abre por teclado ou leitor de
    // tela é avisado de onde caiu, antes de tabular para os links.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="icon-btn nav-toggle"
        aria-label={open ? 'Fechar menu de editorias' : 'Abrir menu de editorias'}
        aria-expanded={open}
        aria-controls="nav-drawer-painel"
        onClick={() => setOpen((value) => !value)}
      >
        {/* `.ico` vazio de propósito: o sprite de ícones do design ainda não
            foi portado para o produto (mesma situação em `site-header.tsx` e
            `bottom-nav.tsx` — ver o comentário sobre isso em
            `site-footer.tsx`). O botão continua utilizável sem ele: tem
            `aria-label` e a mesma área de toque de 40px dos outros
            `.icon-btn`. */}
        <span className="ico" aria-hidden="true" />
      </button>

      {/* Fundo escurecido: fecha o painel ao ser tocado e não existe enquanto
          fechado (`pointer-events: none` no CSS), então nunca captura clique
          por engano. */}
      <div
        className={`nav-drawer__backdrop${open ? ' nav-drawer__backdrop--open' : ''}`}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <div
        id="nav-drawer-painel"
        ref={panelRef}
        className={`nav-drawer${open ? ' nav-drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-drawer-titulo"
        // -1: alvo de foco programático (o painel recebe foco ao abrir), sem
        // entrar na ordem normal de Tab.
        tabIndex={-1}
        inert={!open}
      >
        <div className="nav-drawer__head">
          <h2 id="nav-drawer-titulo" className="nav-drawer__title">
            Editorias
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar menu de editorias"
            onClick={() => setOpen(false)}
          >
            <span className="ico" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Editorias">
          {categories.map((category) => {
            const href = routes.category(category.slug);
            const isActive = pathname === href || pathname?.startsWith(`${href}/`);

            return (
              <Link key={category.slug} href={href} aria-current={isActive ? 'page' : undefined}>
                {category.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
