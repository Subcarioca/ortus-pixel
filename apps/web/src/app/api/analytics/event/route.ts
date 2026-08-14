/**
 * =============================================================================
 * POST /api/analytics/event — recebe um evento de audiência do leitor
 * =============================================================================
 *
 * Rota PÚBLICA e não autenticada, por natureza: quem a chama é o navegador de
 * qualquer visitante. Isso define tudo no desenho dela.
 *
 * -----------------------------------------------------------------------------
 * O QUE UMA ROTA PÚBLICA DE ESCRITA PRECISA RESPONDER ANTES DE EXISTIR
 * -----------------------------------------------------------------------------
 *
 * "E se alguém mandar um milhão de eventos?" — Rate limit por IP, e o dano
 * máximo é um número inflado no painel. Vale registrar em voz alta o que isso
 * significa: ESTES NÚMEROS NÃO SÃO AUDITÁVEIS. Nenhuma métrica coletada no
 * cliente é (nem as do GA4). Servem para comparar matérias entre si e orientar
 * decisão editorial — nunca para prestar contas a anunciante, que é papel do
 * relatório do AdSense.
 *
 * "E se mandarem lixo?" — Vocabulário fechado de `kind`, ids conferidos por
 * formato e nada além disso é gravado. Um `articleId` inventado que passe pelo
 * formato vira uma linha órfã que NENHUMA tela lê: a agregação parte das
 * matérias que existem e cruza com os eventos, nunca o contrário.
 *
 * "E se derrubarem o banco?" — Uma linha por evento, sem transação, sem leitura
 * prévia, sem chave estrangeira (ver o comentário do model `AnalyticsEvent`). O
 * único caso com leitura é o clique para outra matéria, que faz uma busca por
 * slug (índice único) e é ordens de grandeza mais raro que a visualização.
 *
 * -----------------------------------------------------------------------------
 * RESPONDE 204 EM QUASE TUDO, INCLUSIVE NA RECUSA
 * -----------------------------------------------------------------------------
 * O cliente usa `navigator.sendBeacon`, que por especificação IGNORA a resposta.
 * Devolver JSON com detalhes seria gastar banda para ninguém, e devolver erro
 * distinto para "matéria não existe" transformaria esta rota num oráculo barato
 * para descobrir quais slugs existem — inclusive rascunhos, se alguém adivinhar
 * o endereço. Falha e sucesso saem iguais; o que não sai igual é o 429, porque
 * ele é a única informação que o cliente legítimo poderia usar.
 */

import { NextResponse } from 'next/server';

import { isAnalyticsEventKind } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { checkRateLimit, getClientIp } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Formato de `cuid()` — o mesmo teste já usado nas rotas do painel. */
const ID_PATTERN = /^[a-z0-9]{10,40}$/i;

