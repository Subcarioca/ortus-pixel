/**
 * =============================================================================
 * CORPO DA MATÉRIA EM BLOCOS — renderização
 * =============================================================================
 *
 * Irmão de `article-body.tsx` (que renderiza o Markdown do acervo antigo) e
 * regido pela MESMA garantia de segurança, que é a razão de este arquivo existir
 * em vez de um template de HTML:
 *
 *   NENHUM `dangerouslySetInnerHTML`. Em lugar nenhum. Nunca.
 *
 * Todo texto de bloco atravessa `renderInline`, importada de `article-body.tsx`
 * — a mesma função, não uma cópia. Ela produz NÓS REACT e o React escapa tudo
 * que interpola: um bloco cujo texto seja `<script>roubar()</script>` renderiza
 * os caracteres literais na tela. A segurança é propriedade da arquitetura, e
 * não de alguém ter lembrado de sanear.
 *
 * -----------------------------------------------------------------------------
 * COMPONENTE DE SERVIDOR (sem `'use client'`)
 * -----------------------------------------------------------------------------
 * Zero JavaScript enviado ao navegador para renderizar o corpo — que é a parte
 * mais pesada da página mais acessada do site. A única exceção é o bloco de
 * vídeo, que precisa de um clique para trocar a fachada pelo iframe; ele é o
 * ÚNICO componente de cliente aqui, e carrega só a si mesmo.
 *
 * -----------------------------------------------------------------------------
 * TIPO DESCONHECIDO É IGNORADO, NÃO EXPLODE
 * -----------------------------------------------------------------------------
 * O `default` do switch devolve `null`. Parece descuido e é o contrário: os
 * blocos vêm de uma coluna `Json`, e coluna Json é fronteira. Um bloco de tipo
 * futuro (gravado por uma versão mais nova do editor, lido por um servidor que
 * ainda não subiu) faz a matéria perder um trecho — grave, mas recuperável.
 * Lançar faria a PÁGINA INTEIRA responder 500 para todo leitor, inclusive os
 * outros 40 blocos que estavam perfeitos.
 */

import Image from 'next/image';
import Link from 'next/link';

import {
  formatVideoDuration,
  headingAnchor,
  type ArticleBlock,
  type BlockWidth,
  type ImageBlock,
  type ReadMoreBlock,
  type VideoBlock,
} from '@subcarioca/core';

import { renderInline } from './article-body';
import { VideoFacade } from './video-facade';

interface ArticleBlocksProps {
  blocks: ArticleBlock[];
  /**
   * Token de design da editoria, para o gradiente do `.thumb` enquanto a foto
   * carrega. `undefined` para editoria sem token — o `.thumb` cai no gradiente
   * neutro, que é o comportamento correto e não um erro.
   */
  categoryToken: string | undefined;
}

export function ArticleBlocks({ blocks, categoryToken }: ArticleBlocksProps) {
  /**
   * OS BLOCOS DE TEXTO SÃO AGRUPADOS EM `.prose`; OS DE MÍDIA, NÃO.
   *
   * `.prose` é a classe que dá ao texto a medida de leitura, a entrelinha 1.75 e
   * o link editorial com sublinhado carmim. Ela precisa envolver o texto — e
   * NÃO pode envolver imagem, vídeo e "leia também", porque esses podem furar a
   * medida de 44rem (decisão aprovada) e porque `.prose > * + *` aplicaria a
   * margem de parágrafo a eles.
   *
   * Daí o agrupamento: uma sequência de blocos de texto vira UM `.prose`, e cada
   * bloco de mídia sai fora. Sem isso, cada parágrafo seria um `.prose` próprio e
   * o seletor de irmãos (`> * + *`) nunca casaria — o texto sairia sem
   * espaçamento entre parágrafos, que é o sintoma clássico de "o CSS não pegou".
   */
  const groups = groupBlocks(blocks);

  return (
    <>
      {groups.map((group, index) =>
        group.kind === 'prose' ? (
          <div className="prose" key={`prose-${index}`}>
            {group.blocks.map(renderProseBlock)}
          </div>
        ) : (
          renderMediaBlock(group.block, categoryToken)
        ),
      )}
    </>
  );
}

// =============================================================================
// AGRUPAMENTO
// =============================================================================

type BlockGroup =
  | { kind: 'prose'; blocks: ArticleBlock[] }
  | { kind: 'media'; block: ArticleBlock };

/** Blocos que saem do fluxo de `.prose` por terem largura e margem próprias. */
const MEDIA_TYPES = new Set<ArticleBlock['type']>(['imagem', 'video', 'leia-tambem']);

function groupBlocks(blocks: ArticleBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];

  for (const block of blocks) {
    if (MEDIA_TYPES.has(block.type)) {
      groups.push({ kind: 'media', block });
      continue;
    }

    const last = groups[groups.length - 1];
    if (last?.kind === 'prose') {
      last.blocks.push(block);
    } else {
      groups.push({ kind: 'prose', blocks: [block] });
    }
  }

  return groups;
}

