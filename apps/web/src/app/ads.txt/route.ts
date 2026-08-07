/**
 * =============================================================================
 * GET /ads.txt — autorização de vendedores de anúncio (IAB Tech Lab)
 * =============================================================================
 *
 * O QUE É E POR QUE IMPORTA: o `ads.txt` é a lista pública de quem está
 * autorizado a vender o inventário deste domínio. Sem ele, um fraudador compra
 * tráfego barato, declara ser "ortuspixel.com" num exchange e revende
 * impressões falsas em nosso nome. Com ele, o comprador confere a lista e
 * recusa o vendedor não autorizado.
 *
 * A consequência prática de NÃO ter o arquivo não é teórica: desde 2022 os
 * principais compradores programáticos simplesmente não dão lance em inventário
 * sem `ads.txt` válido. Na prática, o eCPM despenca.
 *
 * POR QUE UMA ROTA E NÃO UM ARQUIVO EM /public:
 *
 *   1. O Publisher ID vive em variável de ambiente. Um arquivo estático
 *      obrigaria a comitá-lo — o que não é um problema de sigilo (o ID é
 *      público), mas é um problema de AMBIENTE: pré-produção e produção usam
 *      contas diferentes, e um arquivo fixo garantiria que uma das duas ficasse
 *      errada.
 *   2. Quando entrar a rede de afiliados ou um segundo intermediário, a lista
 *      cresce por configuração, sem deploy de arquivo.
 *
 * DECISÃO IMPORTANTE — SEM ID CONFIGURADO, RESPONDEMOS 404:
 *
 * A alternativa seria servir um arquivo com um placeholder. Seria pior: um
 * `ads.txt` com linha inválida é interpretado como "este domínio declarou seus
 * vendedores, e você não está na lista" — ou seja, ativamente BLOQUEIA a venda,
 * inclusive a legítima. Ausência do arquivo é neutra; arquivo errado é nocivo.
 * Falhar seguro aqui significa não existir.
 */

import { SITE_NAME } from '@/lib/site';

const PUBLISHER_ID = process.env.ADSENSE_PUBLISHER_ID ?? '';

/**
 * Linhas extras, separadas por `;` — para redes de afiliados e intermediários
 * que exijam autorização própria. Formato de cada linha, conforme a
 * especificação do IAB: `dominio, id-do-publisher, DIRECT|RESELLER, id-TAG`.
 */
const EXTRA_LINES = (process.env.ADS_TXT_EXTRA_LINES ?? '')
  .split(';')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

/**
 * Estático: o conteúdo só muda com deploy (mudança de variável de ambiente).
 * Não faz sentido pagar renderização por requisição por um arquivo de texto que
 * os robôs buscam algumas vezes ao dia.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  if (!PUBLISHER_ID) {
    // Ver o comentário no topo: melhor não existir do que existir errado.
    return new Response('Not found', { status: 404 });
  }

  const lines = [
    `# ads.txt — ${SITE_NAME}`,
    '# Lista de vendedores autorizados (IAB Tech Lab ads.txt v1.1).',
    '# Gerado por apps/web/src/app/ads.txt/route.ts a partir das variáveis de ambiente.',
    // `f08c47fec0942fa0` é o TAG-ID do Google no sistema do IAB. É público, fixo
    // e igual para todos os publishers do AdSense — não é um segredo nosso.
    `google.com, ${PUBLISHER_ID}, DIRECT, f08c47fec0942fa0`,
    ...EXTRA_LINES,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // 24h de cache: os rastreadores de verificação consultam o arquivo com
      // frequência, e ele muda uma vez por ano, na melhor das hipóteses.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
