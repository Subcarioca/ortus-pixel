/**
 * =============================================================================
 * MARCA — O "O" DA ORTUS COMO SINAL DE GRAVAÇÃO (REC)
 * =============================================================================
 *
 * Pedido do dono do produto, textual: "vamos manter o 'Pixel' pixelado e o O
 * como se fosse o símbolo de gravação em andamento, aquele símbolo vermelho de
 * que algo está sendo gravado."
 *
 * A marca curta é `●.Pixel` no header e `●rtus Pixel` no rodapé: o círculo
 * vermelho cheio ocupa o lugar da letra "O" de Ortus. "Pixel" não mudou.
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM CÍRCULO CHEIO, E NÃO UM ANEL
 * -----------------------------------------------------------------------------
 * O símbolo universal de "gravando" é o disco vermelho sólido — em câmera, em
 * gravador, no ponto vermelho da aba de uma chamada. Um anel (o "O" pixelado
 * que estava aqui até ontem) lê como letra; o disco lê como ESTADO. É essa a
 * troca que o pedido faz: a marca deixa de dizer "Ortus" e passa a dizer
 * "estamos no ar agora", o que é literalmente o produto — cobertura de notícia
 * em tempo real.
 *
 * O preço da troca é honesto e vale registrar: um disco cheio é menos legível
 * como a letra "O" do que um anel era, principalmente no rodapé (`●rtus`). É
 * decisão do dono, e o nome completo continua acessível a quem não vê o
 * símbolo — o `aria-label` do link diz "Ortus Pixel" nos dois lugares.
 *
 * -----------------------------------------------------------------------------
 * ONDE CADA VERSÃO DO SÍMBOLO VIVE
 * -----------------------------------------------------------------------------
 *   1. WORDMARK (header e rodapé) → NÃO passa por aqui. É um `<span>` vazio
 *      estilizado por `.logo__rec` (ortuspixel.css §19.1): um círculo de CSS com
 *      `border-radius: 50%`, mais um halo animado em `::after`. Um círculo não
 *      tem geometria a compartilhar — `border-radius` já é a definição inteira —,
 *      e como `<span>` ele herda cor e tamanho do wordmark e ainda ganha a
 *      animação de graça. Um SVG ali seria mais código para o mesmo pixel.
 *
 *   2. ÍCONES ESTÁTICOS (favicon.ico, icon.svg, apple-icon.png) → daqui. São
 *      binários gerados por `scripts/gerar-marca.ts`, que não têm CSS nem
 *      animação e precisam de valores fixos.
 *
 * As duas versões dizem "disco vermelho" em linguagens diferentes; o que as
 * mantém coerentes são as cores abaixo, que são cópia consciente dos tokens.
 */

/**
 * Lado da caixa do símbolo e raio do disco, nas unidades do `viewBox`.
 *
 * 16 e 7 (ou seja, diâmetro de 14 em 16) NÃO são arbitrários: o favicon é
 * desenhado a 16 pixels, então uma unidade do `viewBox` vale exatamente um
 * pixel de tela nesse tamanho, e o disco de 14px deixa 1px de folga de cada
 * lado. Sem essa folga o círculo encosta na borda da área do ícone e o
 * antialiasing come o topo e a base, achatando o disco num losango.
 */
export const REC_BOX = 16;
export const REC_RADIUS = 7;

/**
 * CORES DOS ARQUIVOS ESTÁTICOS.
 *
 * Um .ico não lê CSS: precisa de valor fixo. Estes literais são cópias
 * conscientes dos tokens `--brand` da folha de estilo — no site, quem manda é
 * sempre o token, e o wordmark nem conhece estas constantes.
 *
 * Por que DUAS cores de marca e não uma: o SVG do favicon troca de cor com
 * `prefers-color-scheme` (Chrome e Firefox respeitam isso na aba). O carmim
 * escuro (#A81729) some contra a barra escura do navegador; o claro (#CA414F)
 * some contra a barra clara.
 *
 * ⚠ E POR QUE NÃO O VERMELHO VIVO DE "URGENTE" (`--heat-hot`, #DE0E2D), que
 * seria o vermelho mais "de gravação" dos dois: a regra dos dois vermelhos
 * (ortuspixel.css §1) reserva aquele tom EXCLUSIVAMENTE para sinalizar
 * temperatura de conteúdo. Usá-lo na marca gastaria, em toda página do site, o
 * único vermelho que o leitor aprendeu a associar a "isto está pegando fogo
 * agora". A marca usa o carmim; o sinal de gravação vem da FORMA e do
 * movimento, não de subir a saturação.
 */
export const BRAND_RED_LIGHT = '#A81729';
export const BRAND_RED_DARK = '#CA414F';

/**
 * Fundo do `apple-icon`. O iOS NÃO respeita transparência em ícone de tela de
 * início: ele compõe a arte sobre preto e, se o ícone for um disco vermelho
 * transparente, o resultado é um símbolo escuro num quadrado escuro. Declarar o
 * fundo aqui é assumir a composição em vez de deixá-la para o sistema.
 * O valor é o `--ink` do tema claro, que é o preto da marca.
 */
export const BRAND_ICON_BG = '#16161A';
