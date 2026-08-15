'use client';

/**
 * =============================================================================
 * SLOT DE ANÚNCIO — AdSense com carregamento tardio
 * =============================================================================
 *
 * TRÊS PROPRIEDADES QUE ESTE COMPONENTE PRECISA GARANTIR, e como cada uma é
 * garantida aqui (todas vêm de design/README.md §7.2):
 *
 * 1. CLS ZERO. A altura vem do CSS (`--ad-h` por variante de `.ad`), não do
 *    criativo. O espaço existe antes de qualquer requisição de rede; se o
 *    anúncio não carregar — ou for bloqueado, o que acontece com boa parte da
 *    audiência — a caixa cinza permanece e o texto não pula. Layout shift em
 *    página de notícia é a diferença entre ler e desistir.
 *
 * 2. ORÇAMENTO DE JS PRESERVADO. O script do AdSense pesa mais de 100 KB e, se
 *    disputar a rede com o HTML e a imagem de capa, atrasa o LCP no 4G — a
 *    métrica que o projeto inteiro protege.
 *
 *    ⚠ O CARREGAMENTO DO SCRIPT DEIXOU DE SER TARDIO. Ele agora sai no `<head>`
 *    do HTML servido, com `async`, porque o rastreador do AdSense se recusava a
 *    verificar um site em que a tag só existia depois que o JavaScript rodava —
 *    o racional completo está no cabeçalho de `components/adsense-loader.tsx`.
 *    `async` mantém a garantia que importa aqui: o script não bloqueia a
 *    renderização, ele apenas disputa banda.
 *
 *    O que continua valendo, e é a economia de verdade deste arquivo: cada slot
 *    só se REGISTRA quando chega perto da viewport (IntersectionObserver com
 *    margem de 200px). Um leitor que nunca rola até o fim do artigo não paga
 *    pelo pedido de um anúncio que nunca veria.
 *
 * 3. HONESTIDADE. O rótulo "Publicidade" fica FORA da caixa, em mono cinza. Não
 *    é decoração: publicidade não identificável é infração ao CDC (art. 36) e
 *    ao Código do CONAR, além de política do próprio Google.
 *
 * POR QUE É UM COMPONENTE DE CLIENTE: o AdSense precisa de
 * `(adsbygoogle = window.adsbygoogle || []).push({})` para cada unidade. Não há
 * como fazer isso do servidor. O custo é pequeno e localizado — o componente
 * não tem estado além de um booleano e não re-renderiza a árvore.
 */

import { useEffect, useRef, useState } from 'react';

import { ANALYTICS_ATTR } from '@subcarioca/core';

import { AD_LABEL, ADSENSE_CLIENT_ID, ADS_ENABLED, type AdSlotSpec } from '@/lib/ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface AdSlotProps {
  slot: AdSlotSpec;
  /** `true` no trilho lateral: acompanha a rolagem (`.ad--sticky`). */
  sticky?: boolean;
  /**
   * RESERVA O ESPAÇO, MAS NÃO PEDE ANÚNCIO. Usado pelo preview do painel.
   *
   * A caixa continua ocupando a altura exata que ocuparia na página do leitor
   * (a reserva vem do CSS, `--ad-h`), então o redator vê o texto na mesma
   * posição em que ele sairá publicado. O que não acontece é a requisição ao
   * AdSense — e a razão é de RISCO DE CONTA, não de estética: o preview fica
   * atrás de login, e impressão de anúncio em página autenticada é impressão
   * inválida pelas políticas do programa. A punição do AdSense não é a página,
   * é a conta inteira (é o mesmo raciocínio que governa `canLowerSensitivity`
   * em core/staff.ts).
   *
   * ⚠ Isto sozinho NÃO basta: o script do AdSense é carregado no layout raiz,
   * portanto ele está presente também em `/admin`, e o recurso "Auto ads" pode
   * injetar unidade por conta própria. Quem fecha essa porta é o `<AdsPaused/>`,
   * renderizado pelo preview — ver `components/article-view.tsx`.
   */
  inert?: boolean;
}

