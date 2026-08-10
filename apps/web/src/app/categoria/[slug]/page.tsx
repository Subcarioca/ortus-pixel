/**
 * =============================================================================
 * PÁGINA DE CATEGORIA — /categoria/{slug}
 * =============================================================================
 *
 * Categorias são entidades de primeira classe com URL estável (requisito de
 * SEO do briefing).
 *
 * DECISÃO DE ORDENAÇÃO: a grade é CRONOLÓGICA, não por score. Justificativa do
 * design: "Ordenar por score dentro da categoria confundiria o leitor que vai
 * lá justamente para ver o que saiu hoje." Quem quer ordem por score tem a
 * página /em-alta e a sidebar "Em alta em Games".
 *
 * -----------------------------------------------------------------------------
 * RE-SKIN v0.3
 * -----------------------------------------------------------------------------
 *   .section__dek → .section-sub    ·  .cd-box → .side-box
 *   .cd-box__list → .side-list      ·  .rank-list__* → .rank__*
 *
 * A sub-navegação (Tudo / Hardware) deixou de ser uma fileira de `.chip` e
 * passou a ser `.tabs`, que é o componente do protótipo para este papel. Não é
 * troca de gosto: `.chip` é um FILTRO (estado ligado/desligado dentro da mesma
 * página, `aria-pressed`) e `.tabs` é NAVEGAÇÃO entre páginas distintas
 * (`aria-current="page"`, com filete de marca embaixo do item ativo). Aqui
 * cada item é uma URL própria — logo, aba. Usar chip ensinava a gramática
 * errada ao leitor: ele esperaria filtrar sem sair do lugar.
 */

import type { Metadata } from 'next';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import {
  CATEGORIES,
  type CategorySlug,
  type ContentFormat,
  catModifier,
  heatClass,
  isCategorySlug,
  routes,
  subcategoriesOf,
} from '@subcarioca/core';

import { categoryRailSlot, feedAdSlot } from '@/lib/ads';
import { AdSlot } from '@/components/ad-slot';
import { ArticleCard } from '@/components/article-card';
import { BreadcrumbJsonLd, CollectionJsonLd } from '@/components/json-ld';
import { HeatBar } from '@/components/heat-bar';
import { NewsletterForm } from '@/components/newsletter-form';
import { Pagination } from '@/components/pagination';
import { getCategoryPage } from '@/server/queries';

export const revalidate = 300;

/**
 * Gera as rotas estáticas no build.
 *
 * Como as categorias são poucas e fixas, pré-renderizar todas custa quase nada
 * e garante que a primeira visita já venha da CDN — sem cold start, sem query.
 */
export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ slug: category.slug }));
}

/**
 * SEO editorial por categoria, com o texto homologado no protótipo de design.
 *
 * PRECEDÊNCIA (do mais forte para o mais fraco):
 *   1. `seoTitle` / `seoDescription` da linha no banco — campo do EDITOR, que
 *      pode otimizar sem deploy. Um seed jamais sobrescreve isso.
 *   2. Este mapa — a copy assinada pelo design, para as páginas que existem no
 *      protótipo (hoje: Games, em `design/categoria.html`).
 *   3. O padrão genérico montado a partir de nome e descrição da taxonomia.
 *
 * POR QUE UM MAPA E NÃO UM PADRÃO GENÉRICO PARA TODOS: o título de Games é
 * "Notícias, Trailers e Análises" porque é isso que se busca sobre games.
 * Aplicar a mesma fórmula a HQs ("HQs — Notícias, Trailers e Análises")
 * anunciaria um conteúdo que a editoria não entrega. Título de SEO é promessa;
 * generalizar promessa é como se ganha clique e se perde leitor.
 *
 * O sufixo "| Ortus Pixel" NÃO aparece aqui: quem o acrescenta é o template de
 * título do layout raiz.
 */
const CATEGORY_SEO: Partial<Record<CategorySlug, { title: string; description: string }>> = {
  games: {
    title: 'Games — Notícias, Trailers e Análises',
    description:
      'Notícias, análises e guias de games: lançamentos, patches, rumores e o que está bombando agora. Atualizado em tempo real.',
  },
};

