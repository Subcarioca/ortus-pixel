/**
 * robots.txt gerado dinamicamente.
 *
 * DECISÃO IMPORTANTE — bloqueio total em ambiente que não é produção:
 * um site de homologação indexado gera conteúdo duplicado que compete com o
 * site real e vaza rascunhos. O controle é por variável de ambiente, e o padrão
 * é o SEGURO (bloquear), de modo que esquecer de configurar não resulte em
 * indexação indevida.
 */

import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@canalnerd/core';

export default function robots(): MetadataRoute.Robots {
  const isProduction =
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PUBLIC_SITE_URL?.includes('canalnerd.com.br');

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
