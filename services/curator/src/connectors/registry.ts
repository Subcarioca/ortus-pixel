/**
 * =============================================================================
 * REGISTRY DE CONECTORES — o mecanismo de plugin
 * =============================================================================
 *
 * Aqui mora a resposta ao requisito "adicionar novas fontes de sinal sem
 * reescrever o núcleo".
 *
 * COMO ADICIONAR UM CONECTOR NOVO (ex.: TikTok), o passo a passo completo:
 *   1. Crie `connectors/tiktok.ts` exportando um objeto `SignalConnector`.
 *   2. Adicione-o ao array `ALL_CONNECTORS` no fim deste arquivo.
 *   3. Pronto.
 *
 * Não há passo 4. Nenhum arquivo do motor de score, do orquestrador ou do
 * front-end precisa ser tocado. Isso é possível porque o núcleo só conhece a
 * INTERFACE `SignalConnector` e a semântica das dimensões — nunca uma fonte
 * concreta.
 *
 * Poderíamos ir além e fazer auto-descoberta por varredura de diretório, mas
 * o array explícito foi mantido de propósito: registro explícito é rastreável
 * (dá para ler o arquivo e saber tudo que roda), amigável ao tree-shaking e
 * não quebra quando o bundler mexe nos caminhos. "Mágica" aqui custaria mais
 * do que economiza.
 */

import type { SignalConnector } from '@canalnerd/core';

import { googleTrendsConnector } from './google-trends';
import { redditConnector } from './reddit';
import { youtubeConnector } from './youtube';
import { xConnector } from './x-twitter';
import { sourceAuthorityConnector } from './source-authority';
import { releaseCalendarConnector } from './release-calendar';
import { serpCompetitionConnector } from './serp-competition';
import { audienceAffinityConnector } from './audience-affinity';
import { emotionalTriggerConnector } from './emotional-triggers';

/**
 * TODOS os conectores conhecidos pelo sistema.
 *
 * Repare na mistura proposital de naturezas:
 *   - Externos pagos/quotados: Google Trends, Reddit, YouTube, X, SERP.
 *   - Internos e gratuitos: autoridade da fonte, calendário de lançamentos,
 *     afinidade da audiência, gatilhos emocionais.
 *
 * Os internos são estratégicos: funcionam SEM nenhuma API externa, custam zero
 * e são justamente os que a concorrência não consegue copiar (ninguém sabe
 * como a NOSSA base reage a cada franquia). Consequência prática importante:
 * mesmo com todas as APIs externas fora do ar, o pipeline continua produzindo
 * scores úteis. A degradação é real, não teórica.
 */
/**
 * NOTA DE ORGANIZAÇÃO: a leitura de feeds RSS NÃO aparece aqui, e isso é
 * proposital. RSS é mecanismo de DESCOBERTA (encontra tópicos que ainda não
 * existem no banco), não de pontuação de um tópico existente. Misturar as duas
 * responsabilidades na mesma interface confundiria o contrato — um conector de
 * sinal responde "quão quente está este tópico?", enquanto a descoberta
 * responde "que tópicos existem?". O código de descoberta vive em
 * `src/discovery/`.
 */
export const ALL_CONNECTORS: SignalConnector[] = [
  // --- Estágio 1: descoberta (barato, roda para todos os candidatos) ---
  sourceAuthorityConnector,
  releaseCalendarConnector,
  audienceAffinityConnector,
  emotionalTriggerConnector,
  youtubeConnector,

  // --- Estágio 2: enriquecimento (caro, só para quem passou da triagem) ---
  googleTrendsConnector,
  redditConnector,
  serpCompetitionConnector,
  xConnector,
];

/** Conectores de um estágio específico que estão de fato disponíveis agora. */
export async function getAvailableConnectors(
  stage: 'discovery' | 'enrichment',
): Promise<SignalConnector[]> {
  const ofStage = ALL_CONNECTORS.filter((c) => c.stage === stage);

  // `isAvailable` pode ser assíncrono (checar token, pingar serviço), então
  // resolvemos em paralelo — sequencial aqui atrasaria todo ciclo à toa.
  const availability = await Promise.all(
    ofStage.map(async (connector) => {
      try {
        return { connector, available: await connector.isAvailable() };
      } catch {
        // Conector que explode no próprio check de disponibilidade é
        // simplesmente indisponível. Não há motivo para derrubar o ciclo.
        return { connector, available: false };
      }
    }),
  );

  return availability.filter((a) => a.available).map((a) => a.connector);
}

export function getConnectorById(id: string): SignalConnector | undefined {
  return ALL_CONNECTORS.find((c) => c.id === id);
}

/**
 * Validação de integridade do registry, executada no boot.
 *
 * IDs duplicados seriam um bug traiçoeiro: as leituras dos dois conectores se
 * misturariam no banco e nas métricas de saúde, e o sintoma apareceria semanas
 * depois como "esse conector tem taxa de erro estranha". Falhar no boot é
 * incomparavelmente mais barato.
 */
export function validateRegistry(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const connector of ALL_CONNECTORS) {
    if (seen.has(connector.id)) {
      errors.push(`ID de conector duplicado: "${connector.id}".`);
    }
    seen.add(connector.id);

    if (connector.dimensions.length === 0) {
      errors.push(`Conector "${connector.id}" não declara nenhuma dimensão.`);
    }
    if (connector.timeoutMs <= 0 || connector.timeoutMs > 30_000) {
      errors.push(
        `Conector "${connector.id}" tem timeout inválido (${connector.timeoutMs}ms). Use entre 1ms e 30s.`,
      );
    }
    // Regra de custo: fonte paga no estágio de descoberta estouraria o
    // orçamento, porque descoberta roda para todos os candidatos.
    if (connector.stage === 'discovery' && connector.cost === 'metered') {
      errors.push(
        `Conector "${connector.id}" é pago (metered) mas está no estágio de descoberta. Mova para 'enrichment'.`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
