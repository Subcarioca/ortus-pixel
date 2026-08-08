/**
 * =============================================================================
 * DESPACHANTE DE AÇÕES — o que acontece quando um score cruza uma faixa
 * =============================================================================
 *
 * Traduz score em AÇÃO no mundo real:
 *
 *   80-100 QUENTE   -> alerta imediato na redação + candidato a push + hero
 *   60-79  EM ALTA  -> entra na seção Trending
 *   40-59  RELEVANTE-> fluxo normal, sem urgência
 *   <40    EVERGREEN-> vira insumo de pauta de SEO
 *
 * DUAS REGRAS INEGOCIÁVEIS, implementadas aqui:
 *
 * 1. O HUMANO SEMPRE VENCE O ALGORITMO. Se existe override manual, ele manda —
 *    e nenhuma automação passa por cima.
 *
 * 2. AUTOMAÇÃO É PRIVILÉGIO, NÃO PADRÃO. Push exige score alto E confiança
 *    suficiente E ausência de gatilho sensível. Um push equivocado para a base
 *    inteira gera descadastro em massa e queima permanentemente a permissão de
 *    notificação no navegador — que não se recupera com pedido de desculpas.
 *
 * PROJETO: as ações são disparadas por EVENTO, não por varredura periódica.
 * Assim o alerta sai no mesmo segundo em que o score cruza o limiar, em vez de
 * esperar o próximo ciclo. Em breaking news, minutos são o produto.
 */

import { bandForScore, type ScoreBand, type ScoreResult } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';
import { isEligibleForAutomation } from '@subcarioca/scoring';

import { logPipelineEvent } from './instrumentation';
import { notifyNewsroom } from './newsroom-alert';
import { revalidateSurfaces } from './revalidate';
import { pingSearchEngines } from './search-ping';

export interface ScoreCalculatedInput {
  topicId: string;
  topicTitle: string;
  result: ScoreResult;
  previousBand: string;
  becameHotNow: boolean;
  hasManualOverride: boolean;
}

/**
 * Ponto de entrada, chamado pelo pipeline após cada cálculo de score.
 * Como todo handler de evento, nunca lança: uma falha ao notificar não pode
 * impedir o ciclo de continuar processando os demais tópicos.
 */
export async function onScoreCalculated(input: ScoreCalculatedInput): Promise<void> {
  try {
    const { topicId, topicTitle, result, previousBand, becameHotNow, hasManualOverride } = input;

    // ---- REGRA 1: override humano vence ----
    if (hasManualOverride) {
      // O score algorítmico continua sendo gravado (é o que permite medir a
      // precisão do modelo depois), mas nenhuma automação é acionada. Quem
      // assumiu o controle foi um editor, e ele decide.
      await logPipelineEvent({
        eventType: 'topic.scored',
        topicId,
        payload: {
          score: result.score,
          band: result.band,
          skippedActions: true,
          reason: 'override manual ativo',
        },
      });
      return;
    }

    await logPipelineEvent({
      eventType: 'topic.scored',
      topicId,
      payload: {
        score: result.score,
        band: result.band,
        previousBand,
        confidence: result.confidence,
        weightsVersion: result.weightsVersion,
      },
    });

    const bandChanged = result.band !== previousBand;

    // -------------------------------------------------------------------------
    // FAIXA QUENTE — alerta imediato
    // -------------------------------------------------------------------------
    if (becameHotNow) {
      await logPipelineEvent({
        eventType: 'topic.became_hot',
        topicId,
        payload: { score: result.score, confidence: result.confidence },
      });

      const eligibility = isEligibleForAutomation(result);

      // O alerta para a REDAÇÃO sai SEMPRE que algo esquenta — inclusive (e
      // principalmente) quando a automação está bloqueada. Um vazamento com
      // score 85 é exatamente o caso em que o jornalista mais precisa ser
      // avisado rápido, ainda que o robô não possa publicar nem notificar.
      await notifyNewsroom({
        topicId,
        title: topicTitle,
        score: result.score,
        confidence: result.confidence,
        summary: result.summary,
        requiresReview: !eligibility.eligible,
        reviewReason: eligibility.reason,
        emotionalTriggers: result.emotionalTriggers,
        targetMinutes: 30,
      });

      // ---- REGRA 2: push só com todos os critérios satisfeitos ----
      if (eligibility.eligible) {
        await logPipelineEvent({
          eventType: 'push.candidate_approved',
          topicId,
          payload: { score: result.score, autoEligible: true },
        });
        // NOTA: o envio efetivo do push acontece na PUBLICAÇÃO do artigo, não
        // aqui. Não faz sentido notificar sobre um tópico que ainda não tem
        // matéria — o leitor clicaria e cairia no vazio.
      } else {
        await logPipelineEvent({
          eventType: 'push.candidate_blocked',
          topicId,
          payload: { score: result.score, reason: eligibility.reason },
        });
      }
    }

    // -------------------------------------------------------------------------
    // INVALIDAÇÃO DE CACHE
    // -------------------------------------------------------------------------
    // Só invalidamos quando a FAIXA muda, e não a cada variação de score.
    // Motivo de performance: o pipeline recalcula scores a cada poucos minutos;
    // invalidar a home a cada 0,3 ponto de variação destruiria a taxa de acerto
    // do cache justamente durante um pico de tráfego — que é quando o cache
    // mais importa. Mudança de faixa é o que de fato altera a página.
    if (bandChanged) {
      await revalidateSurfaces({
        reason: `Tópico mudou de ${previousBand} para ${result.band}`,
        surfaces: surfacesForBand(result.band),
      });
    }
  } catch (error) {
    console.error('[dispatcher] falha ao processar ações do score:', error);
  }
}

