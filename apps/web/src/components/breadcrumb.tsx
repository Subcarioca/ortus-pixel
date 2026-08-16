/**
 * =============================================================================
 * TRILHA VISÍVEL — Home › Categoria › (Sub-seção | Matéria)
 * =============================================================================
 *
 * Componente compartilhado. Nasceu por extração de
 * `app/categoria/[slug]/[sub]/page.tsx`, que já tinha a trilha certa (nav com
 * `aria-label`, `›` decorativo com `aria-hidden`, item ativo em `aria-current`)
 * — só que só ali. `article-view.tsx` e `app/categoria/[slug]/page.tsx`
 * emitiam a trilha apenas como `<BreadcrumbJsonLd>`, que é dado estruturado
 * para o Google e não aparece para quem lê a página. As duas coisas não se
 * substituem: o JSON-LD é para o buscador, este componente é para a pessoa.
 *
 * O ÚLTIMO ITEM NUNCA É LINK — é a página em que o leitor já está. Marcá-lo
 * como `<span aria-current="page">` (e não `<a>`) é o que faz o leitor de tela
 * anunciar "página atual" em vez de oferecer uma navegação para o mesmo lugar.
 */

import { Fragment } from 'react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  /** Ausente (ou omitido) no último item: ele é a página atual, não um link. */
  href?: string;
  /**
   * Só o último item deve receber isto — é o que trunca com reticências
   * quando o texto (ex.: título de matéria) não cabe na largura disponível,
   * sem cortar o texto quando ele cabe.
   */
  truncate?: boolean;
}

export function Breadcrumb({
  items,
  ariaLabel = 'Você está em',
}: {
  items: BreadcrumbItem[];
  ariaLabel?: string;
}) {
  if (items.length === 0) return null;

  return (
    <nav className="breadcrumb" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 && <span aria-hidden="true">›</span>}
            {isLast || !item.href ? (
              <span
                aria-current="page"
                className={item.truncate ? 'breadcrumb__current' : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
