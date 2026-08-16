'use client';

/**
 * =============================================================================
 * MENU DE EDITORIAS DO CABEÇALHO — a fatia que precisa saber a rota atual
 * =============================================================================
 *
 * Existe só para poder marcar `aria-current="page"` no link da editoria em que
 * o leitor está. O CSS já sabia fazer isso (`.header__nav a[aria-current="page"]`
 * em ortuspixel.css) — só faltava alguém escrever o atributo.
 *
 * POR QUE ISTO É UM COMPONENTE DE CLIENTE SEPARADO, E NÃO UM `if` DENTRO DE
 * `site-header.tsx`:
 *
 * `SiteHeader` é cacheado como HTML estático — o mesmo motivo pelo qual o
 * botão de conta não sabe se há sessão (ver o comentário longo em
 * `site-header.tsx` sobre isso). Descobrir a rota atual em Server Component
 * exigiria middleware propagando o pathname, e este projeto já decidiu não
 * ter middleware para autorização (ver `server/staff-auth.ts`) — criar um só
 * para isto contrariaria aquela decisão.
 *
 * A saída é a mesma de `adsense-loader.tsx`: isolar SÓ o pedaço que precisa da
 * rota atual num componente de cliente fino, usando `usePathname`. O detalhe
 * que faz isso funcionar sem custo de hidratação visível: `usePathname`
 * resolve no SERVIDOR durante a renderização inicial (é um Client Component,
 * mas o Next ainda o renderiza a HTML na primeira resposta) — então o
 * `aria-current` certo já vem no HTML servido, não só depois do JS rodar.
 *
 * O restante do `<header>` (logo, busca, "Em alta", conta) continua vindo do
 * Server Component `SiteHeader`, sem nenhum JavaScript extra por causa disto.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { routes, type CategoryDefinition } from '@subcarioca/core';

export function HeaderNav({ categories }: { categories: readonly CategoryDefinition[] }) {
  const pathname = usePathname();

  return (
    <nav className="header__nav" aria-label="Editorias">
      {categories.map((category) => {
        const href = routes.category(category.slug);
        // `startsWith` além da igualdade estrita: uma matéria dentro de
        // /categoria/games/artigo-x ainda é "Games" para efeito do menu, e a
        // sub-categoria (/categoria/tech/hardware) também deve acender "Tech".
        const isActive = pathname === href || pathname?.startsWith(`${href}/`);

        return (
          <Link key={category.slug} href={href} aria-current={isActive ? 'page' : undefined}>
            {category.shortName}
          </Link>
        );
      })}
    </nav>
  );
}
