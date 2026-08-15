/**
 * =============================================================================
 * GERADOR DOS ÍCONES DA MARCA — favicon e apple-icon
 * =============================================================================
 *
 *   npx tsx apps/web/scripts/gerar-marca.ts
 *
 * Desenha o SÍMBOLO DE GRAVAÇÃO da marca — o disco vermelho que ocupa o lugar
 * do "O" de Ortus — e escreve três arquivos dentro de `src/app/`, que é onde o
 * App Router do Next procura por ícones, sem nenhuma configuração, só pela
 * convenção de nome:
 *
 *   icon.svg        → <link rel="icon" type="image/svg+xml">  (navegador moderno)
 *   favicon.ico     → /favicon.ico                            (legado e Windows)
 *   apple-icon.png  → <link rel="apple-touch-icon">           (tela de início iOS)
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM SCRIPT, E NÃO `app/icon.tsx` COM ImageResponse
 * -----------------------------------------------------------------------------
 * O Next sabe gerar ícone em tempo de execução com `ImageResponse`. Para ESTE
 * site seria a escolha errada por dois motivos:
 *
 *   1. custo: `ImageResponse` carrega um renderizador (satori + resvg em wasm)
 *      no servidor para desenhar um círculo que nunca muda;
 *   2. risco de build: a saída é `output: standalone` rodando atrás de PM2 na
 *      Hostinger, e o wasm do resvg é a dependência que mais costuma faltar
 *      nesse tipo de empacotamento. Um favicon não vale um build quebrado.
 *
 * Arquivo estático tem custo zero em produção e é cacheável para sempre. O
 * preço é este script — que roda de novo em dois segundos se a marca mudar.
 *
 * -----------------------------------------------------------------------------
 * NÃO É PARTE DO BUILD, DE PROPÓSITO
 * -----------------------------------------------------------------------------
 * Os arquivos gerados são versionados no Git. Se este script rodasse no build,
 * `sharp` viraria dependência obrigatória do deploy para produzir um resultado
 * idêntico ao que já está commitado.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  BRAND_ICON_BG,
  BRAND_RED_DARK,
  BRAND_RED_LIGHT,
  REC_BOX,
  REC_RADIUS,
} from '../src/lib/brand-mark';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/app');
const CENTER = REC_BOX / 2;

/**
 * O SVG DA ABA — e o detalhe que faz diferença: ele troca de cor com o tema.
 *
 * Chrome e Firefox aplicam `prefers-color-scheme` DENTRO do SVG do favicon. O
 * carmim escuro (#A81729) some contra a barra de abas escura; o tom claro
 * (#CA414F) some contra a barra clara. Com a media query, o "O" fica visível
 * nos dois — é o mesmo par de valores do token `--brand` do design system.
 *
 * A FOLGA DE UMA UNIDADE (caixa de 16, raio 7) é o detalhe que decide se o
 * ícone fica redondo: no tamanho em que o favicon é realmente desenhado, uma
 * unidade do `viewBox` vale um pixel. Sem folga, o disco encosta nas quatro
 * bordas da área do ícone, o antialiasing come o topo e a base, e o círculo
 * sai achatado — lê como losango, não como disco.
 *
 * ⚠ NÃO HÁ MAIS `shape-rendering="crispEdges"` AQUI, e a ausência é
 * deliberada: aquele modo existia para o "O" pixelado, cujas arestas retas
 * precisavam ficar duras. Num círculo ele faz o oposto — desliga o
 * antialiasing e devolve uma borda serrilhada. Cada forma pede um modo de
 * rasterização, e herdar o da forma anterior é como um redesenho estraga o
 * trabalho do anterior sem ninguém notar.
 */
function svgIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${REC_BOX} ${REC_BOX}">
  <style>
    .rec { fill: ${BRAND_RED_LIGHT}; }
    @media (prefers-color-scheme: dark) { .rec { fill: ${BRAND_RED_DARK}; } }
  </style>
  <circle class="rec" cx="${CENTER}" cy="${CENTER}" r="${REC_RADIUS}"/>