/** Superfícies do site afetadas por uma mudança de faixa. */
function surfacesForBand(band: ScoreBand): string[] {
  const placement = bandForScore(
    band === 'HOT' ? 90 : band === 'RISING' ? 70 : band === 'RELEVANT' ? 50 : 20,
  ).homePlacement;

  switch (placement) {
    case 'hero':
      // Um tópico QUENTE muda a home inteira, o ticker e a página Em Alta.
      return ['home', 'trending', 'ticker'];
    case 'trending':
      return ['home', 'trending'];
    case 'feed':
      return ['trending'];
    default:
      return [];
  }
}

/**
 * Chamado quando um artigo é PUBLICADO a partir de um tópico QUENTE.
 * É aqui que o push de fato sai — quando já existe uma página para abrir.
 */
export async function onArticlePublished(input: {
  articleId: string;
  topicId: string | null;
  score: number;
  autoApprovePush: boolean;
}): Promise<void> {
  try {
    const article = await prisma.article.findUnique({
      where: { id: input.articleId },
      select: {
        title: true,
        excerpt: true,
        slug: true,
        coverImageUrl: true,
        category: { select: { slug: true } },
      },
    });

    if (!article) return;

    const band = bandForScore(input.score);

    if (band.pushCandidate && input.autoApprovePush) {
      // Criamos a campanha com status 'pending'. O worker de envio a processa.
      // Separar criação de envio permite cancelar nos primeiros segundos — a
      // janela em que erros de digitação em manchete costumam ser notados.
      await prisma.pushNotification.create({
        data: {
          articleId: input.articleId,
          title: article.title.slice(0, 65),
          // Limites de tamanho seguem o que Android e iOS exibem sem truncar.
          body: article.excerpt.slice(0, 120),
          iconUrl: article.coverImageUrl,
          url: `/${article.category.slug}/${article.slug}`,
          trigger: 'automatic',
          scoreAtTrigger: input.score,
          status: 'pending',
          // 90 segundos de carência: tempo para o editor cancelar caso perceba
          // um erro logo após publicar. Barato de implementar, evita o tipo de
          // constrangimento que só se descobre depois de 200 mil notificações.
          scheduledFor: new Date(Date.now() + 90_000),
        },
      });

      await logPipelineEvent({
        eventType: 'push.scheduled',
        articleId: input.articleId,
        topicId: input.topicId ?? undefined,
        payload: { score: input.score, delaySeconds: 90 },
      });
    }

    await revalidateSurfaces({
      reason: 'Artigo publicado',
      surfaces: ['home', 'trending', 'sitemap', `category:${article.category.slug}`],
    });

    // Notifica os buscadores. Só para conteúdo QUENTE: em breaking news, cada
    // minuto de antecedência na indexação vale tráfego. Para conteúdo de fluxo
    // normal, o sitemap dá conta e não há motivo para gastar a cota.
    if (band.band === 'HOT') {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      if (siteUrl) {
        const articleUrl = `${siteUrl.replace(/\/$/, '')}/${article.category.slug}/${article.slug}`;
        // Sem `await` bloqueante no caminho crítico: a publicação já aconteceu,
        // e a notificação é um efeito colateral desejável, não um pré-requisito.
        void pingSearchEngines([articleUrl]).then((result) => {
          void logPipelineEvent({
            eventType: 'search.pinged',
            articleId: input.articleId,
            payload: { ok: result.ok, reason: result.reason },
          });
        });
      }
    }
  } catch (error) {
    console.error('[dispatcher] falha ao processar publicação:', error);
  }
}
