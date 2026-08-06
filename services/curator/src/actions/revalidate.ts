/**
 * =============================================================================
 * INVALIDAÇÃO DE CACHE POR EVENTO
 * =============================================================================
 *
 * O requisito de Core Web Vitals sob pico de tráfego pede uma estratégia de
 * cache em duas velocidades, e é isso que este módulo operacionaliza:
 *
 *   ARTIGO      -> cache LONGO. O conteúdo praticamente não muda depois de
 *                  publicado, então serve estático da CDN. Um pico de 50 mil
 *                  leitores simultâneos em um breaking news não gera nem uma
 *                  consulta ao banco.
 *
 *   HOME / EM ALTA -> cache CURTO + invalidação por evento. Essas páginas
 *                  mudam de verdade quando um score muda de faixa.
 *
 * POR QUE INVALIDAÇÃO POR EVENTO E NÃO SÓ TEMPO CURTO:
 *
 * Com `revalidate: 30`, a home fica no máximo 30s desatualizada, mas paga o
 * custo de regenerar a cada 30s o dia inteiro — inclusive às 4h da manhã,
 * quando nada muda.
 *
 * Com invalidação por evento, a home fica em cache indefinidamente e é
 * regenerada NO INSTANTE em que algo relevante acontece. O resultado é melhor
 * nas duas pontas: mais fresco quando importa e mais barato quando não importa.
 *
 * Mantemos um tempo de revalidação como rede de segurança, para o caso de o
 * webhook falhar — cinto e suspensório.
 */

export interface RevalidateRequest {
  reason: string;
  /**
   * Superfícies a invalidar. Usamos nomes de domínio ('home', 'trending') em
   * vez de caminhos de URL para que o curator não precise conhecer a estrutura
   * de rotas do site. Se a URL do trending mudar, o curator não fica sabendo —
   * e não deveria mesmo.
   */
  surfaces: string[];
}

/**
 * Solicita ao Next.js a invalidação das superfícies indicadas.
 *
 * SEGURANÇA — este endpoint é um alvo óbvio: quem conseguir chamá-lo à vontade
 * derruba toda a estratégia de cache e, com ela, o site sob pico de tráfego
 * (um ataque de negação de serviço barato e elegante). As proteções:
 *
 *   1. Segredo compartilhado no cabeçalho, comparado no servidor com
 *      comparação de tempo constante (ver a rota em apps/web).
 *   2. O segredo vem de variável de ambiente, nunca embutido no código.
 *   3. Falhar em invalidar NÃO derruba o pipeline: a página apenas fica
 *      desatualizada até o tempo de revalidação passar.
 */
export async function revalidateSurfaces(request: RevalidateRequest): Promise<void> {
  const secret = process.env.REVALIDATE_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!secret || !siteUrl) {
    // Em desenvolvimento isso é normal e esperado: sem site rodando, não há o
    // que invalidar. Não é erro.
    console.log(`[revalidate] ignorado (não configurado) — ${request.reason}`);
    return;
  }

  if (request.surfaces.length === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${siteUrl}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Cabeçalho, e não query string: query string aparece em log de
        // servidor, de proxy e de CDN. Cabeçalho, não.
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({ surfaces: request.surfaces, reason: request.reason }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[revalidate] falhou com status ${response.status} — ${request.reason}`);
      return;
    }

    console.log(`[revalidate] ok: ${request.surfaces.join(', ')} — ${request.reason}`);
  } catch (error) {
    // Falha de invalidação é degradação aceitável: o conteúdo fica velho por
    // alguns segundos. Nunca deve interromper o pipeline.
    console.error(
      '[revalidate] erro na chamada:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    clearTimeout(timeout);
  }
}
