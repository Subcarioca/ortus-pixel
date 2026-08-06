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
 *    métrica que o projeto inteiro protege. Por isso:
 *      - o loader entra com `strategy="lazyOnload"` (depois do `load`, quando o
 *        conteúdo já está na tela);
 *      - cada slot só se REGISTRA quando chega perto da viewport
 *        (IntersectionObserver com margem de 200px).
 *    Um leitor que nunca rola até o fim do artigo não paga por um anúncio que
 *    nunca veria.
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
}

const VARIANT_CLASS: Record<AdSlotSpec['format'], string> = {
  leader: 'ad--leader',
  rect: 'ad--rect',
  rail: 'ad--rail',
  feed: 'ad--feed',
};

export function AdSlot({ slot, sticky = false }: AdSlotProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    // Sem Publisher ID não há o que registrar. O componente nem deveria ter
    // sido renderizado (ver `commercePolicy`), mas a checagem local evita
    // depender de o chamador ter feito a dele.
    if (!ADS_ENABLED || registered) return;

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
  }, [registered]);

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
    >
      <span className="ad__label">{AD_LABEL}</span>
      <div className="ad__box">
        <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', height: '100%' }}
          data-ad-client={ADSENSE_CLIENT_ID}
          data-ad-slot={slot.id}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
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
