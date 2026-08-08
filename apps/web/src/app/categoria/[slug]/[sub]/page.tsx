/**
 * =============================================================================
 * SUB-SEÇÃO DE CATEGORIA — /categoria/tech/hardware
 * =============================================================================
 *
 * Hoje existe uma sub-seção: Hardware, dentro de Tech. A rota é genérica porque
 * a segunda (se vier) não deve custar um arquivo novo.
 *
 * POR QUE ESTA PÁGINA EXISTE COMO URL PRÓPRIA, e não como filtro em query
 * string (que é o tratamento dado às sub-abas por FORMATO):
 *
 *   /categoria/tech?formato=review  → mesmo acervo, recorte diferente. Uma URL
 *                                     indexável por recorte criaria N páginas
 *                                     quase idênticas competindo entre si.
 *   /categoria/tech/hardware        → ACERVO PRÓPRIO e intenção de busca
 *                                     distinta. "Melhor placa de vídeo
 *                                     custo-benefício" não é a mesma consulta
 *                                     que "notícias de tecnologia". Merece
 *                                     título, descrição e URL próprios.
 *
 * É TAMBÉM A PÁGINA MAIS COMERCIAL DO SITE (design §7.1: "Hardware — densidade
 * máxima"). Isolar o conteúdo de compra aqui é o que permite manter o resto do
 * portal limpo: sem esta separação, a alternativa seria diluir link comercial
 * por todas as editorias.
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .cd-box → .side-box  ·  .section__dek → .section-sub  ·  .grid → .grid.g-sm-2
 *
 * A trilha "Tech › Hardware" saiu do `.form-hint` (que é texto de ajuda de
 * formulário) e virou `.breadcrumb`, o componente do design para exatamente
 * isso — com `<nav aria-label>` e `aria-current` no último item, que é o que
 * faz o leitor de tela anunciar a posição na hierarquia. Também entrou a
 * `.tabs` da editoria pai, para que a sub-seção não pareça um site à parte.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import {
  SUBCATEGORIES,
  catModifier,
  isValidSubcategoryPath,
  routes,
  type CategorySlug,
  type SubcategorySlug,
} from '@subcarioca/core';

import { AdSlot } from '@/components/ad-slot';
import { ArticleCard } from '@/components/article-card';
import { BreadcrumbJsonLd, CollectionJsonLd } from '@/components/json-ld';
import { NewsletterForm } from '@/components/newsletter-form';
import { feedAdSlot } from '@/lib/ads';
import { getSubcategoryPage } from '@/server/queries';

export const revalidate = 300;

/**
 * Pré-renderiza todas as sub-seções no build. São poucas e fixas: custa quase
 * nada e garante que a primeira visita já venha da CDN.
 */
export function generateStaticParams() {
  return SUBCATEGORIES.map((sub) => ({ slug: sub.parent, sub: sub.slug }));
}

/**
 * Copy de SEO das sub-seções que já têm protótipo de design
 * (hoje: Hardware, em `design/categoria-hardware.html`).
 *
 * A descrição foi escrita para uma página de INTENÇÃO DE COMPRA, que é o
 * contrato desta sub-seção: ela promete bancada própria, comparativo de preço e
 * veredito ANTES de qualquer link comercial — nessa ordem. É a mesma sequência
 * que o leitor encontra na página, e é ela que separa "review" de "vitrine".
 *
 * Sem sufixo de marca: o template do layout raiz acrescenta "| Ortus Pixel".
 */
const SUBCATEGORY_SEO: Partial<Record<SubcategorySlug, { title: string; description: string }>> = {
  hardware: {
    title: 'Hardware — Reviews e Guias de Compra',
    description:
      'Placas de vídeo, processadores, monitores e periféricos: reviews com bancada própria, comparativo de preço e veredito fechado antes de qualquer link de compra.',
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; sub: string }>;
}): Promise<Metadata> {
  const { slug, sub } = await params;
  if (!isValidSubcategoryPath(slug, sub)) return {};

  const data = await getSubcategoryPage(slug, sub);
  if (!data) return {};

  const { subcategory } = data;
  const designSeo = SUBCATEGORY_SEO[sub as SubcategorySlug];

  return {
    title: designSeo?.title ?? `${subcategory.name} — reviews, comparativos e guias de compra`,
    description: designSeo?.description ?? subcategory.description,
    alternates: { canonical: routes.subcategory(slug, sub) },
    openGraph: {
      title: `${subcategory.name} · ${subcategory.categoryName}`,
      description: subcategory.description,
      type: 'website',
      url: routes.subcategory(slug, sub),
    },
  };
}

