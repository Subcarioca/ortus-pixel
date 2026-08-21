import path from 'node:path';

import type { NextConfig } from 'next';

import { ALLOWED_IMAGE_HOSTS } from './src/lib/image-hosts';

/**
 * SAÍDA `standalone` — LIGADA SOB DEMANDA, NÃO POR PADRÃO.
 *
 * O modo `standalone` faz o Next emitir, além do build normal, uma pasta
 * `.next/standalone` com um `server.js` autocontido e apenas os arquivos de
 * `node_modules` que o rastreamento provou serem necessários. É o que permite
 * uma imagem Docker de runtime pequena, sem `npm install` no contêiner.
 *
 * POR QUE CONDICIONAL, E NÃO SEMPRE LIGADO:
 * o caminho de execução já validado (PM2 rodando `next start`) não precisa
 * disso e pagaria build mais lento e disco extra a cada deploy. Deixando a
 * decisão numa variável de ambiente, o Dockerfile liga (`NEXT_OUTPUT_STANDALONE=1`)
 * e o caminho PM2 continua exatamente como estava — nenhum comportamento muda
 * para quem não pediu.
 *
 * `outputFileTracingRoot` é obrigatório em monorepo: sem ele o rastreamento
 * para na pasta de `apps/web` e os pacotes locais (`@subcarioca/*`, que são
 * links simbólicos para `packages/`) ficam de fora — o contêiner sobe e quebra
 * no primeiro import, em runtime. `process.cwd()` durante o build é a pasta do
 * workspace (`apps/web`), então dois níveis acima é a raiz do monorepo.
 */
const standaloneOutput: Pick<NextConfig, 'output' | 'outputFileTracingRoot'> =
  process.env.NEXT_OUTPUT_STANDALONE === '1'
    ? {
        output: 'standalone',
        outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
      }
    : {};

/**
 * =============================================================================
 * POLYFILLS: TROCAR O PACOTE FIXO DO NEXT POR UM DE LINHA DE BASE MODERNA
 * =============================================================================
 *
 * O ACHADO DO PAGESPEED (home, desktop): "JavaScript legado — 17 KiB de economia
 * estimada", apontando o chunk `_next/static/chunks/18-*.js` e listando SETE
 * polyfills desnecessários — `Array.prototype.at`, `Array.prototype.flat`,
 * `Array.prototype.flatMap`, `Object.fromEntries`, `Object.hasOwn`,
 * `String.prototype.trimEnd` e `String.prototype.trimStart`.
 *
 * DE ONDE ELES VÊM, E POR QUE `browserslist` SOZINHO NÃO OS TIRA:
 * essa lista é, palavra por palavra, o conteúdo de `next-polyfill-module`
 * (`next/dist/build/polyfills/polyfill-module`) — um módulo que o cliente do
 * Next importa INCONDICIONALMENTE, no topo de `next/dist/client/next.js`. Ele
 * não passa pelo alvo de transpilação: não existe `browserslist`, `.babelrc` ou
 * opção de `next.config` que o remova (issue vercel/next.js#86785, ainda aberta;
 * discussão #64330). O `browserslist` que acrescentamos em `package.json`
 * resolve a OUTRA metade do problema — o downlevel do NOSSO código pelo SWC —,
 * mas esses 17 KiB só saem trocando o módulo.
 *
 * O QUE FAZEMOS, E POR QUE NÃO É O `alias: false` QUE A COMUNIDADE SUGERE:
 * a receita mais divulgada aponta o módulo para `false`, o que apaga o pacote
 * INTEIRO. Isso derruba junto o único polyfill dali que ainda é jovem de
 * verdade: `URL.canParse` (Safari 17, set/2023; Chrome 120, dez/2023). Um
 * navegador de 2022 — dentro do nosso alvo declarado — quebraria de verdade se
 * algo do Next o chamasse. Então em vez de apagar, SUBSTITUÍMOS por um módulo
 * nosso que mantém `URL.canParse` e larga os outros sete, todos com suporte
 * nativo desde iOS/Safari 15.4 (mar/2022) — que é exatamente o piso declarado no
 * `browserslist`. Os dois arquivos precisam concordar: mexeu em um, confira o
 * outro. Ver `src/polyfills/modern-baseline.js`.
 *
 * PARA REVERTER: apague o bloco `webpack` lá embaixo. Nada mais depende disto.
 *
 * ⚠ O alias é aplicado no WEBPACK, que é o compilador usado por `next build` e
 * `next dev` neste projeto (nenhum dos dois passa `--turbopack`). Se um dia o
 * projeto migrar para o Turbopack, a substituição precisa ser repetida em
 * `turbopack.resolveAlias` — senão os 17 KiB voltam em silêncio.
 *
 * As DUAS chaves são necessárias porque o webpack casa o alias contra a STRING
 * do pedido, e o mesmo módulo é pedido de duas formas: pelo caminho relativo,
 * de dentro do próprio Next, e pelo caminho completo do pacote.
 */
