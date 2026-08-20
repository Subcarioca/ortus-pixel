'use client';

/**
 * =============================================================================
 * ENQUADRAMENTO DA CAPA — recorte automático, imagem completa ou ponto focal
 * =============================================================================
 *
 * Compartilhado entre `article-create-form.tsx` e `article-edit-form.tsx` pelo
 * mesmo critério de `article-classification-fields.tsx`: é literalmente o
 * mesmo conjunto de campos, com a mesma regra, nos dois formulários.
 *
 * -----------------------------------------------------------------------------
 * POR QUE O SELETOR DE PONTO FOCAL, E NÃO UM RECORTE DE PIXELS DE VERDADE
 * -----------------------------------------------------------------------------
 * Ver o cabeçalho de `@/lib/cover-image` para a decisão completa. Em resumo:
 * um recorte de pixels de verdade (arrastar um retângulo, gravar uma SEGUNDA
 * imagem já cortada) exigiria processamento de imagem no servidor — escopo bem
 * maior do que "o editor escolhe o enquadramento". O ponto focal resolve o
 * mesmo problema prático (preservar o que importa na foto) só com CSS
 * (`object-position`), sem nenhuma biblioteca nova.
 *
 * -----------------------------------------------------------------------------
 * A PRÉVIA É UM `<img>` CRU, PELO MESMO MOTIVO DE `image-url-field.tsx`
 * -----------------------------------------------------------------------------
 * `next/image` lançaria em tempo de renderização se a URL digitada não estiver
 * num host declarado em `remotePatterns` — e o valor aqui é, por definição,
 * algo que a pessoa acabou de colar. Fora da otimização, esta prévia é vista
 * por uma pessoa da redação, uma vez, ao editar: o custo de não otimizar é
 * zero.
 */

import type { KeyboardEvent, MouseEvent } from 'react';

import { COVER_IMAGE_FITS, COVER_IMAGE_FIT_LABELS, type CoverImageFit } from '@/lib/cover-image';

export interface CoverImageFitValue {
  fit: CoverImageFit;
  focalX: number | null;
  focalY: number | null;
}

interface CoverImageFitFieldProps {
  /** URL da capa já digitada/enviada no campo acima — a mesma que vai para a matéria. */
  imageUrl: string;
  value: CoverImageFitValue;
  onChange: (next: CoverImageFitValue) => void;
  className?: string;
}

export function CoverImageFitField({
  imageUrl,
  value,
  onChange,
  className,
}: CoverImageFitFieldProps) {
  function markPoint(clientX: number, clientY: number, rect: DOMRect) {
    onChange({
      fit: 'focal',
      focalX: clampPercent(((clientX - rect.left) / rect.width) * 100),
      focalY: clampPercent(((clientY - rect.top) / rect.height) * 100),
    });
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    markPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Teclado não tem "onde a pessoa apontou" — o centro é o ponto de partida
    // mais razoável para quem ativa isto sem mouse, e continua ajustável
    // depois por qualquer um dos dois.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onChange({ fit: 'focal', focalX: 50, focalY: 50 });
  }

  return (
    <div className={className}>
      <span className="form-hint">Enquadramento da capa</span>

      <div className="admin-actions" role="radiogroup" aria-label="Enquadramento da capa">
        {COVER_IMAGE_FITS.map((fit) => (
          <label key={fit} className="form-inline">
            <input
              type="radio"
              name="coverImageFit"
              value={fit}
              checked={value.fit === fit}
              onChange={() =>
                onChange({
                  fit,
                  // Sair do modo 'focal' limpa o ponto: um ponto marcado num
                  // modo que não o usa é resíduo de uma escolha anterior, não
                  // dado válido — o servidor recusaria do mesmo jeito (ver
                  // `parseCoverImageFocus` em `server/article-input.ts`), mas
                  // é melhor a tela já refletir isso do que depender da
                  // validação para "corrigir" o que o formulário mostra.
                  focalX: fit === 'focal' ? value.focalX : null,
                  focalY: fit === 'focal' ? value.focalY : null,
                })
              }
            />
            {COVER_IMAGE_FIT_LABELS[fit]}
          </label>
        ))}
      </div>

      {value.fit === 'focal' &&
        (imageUrl ? (
          <>
            <div
              className="admin-focal-picker"
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              role="button"
              tabIndex={0}
              aria-label="Clique na imagem para marcar o ponto que não pode ser cortado"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- prévia do painel; ver o cabeçalho do arquivo */}
              <img src={imageUrl} alt="" className="admin-focal-picker__img" />
              {value.focalX !== null && value.focalY !== null && (
                <span
                  className="admin-focal-picker__marker"
                  style={{ left: `${value.focalX}%`, top: `${value.focalY}%` }}
                  aria-hidden="true"
                />
              )}
            </div>
            <span className="form-hint">
              Clique no ponto da imagem que não pode ser cortado — normalmente um rosto ou o
              elemento principal da composição.
              {value.focalX === null && ' Nenhum ponto marcado ainda; o rascunho não salva sem um.'}
            </span>
          </>
        ) : (
          <span className="form-hint">Adicione uma imagem de capa acima para marcar o ponto.</span>
        ))}
    </div>
  );
}

/** Uma casa decimal já é mais precisão do que qualquer clique de mouse tem. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
