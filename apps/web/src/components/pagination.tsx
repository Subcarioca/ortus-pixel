/**
 * =============================================================================
 * PAGINAÇÃO — links de verdade, não rolagem infinita
 * =============================================================================
 *
 * POR QUE NÃO ROLAGEM INFINITA (que é o padrão de Dexerto e ScreenRant):
 *
 *  1. O CRAWLER NÃO ROLA. Conteúdo que só existe depois de um evento de scroll
 *     é, para o buscador, conteúdo que não existe — e a editoria é justamente a
 *     página que distribui autoridade para o acervo antigo.
 *  2. O BOTÃO VOLTAR QUEBRA. Quem abre a 40ª matéria e volta cai no topo, com as
 *     39 anteriores para rolar de novo. É a reclamação nº 1 de qualquer listagem
 *     infinita.
 *  3. NÃO HÁ "FIM". Sem rodapé alcançável, o leitor nunca chega ao que está
 *     abaixo da lista.
 *
 * A URL de cada página é indexável e compartilhável (`?pagina=2`), e o
 * `canonical` da editoria continua apontando para a primeira — que é o que
 * evita as páginas internas competirem entre si na busca.
 *
 * Componente de SERVIDOR: são links, e link não precisa de JavaScript.
 */

import Link from 'next/link';

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Monta a URL de uma página. Quem chama sabe preservar os outros filtros. */
  hrefFor: (page: number) => string;
  label: string;
}

export function Pagination({ page, totalPages, hrefFor, label }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pager" aria-label={label}>
      {/*
        Os extremos são <span>, e não <a> desabilitado: link que não leva a lugar
        nenhum continua sendo anunciado como link pelo leitor de tela e continua
        recebendo foco no teclado. O elemento certo para "esta ação não existe
        agora" é não ter elemento clicável.
      */}
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="btn btn--ghost btn--sm" rel="prev">
          ← Anteriores
        </Link>
      ) : (
        <span className="pager__edge">← Anteriores</span>
      )}

      {/* A posição em texto, e não uma fileira de números. Com paginação de
          números, uma editoria com 30 páginas produz uma linha de 30 links que
          ninguém usa; "Página 2 de 7" responde a mesma pergunta e cabe no
          celular. */}
      <span className="pager__status" aria-current="page">
        Página {page} de {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className="btn btn--ghost btn--sm" rel="next">
          Próximas →
        </Link>
      ) : (
        <span className="pager__edge">Próximas →</span>
      )}
    </nav>
  );
}
