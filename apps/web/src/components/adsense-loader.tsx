'use client';

/**
 * =============================================================================
 * CARREGADOR DO ADSENSE — um script para o SITE, nunca para o PAINEL
 * =============================================================================
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
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE COMPONENTE É DE CLIENTE (ele era um Server Component)
 * -----------------------------------------------------------------------------
 * BUG CORRIGIDO: ele é renderizado pelo LAYOUT RAIZ, ou seja, em toda página do
 * projeto — inclusive no painel editorial inteiro (`/admin/*`). Com "Auto ads"
 * ligado (interruptor da CONTA do Google, não do nosso código), o Google injeta
 * unidades sozinho em qualquer página onde este script exista. O efeito prático
 * era anúncio dentro da fila de pautas, da lista de matérias e da tela de
 * contas, exibido para a própria redação — impressão inválida, cuja punição
 * recai sobre a CONTA inteira e não sobre a página.
 *
 * Para não carregar no painel é preciso saber QUAL é a rota atual, e no App
 * Router essa informação não existe em Server Component: não há API de pathname
 * para o servidor, e a alternativa usual (um `middleware.ts` propagando o
 * caminho num cabeçalho) foi descartada de propósito neste projeto — ver o
 * cabeçalho de `server/staff-auth.ts`, que explica por que a autorização não
 * vive em middleware aqui. Criar um middleware só para isto contrariaria aquela
 * decisão e acrescentaria uma camada que roda em TODA requisição do site.
 *
 * O custo real de 'use client' aqui é praticamente nulo: `next/script` já é uma
 * peça de cliente, este componente não renderiza marcação, e `usePathname` é um
 * hook de contexto (nenhuma requisição, nenhum estado). Nada de conteúdo virou
 * JavaScript por causa desta mudança.
 *
 * -----------------------------------------------------------------------------
 * ISTO É A PRIMEIRA CAMADA, E EXISTE UMA SEGUNDA
 * -----------------------------------------------------------------------------
 * Não renderizar o script cobre o caso normal: abrir/recarregar qualquer URL do
 * painel. Sobra um caso que ele NÃO cobre — navegar de uma página pública para o
 * painel sem recarregar (navegação do lado do cliente): o script já foi baixado
 * e não há como "descarregá-lo". Quem fecha essa porta é o `<AdsPaused />` do
 * layout do painel (`app/admin/layout.tsx`), que pede ao AdSense para não
 * solicitar anúncios naquelas telas. As duas camadas juntas é que fecham o caso.
 */

import { usePathname } from 'next/navigation';
import Script from 'next/script';

import { isAdminPath } from '@subcarioca/core';

import { ADSENSE_CLIENT_ID, ADS_ENABLED } from '@/lib/ads';

export function AdSenseLoader() {
  const pathname = usePathname();

  // Sem Publisher ID configurado não existe integração — nada a fazer.
  if (!ADS_ENABLED) return null;

  /**
   * Painel editorial: o script não entra. E o caminho DESCONHECIDO (`null`)
   * também não carrega — falha fechada, de propósito.
   *
   * `usePathname` devolve string em toda situação que conhecemos, mas o tipo
   * admite `null` e o valor vem do roteador, não de nós. Entre os dois erros
   * possíveis, a assimetria é grande: falhar fechado custa impressões e é
   * VISÍVEL (o relatório de receita cai no mesmo dia); falhar aberto custa a
   * conta e é INVISÍVEL até o Google avisar. É o mesmo raciocínio que já governa
   * `ads-paused.tsx`: "ficar pausado demais custa impressão, e o erro contrário
   * custa a conta".
   */
  if (!pathname || isAdminPath(pathname)) return null;

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