/**
 * No Next 15, `params` é uma Promise (mudança para suportar renderização
 * parcial). Por isso o `await` antes de usar.
 */
/**
 * Sub-abas por FORMATO.
 *
 * O README §1 previa `/games/analises`, `/games/trailers`, `/games/guias`; a
 * implementação usa `?formato=` em vez de segmento de URL, e o motivo está em
 * `core/routes.ts`: formato é um RECORTE do mesmo acervo, e uma URL indexável
 * por recorte criaria páginas quase idênticas competindo entre si na mesma
 * consulta de busca. Sub-CATEGORIA (Hardware) é acervo próprio e por isso ganha
 * segmento de verdade.
 *
 * A lista é curta de propósito: são os três recortes que o leitor de fato
 * procura por nome ("análise de X", "trailer de Y", "guia de Z"). Oferecer as
 * oito opções de `CONTENT_FORMATS` transformaria a linha de abas num menu.
 */
const FORMAT_TABS: { value: ContentFormat; label: string }[] = [
  { value: 'review', label: 'Análises' },
  { value: 'trailer', label: 'Trailers' },
  { value: 'guide', label: 'Guias' },
];

/** Query string aceita na URL. Qualquer outro valor é tratado como ausente. */
function parseFormatFilter(value: unknown): ContentFormat | null {
  return FORMAT_TABS.some((tab) => tab.value === value) ? (value as ContentFormat) : null;
}

