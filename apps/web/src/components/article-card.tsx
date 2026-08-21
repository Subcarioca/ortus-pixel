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

import type { ContentCardData } from '@subcarioca/core';
import {
  catClass,
  catToken,
  EVERGREEN_FORMATS,
  FORMAT_LABELS,
  formatSealClass,
  routes,
} from '@subcarioca/core';

import { HeatBadge } from './heat-badge';
import { HeatBar, TrendTag } from './heat-bar';
import { RelativeTime } from './relative-time';

interface ArticleCardProps {
  item: ContentCardData;
  /**
   * `ever` força a anatomia de evergreen independentemente da temperatura.
   *
   * Existe porque "Guias e essenciais" passou a ser selecionada por FORMATO
   * (guia, lista, comparativo) e não mais por faixa de score: um guia publicado
   * hoje pode estar em qualquer temperatura, e ainda assim precisa do card sem
   * imagem e do filete verde — é o tratamento que diz "isto vale a qualquer
   * momento", que é justamente o que a seção promete.
   */
  variant?: 'grid' | 'row' | 'lead' | 'ever';
  /** Posição no ranking, exibida na página Em Alta. */
  rank?: number;
  /**
   * `true` apenas para as imagens acima da dobra.
   * Marcar TODAS as imagens como prioritárias anula o efeito: o navegador
   * baixaria tudo ao mesmo tempo e o LCP pioraria em vez de melhorar.
   */
  priority?: boolean;
  /**
   * Mostra o `HeatBar` (termômetro de 4 blocos) ao lado do `HeatBadge`, além
   * da pílula de temperatura.
   *
   * `false` por padrão: no card do feed, pílula + termômetro lado a lado
   * comunicavam a MESMA informação duas vezes (relatório de UI) — a pílula já
   * diz a faixa por extenso, e é mais legível que quatro barrinhas de 16px.
   *
   * A EXCEÇÃO É `/em-alta`: o pódio (`variant="lead"`) liga esta prop de
   * propósito, porque ali o termômetro aparece em SEQUÊNCIA, um por posição
   * do ranking — é comparação lado a lado entre itens, não repetição dentro
   * do mesmo card, e é exatamente o caso em que a barra ganha do texto.
   */
  showHeatBar?: boolean;
}

/**
 * Cada variante do produto → as classes do design que a compõem.
 *
 * `lead` merece explicação: no design system, `.card--lead` NÃO é um contêiner
 * — é só um modificador de tamanho de título (`.card--lead .card__title`).
 * Usá-lo sozinho produziria um card sem fundo, sem borda e sem padding. O
 * pódio é, portanto, um card de grade com título grande.
 */
const VARIANT_CLASS: Record<'grid' | 'row' | 'lead' | 'ever', string> = {
  grid: 'card--grid',
  row: 'card--row',
  lead: 'card--grid card--lead',
  ever: 'card--ever',
};

export function ArticleCard({
  item,
  variant = 'grid',
  rank,
  priority = false,
  showHeatBar = false,
}: ArticleCardProps) {
  const isEvergreenFormat = (EVERGREEN_FORMATS as readonly string[]).includes(item.format);

  /*
    QUEM MERECE A ANATOMIA DE EVERGREEN — e por que a regra mudou.

    Evergreen não compete: sem imagem grande, sem horário, mostrando tempo de
    leitura. É decisão do design, para proteger a hierarquia da temperatura.

    O critério ANTIGO era só `heat === 'ever'`, ou seja, score baixo. Enquanto o
    feed da home excluía a faixa fria, isso nunca aparecia; agora que "Últimas
    notícias" mostra tudo, apareceria — e mostraria uma notícia de anteontem sem
    foto e SEM DATA numa seção cronológica, tratando-a como material perene.

    Perene é propriedade do FORMATO. Uma notícia que esfriou continua sendo
    notícia: card normal, com capa e com data.
  */
  const isEvergreen = variant === 'ever' || (item.heat === 'ever' && isEvergreenFormat);

  // Na faixa mais fria o badge diz o FORMATO, não a faixa: "Guia" só é verdade
  // quando o conteúdo é um guia. Ver o comentário da prop `label` no HeatBadge.
  const badgeLabel =
    variant === 'ever' || item.heat === 'ever' ? FORMAT_LABELS[item.format] : undefined;

  /**
   * O SELO DE FORMATO SÓ APARECE QUANDO O BADGE JÁ NÃO DIZ O FORMATO.
   *
   * Na faixa mais fria, `HeatBadge` já mostra "Guia"/"Lista" no lugar da
   * temperatura (ver `badgeLabel` acima). Acrescentar o `.fmt` ali produziria
   * "Guia · Guia" lado a lado — o tipo de duplicação que passa despercebida em
   * revisão de código e é constrangedora na tela.
   *
   * `breaking` também fica de fora: "Notícia" é o formato PADRÃO deste site, e
   * carimbar de notícia a maioria dos cards não distingue nada. Selo de formato
   * existe para dizer "este é diferente".
   */
  const showFormatSeal = badgeLabel === undefined && item.format !== 'breaking';

  // Evergreen tem anatomia própria no design: sem imagem, sem .card__body e
  // com filete verde à esquerda (`.card--ever` já traz o padding). Tratá-lo no
  // mesmo JSX dos demais exigiria três ternários aninhados no meio do markup.
  if (isEvergreen) {
    return (
      <article className={`card ${VARIANT_CLASS.ever}`}>
        {/* Na seção de guias o verde é do BLOCO (o filete do `.card--ever`),
            então o badge acompanha, mesmo que o guia esteja quente hoje. */}
        <HeatBadge heat={variant === 'ever' ? 'ever' : item.heat} label={badgeLabel} />
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
          <HeatBadge heat={item.heat} label={badgeLabel} />
          {showHeatBar && <HeatBar heat={item.heat} level={item.heatLevel} size="sm" />}
          <TrendTag trend={item.trend} />
          {showFormatSeal && (
            <span className={formatSealClass(item.format)}>{FORMAT_LABELS[item.format]}</span>
          )}
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
