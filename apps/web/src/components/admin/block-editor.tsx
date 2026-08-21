'use client';

/**
 * =============================================================================
 * EDITOR DE BLOCOS — o corpo da matéria deixa de ser um textarea
 * =============================================================================
 *
 * DECISÕES DE INTERFACE, e o motivo de cada uma:
 *
 * 1. REORDENAR É COM BOTÃO ↑ ↓, e não com arrastar-e-soltar.
 *    Não é preguiça: drag-and-drop acessível é caro (precisa de equivalente por
 *    teclado, de anúncio de posição para leitor de tela e de tratamento de
 *    rolagem em lista longa) e, num editor de notícia, mover um bloco é uma ação
 *    rara comparada a digitar. Botões funcionam no teclado de graça, funcionam no
 *    celular de graça, e o `aria-label` diz exatamente o que vai acontecer.
 *
 * 2. O ESTADO VIVE AQUI, e o formulário-pai só recebe o array no envio.
 *    A alternativa (um `<input type="hidden">` com JSON serializado a cada tecla)
 *    faria o React reserializar a matéria inteira a cada caractere digitado.
 *
 * 3. NÃO HÁ SALVAMENTO AUTOMÁTICO.
 *    Num CMS de notícia, salvar sozinho é perigoso: uma matéria em edição que se
 *    salva sozinha pode ir ao ar pela metade se o status já for "publicada". O
 *    salvamento continua sendo um clique deliberado, como já era.
 *
 * 4. O QUE ESTE COMPONENTE **NÃO** FAZ: validar. Ele deixa o redator digitar o
 *    que quiser e mostra o erro que o SERVIDOR devolveu. Validar aqui também
 *    duplicaria as regras — e a cópia do cliente é a que sempre fica para trás,
 *    criando o pior dos casos: um editor que aceita algo que a gravação recusa,
 *    ou pior, que recusa algo que a gravação aceitaria.
 */

import { useState } from 'react';

import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  BLOCK_WIDTHS,
  countImageBlocks,
  emptyBlock,
  markdownToBlocks,
  withSuggestedImageWidths,
  type ArticleBlock,
  type BlockType,
  type BlockWidth,
} from '@subcarioca/core';

import { CoverImageFitField } from './cover-image-fit-field';
import { ImageUrlField } from './image-url-field';

/** Rótulos de largura de mídia, para o `<select>`. */
const WIDTH_LABELS: Record<BlockWidth, string> = {
  medida: 'Largura do texto',
  larga: 'Mais larga que o texto',
  'borda-a-borda': 'Borda a borda',
};

/**
 * Id de bloco.
 *
 * `crypto.randomUUID` quando existe; um contador com timestamp como reserva.
 * O id nunca vai ao banco como identidade — ele é chave de reconciliação do
 * React (ver o comentário de `BlockBase.id` em core/blocks.ts) e o servidor o
 * reescreve se houver colisão. Portanto não precisa ser criptograficamente
 * único; precisa ser único DENTRO desta matéria.
 */
let fallbackCounter = 0;
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  fallbackCounter += 1;
  return `b${Date.now().toString(36)}${fallbackCounter}`;
}

/**
 * Normaliza o que veio do banco (coluna `Json`, portanto `unknown`).
 *
 * Json malformado, `null` ou array vazio viram lista vazia — que o editor lê
 * como "esta matéria ainda está em Markdown". Blocos sem `id` (gravados por uma
 * versão anterior, ou por escrita direta no banco) ganham um: sem id, a
 * reconciliação do React passa a ser por índice e o texto digitado pula de bloco
 * ao reordenar.
 */
export function toEditorBlocks(raw: unknown): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ArticleBlock => typeof item === 'object' && item !== null && 'type' in item)
    .map((block) => ({ ...block, id: block.id || newId() }));
}

interface BlockEditorProps {
  blocks: ArticleBlock[];
  onChange: (blocks: ArticleBlock[]) => void;
  /** Markdown atual da matéria, para o botão de conversão do acervo antigo. */
  legacyMarkdown: string;
}