export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ slug: string; sub: string }>;
}) {
  const { slug, sub } = await params;

  /**
   * Valida o PAR (categoria, sub-categoria), não cada um isoladamente.
   *
   * Sem isso, /categoria/games/hardware responderia 200 com a mesma listagem de
   * /categoria/tech/hardware — conteúdo duplicado em N URLs, que dilui
   * autoridade e que o Google pune. É o mesmo cuidado já aplicado ao par
   * (categoria, artigo) na página de artigo.
   */
  if (!isValidSubcategoryPath(slug, sub)) notFound();

  const data = await getSubcategoryPage(slug, sub);
  if (!data) notFound();

  const { subcategory, articles } = data;
  const categorySlug = slug as CategorySlug;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: subcategory.categoryName, url: routes.category(categorySlug) },
          { name: subcategory.name, url: routes.subcategory(slug, sub) },
        ]}
      />
      <CollectionJsonLd
        name={`${subcategory.name} · ${subcategory.categoryName}`}
        description={subcategory.description}
        url={routes.subcategory(slug, sub)}
        items={articles.map((a) => ({ title: a.title, url: a.url }))}
      />

      <div className="container">
        {/* Trilha visível: a pessoa precisa saber que Hardware está DENTRO de
            Tech, senão a sub-seção parece um site à parte. */}
        <nav className="breadcrumb" aria-label="Você está em">
          <Link href={routes.home()}>Home</Link>
          <span aria-hidden="true">›</span>
          <Link href={routes.category(categorySlug)}>{subcategory.categoryName}</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{subcategory.name}</span>
        </nav>

        {/* Mesma correção da página da editoria: o modificador de cor vem de
            `catModifier`, porque o slug da URL nem sempre é o nome que o design
            usa. Aqui a sub-seção herda a cor da editoria-mãe (Hardware é Tech),
            que é justamente o que amarra as duas páginas visualmente. */}
        <header className={`editoria-head ${catModifier(categorySlug)}`}>
          <div>
            <h1 className="article__title">{subcategory.name}</h1>
            <p className="section-sub">{subcategory.description}</p>
          </div>
        </header>

        {/* Mesma `.tabs` da página da editoria, com a sub-seção marcada como
            atual: é ela que amarra Hardware a Tech na cabeça do leitor. */}
        <nav className="tabs" aria-label={`Seções de ${subcategory.categoryName}`}>
          <Link href={routes.category(categorySlug)}>Tudo</Link>
          <Link href={routes.subcategory(slug, sub)} aria-current="page">
            {subcategory.name}
          </Link>
        </nav>
      </div>

      <div className="container layout-2col">
        <div>
          {articles.length === 0 ? (
            <p className="empty-state">
              Ainda não publicamos nada em {subcategory.name}. Volte em breve.
            </p>
          ) : (
            <div className="grid g-sm-2">
              {articles.map((item, index) => (
                <div key={item.id}>
                  <ArticleCard item={item} variant="grid" priority={index === 0} />

                  {/* Slot in-feed a cada 6 cards, sempre depois de uma linha
                      completa da grade (design §7.1). O `feedAdSlot` devolve
                      `null` quando não é a posição certa — e sempre, se não
                      houver Publisher ID configurado. */}
                  {(() => {
                    const slot = feedAdSlot(index + 1);
                    return slot ? <AdSlot slot={slot} /> : null;
                  })()}
                </div>
              ))}
            </div>
          )}

          <div className="section">
            <NewsletterForm
              title={`Ofertas e reviews de ${subcategory.name}`}
              description="Avisamos quando sair review novo ou quando um produto que testamos cair de preço."
              source={`sub-${sub}`}
              variant="inline"
            />
          </div>
        </div>

        <aside className="sidebar">
          {/* A transparência tem lugar fixo na sub-seção mais comercial do
              site. É onde a dúvida "isso é anúncio?" nasce — e a caixa existe
              para sustentar E-E-A-T numa página assumidamente comercial. */}
          <section className="side-box side-sticky">
            <h2>Como testamos</h2>
            <ul className="side-list">
              <li>
                <strong>Compramos ou pedimos emprestado</strong> — não ficamos com
                unidade de review.
              </li>
              <li>
                <strong>Mesma bancada para todos</strong> — trocamos só a peça testada.
              </li>
              <li>
                <strong>Nota antes do preço</strong> — a análise fecha antes de alguém
                olhar comissão.
              </li>
              <li>
                <strong>Nada disso entra no ranking</strong> — a temperatura ignora
                100% da monetização.
              </li>
            </ul>
            <Link href="/politica-de-afiliados" className="link-more">
              Nossa política de afiliados
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}

/** Só para o TypeScript enxergar que `sub` é um slug conhecido. */
export type { SubcategorySlug };
