/**
 * robots.txt gerado dinamicamente.
 *
 * DECISÃO IMPORTANTE — bloqueio total em ambiente que não é produção:
 * um site de homologação indexado gera conteúdo duplicado que compete com o
 * site real e vaza rascunhos. O controle é por variável de ambiente, e o padrão
 * é o SEGURO (bloquear), de modo que esquecer de configurar não resulte em
 * indexação indevida.
 *
 * -----------------------------------------------------------------------------
 * CORREÇÃO (reposicionamento de marca) — POR QUE O DOMÍNIO SAIU DAQUI
 * -----------------------------------------------------------------------------
 * A checagem anterior era `NEXT_PUBLIC_SITE_URL?.includes('canalnerd.com.br')`,
 * com o domínio escrito à mão. Esse padrão tem uma falha grave de projeto: ele
 * falha em SILÊNCIO e no sentido mais caro possível. Ao trocar o domínio para
 * `ortuspixel.com`, a condição passaria a dar `false` em produção, o site
 * responderia `Disallow: /` para TODOS os buscadores, e nada — nem log, nem
 * erro de build, nem teste — acusaria o problema. O sintoma só apareceria
 * semanas depois, como "por que não indexamos?", já com a autoridade perdida.
 *
 * A regra agora descreve a CONDIÇÃO REAL que queremos ("estamos rodando em
 * produção, num host público"), em vez de uma coincidência de string com um
 * domínio específico:
 *
 *   1. `NODE_ENV === 'production'` — descarta `next dev`.
 *   2. A URL precisa ser HTTPS absoluta e não apontar para um host local.
 *
 * Efeito colateral desejado: trocar de domínio (ou subir um segundo país/marca)
 * deixa de exigir alteração de código. O que separa produção de homologação
 * passa a ser a variável de ambiente — que é o lugar certo para essa decisão.
 *
 * E a homologação? Ela continua bloqueada, mas pelo motivo certo: um ambiente
 * de staging não deve rodar com `NODE_ENV=production` E domínio público ao
 * mesmo tempo sem que alguém tenha decidido isso conscientemente. Se um dia
 * precisar de um staging público e indexável-não, o caminho é uma variável
 * explícita (ex.: `SEO_INDEXABLE=false`), e não adivinhar pelo nome do host.
 */

import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@subcarioca/core';

/**
 * Hosts que caracterizam ambiente local/privado.
 * `.localhost`, `.local` e `.test` são TLDs reservados justamente para isso
 * (RFC 2606 / RFC 6761); os IPs de loopback cobrem o acesso direto.
 */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.test')
  );
}

/** O site está publicado num host público de produção? */
function isPublicProductionSite(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return false;

  try {
    const { protocol, hostname } = new URL(siteUrl);
    // HTTPS obrigatório: um site público servido em HTTP puro é, quase sempre,
    // uma configuração incompleta — e não é o que queremos oferecer ao Google.
    return protocol === 'https:' && !isLocalHost(hostname);
  } catch {
    // URL malformada = configuração errada. Falha no lado SEGURO: não indexa.
    return false;
  }
}

export default function robots(): MetadataRoute.Robots {
  const isProduction = isPublicProductionSite();

  if (!isProduction) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Painel editorial: nunca deve ser rastreado nem indexado.
          '/admin',
          '/api/',
          // Páginas de resultado de fluxo transacional não têm valor de busca
          // e poderiam expor tokens em relatórios de rastreamento.
          '/newsletter/confirmado',
          '/newsletter/descadastro',
          // Parâmetros de rastreamento geram infinitas variações da mesma
          // página; bloquear evita desperdício de orçamento de rastreamento.
          '/*?utm_',
          '/*?fbclid',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
