'use client';

/**
 * =============================================================================
 * RASTREADOR DE AUDIÊNCIA — um componente, um ouvinte, quatro eventos
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO CENTRAL: DELEGAÇÃO DE EVENTO, E NÃO `onClick` EM CADA ELEMENTO
 * -----------------------------------------------------------------------------
 * A alternativa seria colocar um `onClick` em cada link de matéria, em cada
 * oferta e em cada slot de anúncio. Isso teria transformado três Server
 * Components em Client Components — inclusive o `AffiliateOffers`, cujo
 * cabeçalho diz, com todas as letras, "zero JavaScript enviado ao navegador".
 * Rastrear cliques teria custado ao leitor o download e a hidratação do bloco
 * comercial inteiro, em toda matéria, para medir um clique que a maioria não dá.
 *
 * Com delegação, o custo é UM ouvinte no `document`, montado uma vez por página.
 * Os componentes continuam sendo HTML puro; o que eles ganham é um atributo
 * `data-*`, que não pesa nada e não muda o que eles são. Os nomes desses
 * atributos moram em `core/analytics.ts`, e não escritos à mão nos dois lados —
 * um seletor que não casa com o atributo produz SILÊNCIO, não erro, e silêncio é
 * o bug mais caro de achar em medição.
 *
 * -----------------------------------------------------------------------------
 * `sendBeacon` E NÃO `fetch`
 * -----------------------------------------------------------------------------
 * Todo evento aqui acontece imediatamente antes de a página ser abandonada
 * (o leitor clicou em algo que o leva embora). Um `fetch` disparado nesse
 * instante é CANCELADO pelo navegador na navegação — o clique que mais importa
 * medir é justamente o que se perderia. `sendBeacon` foi criado para este caso:
 * o navegador assume a entrega e a completa depois de a página morrer.
 *
 * -----------------------------------------------------------------------------
 * O CLIQUE EM ANÚNCIO É APROXIMADO, E ISSO ESTÁ ASSUMIDO
 * -----------------------------------------------------------------------------
 * O criativo vive dentro de um `<iframe>` de outro domínio. A política de mesma
 * origem — corretamente — nos impede de ver o que acontece lá dentro. O que dá
 * para observar é o `pointerdown` que chega ao NOSSO contêiner (`.ad`), que é
 * onde o ponteiro passa antes de entrar no iframe.
 *
 * Consequências, ditas sem maquiagem: conta cliques que não viraram clique de
 * verdade no anúncio, e não distingue clique de rolagem com o dedo em cima da
 * caixa. É um número COMPARATIVO ('artigo-meio' × 'artigo-fim'), jamais um
 * número de receita — a receita está no relatório do AdSense e só lá.
 */

import { useEffect } from 'react';

import { ANALYTICS_ATTR, type AnalyticsEventKind } from '@subcarioca/core';

interface AnalyticsTrackerProps {
  /** Matéria em que estes eventos estão acontecendo. */
  articleId: string;
}

interface EventPayload {
  kind: AnalyticsEventKind;
  articleId: string;
  targetPath?: string;
  offerId?: string;
  slotId?: string;
}

export function AnalyticsTracker({ articleId }: AnalyticsTrackerProps) {
  useEffect(() => {
    /**
     * VISUALIZAÇÃO: uma por matéria, por aba.
     *
     * `sessionStorage` (e não `localStorage`) é a escolha certa aqui: ele morre
     * quando a aba fecha, então voltar à mesma matéria amanhã conta de novo — o
     * que é o comportamento desejado, porque é uma leitura nova. Com
     * `localStorage`, uma matéria lida uma vez nunca mais contaria naquele
     * navegador, e o número viraria "leitores únicos históricos", que é outra
     * métrica e não a que a redação pediu.
     *
     * O `try/catch` não é excesso de zelo: navegação privativa e navegadores com
     * armazenamento bloqueado LANÇAM ao acessar `sessionStorage`. Sem ele, uma
     * exceção aqui derrubaria o efeito inteiro e nenhum evento seria medido para
     * essas pessoas — sem nada aparecer em lugar nenhum.
     */
    const viewKey = `op:view:${articleId}`;
    let alreadyCounted = false;

    try {
      alreadyCounted = sessionStorage.getItem(viewKey) === '1';
      if (!alreadyCounted) sessionStorage.setItem(viewKey, '1');
    } catch {
      // Sem armazenamento disponível, conta a cada carregamento. Superestimar um
      // pouco é melhor do que não medir nada.
    }

    if (!alreadyCounted) send({ kind: 'article.view', articleId });

    /**
     * UM ÚNICO OUVINTE, na fase de CAPTURA.
     *
     * Captura (e não bolha) porque um `onClick` de componente que chame
     * `stopPropagation` — hoje não há, mas amanhã pode haver — nos deixaria
     * cegos sem ninguém perceber. Na captura, o evento passa por nós antes de
     * chegar ao alvo, e o rastreamento não depende do que o resto da página faz.
     */
    function handlePointerDown(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // ----- Clique em anúncio -----
      const adContainer = target.closest(`[${ANALYTICS_ATTR.adSlot}]`);
      if (adContainer) {
        send({
          kind: 'ad.click',
          articleId,
          slotId: adContainer.getAttribute(ANALYTICS_ATTR.adSlot) ?? undefined,
        });
        return;
      }

      const anchor = target.closest('a');
      if (!(anchor instanceof HTMLAnchorElement)) return;

      // ----- Clique em oferta de afiliado -----
      const offerId = anchor.getAttribute(ANALYTICS_ATTR.offerId);
      if (offerId) {
        send({ kind: 'affiliate.click', articleId, offerId });
        return;
      }

      // ----- Clique para outra matéria -----
      //
      // `getAttribute('href')` e não `anchor.href`: o segundo devolve a URL
      // ABSOLUTA resolvida pelo navegador, e aí todo link interno viraria
      // "https://ortuspixel.com/..." e falharia o teste de "começa com /". O
      // atributo cru é o que o HTML diz, que é o que queremos comparar.
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;

      send({ kind: 'article.link', articleId, targetPath: href });
    }

    /**
     * `pointerdown` e não `click`.
     *
     * `click` só dispara com o botão do meio ou com Ctrl pressionado em alguns
     * navegadores — ou seja, "abrir em nova aba", que é EXATAMENTE o
     * comportamento de quem está engajado e quer ler as duas matérias. Perder
     * justamente esses cliques enviesaria a métrica contra o leitor mais
     * valioso. `pointerdown` acontece antes de qualquer uma dessas decisões.
     */
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [articleId]);

  // Não renderiza nada: é comportamento, não interface.
  return null;
}

function send(payload: EventPayload): void {
  try {
    const body = JSON.stringify(payload);

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // `type: 'application/json'` para o servidor conseguir ler com
      // `request.json()`. Sem isso, o beacon sai como `text/plain` e alguns
      // runtimes recusam o corpo.
      navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      return;
    }

    // Reserva para navegador sem `sendBeacon`. `keepalive` faz a requisição
    // sobreviver à navegação, que é a propriedade que interessa.
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Medição NUNCA pode quebrar a página do leitor. Se falhar, falha calada —
    // o conteúdo é o produto; a métrica é conveniência nossa.
  }
}
