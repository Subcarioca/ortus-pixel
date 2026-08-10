'use client';

/**
 * =============================================================================
 * VÍDEO POR FACHADA — a miniatura vira player só no clique
 * =============================================================================
 *
 * É o ÚNICO componente de cliente do corpo da matéria, e ele carrega só a si
 * mesmo (algumas linhas de estado). O resto do corpo continua sendo HTML puro
 * renderizado no servidor.
 *
 * POR QUE NÃO EMBUTIR O IFRAME DIRETO — dois motivos, e os dois são medidos:
 *
 *   DESEMPENHO. Um iframe do YouTube puxa perto de 1 MB de JavaScript e abre
 *   várias conexões a domínios de terceiro no carregamento da página. Isso é
 *   pago por TODO leitor, inclusive pelos muitos que nunca clicam em play — e é
 *   pago no pior momento, competindo com a imagem de capa pelo LCP.
 *
 *   PRIVACIDADE. O iframe entrega o IP e o user-agent do leitor ao Google no
 *   instante em que a página abre. É a mesma razão pela qual o projeto não
 *   re-hospeda avatar de provedor OAuth nos comentários: não entregamos o
 *   público a terceiros como efeito colateral de ler uma matéria. Com a fachada,
 *   quem paga esse custo é quem pediu para assistir — e no domínio
 *   `youtube-nocookie`.
 *
 * O CLS É ZERO porque a moldura tem `aspect-ratio` fixo (vem do `.thumb`): o
 * iframe nasce exatamente do tamanho da miniatura que ele substitui.
 */

import { useState } from 'react';

import { videoEmbedUrl, videoThumbnailUrl, type VideoProvider } from '@subcarioca/core';

interface VideoFacadeProps {
  provider: VideoProvider;
  videoId: string;
  title: string;
  thumbUrl: string | null;
  duration: string | null;
  categoryToken: string | undefined;
}

export function VideoFacade({
  provider,
  videoId,
  title,
  thumbUrl,
  duration,
  categoryToken,
}: VideoFacadeProps) {
  const [playing, setPlaying] = useState(false);

  const poster = thumbUrl ?? videoThumbnailUrl(provider, videoId);

  if (playing) {
    return (
      <div className="embed__frame">
        <iframe
          src={videoEmbedUrl(provider, videoId)}
          title={title}
          // `allow` mínimo: só o necessário para o vídeo tocar. Cada permissão a
          // mais é uma capacidade concedida a código de terceiro rodando dentro
          // da nossa página.
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          // `sandbox` não entra: os provedores exigem `allow-same-origin` +
          // `allow-scripts` para funcionar, combinação que anula o isolamento
          // do sandbox — declará-lo daria uma falsa sensação de contenção.
          referrerPolicy="strict-origin-when-cross-origin"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    );
  }

  return (
    <div className="embed__frame thumb" data-c={categoryToken}>
      {poster && (
        // `<img>` cru, e não `next/image`: a miniatura vem do CDN do provedor,
        // que NÃO está na lista de hosts autorizados do `next/image` — e não deve
        // estar, porque a lista existe para controlar o que o nosso otimizador
        // busca. Aqui a imagem é decorativa (o botão ao lado tem o rótulo
        // acessível), então `alt=""` é a marcação correta.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" loading="lazy" decoding="async" />
      )}

      <button
        type="button"
        className="thumb__play"
        // O rótulo carrega o TÍTULO do vídeo: "Reproduzir" sozinho, numa matéria
        // com três vídeos, dá ao leitor de tela três botões idênticos.
        aria-label={`Reproduzir vídeo: ${title}`}
        onClick={() => setPlaying(true)}
      />

      {duration && <span className="thumb__dur">{duration}</span>}
    </div>
  );
}
