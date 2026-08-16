/**
 * =============================================================================
 * /editorias — vitrine das 6 editorias
 * =============================================================================
 *
 * POR QUE ESTA PÁGINA EXISTE: a aba "Editorias" do menu inferior mobile
 * (`bottom-nav.tsx`) apontava direto para `/categoria/games` — não existia
 * nenhuma página real de "escolha uma editoria". Quem tocava ali caía dentro
 * de Games sem aviso, e nunca via as outras 5.
 *
 * POR QUE É UMA PÁGINA, E NÃO SÓ O DRAWER DO ITEM 1 (`nav-drawer.tsx`):
 * o drawer é um atalho rápido para trocar de editoria a partir de QUALQUER
 * página — ele não precisa (e não deve) explicar o que cada editoria cobre,
 * seria ruído num painel pensado para ser aberto e fechado em segundos. Esta
 * página é o destino oposto: um lugar para CHEGAR e DECIDIR, com a descrição
 * de cada editoria por escrito, e com URL própria — dá para linkar, indexar e
 * voltar a ela pelo histórico do navegador, três coisas que um painel
 * sobreposto não oferece. As duas interfaces resolvem problemas diferentes;
 * manter as duas é menos código do que forçar uma a fazer o papel da outra.
 *
 * Estático de propósito: a lista de editorias muda tão pouco quanto o próprio
 * menu (é o mesmo `CATEGORIES` de `@subcarioca/core`), então não há por que
 * pagar o custo de uma consulta ao banco aqui.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { CATEGORIES, absoluteUrl, catClass, routes } from '@subcarioca/core';

import { BreadcrumbJsonLd } from '@/components/json-ld';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Editorias',
  description:
    'Games, cinema & séries, anime & mangá, HQs, tech e eventos: as 6 editorias que a redação do Ortus Pixel cobre.',
  alternates: { canonical: routes.editorias() },
};

export default function EditoriasPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: 'Editorias', url: absoluteUrl(routes.editorias()) },
        ]}
      />

      <div className="container">
        <header className="hub-hero">
          <h1 className="article__title">Editorias</h1>
          <p className="hub-hero__desc">
            {`Tudo que o ${SITE_NAME} cobre, dividido em 6 frentes. Toque numa editoria para ver as últimas matérias.`}
          </p>
        </header>

        <section className="section" aria-label="Todas as editorias">
          {/*
            `.side-box` é o cartão genérico do design (fundo, borda, raio) —
            já usado para caixas de conteúdo avulso em `/em-alta` e
            `/metodologia`. O TÍTULO é o link (mesmo padrão de `.card__title`
            em `ArticleCard`): o cartão inteiro não é clicável de propósito,
            porque a descrição de cada editoria é conteúdo para LER antes de
            decidir, não um rótulo redundante dentro de um alvo de toque único.
          */}
          <div className="grid g-sm-2 g-md-3">
            {CATEGORIES.map((category) => (
              <article key={category.slug} className="side-box">
                <span className={catClass(category.slug)} aria-hidden="true" />
                <h2>
                  <Link href={routes.category(category.slug)}>{category.name}</Link>
                </h2>
                <p className="form-hint">{category.description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