</svg>
`;
}

/**
 * SVG de cor fixa, para os formatos que não entendem CSS (.ico e .png).
 *
 * `pad` é a folga EXTRA em volta do disco, em unidades do `viewBox`. Ela existe
 * só para o ícone do iOS, que precisa do símbolo respirando dentro do quadrado
 * de fundo; nos demais o disco já nasce com a folga interna do próprio raio.
 */
function svgFlat(fill: string, background: string | null, pad = 0): string {
  const box = REC_BOX + pad * 2;
  const center = box / 2;
  const bg = background
    ? `<rect width="${box}" height="${box}" rx="${box / 5}" fill="${background}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">
  ${bg}<circle cx="${center}" cy="${center}" r="${REC_RADIUS}" fill="${fill}"/>
</svg>
`;
}

/**
 * Empacota PNGs num contêiner .ico.
 *
 * O formato é de 1985 e cabe em vinte linhas: um cabeçalho de 6 bytes, uma
 * entrada de 16 bytes por tamanho e os dados no fim. O truque moderno é que a
 * carga pode ser um PNG inteiro em vez do bitmap DIB original — todo navegador
 * em uso hoje aceita, e é o que evita ter que escrever um codificador de BMP
 * com máscara de transparência invertida (a parte do formato que costuma sair
 * errada).
 *
 * `width`/`height` são UM byte: 256 não cabe e é escrito como 0. Por isso os
 * tamanhos param em 48 — que é o maior que o Windows usa na barra de tarefas.
 */
function buildIco(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // paleta: nenhuma
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  // 1. SVG da aba — o único que acompanha o tema do sistema.
  fs.writeFileSync(path.join(APP_DIR, 'icon.svg'), svgIcon(), 'utf8');

  /**
   * 2. favicon.ico com 16, 32 e 48.
   *
   * O vermelho aqui é o do tema CLARO: um .ico não tem como responder ao tema,
   * e ele só é servido a navegadores que não sabem ler o SVG acima.
   *
   * CADA TAMANHO É RASTERIZADO DIRETO DO VETOR, na densidade exata do destino
   * (`96 dpi × tamanho / caixa`), em vez de reduzir um bitmap grande. Para um
   * DISCO isso importa mais do que importava para a pixel art, e pelo motivo
   * oposto: reduzir bitmap com filtro Lanczos (o padrão do sharp) produz
   * "ringing" na borda curva — um fio mais claro e outro mais escuro em volta
   * do círculo, que a 16px lê como sujeira. Rasterizando no tamanho final, o
   * antialiasing é o do próprio renderizador de vetor, sem ressampleamento.
   */
  const flat = Buffer.from(svgFlat(BRAND_RED_LIGHT, null), 'utf8');
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(flat, { density: (96 * size) / REC_BOX })
        .resize(size, size)
        .png()
        .toBuffer(),
    })),
  );
  fs.writeFileSync(path.join(APP_DIR, 'favicon.ico'), buildIco(pngs));

  /**
   * 3. apple-icon.png (180×180), COM fundo.
   *
   * O iOS ignora transparência em ícone de tela de início e compõe sobre preto.
   * Um disco vermelho transparente viraria um símbolo escuro num quadrado
   * escuro, então o fundo é declarado aqui — preto de marca, disco no carmim
   * claro (o mesmo do tema escuro, porque é sobre fundo escuro que ele aparece).
   *
   * A folga extra de 4 unidades leva a caixa a 24 e deixa o disco ocupando 58%
   * do quadrado. Não é estética: ícone de iOS é recortado com canto arredondado
   * e ainda pode ganhar máscara circular em alguns contextos (relógio, widget).
   * Um símbolo que ocupa 88% da arte, como no favicon, seria mordido pelo
   * recorte; ~60% é a proporção que sobrevive a todos eles.
   */
  const apple = Buffer.from(svgFlat(BRAND_RED_DARK, BRAND_ICON_BG, 4), 'utf8');
  await sharp(apple, { density: (96 * 180) / (REC_BOX + 8) })
    .resize(180, 180)
    .png()
    .toFile(path.join(APP_DIR, 'apple-icon.png'));

  console.log('marca gerada em', APP_DIR);
  console.log('  icon.svg · favicon.ico (16/32/48) · apple-icon.png (180)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
