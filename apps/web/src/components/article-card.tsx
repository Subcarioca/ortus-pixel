/**
 * =============================================================================
 * CARD DE ARTIGO
 * =============================================================================
 *
 * Componente de servidor (sem `'use client'`): zero JavaScript enviado ao
 * navegador. Num feed com 20 cards, isso é a diferença entre um LCP bom e um
 * ruim no 4G.
 *
 * VOCABULÁRIO (re-skin v0.3): este componente segue as quatro variantes de
 * card do design — `.card--grid` (feed), `.card--row` (lista compacta),
 * `.card--lead` (pódio) e `.card--ever` (evergreen). A anatomia interna é a
 * do protótipo:
 *
 *   .card > .thumb            imagem, com razão de aspecto fixa (CLS zero)
 *         > .card__body       (só em --grid: é ele que tem o padding)
 *             > .card__head   badge de temperatura + termômetro + editoria
 *             > .card__title
 *             > .card__dek
 *             > .meta         rodapé: data, "ao vivo", fandom
 *
 * A versão anterior usava `.card__media`, `.card__img`, `.card__foot`,
 * `.card__meta` e `.card__live` — nomes que pareciam certos, mas que **nunca
 * existiram no design system**. Como a folha de estilo é a do design, esses
 * quatro elementos vinham sem estilo nenhum: o rodapé do card não era uma
 * linha flex cinza, era texto solto herdando o corpo.
 */

import Image from 'next/image';
import Link from 'next/link';

import type { ContentCardData } from '@canalnerd/core';
import { catClass, catToken, routes } from '@canalnerd/core';

import { HeatBadge } from './heat-badge';
import { HeatBar, TrendTag } from './heat-bar';
import { RelativeTime } from './relative-time';

interface ArticleCardProps {
  item: ContentCardData;
  variant?: 'grid' | 'row' | 'lead';
  /** Posição no ranking, exibida na página Em Alta. */
  rank?: number;
  /**
   * `true` apenas para as imagens acima da dobra.
   * Marcar TODAS as imagens como prioritárias anula o efeito: o navegador
   * baixaria tudo ao mesmo tempo e o LCP pioraria em vez de melhorar.
   */
  priority?: boolean;
}

/**
 * Cada variante do produto → as classes do design que a compõem.
 *
 * `lead` merece explicação: no design system, `.card--lead` NÃO é um contêiner
 * — é só um modificador de tamanho de título (`.card--lead .card__title`).
 * Usá-lo sozinho produziria um card sem fundo, sem borda e sem padding. O
 * pódio é, portanto, um card de grade com título grande.
 */
const VARIANT_CLASS: Record<'grid' | 'row' | 'lead', string> = {
  grid: 'card--grid',
  row: 'card--row',
  lead: 'card--grid card--lead',
};

export function ArticleCard({ item, variant = 'grid', rank, priority = false }: ArticleCardProps) {
  // Evergreen não compete: sem imagem grande e sem horário, mostrando tempo de
  // leitura. Decisão do design para proteger a hierarquia da temperatura.
  const isEvergreen = item.heat === 'ever';

  // Evergreen tem anatomia própria no design: sem imagem, sem .card__body e
  // com filete verde à esquerda (`.card--ever` já traz o padding). Tratá-lo no
  // mesmo JSX dos demais exigiria três ternários aninhados no meio do markup.
  if (isEvergreen) {
    return (
      <article className="card card--ever">
        <HeatBadge heat={item.heat} />
        <h3 className="card__title">
          <Link href={item.url}>{item.title}</Link>
        </h3>
        <div className="meta">
          <span>{item.readingTimeMin} min de leitura</span>
        </div>
      </article>
    );
  }

  return (
    <article className={`card ${VARIANT_CLASS[variant]}`}>
      {/* `data-c` no `.thumb` pinta o gradiente da editoria enquanto a foto não
          carrega. É o placeholder do design, não decoração: sem ele o card
          mostra o mesmo retângulo cinza para todas as editorias no
          carregamento. O sufixo vem de `catToken`, porque o slug da URL
          (`cinema-e-series`) não é o nome que o design usa (`cinema`). */}
      {item.coverImageUrl && (
        <Link
          href={item.url}
          className="thumb"
          data-c={catToken(item.category.slug)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Image
            src={item.coverImageUrl}
            // Alt vazio é CORRETO aqui: a imagem é decorativa e o link do
            // título logo abaixo já descreve o destino. Repetir o texto faria
            // o leitor de tela anunciar a mesma manchete duas vezes.
            alt={item.coverImageAlt ?? ''}
            width={640}
            height={360}
            priority={priority}
            // `sizes` evita baixar imagem de 640px numa tela de 360px.
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
          {/* Posição do ranking sobre a capa (página Em Alta). No protótipo é
              um `style=""` inline sobre o hero; aqui reaproveitamos
              `.thumb__tag`, que já existe para badge no canto da imagem. */}
          {typeof rank === 'number' && (
            <span className="thumb__tag heat heat--lg">{String(rank).padStart(2, '0')}</span>
          )}
        </Link>
      )}

      <div className="card__body">
        <div className="card__head">
          <HeatBadge heat={item.heat} />
          <HeatBar heat={item.heat} level={item.heatLevel} size="sm" />
          <TrendTag trend={item.trend} />
          <Link href={routes.category(item.category.slug)} className={catClass(item.category.slug)}>
            {item.category.label}
          </Link>
        </div>

        <h3 className="card__title">
          <Link href={item.url}>{item.title}</Link>
        </h3>

        {variant !== 'row' && <p className="card__dek">{item.excerpt}</p>}

        {/*
          `.meta` é a linha de rodapé do design: flex, cinza, `fs-xs`, com
          `.meta__sep` (o pontinho) separando os itens. Substitui o antigo
          `.card__foot`, que não tinha estilo.
        */}
        <div className="meta">
          <RelativeTime date={item.publishedAt} />

          {item.isLive && (
            <>
              <span className="meta__sep" aria-hidden="true" />
              <span className="meta meta--live">
                <span className="live-dot" aria-hidden="true" />
                Ao vivo
                {item.updatesCount > 0 && ` · ${item.updatesCount} atualizações`}
              </span>
            </>
          )}

          {item.franchises.length > 0 && item.franchises[0] && (
            <>
              <span className="meta__sep" aria-hidden="true" />
              <Link href={routes.franchise(item.franchises[0].slug)} className="chip">
                {item.franchises[0].label}
              </Link>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
