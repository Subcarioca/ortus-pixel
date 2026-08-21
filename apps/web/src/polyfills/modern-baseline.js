/**
 * =============================================================================
 * POLYFILLS — A LINHA DE BASE DECLARADA DO SITE, E NADA ALÉM DELA
 * =============================================================================
 *
 * Este arquivo SUBSTITUI `next/dist/build/polyfills/polyfill-module` no bundle
 * do cliente. A troca é feita por `resolve.alias` em `next.config.ts`, onde
 * está o racional completo — inclusive por que ela é necessária (o módulo do
 * Next é importado incondicionalmente e não obedece a `browserslist`).
 *
 * -----------------------------------------------------------------------------
 * O QUE O MÓDULO ORIGINAL TRAZ, E O QUE ACONTECE COM CADA ITEM AQUI
 * -----------------------------------------------------------------------------
 * A coluna da direita é a versão do Safari que passou a ter o recurso NATIVO —
 * escolhi o Safari como referência porque ele é, dos navegadores relevantes, o
 * que sempre chega por último, e porque no público brasileiro o iPhone antigo é
 * o caso de borda que de fato existe. Chrome e Firefox ganharam todos eles
 * antes.
 *
 *   String.prototype.trimStart / trimEnd   Safari 12.0  (2018)   → DESCARTADO
 *   Symbol.prototype.description           Safari 12.1  (2019)   → DESCARTADO
 *   Array.prototype.flat / flatMap         Safari 12.0  (2018)   → DESCARTADO
 *   Promise.prototype.finally              Safari 11.1  (2018)   → DESCARTADO
 *   Object.fromEntries                     Safari 12.1  (2019)   → DESCARTADO
 *   Array.prototype.at                     Safari 15.4  (2022)   → DESCARTADO
 *   Object.hasOwn                          Safari 15.4  (2022)   → DESCARTADO
 *   URL.canParse                           Safari 17.0  (2023)   → MANTIDO
 *
 * Os sete descartados são exatamente os sete que o PageSpeed Insights listou
 * como "JavaScript legado" na home (17 KiB de economia estimada), e todos estão
 * abaixo ou no piso declarado em `apps/web/package.json` → `browserslist`
 * (Safari/iOS 15.4). Ou seja: nenhum navegador que o projeto se compromete a
 * atender depende deles.
 *
 * `URL.canParse` é o único que fica, e o motivo é a data: setembro de 2023 no
 * Safari, dezembro de 2023 no Chrome. Ele está ACIMA do nosso piso, então um
 * navegador perfeitamente suportado (um iPhone em iOS 16, por exemplo) poderia
 * encontrar um `undefined` se algum código do Next o chamasse. Custa ~200 bytes
 * manter; custaria uma página branca não manter.
 *
 * -----------------------------------------------------------------------------
 * ESTE ARQUIVO E O `browserslist` SÃO DUAS METADES DA MESMA DECISÃO
 * -----------------------------------------------------------------------------
 * O `browserslist` decide que SINTAXE o SWC pode emitir no nosso código; este
 * arquivo decide que MÉTODOS de runtime o site assume existir. Se o piso do
 * `browserslist` descer (para atender um navegador mais antigo), os polyfills
 * correspondentes precisam voltar para cá — senão o alvo declarado passa a ser
 * uma promessa que o bundle não cumpre.
 *
 * -----------------------------------------------------------------------------
 * POR QUE `.js` E NÃO `.ts`
 * -----------------------------------------------------------------------------
 * Ele existe para SUBSTITUIR um arquivo `.js` de dentro do `node_modules`, e a
 * substituição é feita por caminho absoluto no `resolve.alias`. Em TypeScript,
 * atribuir `URL.canParse` exigiria uma declaração de ampliação de tipo global
 * só para fazer o compilador aceitar uma linha que só roda em navegador antigo.
 * Também fica fora do `tsc --noEmit` do `npm run typecheck` de propósito: não é
 * código de aplicação, é uma peça de compatibilidade de plataforma.
 */

// A guarda dupla é intencional. `typeof URL !== 'undefined'` protege o caso em
// que este módulo for arrastado para um contexto sem DOM (um teste em Node
// antigo, por exemplo); a segunda condição garante que jamais sobrescrevemos a
// implementação nativa, que é mais rápida e mais correta que esta.
if (typeof URL !== 'undefined' && typeof URL.canParse !== 'function') {
  /**
   * A implementação canônica: `canParse` responde "o construtor aceitaria isto
   * sem lançar?". Não existe caminho mais barato — a validação de URL não é
   * expressável por expressão regular sem reimplementar a WHATWG URL Standard,
   * e uma regex "quase certa" aqui seria pior que o `try/catch`, porque
   * responderia `true` para entradas que o `new URL()` recusa.
   */
  URL.canParse = function canParse(url, base) {
    try {
      // eslint-disable-next-line no-new -- o efeito desejado é só "lançou ou não"
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}

// Marca o arquivo como módulo ES para o webpack, em vez de script solto. Sem
// isto, o bundler o trataria como CommonJS e o `import` sem binding do cliente
// do Next passaria por um caminho de interoperabilidade desnecessário.
export {};
