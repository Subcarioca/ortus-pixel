'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTE_PREFIXES, routes } from '@subcarioca/core';

/**
 * Navegação inferior fixa (mobile).
 *
 * Justificativa do design, que é ergonômica e não estética: "O público-alvo usa
 * o celular com uma mão; menu hambúrguer no topo tem custo motor alto e esconde
 * a seção mais valiosa do site."
 *
 * Some a partir de 768px via CSS — no desktop, o cabeçalho já dá conta.
 *
 * RE-SKIN v0.3: o design estiliza os itens por ELEMENTO (`.bottom-nav a`), sem
 * classe intermediária. A versão anterior usava `.bottom-nav__item`, que não
 * existe na folha de estilo — os links ficavam sem o `display:grid`, sem o
 * tamanho de 21px do ícone e sem o estado `aria-current`. Tirar a classe é,
 * literalmente, o conserto.
 *
 * --------------------------------------------------------------------------
 * VIROU CLIENT COMPONENT — e o motivo é `aria-current`, não interatividade.
 * --------------------------------------------------------------------------
 * O CSS já sabia destacar a aba ativa (`.bottom-nav a[aria-current="page"]`),
 * mas nenhum `<Link>` aqui setava o atributo: a barra inteira aparentava
 * sempre estar "em Home", em toda página do site. Descobrir a rota atual não
 * existe em Server Component (mesma limitação documentada em
 * `adsense-loader.tsx` e `header-nav.tsx`), e este componente é pequeno o
 * bastante (5 links, zero busca a banco) para o custo de `usePathname` ser
 * desprezível — ao contrário do cabeçalho, não fazia sentido separar isto num
 * arquivo-satélite só para manter uma casca de Server Component vazia.
 *
 * --------------------------------------------------------------------------
 * DOIS LINKS CORRIGIDOS (relatório de UX)
 * --------------------------------------------------------------------------
 * "Editorias" apontava para `/categoria/games` — ou seja, não era um menu de
 * editorias, era um atalho hardcoded para Games. Agora leva para `/editorias`,
 * a vitrine das 6 editorias (`app/editorias/page.tsx`).
 *
 * "Meus hubs" apontava para `routes.franchise('gta')` — a franquia de GTA,
 * sempre, para todo mundo. Agora leva para `/minha-conta#conta-seguindo`, a
 * âncora da seção "Universos que você segue" — onde vivem os universos que o
 * leitor de fato segue (ver `minha-conta/page.tsx`). É a mesma página que a
 * aba "Conta" (routes.account()), só que direto na seção relevante: as duas
 * abas convergem para /minha-conta porque hoje é o único destino real que a
 * conta do leitor tem — não há uma tela separada de "hubs" no produto ainda.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <Link href={routes.home()} aria-current={pathname === routes.home() ? 'page' : undefined}>
        <span className="ico" aria-hidden="true" />
        Home
      </Link>
      {/* `.ico-hot` pinta a chama com `--heat-hot`: é o único item colorido da
          barra, porque "Em alta" é a página-manifesto do produto. */}
      <Link
        href={routes.trending()}
        aria-current={pathname === routes.trending() ? 'page' : undefined}
      >
        <span className="ico ico-hot" aria-hidden="true" />
        Em alta
      </Link>
      {/*
        Acende também dentro de qualquer página de categoria (`/categoria/*`):
        é o mesmo raciocínio de `header-nav.tsx` — quem está lendo Games ainda
        está, editorialmente, "dentro" da navegação por editoria.
      */}
      <Link
        href={routes.editorias()}
        aria-current={
          pathname === routes.editorias() ||
          pathname === ROUTE_PREFIXES.category ||
          pathname?.startsWith(`${ROUTE_PREFIXES.category}/`)
            ? 'page'
            : undefined
        }
      >
        <span className="ico" aria-hidden="true" />
        Editorias
      </Link>
      {/*
        Aponta para a seção "Universos que você segue" de /minha-conta (âncora
        `#conta-seguindo`, ver `minha-conta/page.tsx`) — os hubs de verdade que
        o leitor segue. Antes ia para `routes.franchise('gta')`: a franquia de
        GTA, sempre, para todo mundo, sem relação com o que a pessoa de fato
        acompanha.
      */}
      <Link
        href={`${routes.account()}#conta-seguindo`}
        aria-current={pathname === routes.account() ? 'page' : undefined}
      >
        <span className="ico" aria-hidden="true" />
        Meus hubs
      </Link>
      {/* Passou a apontar para a área do leitor de verdade. Antes levava à
          landing da newsletter — o destino possível quando "conta" ainda não
          existia no produto, e que agora seria uma promessa quebrada. */}
      <Link
        href={routes.account()}
        aria-current={pathname === routes.account() ? 'page' : undefined}
      >
        <span className="ico" aria-hidden="true" />
        Conta
      </Link>
    </nav>
  );
}
