import path from 'node:path';

import type { NextConfig } from 'next';

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
 * para na pasta de `apps/web` e os pacotes locais (`@canalnerd/*`, que são
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
 * CONFIGURAÇÃO DO NEXT.JS
 * =============================================================================
 *
 * Concentra três decisões de arquitetura que impactam SEO e resiliência a picos.
 */
const nextConfig: NextConfig = {
  ...standaloneOutput,

  // Os pacotes do monorepo são consumidos como TypeScript-fonte (sem passo de
  // build próprio). `transpilePackages` faz o Next compilá-los junto com o app.
  // Ganho: alterar um tipo em @canalnerd/core reflete no site com hot reload,
  // sem `npm run build` em cascata. Custo: build do app um pouco mais lento.
  transpilePackages: ['@canalnerd/core', '@canalnerd/db', '@canalnerd/scoring'],

  reactStrictMode: true,
  poweredByHeader: false,

  images: {
    // AVIF antes de WebP: melhor compressão, e o público é majoritariamente
    // mobile (dado do briefing), onde cada KB conta para o LCP.
    formats: ['image/avif', 'image/webp'],
    // Larguras alinhadas aos breakpoints do design system (design/README.md §6).
    deviceSizes: [320, 560, 640, 768, 900, 1024, 1180, 1280],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.ortuspixel.test' },
      { protocol: 'https', hostname: '**.ytimg.com' },
      // Placeholder de imagens do seed local — trocar pelo CDN real em produção.
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
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