/** Resposta padrão. Ver o bloco no topo do arquivo. */
const NO_CONTENT = new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  /**
   * 120 eventos por minuto por IP.
   *
   * Um leitor real, navegando rápido, gera talvez 10. O teto alto existe porque
   * IP de operadora móvel e rede corporativa é COMPARTILHADO por muita gente —
   * um limite apertado silenciaria a medição de escolas e escritórios inteiros,
   * enviesando o dado justamente onde há mais leitores juntos.
   */
  const limit = checkRateLimit(`analytics:${ip}`, { maxRequests: 120, windowSeconds: 60 });
  if (!limit.allowed) return new NextResponse(null, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT;
  }

  const payload = body as Record<string, unknown>;

  const kind = payload.kind;
  if (!isAnalyticsEventKind(kind)) return NO_CONTENT;

  const articleId =
    typeof payload.articleId === 'string' && ID_PATTERN.test(payload.articleId)
      ? payload.articleId
      : null;

  // Todo evento acontece DENTRO de uma matéria. Sem ela, não há o que agregar —
  // a tela do painel é organizada por matéria.
  if (!articleId) return NO_CONTENT;

  const offerId =
    typeof payload.offerId === 'string' && ID_PATTERN.test(payload.offerId)
      ? payload.offerId
      : null;

  const slotId =
    typeof payload.slotId === 'string' && /^[a-z0-9-]{1,64}$/i.test(payload.slotId)
      ? payload.slotId
      : null;

  /**
   * O DESTINO DO CLIQUE CHEGA COMO CAMINHO, E VIRA ID AQUI.
   *
   * O navegador conhece a URL (`/games/nome-da-materia`), não o id — ele não
   * tem por que conhecer identificadores internos, e mandá-los no HTML só para
   * isto seria expor dado sem necessidade. A tradução é uma busca pelo `slug`,
   * que é índice ÚNICO: custo de uma leitura de índice.
   *
   * Clique para uma URL que não é matéria (a home, uma categoria) resulta em
   * `null` e o evento é gravado assim mesmo: continua sendo um clique que levou
   * o leitor adiante no site, e contá-lo como "saiu para outra matéria" seria
   * errado, mas descartá-lo perderia o sinal de navegação interna.
   */
  let targetArticleId: string | null = null;
  if (kind === 'article.link' && typeof payload.targetPath === 'string') {
    const slug = lastPathSegment(payload.targetPath);
    if (slug) {
      const target = await prisma.article.findUnique({
        where: { slug },
        select: { id: true },
      });
      targetArticleId = target?.id ?? null;
    }
  }

  try {
    /**
     * DUAS ESCRITAS PARA A VISUALIZAÇÃO, e a segunda merece justificativa.
     *
     * O evento granular responde "o que aconteceu nos últimos 30 dias" e será
     * PODADO quando a retenção entrar (ver o schema). O `viewCount` do artigo é
     * o total histórico, que sobrevive à poda e já existia no model. Mantê-lo
     * atualizado custa um UPDATE por chave primária e é o que evita a situação
     * boba de, daqui a um ano, não saber quantas visitas a melhor matéria do
     * site teve — porque os eventos daquele mês já foram agregados e apagados.
     *
     * `Promise.all` e não transação: são dois fatos independentes, e nenhum dos
     * dois justifica segurar um lock. Se um falhar, o outro valendo é melhor do
     * que nenhum — analytics não é contabilidade.
     */
    const writes: Promise<unknown>[] = [
      prisma.analyticsEvent.create({
        data: { kind, articleId, targetArticleId, offerId, slotId },
      }),
    ];

    if (kind === 'article.view') {
      writes.push(
        prisma.article.update({
          where: { id: articleId },
          data: { viewCount: { increment: 1 } },
        }),
      );
    }

    await Promise.all(writes);
  } catch {
    /**
     * ENGOLE O ERRO DE PROPÓSITO — e este é o único lugar do projeto onde isso
     * é a atitude certa.
     *
     * A causa esperada é `articleId` que não existe mais (matéria apagada com a
     * página ainda aberta na aba de alguém). Deixar subir viraria um 500 no log
     * a cada leitor que tivesse a página velha aberta, afogando erros de
     * verdade. Perder um evento de medição não tem consequência nenhuma; o
     * inverso — barulho que esconde incidente real — tem.
     */
  }

  return NO_CONTENT;
}

/**
 * Último segmento de um caminho interno, quando ele parece um slug de matéria.
 *
 * Aceita SÓ caminho relativo: `https://evil.com/x` e `//evil.com/x` não passam.
 * Não é paranoia deslocada — sem isso, um site externo poderia usar esta rota
 * para nos fazer consultar slugs arbitrários, e a validação de formato do slug
 * é o que mantém a consulta previsível.
 */
function lastPathSegment(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null;

  const clean = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = clean.split('/').filter(Boolean);

  // Matéria é sempre `/{categoria}/{slug}`: dois segmentos. Um segmento só é
  // home de seção; três ou mais não é rota de matéria neste site.
  if (segments.length !== 2) return null;

  const slug = segments[1] ?? '';
  return /^[a-z0-9-]{1,120}$/i.test(slug) ? slug : null;
}
