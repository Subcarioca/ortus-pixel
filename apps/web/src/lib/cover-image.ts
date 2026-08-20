/**
 * =============================================================================
 * ENQUADRAMENTO DA CAPA — recorte automático, imagem completa ou ponto focal
 * =============================================================================
 *
 * O QUE ISTO RESOLVE: `object-fit: cover` (o comportamento de sempre) enche o
 * retângulo 16:9 do card e da capa cortando o que sobra dos lados ou de cima e
 * de baixo. Funciona bem para a maioria das fotos, e mal para um pôster, um
 * quadrinho ou qualquer imagem cuja composição não pode perder borda — o corte
 * automático vira a diferença entre "ilustra a matéria" e "corta a cabeça de
 * alguém".
 *
 * -----------------------------------------------------------------------------
 * POR QUE TRÊS MODOS, E NÃO UM RECORTE DE PIXELS DE VERDADE
 * -----------------------------------------------------------------------------
 * A alternativa "de verdade" — o editor desenha um retângulo sobre a imagem e o
 * servidor grava uma imagem já cortada — exige processamento de imagem
 * (canvas, upload do recorte, um segundo arquivo no CDN por matéria) para um
 * ganho que os dois modos abaixo já cobrem na prática:
 *
 *   'contain' — resolve o caso "não pode cortar NADA": a imagem inteira aparece,
 *               sem recorte algum.
 *   'focal'   — resolve o caso "pode cortar, mas não ISSO": o editor marca o
 *               ponto que precisa sobreviver ao corte, e `object-position`
 *               ancora o `cover` de sempre nesse ponto — mesmo recorte
 *               automático, mesma moldura 16:9, âncora diferente.
 *
 * Entre os dois, cobre-se o motivo real por trás de "deixa eu escolher o
 * enquadramento" sem processar imagem no servidor. Fica registrado que esta é
 * uma decisão de ESCOPO, não a única leitura possível do pedido — ver o
 * relatório de quem integrou isto ao formulário para o contexto completo.
 *
 * -----------------------------------------------------------------------------
 * 'cover' É O PADRÃO, E ISSO NÃO É NEUTRO
 * -----------------------------------------------------------------------------
 * Toda matéria já publicada antes desta coluna existir precisa continuar com a
 * MESMA aparência. `@default("cover")` no schema (ver `Article.coverImageFit`
 * em `packages/db/prisma/schema.prisma`) é o que garante isso sem backfill: a
 * coluna nasce com o valor que já era o comportamento de fato.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE MÓDULO VIVE EM `apps/web/src/lib`, E NÃO EM `packages/core`
 * -----------------------------------------------------------------------------
 * O restante do vocabulário fechado do projeto (`ContentSensitivity`,
 * `ContentFormat`, `ContentOrigin`...) mora em `packages/core`, compartilhado
 * entre `apps/web` e outros pacotes. Este campo é usado SÓ dentro de
 * `apps/web` (formulário do painel, validação da rota, renderização pública) —
 * e o trabalho que o introduziu tinha escopo deliberadamente restrito a
 * `apps/web/` e ao schema do Prisma, para não interferir em `packages/core`
 * enquanto outro trabalho corre em paralelo no monorepo. Se um dia outro
 * pacote precisar deste vocabulário, migrar para `core` é mover um arquivo.
 */

export const COVER_IMAGE_FITS = ['cover', 'contain', 'focal'] as const;

export type CoverImageFit = (typeof COVER_IMAGE_FITS)[number];

/** Valor desconhecido cai em 'cover' — o comportamento de sempre, o mais seguro. */
export function toCoverImageFit(value: unknown): CoverImageFit {
  return (COVER_IMAGE_FITS as readonly unknown[]).includes(value)
    ? (value as CoverImageFit)
    : 'cover';
}

export function isCoverImageFit(value: unknown): value is CoverImageFit {
  return (COVER_IMAGE_FITS as readonly unknown[]).includes(value);
}

export const COVER_IMAGE_FIT_LABELS: Record<CoverImageFit, string> = {
  cover: 'Recorte automático (padrão)',
  contain: 'Imagem completa (sem cortar)',
  focal: 'Escolher enquadramento (marcar o que não pode ser cortado)',
};

/**
 * O ponto focal é um percentual (0–100) de posição dentro da imagem, nos dois
 * eixos. Fora dessa faixa não é coordenada válida — é dado que `object-position`
 * aceita sem reclamar (um número negativo ou maior que 100 não quebra o CSS,
 * só posiciona a imagem fora da moldura visível), então a checagem é do
 * VALIDADOR, não do navegador.
 */
export function isValidFocalCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
