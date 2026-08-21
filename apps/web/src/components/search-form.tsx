import { routes } from '@subcarioca/core';

/**
 * =============================================================================
 * CAMPO DE BUSCA
 * =============================================================================
 *
 * COMPONENTE DE SERVIDOR, SEM UMA LINHA DE JAVASCRIPT.
 *
 * É um `<form method="get">` apontando para /busca. O navegador monta a URL
 * `/busca?q=termo` sozinho, e isso traz de graça coisas que uma busca em JS
 * teria de reimplementar (quase sempre pior):
 *
 *   - a busca funciona antes de qualquer script carregar, e funciona mesmo se
 *     um script quebrar;
 *   - o resultado tem URL própria: dá para compartilhar, favoritar e voltar;
 *   - o botão "voltar" do navegador se comporta como a pessoa espera;
 *   - Enter submete, porque é um formulário de verdade.
 *
 * `type="search"` (e não `text`): no celular, o teclado vem com a tecla "buscar"
 * no lugar do Enter, e o campo ganha o botão nativo de limpar.
 */
export function SearchForm({
  defaultValue = '',
  variant = 'page',
}: {
  defaultValue?: string;
  /** `header` = versão compacta na barra do topo; `page` = campo largo. */
  variant?: 'header' | 'page';
}) {
  const isHeader = variant === 'header';

  return (
    <form
      // `role="search"` dá ao bloco um marco de navegação: quem usa leitor de
      // tela pula direto para a busca, sem varrer o cabeçalho inteiro.
      role="search"
      action={routes.search()}
      method="get"
      className={isHeader ? 'header__search' : 'form-inline'}
    >
      {/*
        O rótulo existe SEMPRE — no header ele fica visualmente oculto
        (`.sr-only`), porque o contexto visual (a lupa, a posição) já explica o
        campo para quem enxerga. Sem rótulo, um leitor de tela anunciaria apenas
        "caixa de edição", que não diz nada. `placeholder` NÃO é rótulo: some ao
        digitar e não é lido de forma confiável.
      */}
      <label className="sr-only" htmlFor={isHeader ? 'busca-header' : 'busca-pagina'}>
        Buscar no Ortus Pixel
      </label>

      {/*
        `.header__search-field` só existe na variante `header`: é o que dá ao
        `<kbd>` abaixo uma âncora para se posicionar SOBRE o campo (canto
        direito, dentro da pílula), em vez de flutuar como mais um item solto
        na linha entre o campo e o botão de lupa.
      */}
      <div className={isHeader ? 'header__search-field' : undefined}>
        <input
          id={isHeader ? 'busca-header' : 'busca-pagina'}
          className="input"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Buscar matérias e universos"
          // 80 = o mesmo teto aplicado no servidor (`normalizeSearchTerm`).
          // Barrar aqui também é conveniência, não segurança: a validação que
          // vale é sempre a do servidor, porque esta pode ser contornada.
          maxLength={80}
          autoComplete="off"
        />

        {/*
          DICA VISUAL DO ATALHO "/" — markup estático, sem JavaScript nenhum:
          quem de fato ESCUTA a tecla é `search-shortcut.tsx`, montado à parte
          em `site-header.tsx` (ver o cabeçalho daquele componente para o
          motivo de não estar aqui dentro). Esta é só a pista visual de que o
          atalho existe; sem o script, ela continua aparecendo — só deixa de
          fazer nada ao ser pressionada, o que é exatamente o comportamento
          de sempre. `aria-hidden`: um leitor de tela já está DENTRO do campo
          quando chega aqui, não precisa ouvir "barra" no meio do formulário.
        */}
        {isHeader && (
          <kbd className="header__search-hint" aria-hidden="true">
            /
          </kbd>
        )}
      </div>

      <button type="submit" className={isHeader ? 'icon-btn' : 'btn btn--primary'}>
        {isHeader ? <span className="ico" aria-hidden="true" /> : 'Buscar'}
        {isHeader && <span className="sr-only">Buscar</span>}
      </button>
    </form>
  );
}
