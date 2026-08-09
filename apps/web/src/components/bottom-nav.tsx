import Link from 'next/link';

import { routes } from '@subcarioca/core';

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
 */
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      <Link href={routes.home()}>
        <span className="ico" aria-hidden="true" />
        Home
      </Link>
      {/* `.ico-hot` pinta a chama com `--heat-hot`: é o único item colorido da
          barra, porque "Em alta" é a página-manifesto do produto. */}
      <Link href={routes.trending()}>
        <span className="ico ico-hot" aria-hidden="true" />
        Em alta
      </Link>
      <Link href={routes.category('games')}>
        <span className="ico" aria-hidden="true" />
        Editorias
      </Link>
      <Link href={routes.franchise('gta')}>
        <span className="ico" aria-hidden="true" />
        Meus hubs
      </Link>
      {/* Passou a apontar para a área do leitor de verdade. Antes levava à
          landing da newsletter — o destino possível quando "conta" ainda não
          existia no produto, e que agora seria uma promessa quebrada. */}
      <Link href={routes.account()}>
        <span className="ico" aria-hidden="true" />
        Conta
      </Link>
    </nav>
  );
}
