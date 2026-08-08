import Link from 'next/link';

import { routes, type CategoryDefinition } from '@subcarioca/core';

/**
 * Cabeçalho do site.
 *
 * A ordem das editorias no menu NÃO é alfabética: segue a prioridade de
 * negócio (Games > Cinema & Séries > Anime > HQs > Tech > Eventos), que é a
 * mesma ordem de `monitoringPriority` na taxonomia. Como as categorias já vêm
 * ordenadas de `CATEGORIES`, o menu se mantém alinhado à estratégia sozinho —
 * sem ninguém precisar lembrar de atualizar dois lugares.
 *
 * RE-SKIN v0.3 — duas mudanças de vocabulário:
 *
 *  - O logo do HEADER usa a marca curta `O.<b>Pixel</b>` (rebranding visual —
 *    o nome do site continua "Ortus Pixel" em toda parte que não é o wordmark:
 *    `SITE_NAME`, meta tags, JSON-LD, e-mails). O rodapé mantém o nome por
 *    extenso (ver site-footer.tsx) para não perder o "Ortus" de vista. O `<b>`
 *    não é decoração: `.logo b` é o que aplica `--brand-ink` (o carmim
 *    recalibrado na v0.3, AAA como texto nos dois temas). Sem ele, a marca
 *    ficava monocromática no header.
 *  - Os links do menu deixaram de usar `.cat cat--{slug}`. `.cat` é o RÓTULO
 *    de editoria (filete colorido + caixa-alta 10px), pensado para aparecer
 *    dentro de um card, subordinado ao badge de temperatura. Aplicá-lo ao menu
 *    principal dava seis filetes coloridos competindo no topo — exatamente a
 *    hierarquia que o design §2 evita. O protótipo usa `<a>` puro, estilizado
 *    por `.header__nav a`, com o filete de marca só na página atual.
 */
export function SiteHeader({ categories }: { categories: readonly CategoryDefinition[] }) {
  return (
    <header className="header">
      <div className="container header__bar">
        <Link href={routes.home()} className="logo" aria-label="Ortus Pixel — página inicial">
          <span className="logo__dot" aria-hidden="true" />
          O.<b>Pixel</b>
        </Link>

        <nav className="header__nav" aria-label="Editorias">
          {categories.map((category) => (
            <Link key={category.slug} href={routes.category(category.slug)}>
              {category.shortName}
            </Link>
          ))}
        </nav>

        <div className="header__actions">
          {/*
            "Em alta" recebe tratamento de destaque no header porque é a
            página-manifesto do produto: é ela que comunica o diferencial de
            "sabemos o que está bombando agora".
          */}
          <Link href={routes.trending()} className="btn-hot-nav">
            <span className="live-dot" aria-hidden="true" />
            Em alta
          </Link>
        </div>
      </div>
    </header>
  );
}
