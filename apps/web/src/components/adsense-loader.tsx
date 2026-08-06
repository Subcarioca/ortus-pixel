/**
 * =============================================================================
 * CARREGADOR DO ADSENSE — um único script para o site inteiro
 * =============================================================================
 *
 * Server Component: decide se o script entra (com base na variável de
 * ambiente) sem custo nenhum no cliente. O `<Script>` do Next cuida da injeção.
 *
 * `strategy="lazyOnload"` — a escolha mais importante deste arquivo.
 *
 *   afterInteractive (o padrão que a maioria dos tutoriais recomenda) injeta o
 *   script logo após a hidratação, disputando banda com a imagem de capa
 *   justamente na janela em que o LCP é medido. Num 4G brasileiro, isso custa
 *   décimos de segundo na métrica que o projeto inteiro protege.
 *
 *   lazyOnload espera o evento `load` da página. O anúncio aparece um pouco
 *   depois; o conteúdo aparece antes. Para um portal de notícias, essa é a
 *   troca certa: LCP ruim custa posição no Google, o que custa MUITO mais do
 *   que alguns milissegundos de impressão de anúncio.
 *
 * `crossOrigin="anonymous"` é exigência do próprio AdSense para o script
 * carregar corretamente com CORS.
 *
 * O script NÃO é renderizado quando não há Publisher ID: em desenvolvimento e
 * em pré-produção, nenhuma requisição sai para o Google. Isso evita
 * contabilizar impressões inválidas com o próprio time navegando — motivo
 * clássico de suspensão de conta do AdSense.
 */

import Script from 'next/script';

import { ADSENSE_CLIENT_ID, ADS_ENABLED } from '@/lib/ads';

export function AdSenseLoader() {
  if (!ADS_ENABLED) return null;

  return (
    <Script
      id="adsbygoogle-loader"
      strategy="lazyOnload"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
        ADSENSE_CLIENT_ID,
      )}`}
    />
  );
}
