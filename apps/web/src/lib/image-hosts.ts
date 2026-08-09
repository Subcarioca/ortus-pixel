/**
 * =============================================================================
 * HOSTS DE IMAGEM PERMITIDOS — uma lista, dois leitores
 * =============================================================================
 *
 * O `next/image` só aceita imagens de hosts declarados em `remotePatterns`
 * (next.config.ts). Quem NÃO está na lista não gera "imagem quebrada": o
 * componente LANÇA em tempo de renderização e derruba a página inteira com 500.
 *
 * O detalhe que torna isso grave: a capa não aparece só na página da matéria —
 * ela aparece nos cards da home, da categoria e das relacionadas. Uma única
 * matéria com capa de host não declarado tira do ar todas as páginas que a
 * listam, não apenas a dela.
 *
 * Por isso a lista mora AQUI e não dentro do next.config: o painel editorial
 * precisa recusar a URL no momento em que o editor cola, e não depois, quando o
 * leitor recebe o 500. Se a lista fosse copiada nos dois lugares, adicionar um
 * CDN novo em um deles e esquecer o outro produziria exatamente o bug que esta
 * validação existe para impedir — só que mais difícil de achar.
 */

/**
 * Hosts aceitos. O formato é o mesmo de `remotePatterns.hostname` do Next:
 * `**.` no início significa "qualquer subdomínio de".
 *
 * PARA ADICIONAR UM CDN: acrescente aqui e reinicie o servidor. Não use
 * curinga aberto (`**`): o otimizador de imagens do Next baixa e reprocessa
 * qualquer URL que passe por ele, e liberar tudo transforma o site num proxy de
 * imagens de terceiros — custo de CPU e banda nossos, conteúdo de estranhos.
 */
export const ALLOWED_IMAGE_HOSTS = [
  'images.ortuspixel.test',
  '**.ytimg.com',
  // Placeholder de imagens do seed local — trocar pelo CDN real em produção.
  'picsum.photos',
] as const;

/**
 * Reproduz a regra de correspondência do Next para os padrões acima.
 *
 * É deliberadamente um pouco MAIS restrita que a do Next (`**.exemplo.com` não
 * aceita `exemplo.com` sem subdomínio). Errar para o lado restritivo aqui
 * significa, na pior das hipóteses, recusar uma URL que funcionaria — enquanto
 * errar para o lado permissivo significa aceitar uma que derruba a página.
 */
export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return ALLOWED_IMAGE_HOSTS.some((pattern) =>
    pattern.startsWith('**.') ? host.endsWith(pattern.slice(2)) : host === pattern,
  );
}

/** Lista legível para a mensagem de erro do painel. */
export const ALLOWED_IMAGE_HOSTS_LABEL = ALLOWED_IMAGE_HOSTS.join(', ');