export function BlockEditor({ blocks, onChange, legacyMarkdown }: BlockEditorProps) {
  const [adding, setAdding] = useState(false);

  function update(index: number, patch: Partial<ArticleBlock>) {
    onChange(
      blocks.map((block, i) => (i === index ? ({ ...block, ...patch } as ArticleBlock) : block)),
    );
  }

  /**
   * DESTAQUE PROPORCIONAL DA IMAGEM — aplicado ao INSERIR e ao REMOVER.
   *
   * A regra ("uma imagem sozinha merece destaque bem maior do que três, uma por
   * parágrafo") é do dono do produto e está implementada, com o racional
   * completo e testes, em `core/blocks.ts` — `withSuggestedImageWidths`.
   *
   * POR QUE NOS DOIS EVENTOS, e não só na inserção: a quantidade muda nas duas
   * pontas. Uma matéria com três imagens em que o redator apaga duas ficaria
   * com a última em `'medida'` — discreta justamente quando ela virou a única
   * pausa visual do texto, que é o caso em que a regra manda destacar mais.
   *
   * E POR QUE NÃO A CADA DIGITAÇÃO: `update()` roda a cada tecla nos campos do
   * bloco. Reescrever o array inteiro ali para recalcular algo que só muda com a
   * QUANTIDADE de imagens seria trabalho por caractere digitado, e ainda
   * atropelaria a escolha manual de largura no meio da edição.
   *
   * A largura continua editável no `<select>` de cada imagem: isto é sugestão
   * automática, não trava. Ver o comentário de `withSuggestedImageWidths`.
   */
  function applyImageRhythm(next: ArticleBlock[]): ArticleBlock[] {
    return countImageBlocks(next) > 0 ? withSuggestedImageWidths(next) : next;
  }

  function add(type: BlockType) {
    const next = [...blocks, emptyBlock(type, newId())];
    onChange(type === 'imagem' ? applyImageRhythm(next) : next);
    setAdding(false);
  }

  function remove(index: number) {
    const removido = blocks[index];
    const next = blocks.filter((_, i) => i !== index);
    onChange(removido?.type === 'imagem' ? applyImageRhythm(next) : next);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;

    const next = [...blocks];
    // Troca simples entre vizinhos. Como cada bloco tem `id` estável, o React
    // move os nós do DOM em vez de recriá-los — e o campo em foco continua com o
    // valor certo depois do movimento.
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  // ---------------------------------------------------------------------------
  // ESTADO VAZIO: a matéria ainda está em Markdown
  // ---------------------------------------------------------------------------
  if (blocks.length === 0) {
    return (
      <div className="block-editor block-editor--empty">
        <p className="form-hint">
          Esta matéria usa o corpo em texto (Markdown) do campo acima. Você pode continuar
          assim — nada muda para o leitor — ou passar para o editor de blocos, que permite
          imagem com crédito, vídeo, caixa &ldquo;Leia também&rdquo; e índice automático.
        </p>

        <div className="admin-actions">
          {legacyMarkdown.trim().length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => onChange(markdownToBlocks(legacyMarkdown, newId))}
            >
              Converter o texto atual em blocos
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => add('paragrafo')}
          >
            Começar do zero com um parágrafo
          </button>
        </div>

        <p className="form-hint">
          A conversão transforma títulos, listas e citações do texto em blocos equivalentes.
          Ela não é definitiva: apagando todos os blocos, a matéria volta a renderizar pelo
          texto de cima.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // LISTA DE BLOCOS
  // ---------------------------------------------------------------------------
  return (
    <div className="block-editor">
      <ol className="block-editor__list">
        {blocks.map((block, index) => (
          <li key={block.id} className="block-card">
            <div className="block-card__head">
              <span className="block-card__type">
                {index + 1}. {BLOCK_LABELS[block.type] ?? block.type}
              </span>

              <div className="block-card__tools">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  // O rótulo diz o QUE move, não só a direção: numa lista de 30
                  // blocos, "Subir" repetido 30 vezes é inútil no leitor de tela.
                  aria-label={`Mover ${BLOCK_LABELS[block.type]} para cima`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => move(index, 1)}
                  disabled={index === blocks.length - 1}
                  aria-label={`Mover ${BLOCK_LABELS[block.type]} para baixo`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => remove(index)}
                  aria-label={`Remover ${BLOCK_LABELS[block.type]}`}
                >
                  Remover
                </button>
              </div>
            </div>

            <BlockFields block={block} onChange={(patch) => update(index, patch)} />
          </li>
        ))}
      </ol>

      {/* ------- INSERÇÃO ------- */}
      {adding ? (
        <div className="block-editor__add" role="group" aria-label="Escolha o tipo de bloco">
          {BLOCK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => add(type)}
            >
              {BLOCK_LABELS[type]}
            </button>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdding(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => setAdding(true)}
          aria-expanded={adding}
        >
          + Adicionar bloco
        </button>
      )}
    </div>
  );
}

// =============================================================================
// CAMPOS DE CADA TIPO
// =============================================================================

/**
 * Um `switch` por tipo, e não um sistema de "descrição de campos" genérico.
 *
 * A tentação de descrever os blocos como metadados (`{ campo: 'texto', tipo:
 * 'textarea' }`) e gerar o formulário a partir disso é forte e seria abstração
 * prematura: cada tipo tem uma particularidade real — a imagem tem a caixa de
 * "decorativa" que ESCONDE o campo de alt, o vídeo aceita URL colada, o "leia
 * também" tem lista de tamanho variável. Um gerador genérico precisaria de
 * exceções para todas elas, e aí seria um `switch` disfarçado, com uma camada a
 * mais entre quem lê o código e o que aparece na tela.
 */
function BlockFields({
  block,
  onChange,
}: {
  block: ArticleBlock;
  onChange: (patch: Partial<ArticleBlock>) => void;
}) {
  switch (block.type) {
    // -------------------------------------------------------------------------
    case 'paragrafo':
      return (
        <label>
          Texto
          <textarea
            value={block.texto}
            onChange={(event) => onChange({ texto: event.target.value } as Partial<ArticleBlock>)}
            rows={4}
            placeholder="Escreva o parágrafo. Aceita **negrito**, *itálico*, `código` e [link](/games/materia)."
          />
        </label>
      );

    // -------------------------------------------------------------------------
    case 'titulo':
      return (
        <div className="admin-form admin-form--cols">
          <label className="admin-form__full">
            Texto do título
            <input
              value={block.texto}
              onChange={(event) => onChange({ texto: event.target.value } as Partial<ArticleBlock>)}
              maxLength={300}
            />
          </label>
          <label>
            Nível
            <select
              value={block.nivel}
              onChange={(event) =>
                onChange({ nivel: Number(event.target.value) === 3 ? 3 : 2 } as Partial<ArticleBlock>)
              }
            >
              <option value={2}>Seção (H2) — entra no índice</option>
              <option value={3}>Subseção (H3)</option>
            </select>
          </label>
        </div>
      );

    // -------------------------------------------------------------------------
    case 'imagem':
      return (
        <div className="admin-form admin-form--cols">
          <ImageUrlField
            label="Imagem"
            className="admin-form__full"
            value={block.url}
            onChange={(url) => onChange({ url } as Partial<ArticleBlock>)}
          />

          {/* Mesma moldura 16:9 fixa da capa (`.thumb`, ver
              `article-blocks.tsx`), então sofre o mesmo corte automático —
              ver `@subcarioca/core` (`cover-image.ts`). `groupName` inclui o
              `id` do bloco: sem isso, dois blocos de imagem na mesma matéria
              teriam radios com o mesmo `name`, e escolher o enquadramento de
              um mudaria visualmente o outro (grupo de rádio é exclusivo por
              `name`, não por posição na tela). */}
          <CoverImageFitField
            imageUrl={block.url}
            value={{ fit: block.fit ?? 'cover', focalX: block.focalX ?? null, focalY: block.focalY ?? null }}
            onChange={(next) =>
              onChange({
                fit: next.fit,
                focalX: next.focalX,
                focalY: next.focalY,
              } as Partial<ArticleBlock>)
            }
            groupName={`block-fit-${block.id}`}
            className="admin-form__full"
          />

          <label className="form-inline admin-form__full">
            <input
              type="checkbox"
              checked={block.decorativa}
              onChange={(event) =>
                onChange({ decorativa: event.target.checked } as Partial<ArticleBlock>)
              }
            />
            Imagem decorativa (não acrescenta informação ao texto)
          </label>

          {/* O campo de alt SOME quando "decorativa" está marcada — em vez de
              ficar desabilitado. Campo desabilitado com texto dentro sugere que
              o texto vale; aqui ele deixa de valer, e a tela precisa dizer isso
              sem ambiguidade. */}
          {!block.decorativa && (
            <label className="admin-form__full">
              Texto alternativo (obrigatório)
              <input
                value={block.alt}
                onChange={(event) => onChange({ alt: event.target.value } as Partial<ArticleBlock>)}
                maxLength={300}
                placeholder="Descreva o que a imagem mostra, para quem não a vê."
              />
            </label>
          )}

          <label>
            Legenda (opcional)
            <input
              value={block.legenda ?? ''}
              onChange={(event) => onChange({ legenda: event.target.value } as Partial<ArticleBlock>)}
              maxLength={300}
            />
          </label>

          <label>
            Crédito (opcional)
            <input
              value={block.credito ?? ''}
              onChange={(event) => onChange({ credito: event.target.value } as Partial<ArticleBlock>)}
              maxLength={120}
              placeholder="Team Cherry / Divulgação"
            />
          </label>

          <label>
            Largura
            <select
              value={block.largura}
              onChange={(event) =>
                onChange({ largura: event.target.value as BlockWidth } as Partial<ArticleBlock>)
              }
            >
              {BLOCK_WIDTHS.map((width) => (
                <option key={width} value={width}>
                  {WIDTH_LABELS[width]}
                </option>
              ))}
            </select>
            <span className="form-hint">
              A largura é sugerida automaticamente pela quantidade de imagens do corpo: uma
              imagem sozinha nasce borda a borda, três nascem na largura do texto. Você pode
              mudar aqui — nenhuma opção deixa a imagem mais estreita que o texto.
            </span>
          </label>
        </div>
      );

    // -------------------------------------------------------------------------
    case 'lista':
      return (
        <div className="admin-form">
          <label className="form-inline">
            <input
              type="checkbox"
              checked={block.ordenada}
              onChange={(event) =>
                onChange({ ordenada: event.target.checked } as Partial<ArticleBlock>)
              }
            />
            Lista numerada
          </label>

          {block.itens.map((item, index) => (
            <div className="admin-tldr__row" key={index}>
              <input
                value={item}
                onChange={(event) =>
                  onChange({
                    itens: block.itens.map((old, i) => (i === index ? event.target.value : old)),
                  } as Partial<ArticleBlock>)
                }
                placeholder={`Item ${index + 1}`}
              />
              {block.itens.length > 1 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    onChange({
                      itens: block.itens.filter((_, i) => i !== index),
                    } as Partial<ArticleBlock>)
                  }
                >
                  Remover
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onChange({ itens: [...block.itens, ''] } as Partial<ArticleBlock>)}
          >
            + Item
          </button>
        </div>
      );

    // -------------------------------------------------------------------------
    case 'citacao':
      return (
        <div className="admin-form admin-form--cols">
          <label className="admin-form__full">
            Citação
            <textarea
              value={block.texto}
              onChange={(event) => onChange({ texto: event.target.value } as Partial<ArticleBlock>)}
              rows={3}
            />
          </label>
          <label>
            Quem disse
            <input
              value={block.autor ?? ''}
              onChange={(event) => onChange({ autor: event.target.value } as Partial<ArticleBlock>)}
              maxLength={120}
            />
          </label>
          <label>
            Cargo ou veículo
            <input
              value={block.cargo ?? ''}
              onChange={(event) => onChange({ cargo: event.target.value } as Partial<ArticleBlock>)}
              maxLength={120}
              placeholder="diretor da Team Cherry"
            />
          </label>
          <label className="admin-form__full">
            Link da fonte (opcional)
            <input
              type="url"
              value={block.fonteUrl ?? ''}
              onChange={(event) => onChange({ fonteUrl: event.target.value } as Partial<ArticleBlock>)}
              placeholder="https://..."
            />
          </label>
        </div>
      );

    // -------------------------------------------------------------------------
    case 'leia-tambem':
      return (
        <div className="admin-form">
          <label>
            Rótulo da caixa
            <input
              value={block.rotulo ?? ''}
              onChange={(event) => onChange({ rotulo: event.target.value } as Partial<ArticleBlock>)}
              maxLength={60}
              placeholder="Leia também"
            />
          </label>

          {block.itens.map((item, index) => (
            <div className="admin-form admin-form--cols" key={index}>
              <label>
                Título da matéria
                <input
                  value={item.titulo}
                  onChange={(event) =>
                    onChange({
                      itens: block.itens.map((old, i) =>
                        i === index ? { ...old, titulo: event.target.value } : old,
                      ),
                    } as Partial<ArticleBlock>)
                  }
                />
              </label>
              <label>
                Endereço interno
                <input
                  value={item.url}
                  onChange={(event) =>
                    onChange({
                      itens: block.itens.map((old, i) =>
                        i === index ? { ...old, url: event.target.value } : old,
                      ),
                    } as Partial<ArticleBlock>)
                  }
                  placeholder="/games/nome-da-materia"
                />
              </label>
              {block.itens.length > 1 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    onChange({
                      itens: block.itens.filter((_, i) => i !== index),
                    } as Partial<ArticleBlock>)
                  }
                >
                  Remover esta
                </button>
              )}
            </div>
          ))}

          {/* Teto de 3: acima disso deixa de ser um destaque no meio do texto e
              vira uma lista de links — que é o bloco de relacionadas do fim. */}
          {block.itens.length < 3 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() =>
                onChange({
                  itens: [...block.itens, { titulo: '', url: '' }],
                } as Partial<ArticleBlock>)
              }
            >
              + Outra matéria
            </button>
          )}

          <p className="form-hint">
            Só matérias do próprio site. Copie o endereço a partir da barra do navegador, da
            barra em diante (ex.: <code>/games/nome-da-materia</code>).
          </p>
        </div>
      );

    // -------------------------------------------------------------------------
    case 'video':
      return (
        <div className="admin-form admin-form--cols">
          <label>
            Provedor
            <select
              value={block.provedor}
              onChange={(event) =>
                onChange({ provedor: event.target.value } as Partial<ArticleBlock>)
              }
            >
              <option value="youtube">YouTube</option>
              <option value="vimeo">Vimeo</option>
            </select>
          </label>

          <label>
            Endereço ou identificador do vídeo
            <input
              value={block.videoId}
              onChange={(event) => onChange({ videoId: event.target.value } as Partial<ArticleBlock>)}
              placeholder="Cole a URL do vídeo"
            />
          </label>

          <label className="admin-form__full">
            Título do vídeo (obrigatório)
            <input
              value={block.titulo}
              onChange={(event) => onChange({ titulo: event.target.value } as Partial<ArticleBlock>)}
              maxLength={300}
              placeholder="Análise em vídeo de Silksong"
            />
          </label>

          <label>
            Duração em segundos (opcional)
            <input
              type="number"
              min={0}
              value={block.duracaoSegundos ?? ''}
              onChange={(event) =>
                onChange({
                  duracaoSegundos: event.target.value ? Number(event.target.value) : undefined,
                } as Partial<ArticleBlock>)
              }
            />
          </label>

          <label>
            Largura
            <select
              value={block.largura}
              onChange={(event) =>
                onChange({ largura: event.target.value as BlockWidth } as Partial<ArticleBlock>)
              }
            >
              {BLOCK_WIDTHS.map((width) => (
                <option key={width} value={width}>
                  {WIDTH_LABELS[width]}
                </option>
              ))}
            </select>
          </label>

          <p className="admin-form__full form-hint">
            O vídeo entra como miniatura com botão de play: o player do YouTube só é carregado
            quando alguém clica. Isso economiza cerca de 1 MB por leitor e evita entregar o IP
            de quem só passou pela página.
          </p>
        </div>
      );

    default:
      return null;
  }
}
