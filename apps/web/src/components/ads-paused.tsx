'use client';

/**
 * =============================================================================
 * SUSPENSÃO DE ANÚNCIO NESTA PÁGINA — para conteúdo adulto
 * =============================================================================
 *
 * O PROBLEMA QUE ESTE COMPONENTE RESOLVE, e ele é sutil o bastante para passar
 * despercebido numa revisão apressada:
 *
 * Marcar uma matéria como 'adult' faz `commercePolicy` devolver ZERO slots — ou
 * seja, nenhuma unidade `<ins class="adsbygoogle">` é renderizada. Isso resolve
 * os anúncios QUE NÓS COLOCAMOS. Não resolve os que o Google coloca sozinho:
 * o recurso "Auto ads" do AdSense é ligado NA CONTA, não no código, e ele injeta
 * unidades em qualquer página onde o script esteja presente — e o script está,
 * porque ele é carregado no layout raiz, para o site inteiro.
 *
 * O resultado seria o pior cenário possível: a redação marca a matéria como
 * adulta, o painel confirma, e o Google veicula anúncio ali assim mesmo — com a
 * conta inteira em risco e ninguém sabendo, porque tudo indicava que estava
 * resolvido.
 *
 * `pauseAdRequests` é o mecanismo do próprio AdSense para dizer "nesta página,
 * não peça anúncio". Ele é definido ANTES de o script carregar (o array
 * `adsbygoogle` aceita configuração enfileirada), o que é justamente o que
 * permite este componente funcionar mesmo com o loader em `lazyOnload`.
 *
 * -----------------------------------------------------------------------------
 * ISTO É DEFESA EM PROFUNDIDADE, NÃO A DEFESA PRINCIPAL
 * -----------------------------------------------------------------------------
 * A defesa principal continua sendo não renderizar unidade nenhuma (feito no
 * servidor, sem depender de JavaScript). Esta é a segunda camada, e ela depende
 * de o script do Google respeitar a configuração.
 *
 * ⚠ A TERCEIRA CAMADA É OPERACIONAL E PRECISA DE UM HUMANO: no painel do
 * AdSense existe exclusão de URL por padrão de endereço. Se o site vier a
 * publicar conteúdo adulto com alguma regularidade, a recomendação é criar um
 * prefixo de URL próprio para essas matérias e excluí-lo por lá — é a única
 * camada que não depende de nada do nosso código estar certo.
 */

import { useEffect } from 'react';

/**
 * O tipo do array global do AdSense COM a propriedade de configuração.
 *
 * Declarado localmente, e não com `declare global`: `ad-slot.tsx` já declara
 * `Window.adsbygoogle` como `unknown[]`, e duas declarações globais do mesmo
 * campo com tipos diferentes é erro de compilação (TS2717). Uma delas teria de
 * ceder — e alargar a declaração global para acomodar uma propriedade usada em
 * um arquivo só espalharia o detalhe por todo o projeto.
 *
 * `pauseAdRequests` é, de fato, uma propriedade pendurada no array: o AdSense
 * usa o mesmo objeto como fila E como espaço de configuração. É esquisito, é
 * assim que a API dele funciona, e o `as` aqui é a tradução honesta disso.
 */
type AdsQueue = unknown[] & { pauseAdRequests?: number };

export function AdsPaused() {
  useEffect(() => {
    try {
      // O array pode não existir ainda (o loader é `lazyOnload`): criá-lo aqui é
      // o comportamento previsto pela própria API do AdSense, que consome o que
      // estiver enfileirado quando o script chega.
      const queue = (window.adsbygoogle = window.adsbygoogle || []) as AdsQueue;
      queue.pauseAdRequests = 1;
    } catch {
      // Um bloqueador de anúncios pode ter substituído o objeto por algo
      // estranho. Falhar aqui não pode derrubar a página do leitor — e, se
      // falhou, é porque provavelmente nenhum anúncio será carregado mesmo.
    }

    return () => {
      // NÃO religamos ao desmontar, de propósito. A navegação no App Router é do
      // lado do cliente: religar ao sair desta matéria dependeria de a próxima
      // página desligar de novo antes de o script pedir anúncio — uma corrida
      // que, quando perdida, veicula anúncio na página errada. A página seguinte
      // recarrega o estado do jeito certo; ficar "pausado demais" custa
      // impressão, e o erro contrário custa a conta.
    };
  }, []);

  return null;
}
