/**
 * =============================================================================
 * NOTIFICAÇÃO DE INDEXAÇÃO — avisar buscadores sobre breaking news
 * =============================================================================
 *
 * Requisito do briefing: "ping automático para Google/Bing em breaking news".
 *
 * ESTADO DA ARTE EM 2026 — o requisito precisa ser traduzido, porque o
 * mecanismo mudou desde que essa prática se popularizou:
 *
 *  1. O PING CLÁSSICO DE SITEMAP MORREU. O endpoint
 *     `google.com/ping?sitemap=...` foi DESCONTINUADO pelo Google em 2023.
 *     Implementá-lo hoje seria escrever código que não faz absolutamente nada —
 *     e pior: daria a falsa sensação de que a indexação está sendo acelerada.
 *
 *  2. INDEXNOW é o substituto aberto, adotado por Bing, Yandex, Seznam e
 *     Naver. Um único envio se propaga entre todos os participantes. É gratuito
 *     e exige apenas hospedar um arquivo de chave no domínio.
 *
 *  3. O GOOGLE não participa do IndexNow. Para ele, os caminhos são:
 *     - Indexing API: oficialmente restrita a JobPosting e BroadcastEvent.
 *       Usá-la para notícia comum viola os termos e arrisca a conta.
 *     - Sitemap com `lastModified` correto + boa autoridade de domínio, que é
 *       o que de fato funciona. O Googlebot rastreia portais de notícia ativos
 *       em minutos.
 *     - Google News / Publisher Center, para inclusão no produto de notícias.
 *
 * DECISÃO: implementamos IndexNow (que funciona de verdade) e mantemos o
 * sitemap sempre fresco via invalidação por evento. Não implementamos um ping
 * ao Google que seria teatro. Isso está registrado aqui para que ninguém
 * "conserte" a ausência no futuro sem conhecer o contexto.
 */

/**
 * Notifica os buscadores participantes do IndexNow sobre URLs novas ou
 * atualizadas.
 *
 * @param urls URLs absolutas. Limite de 10.000 por requisição no protocolo;
 *             na prática enviamos poucas, logo após a publicação.
 */
export async function pingSearchEngines(urls: string[]): Promise<{ ok: boolean; reason: string }> {
  const key = process.env.INDEXNOW_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!key || !siteUrl) {
    return { ok: false, reason: 'IndexNow não configurado (INDEXNOW_KEY ausente).' };
  }
  if (urls.length === 0) {
    return { ok: false, reason: 'Nenhuma URL para notificar.' };
  }

  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return { ok: false, reason: 'NEXT_PUBLIC_SITE_URL inválida.' };
  }

  // O protocolo exige que TODAS as URLs pertençam ao host declarado. Enviar uma
  // URL de outro domínio faz o lote inteiro ser rejeitado — e, do ponto de vista
  // do buscador, seria uma tentativa de indexar site alheio.
  const sameHostUrls = urls.filter((url) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  });

  if (sameHostUrls.length === 0) {
    return { ok: false, reason: 'Nenhuma URL válida do próprio domínio.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        // O arquivo de chave deve estar acessível nesta URL, e é assim que o
        // buscador comprova que controlamos o domínio.
        keyLocation: `${siteUrl.replace(/\/$/, '')}/${key}.txt`,
        urlList: sameHostUrls.slice(0, 10_000),
      }),
      signal: controller.signal,
    });

    // 200 = aceito; 202 = aceito, chave em validação. Ambos são sucesso.
    if (response.status === 200 || response.status === 202) {
      console.log(`[search-ping] IndexNow notificado sobre ${sameHostUrls.length} URL(s).`);
      return { ok: true, reason: `HTTP ${response.status}` };
    }

    // 403 = chave inválida; 422 = URL não pertence ao host. Ambos são erro de
    // configuração nosso, e merecem log explícito em vez de falha silenciosa.
    console.error(`[search-ping] IndexNow recusou: HTTP ${response.status}`);
    return { ok: false, reason: `HTTP ${response.status}` };
  } catch (error) {
    // Falhar em notificar NUNCA pode interromper a publicação. O sitemap
    // continua sendo o caminho principal de descoberta.
    const message = error instanceof Error ? error.message : String(error);
    console.error('[search-ping] falha ao notificar:', message);
    return { ok: false, reason: message };
  } finally {
    clearTimeout(timeout);
  }
}
