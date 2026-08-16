/**
 * =============================================================================
 * LAYOUT RAIZ
 * =============================================================================
 *
 * Server Component (padrão no App Router). Nada aqui vira JavaScript no
 * navegador, o que é decisivo para o LCP no celular — público majoritário
 * segundo o briefing.
 */

import type { Metadata, Viewport } from 'next';
import { Archivo, Inter, JetBrains_Mono } from 'next/font/google';

import { CATEGORIES, routes } from '@subcarioca/core';

import './ortuspixel.css';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, SOCIAL_HANDLE } from '@/lib/site';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { BottomNav } from '@/components/bottom-nav';
import { OrganizationJsonLd } from '@/components/json-ld';
import { AdSenseLoader } from '@/components/adsense-loader';

/**
 * =============================================================================
 * FONTES — `next/font/google`, e não `<link>` para fonts.googleapis.com
 * =============================================================================
 *
 * Antes o `<head>` tinha um `<link rel="stylesheet" href="fonts.googleapis...">`
 * carregando as três famílias. Isso custa DUAS viagens de rede em série: o
 * navegador baixa o CSS do Google, só depois de lê-lo descobre a URL do arquivo
 * .woff2 de cada peso e então baixa a fonte — enquanto isso, o texto pisca sem
 * estilo (FOUT) ou fica invisível, e os títulos em Archivo 800/900 (métrica bem
 * diferente da fonte de sistema) reflowam quando a fonte enfim chega.
 *
 * `next/font/google` baixa os arquivos em BUILD TIME, os hospeda no próprio
 * domínio (zero requisição a `fonts.googleapis.com`/`fonts.gstatic.com`, e por
 * isso os `<link rel="preconnect">` que existiam para eles saíram) e calcula um
 * `font-display: swap` com métricas de fallback ajustadas — o navegador já
 * reserva o espaço certo antes da fonte chegar, e a troca não move o layout.
 *
 * As FAMÍLIAS e os PESOS são exatamente os que já estavam em produção: Archivo
 * 600/800/900, Inter 400/500/600/700, JetBrains Mono 500/700. `variable` gera
 * uma CSS custom property que o `ortuspixel.css` referencia dentro de
 * `--font-display` / `--font-text` / `--font-mono` (ver `:root`) — a troca é só
 * de MECANISMO de carregamento, o nome final dessas três variáveis (usadas em
 * dezenas de regras do CSS) não mudou.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['600', '800', '900'],
  display: 'swap',
  variable: '--font-archivo',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

/**
 * Metadados padrão, herdados e sobrescritos por cada página.
 *
 * `metadataBase` é o que permite usar caminhos relativos em Open Graph e
 * canonical: sem ele, o Next emite avisos e as URLs sociais saem quebradas.
 *
 * Nome, URL e descrição vêm de `@/lib/site` — fonte única da marca. Ver o
 * racional lá: repetir o literal em cada arquivo é o que faz uma troca de marca
 * deixar rastro do nome antigo em um canto esquecido.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — As Notícias Nerd Mais Quentes, Primeiro`,
    // O `%s` é preenchido pelo título de cada página.
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: SITE_NAME,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    // `site` é a conta do VEÍCULO e `creator` a de quem assina o conteúdo.
    // Enquanto não houver perfil por autor, os dois apontam para a marca — é
    // preferível a deixar `creator` vazio, que faz o X exibir o card sem atribuição.
    site: SOCIAL_HANDLE,
    creator: SOCIAL_HANDLE,
  },
  // Título usado quando alguém adiciona o site à tela de início no iOS. O limite
  // prático é ~12 caracteres antes de o iOS truncar com reticências; "Ortus Pixel"
  // cabe, então usamos o nome da marca sem abreviar.
  appleWebApp: {
    title: SITE_NAME,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Sem limite de tamanho de prévia: em notícias, um snippet maior e uma
      // imagem grande na SERP aumentam bastante o CTR.
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  alternates: {
    canonical: '/',
    types: {
      'application/rss+xml': `${SITE_URL}/feed.xml`,
    },
  },
};

/**
 * Viewport separado dos metadados (exigência do Next 15+).
 *
 * `themeColor` casa com o TOPO do gradiente de fundo (`--bg-grad-top` somado ao
 * brilho de `--bg-grad-glow`, que é o que fica logo abaixo do header) e evita o
 * flash da barra do navegador no mobile — a primeira coisa que o usuário vê.
 * São DOIS valores, um por esquema: com um valor só, quem usa o tema escuro
 * teria a barra do navegador clara sobre um site escuro (ou o contrário), e a
 * emenda fica visível no topo da tela.
 *
 * ⚠ Estes literais são a ÚNICA cópia dos tokens de fundo fora do CSS, e é uma
 * cópia inevitável: a barra do navegador é pintada antes de qualquer folha de
 * estilo carregar. Se `--bg-grad-top` mudar no design system, mude aqui junto.
 *
 * `colorScheme: 'light dark'` declara que o site suporta os dois — é o que faz
 * o navegador pintar corretamente scrollbars, campos de formulário e controles
 * nativos, que não são estilizados pelo nosso CSS.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F9F9FB' },
    { media: '(prefers-color-scheme: dark)', color: '#191920' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` no <html>: o script inline abaixo altera o
    // atributo `data-theme` ANTES do React hidratar. Sem esta anotação, o React
    // avisaria no console que o HTML do servidor difere do que ele encontrou —
    // um aviso correto para qualquer outro atributo, e esperado para este.
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/*
          TEMA ANTES DA PRIMEIRA PINTURA (anti-FOUC).

          Precisa ser inline e síncrono, aqui no <head>: o HTML é estático e
          servido pela CDN (o servidor não sabe qual tema este leitor escolheu),
          então quem aplica a preferência é o navegador, antes de pintar. Ver o
          racional completo em lib/theme.ts.

          `dangerouslySetInnerHTML` com uma CONSTANTE do nosso próprio código —
          nenhum dado de usuário entra nesta string, portanto não há superfície
          de injeção.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/*
          Skip link: acessibilidade (WCAG 2.4.1). Permite ao usuário de teclado
          pular a navegação e ir direto ao conteúdo. Fica visível apenas ao
          receber foco — comportamento definido no CSS do design system.
        */}
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>

        <SiteHeader categories={CATEGORIES} />

        <main id="conteudo">{children}</main>

        <SiteFooter categories={CATEGORIES} />

        {/* Navegação inferior fixa: o público usa o celular com uma mão. */}
        <BottomNav />

        {/*
          Dados estruturados da Organização.
          Peça de E-E-A-T: é como o Google associa o site a uma entidade
          editorial real, com logo, perfis sociais e contato.
        */}
        <OrganizationJsonLd siteName={SITE_NAME} siteUrl={SITE_URL} />

        {/*
          Script do AdSense.

          Ele está declarado aqui no fim do <body>, mas NÃO é aqui que ele
          aparece no HTML: o componente renderiza um `<script async src>`, e o
          React 19 iça esse tipo de tag para dentro do <head> — que é onde o
          Google manda colar o trecho e onde o rastreador dele procura. O
          racional completo (e por que `next/script` não servia) está no
          cabeçalho do componente.

          Não renderiza nada em três situações, e as três são proteção contra
          impressão inválida (a infração que suspende a CONTA, não a página):
            1. sem Publisher ID configurado (desenvolvimento e pré-produção);
            2. em qualquer rota do painel editorial (`/admin/*`);
            3. quando o roteador não sabe informar a rota atual (falha fechada).
          O racional completo está no cabeçalho do componente.
        */}
        <AdSenseLoader />
      </body>
    </html>
  );
}
