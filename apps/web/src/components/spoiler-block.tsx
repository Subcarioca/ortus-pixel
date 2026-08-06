'use client';

/**
 * =============================================================================
 * BLOCO DE SPOILER — revelação por escolha
 * =============================================================================
 *
 * "Prevenção de erro" no sentido literal da heurística de Nielsen, aplicada a
 * um problema muito real do público de séries e anime: ler acidentalmente um
 * spoiler é um dano que não se desfaz, e é o tipo de experiência que faz o
 * leitor abandonar um veículo para sempre.
 *
 * IMPLEMENTAÇÃO CORRETA (e o erro comum): o conteúdo fica escondido por CSS
 * (blur + `aria-hidden`), mas continua no HTML. Isso é proposital:
 *   - o Google indexa o texto normalmente (não perdemos SEO);
 *   - a revelação é instantânea, sem nova requisição.
 *
 * O erro comum seria carregar o conteúdo só após o clique, o que esconderia o
 * texto também do buscador e mataria o tráfego orgânico da matéria.
 */

import { useState } from 'react';

export function SpoilerBlock({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return <>{children}</>;
  }

  return (
    <div className="spoiler">
      {/*
        `.spoiler__label` é a tarja laranja (token `--spoiler`, que é uma cor
        SEMÂNTICA própria — não é o vermelho de urgência nem o carmim de marca,
        justamente para não ser confundida com temperatura editorial).
      */}
      <p className="spoiler__label">Atenção: esta matéria contém spoilers</p>

      {/*
        `data-hidden` é o que aciona o blur no CSS do design — estado no
        atributo, estilo na folha. O React controla o dado; o CSS decide a
        aparência. Nenhum `style` inline, nada de classe condicional.

        `aria-hidden` + `inert` garantem que leitores de tela e navegação por
        teclado NÃO alcancem o conteúdo borrado. Sem isso, o blur enganaria
        apenas quem enxerga — e um usuário de leitor de tela ouviria o spoiler
        completo, o que seria uma falha de acessibilidade grave.
      */}
      <div className="spoiler__body" data-hidden="true" aria-hidden="true" inert>
        {children}
      </div>

      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="btn btn--ghost btn--sm spoiler__reveal"
      >
        Mostrar mesmo assim
      </button>
    </div>
  );
}
