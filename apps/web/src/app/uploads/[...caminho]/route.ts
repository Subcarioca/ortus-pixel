/**
 * =============================================================================
 * GET /uploads/... — entrega as imagens enviadas pelo painel
 * =============================================================================
 *
 * ESTA ROTA EXISTE PORQUE `public/` NÃO RESOLVE O PROBLEMA. O Next serve
 * `public/` a partir do que existia no momento do BUILD; arquivo criado depois,
 * em tempo de execução, não é servido. O racional completo (e as três opções
 * consideradas) está no cabeçalho de `server/uploads.ts`.
 *
 * -----------------------------------------------------------------------------
 * SERVIR ARQUIVO DE USUÁRIO NO DOMÍNIO PRINCIPAL É UM RISCO CONHECIDO
 * -----------------------------------------------------------------------------
 * O ataque clássico: enviar um arquivo que o navegador decida interpretar como
 * HTML e executá-lo no NOSSO domínio — o que dá acesso ao cookie de sessão do
 * painel. As quatro camadas contra isso, do dado até o cabeçalho:
 *
 *   1. Só entra o que É imagem, conferido por assinatura binária na gravação
 *      (e SVG não entra nunca). Ver `server/uploads.ts`.
 *   2. O caminho pedido é validado por formato E confinado à raiz de uploads
 *      (`resolveUploadPath`), o que fecha travessia de diretório.
 *   3. O `Content-Type` sai da EXTENSÃO JÁ VALIDADA do arquivo em disco, nunca
 *      de nada que o cliente diga.
 *   4. Os cabeçalhos abaixo tiram do navegador a chance de "adivinhar" e de
 *      executar qualquer coisa, mesmo que 1 a 3 falhem.
 *
 * -----------------------------------------------------------------------------
 * CACHE IMUTÁVEL É SEGURO AQUI — e não seria em quase nenhum outro lugar
 * -----------------------------------------------------------------------------
 * O nome do arquivo é aleatório e nunca é reaproveitado: a mesma URL sempre
 * devolve os mesmos bytes. Isso é exatamente a condição que `immutable` exige, e
 * é o que permite um ano de cache sem revalidação. Trocar a imagem de uma
 * matéria significa enviar outra e gravar outra URL — não sobrescrever esta.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { mimeTypeForStoredFile, resolveUploadPath } from '@/server/uploads';

/**
 * `force-static` seria tentador (o conteúdo é imutável), e está errado: as
 * imagens não existem no build, então não há o que pré-renderizar. O cache que
 * vale é o do navegador e o do CDN, via cabeçalho.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caminho: string[] }> },
) {
  const { caminho } = await params;

  const resolved = resolveUploadPath(caminho ?? []);

  if (!resolved.ok) {
    /**
     * 503 (e não 404) quando o armazenamento não está configurado, e a diferença
     * importa para quem for depurar às 3h: 404 diz "esta imagem não existe" e
     * manda procurar no lugar errado — o editor, a matéria, o banco. 503 com
     * log diz o que é: falta configuração no servidor. É o mesmo tratamento que
     * `/api/revalidate` dá ao segredo ausente.
     *
     * O log sai UMA vez por requisição de imagem, o que num site mal configurado
     * é barulhento de propósito: é uma condição que precisa ser corrigida, não
     * tolerada.
     */
    if (resolved.reason === 'unconfigured') {
      console.error(`[uploads] ${resolved.message}`);
      return new NextResponse(null, { status: 503 });
    }

    // 404 — e não 400 — para caminho recusado pelo validador. Distinguir "não
    // existe" de "formato inválido" entregaria a um curioso um oráculo para
    // mapear a estrutura da pasta.
    return new NextResponse(null, { status: 404 });
  }

  const filePath = resolved.path;

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new NextResponse(null, { status: 404 });
    size = info.size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  /**
   * STREAM, e não `readFile`.
   *
   * `readFile` carregaria a imagem inteira na memória do processo a cada
   * requisição. Com dez leitores baixando capas ao mesmo tempo, isso é dezenas
   * de megabytes de pico — num servidor que precisa da memória para renderizar
   * página. O stream entrega em pedaços e mantém o consumo constante.
   */
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': mimeTypeForStoredFile(filePath),
      'Content-Length': String(size),
      // Um ano, imutável — ver o bloco no topo do arquivo.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Redundante com o cabeçalho global do next.config, e mantido aqui de
      // propósito: esta é a única rota que devolve bytes de terceiros, e ela não
      // pode depender de uma configuração distante continuar existindo.
      'X-Content-Type-Options': 'nosniff',
      // Se, apesar de tudo, algo executável for servido daqui, esta política
      // impede que ele carregue ou execute qualquer coisa.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // `inline` porque é imagem de matéria e deve aparecer na página; sem
      // `filename`, para não ecoar nada de volta ao cliente.
      'Content-Disposition': 'inline',
    },
  });
}