// =============================================================================
// BLOCOS DE TEXTO
// =============================================================================

function renderProseBlock(block: ArticleBlock): React.ReactNode {
  switch (block.type) {
    case 'paragrafo':
      return <p key={block.id}>{renderInline(block.texto)}</p>;

    case 'titulo': {
      // O `id` é a âncora do índice. Mesma função usada por `blocksToToc`, para
      // que o link do sumário e o destino do salto não possam divergir.
      const id = headingAnchor(block.texto);
      return block.nivel === 2 ? (
        <h2 key={block.id} id={id}>
          {renderInline(block.texto)}
        </h2>
      ) : (
        <h3 key={block.id} id={id}>
          {renderInline(block.texto)}
        </h3>
      );
    }

    case 'lista':
      return block.ordenada ? (
        <ol key={block.id}>
          {block.itens.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={block.id}>
          {block.itens.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      );

    case 'citacao':
      return (
        <blockquote key={block.id}>
          <p>{renderInline(block.texto)}</p>
          {/*
            ATRIBUIÇÃO — o que o `blockquote` do Markdown não tinha.
            `<cite>` e não um `<p>` qualquer: é o elemento que declara a FONTE de
            uma citação, e é o que um leitor de tela anuncia como tal. Sem ele, o
            nome do entrevistado seria só mais uma linha de texto colada embaixo.
          */}
          {(block.autor || block.cargo) && (
            <cite className="quote__source">
              {block.autor}
              {block.autor && block.cargo ? ', ' : ''}
              {block.cargo}
              {block.fonteUrl && (
                <>
                  {' · '}
                  <a href={block.fonteUrl} rel="noopener noreferrer" target="_blank">
                    fonte
                  </a>
                </>
              )}
            </cite>
          )}
        </blockquote>
      );

    default:
      return null;
  }
}

// =============================================================================
// BLOCOS DE MÍDIA
// =============================================================================

function renderMediaBlock(block: ArticleBlock, categoryToken: string | undefined): React.ReactNode {
  switch (block.type) {
    case 'imagem':
      return <ImageBlockView key={block.id} block={block} categoryToken={categoryToken} />;
    case 'video':
      return <VideoBlockView key={block.id} block={block} categoryToken={categoryToken} />;
    case 'leia-tambem':
      return <ReadMoreView key={block.id} block={block} />;
    default:
      return null;
  }
}

/** Classe de largura da mídia. `medida` não recebe modificador: é o padrão. */
function widthClass(width: BlockWidth): string {
  return width === 'medida' ? '' : ` media--${width === 'larga' ? 'wide' : 'full'}`;
}

/**
 * O `sizes` de cada largura — e por que ele NÃO pode ser um valor só.
 *
 * `sizes` é a única forma de dizer ao navegador quanto espaço a foto vai ocupar
 * ANTES de o CSS existir; é com ele que o navegador escolhe qual arquivo do
 * `srcset` baixar. Um valor genérico erra nos dois sentidos: declarar 860px
 * numa imagem que vai ser renderizada com 1088px faz o navegador baixar uma
 * versão pequena e esticá-la (a foto de abertura, justamente a mais importante,
 * sai borrada); declarar 1088px numa imagem de 704px torra banda de 4G em
 * pixels que ninguém vai ver.
 *
 * Os números vêm dos mesmos `--media-max` do CSS (seção 18.1 da folha):
 *   medida         44rem = 704px   · a partir de 768px
 *   larga          54rem = 864px   · a partir de 912px  (864 + 2×24 de recuo)
 *   borda-a-borda  68rem = 1088px  · a partir de 1136px (1088 + 2×24)
 *
 * Abaixo desses pontos de corte a imagem ocupa a largura da janela — inclusive
 * no celular, onde 'larga' e 'borda-a-borda' sangram de borda a borda.
 *
 * ⚠ Se um dos valores de `--media-max` mudar no CSS, mude aqui junto. São dois
 * lugares porque `sizes` é atributo de HTML e não enxerga custom property.
 */
const MEDIA_SIZES: Record<BlockWidth, string> = {
  medida: '(min-width: 768px) 704px, 100vw',
  larga: '(min-width: 912px) 864px, 100vw',
  'borda-a-borda': '(min-width: 1136px) 1088px, 100vw',
};

/**
 * A imagem do corpo — o bloco que o produto trata como PROTAGONISTA.
 *
 * A largura vem pronta do dado (`block.largura`), decidida por
 * `suggestedImageWidth` no core a partir de quantas imagens a matéria tem: uma
 * só vira 'borda-a-borda', duas viram 'larga', três ou mais viram 'medida'. Este
 * componente não recalcula nada disso — ele só traduz a palavra em classe
 * (`widthClass`) e em `sizes` (`MEDIA_SIZES`), que são as duas metades da mesma
 * decisão: uma para o layout, outra para a rede.
 *
 * O piso da escada é a largura da coluna de texto, então NÃO existe combinação
 * que produza uma imagem mais estreita que o parágrafo vizinho — a garantia
 * pedida pelo dono do produto está na forma da função do core, e aqui só é
 * preservada.
 */
function ImageBlockView({
  block,
  categoryToken,
}: {
  block: ImageBlock;
  categoryToken: string | undefined;
}) {
  return (
    <figure className={`media${widthClass(block.largura)}`}>
      {/* ENQUADRAMENTO ESCOLHIDO PELO EDITOR (`block.fit`, ver
          `@subcarioca/core`, `cover-image.ts`) — mesmo tratamento da capa
          (`article-view.tsx`), porque `.thumb` é a MESMA moldura 16:9 fixa
          nos dois lugares. `fit` ausente (bloco publicado antes deste campo
          existir) é `undefined`, que a comparação abaixo trata como 'cover'
          — a aparência de sempre, sem mudança nenhuma no acervo existente. */}
      <div
        className={block.fit === 'contain' ? 'thumb thumb--contain' : 'thumb'}
        data-c={categoryToken}
      >
        <Image
          src={block.url}
          // `alt` vazio em imagem decorativa é a marcação CORRETA: diz ao leitor
          // de tela "pule esta imagem". O que não pode existir é imagem
          // informativa com alt vazio — e isso o validador de entrada barra.
          alt={block.alt}
          width={1200}
          height={675}
          // Sem `priority`: imagem do MEIO do corpo nunca é o LCP, e marcá-la
          // como prioritária competiria com a capa pela banda inicial.
          sizes={MEDIA_SIZES[block.largura]}
          // Só 'focal' precisa de posição inline — mesmo raciocínio de
          // `article-view.tsx`/`article-card.tsx`: coordenada ausente cai no
          // centro, que é o que 'cover' já faria.
          style={
            block.fit === 'focal'
              ? { objectPosition: `${block.focalX ?? 50}% ${block.focalY ?? 50}%` }
              : undefined
          }
        />
      </div>

      {(block.legenda || block.credito) && (
        <figcaption>
          {block.legenda}
          {/*
            CRÉDITO EM LINHA PRÓPRIA, subordinado à legenda.
            É a correção do erro semântico que o produto tinha: `coverImageAlt`
            fazia papel de legenda. `alt` SUBSTITUI a imagem para quem não vê;
            legenda COMPLEMENTA para quem vê; crédito diz de quem é a imagem — e
            confundir os três faz o leitor de tela anunciar "Divulgação/Team
            Cherry" como se fosse o conteúdo da foto.
          */}
          {block.credito && <span className="figcredit">{block.credito}</span>}
        </figcaption>
      )}
    </figure>
  );
}

function VideoBlockView({
  block,
  categoryToken,
}: {
  block: VideoBlock;
  categoryToken: string | undefined;
}) {
  return (
    <figure className={`embed media${widthClass(block.largura)}`}>
      <VideoFacade
        provider={block.provedor}
        videoId={block.videoId}
        title={block.titulo}
        thumbUrl={block.thumbUrl ?? null}
        duration={formatVideoDuration(block.duracaoSegundos)}
        categoryToken={categoryToken}
      />
      {/*
        A FONTE DECLARADA não é enfeite: um embed sem procedência é conteúdo de
        terceiro passando por conteúdo nosso. O leitor precisa saber que aquele
        player é do YouTube antes de clicar — inclusive porque o clique é o que
        entrega o IP dele ao provedor.
      */}
      <figcaption className="embed__src">
        Vídeo · {block.provedor === 'youtube' ? 'YouTube' : 'Vimeo'}
        {block.legenda ? ` · ${block.legenda}` : ''}
      </figcaption>
    </figure>
  );
}

function ReadMoreView({ block }: { block: ReadMoreBlock }) {
  const multiple = block.itens.length > 1;

  return (
    // `<aside>` e não `<div>`: é conteúdo tangencial ao texto principal, e a
    // semântica faz o leitor de tela poder pular o bloco em vez de lê-lo no meio
    // da frase que ele interrompe.
    <aside className={`readmore${multiple ? ' readmore--multi' : ''}`}>
      <span className="readmore__label">{block.rotulo ?? 'Leia também'}</span>

      {multiple ? (
        <ul>
          {block.itens.map((item) => (
            <li key={item.url}>
              <Link href={item.url}>{item.titulo}</Link>
            </li>
          ))}
        </ul>
      ) : (
        block.itens[0] && <Link href={block.itens[0].url}>{block.itens[0].titulo}</Link>
      )}
    </aside>
  );
}
