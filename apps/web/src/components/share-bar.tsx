'use client';

/**
 * =============================================================================
 * BARRA DE COMPARTILHAMENTO
 * =============================================================================
 *
 * WHATSAPP EM PRIMEIRO LUGAR — decisão baseada no mercado brasileiro, não em
 * convenção internacional. No Brasil, o WhatsApp é o principal canal de
 * compartilhamento de notícia; templates que copiam layouts americanos colocam
 * Facebook e X primeiro e desperdiçam o canal mais eficaz.
 *
 * Usa a Web Share API nativa quando disponível (celular), com fallback para
 * links diretos. A API nativa abre a folha de compartilhamento do sistema, que
 * inclui apps que não conseguimos prever.
 *
 * RE-SKIN v0.3: o componente passou a usar `.share` + `.share__btn`, que é o
 * vocabulário do design. As classes anteriores (`.share-bar`,
 * `.share-bar__label`, `.share-bar__native`) não existiam na folha de estilo —
 * a barra caía como uma pilha de botões genéricos, sem as cores de marca de
 * cada rede, que é justamente o que faz o leitor achar o WhatsApp sem ler.
 */

import { useState } from 'react';

interface ShareBarProps {
  url: string;
  title: string;
  showCount?: boolean;
}

export function ShareBar({ url, title, showCount = false }: ShareBarProps) {
  const [copied, setCopied] = useState(false);

  // `encodeURIComponent` é obrigatório: um título com "&" ou "?" quebraria a
  // URL de compartilhamento e, em alguns casos, permitiria injetar parâmetros.
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  async function handleNativeShare() {
    // `navigator.share` só existe em contexto seguro (HTTPS) e em navegadores
    // compatíveis — por isso a checagem antes de chamar.
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title, url });
      } catch {
        // O usuário cancelou a folha de compartilhamento. Não é erro.
      }
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // `clipboard` exige permissão e HTTPS; falha silenciosa é aceitável
      // porque os outros botões continuam funcionando.
    }
  }

  return (
    <div className="share">
      {/*
        Rótulo só para leitor de tela. No design a barra é reconhecida pelas
        cores das marcas (verde do WhatsApp, preto do X…), e um "Compartilhar"
        em texto ao lado seria redundante para quem enxerga — mas indispensável
        para quem não enxerga, já que sem ele o grupo é só uma fileira de links.
      */}
      <span className="sr-only">Compartilhar esta matéria</span>

      {/* WhatsApp primeiro. `.share__btn--wa` traz o verde #25D366 da marca:
          reconhecimento em vez de leitura (Nielsen #6). */}
      <a
        href={`https://wa.me/?text=${encodedTitle}%20${encodedUrl}`}
        className="share__btn share__btn--wa"
        rel="noopener noreferrer"
        target="_blank"
        aria-label="Compartilhar no WhatsApp"
      >
        WhatsApp
      </a>

      <a
        href={`https://x.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`}
        className="share__btn share__btn--x"
        rel="noopener noreferrer"
        target="_blank"
        aria-label="Compartilhar no X"
      >
        X
      </a>

      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        className="share__btn"
        rel="noopener noreferrer"
        target="_blank"
        aria-label="Compartilhar no Facebook"
      >
        Facebook
      </a>

      <button type="button" onClick={handleCopy} className="share__btn">
        {copied ? 'Link copiado!' : 'Copiar link'}
      </button>

      <button type="button" onClick={handleNativeShare} className="share__btn">
        Mais
      </button>

      {/* `.share__count` é mono e cinza: número de compartilhamentos é prova
          social, não conteúdo — não pode competir com a manchete. */}
      {showCount && <span className="share__count">compartilhe com quem vai surtar</span>}
    </div>
  );
}
