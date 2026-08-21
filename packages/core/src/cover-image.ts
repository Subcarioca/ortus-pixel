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
 * ganho que os dois modos abaixo já cobrem na prática, e sem reabrir o risco
 * de dependência nativa que este projeto já pagou duas vezes com o Prisma
 * (ver o histórico de `vendor/dot-prisma-client` no workflow de deploy):
 *
 *   'contain' — resolve o caso "não pode cortar NADA": a imagem inteira aparece,
 *               sem recorte algum.
 *   'focal'   — resolve o caso "pode cortar, mas não ISSO": o editor marca o
 *               ponto que precisa sobreviver ao corte, e `object-position`
 *               ancora o `cover` de sempre nesse ponto — mesmo recorte
 *               automático, mesma moldura 16:9, âncora diferente.
 *
 * Entre os dois, cobre-se o motivo real por trás de "deixa eu escolher o
 * enquadramento" sem processar imagem no servidor.
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
 * POR QUE ESTE MÓDULO VIVE EM `packages/core`
 * -----------------------------------------------------------------------------
 * Mesmo lugar de `ContentSensitivity`/`ContentFormat` (ver
 * `content-sensitivity.ts` ao lado): vocabulário fechado, compartilhado entre
 * `apps/web` e qualquer outro pacote que um dia precise ler ou escrever um
 * `Article.coverImageFit`, com uma função de normalização que nunca deixa um
 * valor de banco desconhecido virar `undefined` na tela.
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

/**
 * Valida o PAR modo + ponto focal — usado tanto pela capa da matéria
 * (`server/article-input.ts`) quanto por uma imagem do corpo em blocos
 * (`server/blocks-input.ts`), que são a MESMA regra em dois lugares que
 * gravam enquadramento: viver aqui, em vez de duplicada nos dois servidores,
 * é o que impede um dia alguém apertar a validação de um lado só.
 *
 * Fora do modo 'focal', as coordenadas são forçadas a `null` — mesmo que o
 * cliente tenha mandado um valor (resíduo de quando o editor esteve em modo
 * 'focal' e trocou de ideia, por exemplo). Não é erro de formulário, é
 * limpeza: gravar coordenadas que o modo atual não usa criaria um dado
 * inconsistente sem exigir NENHUM reenvio malicioso — bastaria trocar o
 * `<select>` sem limpar os campos escondidos.
 *
 * Dentro de 'focal', as coordenadas SÃO obrigatórias e VALIDADAS (número
 * 0–100 nos dois eixos): um "escolher enquadramento" sem ponto marcado não é
 * um estado válido — é a tela ter mandado o modo sem terminar a interação, e
 * gravar isso silenciosamente como `null` faria a matéria renderizar com
 * `object-position: null% null%`, que os navegadores toleram mal.
 */
export function parseCoverImageFocus(
  fit: CoverImageFit,
  rawX: unknown,
  rawY: unknown,
): { focalX: number | null; focalY: number | null } | { error: string } {
  if (fit !== 'focal') {
    return { focalX: null, focalY: null };
  }

  // A coação por `Number()` só faz sentido para STRING (o formulário HTML
  // manda os dois campos ocultos como texto). `null`/`undefined` — "nenhum
  // ponto marcado ainda", o estado que a própria tela avisa que não salva —
  // não podem virar `0` por baixo: `Number(null)` é `0`, uma coordenada
  // válida (canto superior esquerdo), e isso transformaria silenciosamente
  // "ninguém marcou nada" em "marcou o canto", que é o oposto do que o aviso
  // do formulário promete.
  const x = typeof rawX === 'number' ? rawX : typeof rawX === 'string' ? Number(rawX) : NaN;
  const y = typeof rawY === 'number' ? rawY : typeof rawY === 'string' ? Number(rawY) : NaN;

  if (!isValidFocalCoordinate(x) || !isValidFocalCoordinate(y)) {
    return {
      error:
        'Para "Escolher enquadramento", clique num ponto da imagem para marcar o que não pode ser cortado.',
    };
  }

  return { focalX: x, focalY: y };
}
