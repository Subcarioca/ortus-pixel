'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ROUTE_PREFIXES, routes } from '@subcarioca/core';

import { NavIcon, PersonIcon } from './nav-icons';

/**
 * =============================================================================
 * ÍCONES DA BARRA INFERIOR (Tarefa B do relatório de UX 2026-08)
 * =============================================================================
 *
 * Antes deste ajuste, `<span className="ico" aria-hidden="true" />` não
 * desenhava NADA: `.ico` (ortuspixel.css) só reserva o tamanho da caixa
 * (`width`/`height`), sem `background`, `border` ou `content` — um `<span>`
 * vazio nessas condições é, literalmente, um retângulo transparente. As 5
 * abas ficavam só com o rótulo de texto.
 *
 * IMPORTANTE — o pedido original supunha que `.ico-hot` (aba "Em alta") já
 * desenhava uma chama, e pediu para não mexer nela. Ao ler o CSS, a regra
 * inteira é `.bottom-nav .ico-hot { color: var(--heat-hot); }` — só a COR;
 * sem forma própria, ela sofria do mesmo problema das outras quatro. Manter
 * essa aba sem ícone enquanto as outras quatro ganhavam símbolo criaria uma
 * inconsistência pior do que a atual (uma aba "quebrada" no meio das outras),
 * então ela também recebeu um traçado — mas SEM tocar na regra de cor que já
 * existia (`--heat-hot` continua sendo o que diferencia esta aba: é a única
 * colorida da barra). Ver `.ico-hot` em ortuspixel.css: nada nela mudou.
 *
 * Os 5 símbolos são SVG inline (sem lib de ícone nova, como pedido) e
 * compartilham o mesmo "molde" (`NavIcon`, importado de `./nav-icons` — saiu
 * daqui quando `site-header.tsx` passou a precisar do símbolo de "Conta" no
 * desktop, ver o cabeçalho daquele módulo): mesmo viewBox, mesma espessura de
 * traço, mesmas pontas arredondadas, sem preenchimento. Isso é o que garante
 * peso visual igual entre eles — nenhum ícone "grita" mais que o outro. A cor
 * não é fixa no SVG: vem de `color` via `stroke="currentColor"`, então o CSS
 * que já existia (`.bottom-nav a[aria-current="page"] .ico`, `.ico-hot`)
 * continua controlando a cor sem precisar de nada novo.
 */
/** Home — casa, o símbolo mais direto para "página inicial". */
function HomeIcon({ className }: { className?: string }) {
  return (
    <NavIcon className={className}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10v8.5a1 1 0 0 0 1 1H10v-5.5h4V19.5h2.5a1 1 0 0 0 1-1V10" />
    </NavIcon>
  );
}

/**
 * Em alta — chama. Único ícone com contorno curvo em vez de linhas retas: é
 * a forma que qualquer leitor reconhece como "fogo" sem precisar de rótulo,
 * e por isso vale a exceção ao estilo mais geométrico dos outros quatro — a
 * espessura de traço e o tamanho continuam os mesmos, então o peso visual
 * segue igual, só a silhueta muda.
 */
function FlameIcon({ className }: { className?: string }) {
  return (
    <NavIcon className={className}>
      <path d="M12 2.5c-1.3 3.6-5.5 5.7-5.5 10a5.5 5.5 0 0 0 11 0c0-1.8-.9-3.2-1.8-3.9.3 1.4-.6 2.3-1.4 1.8-.9-.6-.5-1.9.3-3C13.6 6 12.7 4.3 12 2.5Z" />
    </NavIcon>
  );
}

/** Editorias — grade 2x2, o símbolo mais comum para "categorias/seções". */
function GridIcon({ className }: { className?: string }) {
  return (
    <NavIcon className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </NavIcon>
  );
}

/**
 * Meus hubs — estrela, o símbolo universal de "favoritos/salvos". Preferida
 * a coração ou bandeira porque a aba não é só "curtir" (papel do coração,
 * já usado no botão de curtir matéria) nem só editorial (bandeira) — é
 * "o que eu escolhi acompanhar", que é exatamente o que "salvo com estrela"
 * comunica em qualquer app.
 */
function StarIcon({ className }: { className?: string }) {
  return (
    <NavIcon className={className}>
      <path d="M12 3.3 14.5 8.9 20.5 9.6 16 13.6 17.3 19.6 12 16.5 6.7 19.6 8 13.6 3.5 9.6 9.5 8.9Z" />
    </NavIcon>
  );
}

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
        <HomeIcon className="ico" />
        Home
      </Link>
      {/* `.ico-hot` pinta a chama com `--heat-hot`: é o único item colorido da
          barra, porque "Em alta" é a página-manifesto do produto. */}
      <Link
        href={routes.trending()}
        aria-current={pathname === routes.trending() ? 'page' : undefined}
      >
        <FlameIcon className="ico ico-hot" />
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
        <GridIcon className="ico" />
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
        <StarIcon className="ico" />
        Meus hubs
      </Link>
      {/* Passou a apontar para a área do leitor de verdade. Antes levava à
          landing da newsletter — o destino possível quando "conta" ainda não
          existia no produto, e que agora seria uma promessa quebrada. */}
      <Link
        href={routes.account()}
        aria-current={pathname === routes.account() ? 'page' : undefined}
      >
        <PersonIcon className="ico" />
        Conta
      </Link>
    </nav>
  );
}