const VARIANT_CLASS: Record<AdSlotSpec['format'], string> = {
  leader: 'ad--leader',
  rect: 'ad--rect',
  rail: 'ad--rail',
  feed: 'ad--feed',
};

export function AdSlot({ slot, sticky = false, inert = false }: AdSlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    // Sem Publisher ID não há o que registrar. O componente nem deveria ter
    // sido renderizado (ver `commercePolicy`), mas a checagem local evita
    // depender de o chamador ter feito a dele.
    //
    // `inert` corta ANTES do observer: sem esta condição, o slot do preview
    // instalaria o `IntersectionObserver` e chamaria `adsbygoogle.push` assim
    // que o redator rolasse até ele.
    if (!ADS_ENABLED || inert || registered) return;

    const element = ref.current;
    if (!element) return;

    // `IntersectionObserver` é suportado por todos os navegadores relevantes
    // desde 2019. Ainda assim, se faltar, registramos imediatamente: perder
    // receita por causa de um recurso ausente seria pior que carregar cedo.
    if (typeof IntersectionObserver === 'undefined') {
      registerAd(element);
      setRegistered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          registerAd(element);
          setRegistered(true);
          observer.disconnect();
        }
      },
      // 200px de antecedência: o anúncio começa a carregar pouco antes de
      // entrar na tela, então ele já está pintado quando o leitor chega — sem
      // o "buraco cinza que preenche depois".
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [registered, inert]);

  if (!ADS_ENABLED) return null;

  return (
    <div
      ref={ref}
      className={`ad ${VARIANT_CLASS[slot.format]}${sticky ? ' ad--sticky' : ''}`}
      // `aria-hidden` não seria correto (o usuário PODE querer ver o anúncio),
      // mas o `role="complementary"` com rótulo deixa claro para leitores de
      // tela que aquilo não é o conteúdo da página.
      role="complementary"
      aria-label={AD_LABEL}
      // Marca lida pelo rastreador de audiência. O clique DENTRO do iframe é
      // invisível para nós (mesma origem), então o que se mede é o que chega a
      // este contêiner — número comparativo entre posições, nunca de receita.
      // Ver o cabeçalho de analytics-tracker.tsx.
      {...{ [ANALYTICS_ATTR.adSlot]: slot.id }}
    >
      {/* O rótulo muda no preview para explicar a caixa vazia. Sem isso, o
          redator lê o espaço reservado como um bug do preview e vai reportá-lo. */}
      <span className="ad__label">
        {inert ? `${AD_LABEL} — espaço reservado, sem carregar no preview` : AD_LABEL}
      </span>
      {/* A caixa fica de qualquer jeito: a altura é do CSS (`--ad-h`), e é ela
          que garante que o texto do preview esteja na mesma posição vertical em
          que estará publicado. O que some é a unidade do AdSense lá dentro. */}
      <div className="ad__box">
        {!inert && (
          <ins
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '100%' }}
            data-ad-client={ADSENSE_CLIENT_ID}
            data-ad-slot={slot.id}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Empurra a unidade para a fila do AdSense.
 *
 * O `try/catch` não é preguiça: o script pode ter sido bloqueado por
 * extensão, e `adsbygoogle.push` lança nesse caso. Uma exceção não tratada aqui
 * subiria pela árvore do React e derrubaria a renderização do artigo inteiro —
 * um bloqueador de anúncios quebrando o conteúdo é um resultado absurdo, e é
 * exatamente o que acontece quando esse erro passa.
 */
function registerAd(element: HTMLElement): void {
  const ins = element.querySelector('ins.adsbygoogle');
  if (!ins || ins.getAttribute('data-adsbygoogle-status')) return;

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (error) {
    console.warn('[ads] não foi possível registrar o slot:', error);
  }
}
