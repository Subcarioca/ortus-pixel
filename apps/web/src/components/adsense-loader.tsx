'use client';

/**
 * =============================================================================
 * CARREGADOR DO ADSENSE — um script para o SITE, nunca para o PAINEL
 * =============================================================================
 *
 * POR QUE ESTE ARQUIVO NÃO USA `next/script` (e usou, até 2026-08)
 * -----------------------------------------------------------------------------
 * BUG CORRIGIDO: o AdSense recusava verificar o site — "Não foi possível
 * verificar seu site. Garanta que as mudanças foram publicadas e podem ser
 * acessadas pelo Rastreador do AdSense."
 *
 * A causa era a estratégia de carregamento. O `<Script>` do Next só coloca uma
 * tag `<script src>` de VERDADE no HTML servido em nenhuma das suas estratégias
 * quando se está no App Router — o que ele coloca é uma INSTRUÇÃO para o runtime
 * do próprio Next criar a tag depois, via JavaScript. Verificado lendo o código
 * de `next/dist/client/script.js` e conferido no HTML gerado por `next build`:
 *
 *   lazyOnload        → nada no HTML. O script é criado por
 *                       `document.body.appendChild` dentro de um
 *                       `requestIdleCallback` disparado no evento `load`.
 *   beforeInteractive → também NÃO gera `<script src>`. Gera duas outras coisas:
 *                       `<link rel="preload" as="script" href="...">` e um
 *                       `<script>(self.__next_s=...).push([...])</script>`, que
 *                       é uma FILA lida pelo runtime do Next. A documentação diz
 *                       "injected into the initial HTML from the server" e isso
 *                       é verdade sobre a instrução, não sobre a tag.
 *
 * Ou seja: um rastreador que procura literalmente pelo trecho que o Google manda
 * colar não encontrava nada — em NENHUMA estratégia. Trocar `lazyOnload` por
 * `beforeInteractive` não resolveria; foi testado e descartado com o HTML na
 * mão.
 *
 * A solução é uma tag `<script>` comum. Desde o React 19, `<script>` com `src` E
 * `async` recebe tratamento especial: o React o iça (`hoist`) para dentro do
 * `<head>` e o deduplica por `src`, não importa onde na árvore ele foi
 * renderizado. No servidor, isso vira exatamente o HTML que o Google pede —
 * `<script async src="...adsbygoogle.js?client=..." crossorigin="anonymous">`
 * dentro de `<head></head>`, presente na primeira resposta, sem depender de
 * nenhum JavaScript ter rodado.
 *
 * ⚠ `async` não é opcional aqui, e por dois motivos que se somam: é o que
 * autoriza o React a içar a tag (sem ele, nada de `<head>`), e é o que impede o
 * script de bloquear a análise do HTML.
 *
 * -----------------------------------------------------------------------------
 * E O LCP? (a preocupação que motivava o `lazyOnload`)
 * -----------------------------------------------------------------------------
 * O comentário anterior deste arquivo defendia adiar o script até o evento
 * `load` para não disputar banda com a imagem de capa durante a janela em que o
 * LCP é medido. A preocupação continua legítima — o script agora começa a baixar
 * mais cedo — mas ela perdeu a disputa por um motivo simples: um site que o
 * AdSense se recusa a verificar tem LCP excelente e receita zero.
 *
 * O que resta do cuidado original:
 *   • `async` garante que o script NÃO bloqueia a renderização. Ele disputa
 *     banda, não trava a pintura da página.
 *   • Este é o comportamento PADRÃO de qualquer integração AdSense do mundo —
 *     é o trecho que o Google entrega pronto, para colar no `<head>`. Otimizar
 *     abaixo disso é otimizar para fora do programa.
 *   • A imagem de capa continua com `priority` no `next/image`, que emite
 *     `fetchpriority="high"` — em disputa de banda, ela tem prioridade
 *     declarada e o script do AdSense não.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE COMPONENTE É DE CLIENTE
 * -----------------------------------------------------------------------------
 * BUG ANTERIOR, que continua corrigido: ele é renderizado pelo LAYOUT RAIZ, ou
 * seja, em toda página do projeto — inclusive no painel editorial inteiro
 * (`/admin/*`). Com "Auto ads" ligado (interruptor da CONTA do Google, não do
 * nosso código), o Google injeta unidades sozinho em qualquer página onde este
 * script exista. O efeito prático era anúncio dentro da fila de pautas, da lista
 * de matérias e da tela de contas, exibido para a própria redação — impressão
 * inválida, cuja punição recai sobre a CONTA inteira e não sobre a página.
 *
 * Para não carregar no painel é preciso saber QUAL é a rota atual, e no App
 * Router essa informação não existe em Server Component: não há API de pathname
 * para o servidor, e a alternativa usual (um `middleware.ts` propagando o
 * caminho num cabeçalho) foi descartada de propósito neste projeto — ver o
 * cabeçalho de `server/staff-auth.ts`, que explica por que a autorização não
 * vive em middleware aqui. Criar um middleware só para isto contrariaria aquela
 * decisão e acrescentaria uma camada que roda em TODA requisição do site.
 *
 * ⚠ E ISTO É O QUE FAZ AS DUAS CORREÇÕES CONVIVEREM: `usePathname` resolve no
 * SERVIDOR, durante a renderização inicial — não só depois de hidratar. A
 * documentação do Next é explícita ("a Client Component with `usePathname` will
 * be rendered into HTML on the initial page load"), e o HTML gerado por
 * `next build` confirma: a home traz a tag do AdSense e `/admin` não traz. Se
 * fosse o contrário — se a decisão só acontecesse na hidratação — colocar a tag
 * no HTML servido teria reaberto o bug do painel, porque o script apareceria em
 * `/admin` e só seria removido tarde demais (um script já baixado não se
 * "descarrega").
 *
 * O custo real de 'use client' aqui é praticamente nulo: este componente não
 * renderiza marcação visível e `usePathname` é um hook de contexto (nenhuma
 * requisição, nenhum estado). Nada de conteúdo virou JavaScript por causa disto.
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
 *
 * ⚠ `AdsPaused` PRECISOU MUDAR JUNTO com este arquivo. Enquanto o script só
 * carregava no ócio do navegador, suspender os pedidos num `useEffect` chegava
 * sempre antes. Agora o script está no `<head>` e pode executar ANTES da
 * hidratação — então a suspensão passou a ser emitida também como script inline
 * no HTML. Ver o cabeçalho de `components/ads-paused.tsx`.
 *
 * -----------------------------------------------------------------------------
 * O script NÃO é renderizado quando não há Publisher ID: em desenvolvimento e em
 * pré-produção, nenhuma requisição sai para o Google. Isso evita contabilizar
 * impressões inválidas com o próprio time navegando — motivo clássico de
 * suspensão de conta do AdSense.
 */

import { usePathname } from 'next/navigation';

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

  /**
   * O trecho oficial do AdSense, caractere por caractere — é isto que o
   * rastreador do Google procura.
   *
   * `encodeURIComponent` no ID: ele vem de variável de ambiente, e variável de
   * ambiente é entrada externa. O valor real é sempre `ca-pub-<dígitos>`, mas
   * escapar custa nada e fecha a porta de alguém injetar `&` ou aspas na URL a
   * partir de um `.env` mal preenchido.
   */
  return (
    <script
      async
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
        ADSENSE_CLIENT_ID,
      )}`}
    />
  );
}