/** Página lida da URL. Valor inválido (0, -3, "abc", 10^9) vira 1. */
function parsePage(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isCategorySlug(slug)) return {};

  const query = await searchParams;
  const page = parsePage(query.pagina);

  const data = await getCategoryPage(slug, page, parseFormatFilter(query.formato));
  if (!data) return {};

  const { category } = data;

  const designSeo = CATEGORY_SEO[slug];

  const baseTitle =
    category.seoTitle ??
    designSeo?.title ??
    `${category.name} — notícias, lançamentos e novidades`;

  return {
    // O número da página entra no TÍTULO das páginas internas. Sem isso, o
    // Search Console reporta "títulos duplicados" para a editoria inteira — e,
    // pior, quem vê duas linhas idênticas no histórico do navegador não sabe
    // qual abrir.
    title: page > 1 ? `${baseTitle} — página ${page}` : baseTitle,
    description: category.seoDescription ?? designSeo?.description ?? category.description,
    // Canonical explícito evita que variações com query string (?formato=...,
    // ?utm_source=...) sejam indexadas como páginas distintas e diluam a
    // autoridade entre duplicatas.
    alternates: { canonical: routes.category(slug) },
    openGraph: {
      title: category.name,
      description: category.description,
      type: 'website',
      url: routes.category(slug),
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;

  // Valida o slug contra a lista fechada ANTES de tocar no banco. Barra
  // qualquer string vinda da URL de saída.
  if (!isCategorySlug(slug)) notFound();

  const query = await searchParams;
  const page = parsePage(query.pagina);
  const formatFilter = parseFormatFilter(query.formato);

  const data = await getCategoryPage(slug, page, formatFilter);
  if (!data) notFound();

  const { category, articles, trending, upcomingReleases, totalPages } = data;
  const subcategories = subcategoriesOf(slug);
  const railSlot = categoryRailSlot();

  /**
   * PÁGINA VAZIA POR NÚMERO ALTO DEMAIS RESPONDE 404.
   *
   * Sem isso, `?pagina=900` devolveria 200 com uma listagem vazia — e o Google
   * indexaria infinitas páginas em branco da mesma editoria, cada uma delas
   * diluindo a autoridade das que têm conteúdo. A primeira página é exceção: uma
   * editoria recém-criada sem matéria nenhuma é um estado legítimo, com texto
   * próprio ("Ainda não publicamos nada nesta editoria").
   */
  if (page > 1 && articles.length === 0) notFound();

  /** Monta a URL preservando o outro filtro. */
  const hrefFor = (target: number) => {
    const search = new URLSearchParams();
    if (formatFilter) search.set('formato', formatFilter);
    if (target > 1) search.set('pagina', String(target));
    const qs = search.toString();
    return qs ? `${routes.category(slug)}?${qs}` : routes.category(slug);
  };

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: category.name, url: routes.category(slug) },
        ]}
      />
      <CollectionJsonLd
        name={category.name}
        description={category.description}
        url={routes.category(slug)}
        items={articles.map((a) => ({ title: a.title, url: a.url }))}
      />

      <div className="container">
        {/* Filete de 3px na cor da editoria (design §3).
            `catModifier` — e não `cat--${slug}` cru. O slug da URL é longo por
            causa da busca (`cinema-e-series`, `anime-e-manga`, `hqs`), enquanto
            o design nomeia a editoria pela palavra curta (`cinema`, `anime`,
            `hq`). Escrevendo o slug direto, três das seis editorias apontavam
            para uma classe inexistente, `--c` ficava indefinida e o filete caía
            no fallback carmim: metade do site tinha perdido a cor da editoria
            sem nada quebrar. Ver CATEGORY_DESIGN_TOKEN em core/presentation.ts. */}
        <header className={`editoria-head ${catModifier(slug)}`}>
          <div>
            <h1 className="article__title">{category.name}</h1>
            <p className="section-sub">{category.description}</p>
          </div>
        </header>

        {/*
          ABAS DE SUB-SEÇÃO (hoje: Hardware dentro de Tech).

          São LINKS para URLs próprias, e não filtros por query string. A
          distinção está explicada em core/routes.ts: sub-seção é acervo
          próprio com intenção de busca distinta; formato é recorte do mesmo
          acervo. A aba só aparece nas editorias que têm sub-seção — nas
          demais, `subcategoriesOf` devolve lista vazia e nada é renderizado.

          O item ativo é um <a> para a própria página, e não um <span>: manter o
          elemento clicável em todos os estados evita que a linha "pule" de
          largura ao navegar e dá ao leitor um caminho de volta previsível.
        */}
        <nav className="tabs" aria-label={`Seções de ${category.name}`}>
          {/* "Tudo" só é a aba ativa quando NÃO há filtro de formato. Antes ela
              era marcada como `aria-current` incondicionalmente — o que dizia ao
              leitor de tela que a página atual era a lista completa mesmo quando
              o leitor estava vendo só os trailers. */}
          <Link
            href={routes.category(slug)}
            {...(formatFilter === null ? { 'aria-current': 'page' as const } : {})}
          >
            Tudo
          </Link>

          {/* Sub-SEÇÕES vêm antes dos formatos: são acervos próprios (hierarquia),
              enquanto formato é recorte (filtro). A ordem comunica essa diferença
              sem precisar de rótulo. */}
          {subcategories.map((sub) => (
            <Link key={sub.slug} href={routes.subcategory(slug, sub.slug)}>
              {sub.name}
            </Link>
          ))}

          {FORMAT_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={routes.categoryFiltered(slug, tab.value)}
              {...(formatFilter === tab.value ? { 'aria-current': 'page' as const } : {})}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="container layout-2col">
        <div>
          {articles.length === 0 ? (
            <p className="empty-state">
              {/* O texto muda com o FILTRO. "Ainda não publicamos nada nesta
                  editoria" seria falso numa editoria cheia em que só o recorte
                  de trailers está vazio — e mandaria o leitor embora do site
                  quando o que ele precisa é tirar o filtro. */}
              {formatFilter
                ? `Nenhuma matéria de ${category.name} neste formato ainda.`
                : 'Ainda não publicamos nada nesta editoria. Volte em breve.'}
              {formatFilter && (
                <Link href={routes.category(slug)} className="link-more">
                  Ver tudo de {category.name}
                </Link>
              )}
            </p>
          ) : (
            // Duas colunas a partir de 640px — a grade de categoria do
            // protótipo. Antes era `.grid` puro, que no design não define
            // coluna nenhuma: a categoria inteira saía empilhada no desktop.
            <div className="grid g-sm-2">
              {articles.slice(0, 6).map((item, index) => (
                <ArticleCard
                  key={item.id}
                  item={item}
                  variant="grid"
                  // Só a primeira imagem é prioritária: é a candidata a LCP.
                  priority={index === 0}
                />
              ))}
            </div>
          )}

          {/* Newsletter SEGMENTADA no meio da grade: proposta específica
              converte melhor que a genérica (design §3). */}
          {articles.length > 6 && (
            <>
              <div className="section">
                <NewsletterForm
                  title={`Só o que importa de ${category.name}`}
                  description={`Receba as novidades de ${category.name} direto no seu e-mail.`}
                  source={`categoria-${slug}`}
                  variant="inline"
                />
              </div>

              {/* SLOT IN-FEED a cada 6 cards (design §7.1, linha "Categoria").
                  O índice usado é o ABSOLUTO na listagem, e não o da fatia:
                  reiniciar a contagem aqui colocaria o primeiro anúncio logo
                  abaixo da newsletter, empilhando dois blocos não editoriais.
                  Como a grade tem 2 colunas, um slot a cada 6 cai sempre no
                  começo de uma linha nova — a "linha completa" que a regra pede. */}
              <div className="grid g-sm-2">
                {articles.slice(6).map((item, index) => {
                  const adSlot = feedAdSlot(index + 6);
                  return (
                    <Fragment key={item.id}>
                      {adSlot && <AdSlot slot={adSlot} />}
                      <ArticleCard item={item} variant="grid" />
                    </Fragment>
                  );
                })}
              </div>
            </>
          )}

          {/* PAGINAÇÃO REAL — a editoria deixou de despejar o acervo inteiro
              numa página só. Ver o cabeçalho de `components/pagination.tsx`
              para o motivo de não ser rolagem infinita. */}
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={hrefFor}
            label={`Páginas de ${category.name}`}
          />
        </div>

        <aside className="sidebar">
          {trending.length > 0 && (
            /* `.side-sticky` acompanha a rolagem: é a caixa que o leitor usa
               para pular para outra matéria da mesma editoria, e ela só serve
               se continuar ao alcance enquanto ele desce a grade. */
            <section className="side-box side-sticky">
              <h2>Em alta em {category.name}</h2>
              {/* `--dense` é a variante de sidebar do ranking: sem fundo
                  próprio (a caixa já tem um) e com padding reduzido. */}
              <ol className="rank-list rank-list--dense">
                {trending.map((item, index) => (
                  <li key={item.id}>
                    <Link href={item.url} className={heatClass('rank', item.heat)}>
                      <span className="rank__pos">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <span className="rank__title">{item.title}</span>
                      </span>
                      {/* Só o termômetro à direita: na largura de 320px da
                          sidebar, badge + tendência + barra brigariam pelo
                          espaço e quebrariam a linha do título. */}
                      <HeatBar heat={item.heat} level={item.heatLevel} size="sm" />
                    </Link>
                  </li>
                ))}
              </ol>
              <Link href={routes.trending()} className="link-more">
                Ranking geral
              </Link>
            </section>
          )}

          {/* Conecta a categoria ao calendário de lançamentos — o MESMO dado
              que alimenta o sinal de sazonalidade do score. Um insumo, dois usos. */}
          {upcomingReleases.length > 0 && (
            <section className="side-box">
              <h2>Próximos lançamentos</h2>
              <ul className="side-list side-list--rows">
                {upcomingReleases.map((release) => (
                  <li key={release.title}>
                    <span>
                      {release.title}
                      {!release.isConfirmed && (
                        <span className="form-hint"> data não confirmada</span>
                      )}
                    </span>
                    <time dateTime={release.releaseDate.toISOString()}>
                      {release.releaseDate.toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ÚLTIMO box da barra lateral, sempre — depois do ranking e dos
              lançamentos. A ordem é a regra 2 do design §7.0: o comercial nunca
              precede o editorial na coluna. `sticky` acompanha a rolagem da
              grade, que é longa. */}
          {railSlot && <AdSlot slot={railSlot} sticky />}
        </aside>
      </div>
    </>
  );
}
