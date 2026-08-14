/**
 * =============================================================================
 * MARCA — O "O" PIXELADO DA ORTUS
 * =============================================================================
 *
 * Pedido do dono do produto, textual: "o 'O' da ortus deve ser como um pixel e
 * inverta as cores do 'pixel'. O 'O' pixelado deve ser vermelho e o pixel
 * preto."
 *
 * -----------------------------------------------------------------------------
 * POR QUE A GEOMETRIA MORA AQUI, E NÃO DENTRO DO COMPONENTE
 * -----------------------------------------------------------------------------
 * O mesmo desenho é usado em TRÊS lugares que não compartilham runtime:
 *
 *   1. o wordmark do header e do rodapé (React, `components/pixel-o.tsx`);
 *   2. o `icon.svg` do site (arquivo estático, servido pelo Next);
 *   3. o `favicon.ico` e o `apple-icon.png` (binários, gerados por script).
 *
 * Se cada um tivesse a própria cópia da grade, bastaria alguém ajustar um pixel
 * num deles para a marca do site deixar de ser a marca da aba do navegador — e
 * ninguém percebe isso olhando um arquivo por vez. Aqui existe UMA grade, e o
 * script `scripts/gerar-marca.ts` regenera os binários a partir dela.
 *
 * -----------------------------------------------------------------------------
 * A GRADE: 8×8, E POR QUE ESSE TAMANHO
 * -----------------------------------------------------------------------------
 * O favicon precisa funcionar a 16×16 CSS pixels. Numa grade 8×8 cada célula
 * cai em exatamente 2×2 pixels de tela — número inteiro, sem meio pixel e sem
 * borrão. Grades ímpares (7, 9, 11) ou maiores (16) produzem células
 * fracionárias nesse tamanho, e o "O" vira uma mancha cinza-avermelhada.
 *
 * O contorno é octogonal (os cantos recuam um passo) em vez de um retângulo
 * vazado: é o que faz o olho ler "letra O" e não "quadrado com buraco". Parede
 * de 2 células, miolo de 4×4 — a maior abertura possível sem a parede afinar
 * para 1 célula, que some no favicon.
 */

/**
 * Cada string é uma linha; `#` é célula acesa, `.` é apagada.
 *
 * Está escrito como desenho ASCII de propósito: é a única representação em que
 * o revisor VÊ a marca ao ler o código, e um erro de um pixel fica óbvio no
 * diff. Coordenadas numéricas seriam mais compactas e ilegíveis.
 */
export const PIXEL_O_ROWS = [
  '..####..',
  '.######.',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '.######.',
  '..####..',
] as const;

/** Lado da grade, derivado do desenho — nunca digitado duas vezes. */
export const PIXEL_O_SIZE = PIXEL_O_ROWS.length;

/**
 * Converte a grade num único `d` de `<path>`.
 *
 * UM PATH SÓ, E NÃO UM `<rect>` POR CÉLULA — a diferença é visível: dois `rect`
 * vizinhos são duas operações de pintura, e o antialiasing do navegador deixa
 * um fio claro na emenda entre eles. Como um path único é UMA operação de
 * preenchimento, as células coladas viram uma área contínua e a costura
 * desaparece. Em desenho pixelado, essa costura é o defeito mais visível que
 * existe.
 *
 * Cada sequência horizontal contígua vira um retângulo (`M x y H x2 V y2 H x Z`),
 * o que também deixa o arquivo pequeno: 8 sub-caminhos em vez de 40 células.
 */
export function pixelOPath(): string {
  const parts: string[] = [];

  PIXEL_O_ROWS.forEach((row, y) => {
    let runStart: number | null = null;

    // O `<=` faz a varredura passar UMA posição além do fim da linha: é o que
    // fecha uma sequência que vai até a última coluna, sem repetir o código de
    // fechamento fora do laço.
    for (let x = 0; x <= row.length; x += 1) {
      const on = row[x] === '#';

      if (on && runStart === null) {
        runStart = x;
      } else if (!on && runStart !== null) {
        parts.push(`M${runStart} ${y}H${x}V${y + 1}H${runStart}Z`);
        runStart = null;
      }
    }
  });

  return parts.join('');
}

/**
 * CORES DOS ARQUIVOS ESTÁTICOS (favicon, apple-icon).
 *
 * Um .ico não lê CSS: ele precisa de um valor fixo. Estes literais são cópias
 * conscientes dos tokens `--brand` da folha de estilo — no site, quem manda é
 * sempre o token, e o componente React nem conhece estas constantes.
 *
 * Por que DUAS cores de marca e não uma: o SVG do favicon troca de cor com
 * `prefers-color-scheme` (Chrome e Firefox respeitam isso na aba). O carmim
 * claro (#A81729) some contra a barra escura do navegador; o tom claro
 * (#CA414F) some contra a barra clara. É a mesma regra do design system, só que
 * aplicada dentro do arquivo de ícone.
 */
export const BRAND_RED_LIGHT = '#A81729';
export const BRAND_RED_DARK = '#CA414F';

/**
 * Fundo do `apple-icon`. O iOS NÃO respeita transparência em ícone de tela de
 * início: ele compõe a arte sobre preto e, se o ícone for um "O" vermelho
 * transparente, o resultado é um símbolo escuro num quadrado escuro. Declarar o
 * fundo aqui é assumir a composição em vez de deixá-la para o sistema.
 * O valor é o `--ink` do tema claro, que é o preto da marca.
 */
export const BRAND_ICON_BG = '#16161A';