const MODERN_POLYFILL_MODULE = path.join(
  process.cwd(),
  'src',
  'polyfills',
  'modern-baseline.js',
);

/**
 * =============================================================================
 * CONFIGURAÇÃO DO NEXT.JS
 * =============================================================================
 *
 * Concentra três decisões de arquitetura que impactam SEO e resiliência a picos.
 */
const nextConfig: NextConfig = {
  ...standaloneOutput,

  // O Prisma detecta se o próprio runtime foi bundlado checando se
  // `__filename` bate com `runtime/library.js` — e falha com uma mensagem
  // enganosa ("bundler não copiou o engine") quando não bate. Sem isto, o
  // webpack tenta empacotar `@prisma/client` junto do resto (arrastado pelo
  // `transpilePackages` de `@subcarioca/db`), e o runtime deixa de casar esse
  // caminho. `serverExternalPackages` mantém os dois como `require()` normal
  // em vez de conteúdo bundlado — resolvido do `node_modules` de verdade,
  // exatamente como o Prisma espera.
  serverExternalPackages: ['@prisma/client', '.prisma/client'],

  // Os pacotes do monorepo são consumidos como TypeScript-fonte (sem passo de
  // build próprio). `transpilePackages` faz o Next compilá-los junto com o app.
  // Ganho: alterar um tipo em @subcarioca/core reflete no site com hot reload,
  // sem `npm run build` em cascata. Custo: build do app um pouco mais lento.
  transpilePackages: ['@subcarioca/core', '@subcarioca/db', '@subcarioca/scoring'],

  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * ===========================================================================
   * IMAGENS — e a correção da queixa "as imagens estão pixeladas"
   * ===========================================================================
   *
   * A CAUSA RAIZ Nº 1 ESTAVA AQUI, e ela é aritmética, não estética.
   *
   * `deviceSizes` não é "a lista de breakpoints do layout". É a lista de
   * larguras REAIS, em pixels de imagem, que o otimizador pode gerar — e o
   * navegador escolhe uma delas multiplicando a largura de exibição em CSS pela
   * DENSIDADE DA TELA (`devicePixelRatio`). A lista anterior copiava os
   * breakpoints do design system e parava em 1280, o que produzia esta conta:
   *
   *   capa de matéria no desktop → 1088px de CSS (`--media-max: 68rem`)
   *     · tela comum (DPR 1)   → precisa de 1088 → recebe 1180 ✓
   *     · Windows a 150% (1,5) → precisa de 1632 → recebe 1280 ✗ (estica 1,28×)
   *     · notebook retina (2)  → precisa de 2176 → recebe 1280 ✗ (estica 1,70×)
   *
   *   hero da home ocupando a linha inteira → até 1232px de CSS
   *     · DPR 2                → precisa de 2464 → recebe 1280 ✗ (estica 1,93×)
   *
   *   celular Android topo de linha (412px de CSS, DPR 3,5)
   *     · sangria de borda a borda → precisa de 1442 → recebe 1280 ✗
   *
   * Toda vez que a conta dá acima de 1280, o navegador baixa o maior arquivo
   * disponível e o ESTICA. É exatamente o "pixelado" reportado pelo dono do
   * site — e nenhum ajuste de qualidade de compressão corrige isso, porque o
   * problema não é o quanto a imagem foi comprimida, é que ela tem menos pixels
   * do que a tela precisa. (Foi por isso que a sugestão do PageSpeed de
   * "aumentar o fator de compactação" NÃO foi seguida: ela pioraria a queixa
   * sem tocar na causa.)
   *
   * A lista nova mantém TODOS os degraus antigos (nenhuma tela que hoje recebe
   * um arquivo bem dimensionado passa a receber outro) e acrescenta o topo que
   * faltava: 1536, 1800, 2176 e 2560. Os quatro cobrem, nesta ordem, o celular
   * de alta densidade, o hero em DPR 1,5, a capa de matéria em DPR 2 e o hero
   * de tela cheia em DPR 2.
   *
   * O CUSTO É MENOR DO QUE PARECE, e vale dizer por quê: o Next NUNCA amplia
   * além da imagem de origem. Pedir `w=2176` de uma capa enviada com 1600px de
   * largura devolve 1600px — não um arquivo inflado. Ou seja, os degraus novos
   * só produzem arquivo maior quando existe pixel de verdade para entregar; nos
   * demais casos eles são inertes. E cada variante é gerada sob demanda, uma
   * vez, e fica em cache.
   *
   * ⚠ ISSO EXPÕE A CAUSA RAIZ Nº 2, que não se resolve em arquivo de
   * configuração: se a capa ENVIADA tiver 900px de largura, nenhum degrau novo
   * a torna nítida. O upload não redimensiona nem recomprime nada (ver
   * `server/uploads.ts`), então a nitidez final é a do arquivo que a redação
   * mandou — e o teto de 1,8 MB empurrava todo mundo a encolher a imagem antes
   * de enviar. O aviso de resolução em `server/upload-rules.ts` ataca esse lado.
   */
  images: {
    // AVIF antes de WebP: melhor compressão, e o público é majoritariamente
    // mobile (dado do briefing), onde cada KB conta para o LCP.
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 560, 640, 768, 900, 1024, 1180, 1280, 1536, 1800, 2176, 2560],
    /**
     * ELEMENTOS QUE NUNCA OCUPAM A LARGURA DA TELA — avatar da assinatura
     * (40px), logo de loja no bloco de ofertas (30px), miniatura de produto
     * (120px).
     *
     * Estes valores são EXATAMENTE os padrões do Next 15.5, e estão escritos
     * aqui de propósito: sem a declaração, quem lê o arquivo não tem como saber
     * se os elementos pequenos estão cobertos ou se ninguém pensou neles.
     * Estão cobertos — o avatar de 40px cai em 48 (densidade 1) e 96
     * (densidade 2); a miniatura de produto de 120px cai em 128 e 256.
     * Declarar também congela o comportamento caso um upgrade do Next mude o
     * padrão por baixo.
     *
     * ⚠ ESTA LISTA SÓ É CONSULTADA PARA IMAGENS COM `sizes` ou com `width`
     * numérico — que é o caso de todas as nossas. Ela é concatenada com
     * `deviceSizes` para formar o conjunto de larguras possíveis; não é uma
     * lista paralela.
     */
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    /**
     * QUALIDADE: 75, QUE É O PADRÃO — E A DECISÃO DE NÃO MEXER NELE.
     *
     * Nenhum `<Image>` do projeto passa `quality`, então todas as imagens já
     * saem em 75. A tentação, diante de "está pixelado", é subir esse número —
     * e seria trocar a causa certa pela errada: 75 em AVIF/WebP não produz
     * blocagem visível em foto de capa, e subir para 90 engordaria TODA imagem
     * do site (inclusive o LCP da home, que o PageSpeed já quer menor) para
     * consertar um problema que era de DIMENSÃO, resolvido acima.
     *
     * Declarar a lista explicitamente tem dois efeitos práticos: silencia o
     * aviso de depreciação do Next 15.5 (no 16, usar `quality` fora da lista
     * declarada vira erro) e transforma qualquer mudança futura numa decisão
     * consciente — quem quiser `quality={90}` num componente precisa vir aqui e
     * dizer por quê.
     */
    qualities: [75],
    // A lista vive em `src/lib/image-hosts.ts` porque o painel editorial também
    // precisa dela: é ela que decide se a URL de capa colada pelo editor é
    // aceitável ANTES de publicar. Ver o cabeçalho daquele arquivo.
    remotePatterns: ALLOWED_IMAGE_HOSTS.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
    })),
  },

  /**
   * Substituição do pacote de polyfills do Next. Todo o racional — inclusive
   * por que `browserslist` sozinho não resolve e por que não usamos
   * `alias: false` — está em `MODERN_POLYFILL_MODULE`, no topo deste arquivo.
   *
   * `config` é `any` na assinatura do próprio Next (o tipo do webpack não é
   * exportado por ele), o que significa que o compilador NÃO nos protege aqui —
   * daí os dois cuidados abaixo:
   *
   *  1. MUTAÇÃO NO LUGAR, e não `{ ...alias, nossosAliases }`. O objeto de
   *     alias que o Next monta contém React, `@/` e os pacotes do monorepo;
   *     recriá-lo é a forma clássica de apagar um deles sem perceber.
   *  2. GUARDA DE FORMATO. O webpack aceita `resolve.alias` como objeto OU como
   *     array de regras. O Next usa objeto — mas se um dia isso mudar, escrever
   *     chaves de string num array falharia em SILÊNCIO: o build passaria e os
   *     17 KiB voltariam sem nenhum aviso. Preferimos derrubar o build com uma
   *     mensagem que diz exatamente o que conferir.
   */
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};

    const alias: unknown = config.resolve.alias;

    if (typeof alias !== 'object' || alias === null || Array.isArray(alias)) {
      throw new Error(
        '[next.config] `resolve.alias` não é mais um objeto simples. A substituição do ' +
          'pacote de polyfills do Next (ver MODERN_POLYFILL_MODULE, no topo do arquivo) ' +
          'precisa ser reescrita para o novo formato — sem isso ela deixaria de valer em silêncio.',
      );
    }

    const aliasMap = alias as Record<string, string>;
    aliasMap['next/dist/build/polyfills/polyfill-module'] = MODERN_POLYFILL_MODULE;
    aliasMap['../build/polyfills/polyfill-module'] = MODERN_POLYFILL_MODULE;

    return config;
  },

  /**
   * REDIRECIONAMENTOS 301 — resolvem o conflito de URLs entre briefing e design.
   *
   * O briefing pede /categoria/games e /franquia/x; o protótipo de design propõe
   * /games e /f/x. As URLs canônicas estão em `core/routes.ts`; aqui garantimos
   * que o formato alternativo nunca resulte em 404 e transfira autoridade de SEO
   * para o canônico.
   *
   * `permanent: true` emite 301 (e não 302) porque é isso que consolida a
   * autoridade do link no destino. Um 302 mantém o valor na URL antiga e
   * desperdiça o sinal.
   */
  async redirects() {
    return [
      { source: '/f/:slug', destination: '/franquia/:slug', permanent: true },
      { source: '/trending', destination: '/em-alta', permanent: true },
    ];
  },

  /**
   * CABEÇALHOS DE SEGURANÇA.
   *
   * Aplicados a todas as rotas. Cada um fecha uma classe de ataque do OWASP
   * Top 10 — ver README, seção "Segurança".
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Impede que o navegador "adivinhe" o tipo do conteúdo. Sem isso, um
          // upload de texto pode ser interpretado como script (XSS).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Bloqueia o site dentro de iframes de terceiros (clickjacking).
          { key: 'X-Frame-Options', value: 'DENY' },
          // Não vaza a URL completa (que pode conter token) para sites externos.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Revoga APIs sensíveis que este site nunca usa.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Força HTTPS por 2 anos. Só faz efeito em produção com TLS válido.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // O service worker precisa de escopo raiz para receber push de qualquer
        // página, e não pode ser cacheado — senão uma correção nele levaria
        // semanas para chegar aos navegadores.
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
