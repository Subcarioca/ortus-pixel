/**
 * =============================================================================
 * CONECTOR: AUTORIDADE DA FONTE (interno, custo zero)
 * =============================================================================
 *
 * Item 5 do briefing: "quanto mais oficial, maior confiança e maior urgência".
 *
 * Este conector não chama API nenhuma: classifica o DOMÍNIO da fonte primária
 * do tópico contra uma tabela curada. Simples, instantâneo e um dos sinais mais
 * valiosos do conjunto — porque é ele que separa "a Rockstar anunciou" de
 * "um anônimo no fórum disse".
 *
 * DECISÃO DE MODELAGEM: a tabela é dado versionado em código, e não linhas no
 * banco. Motivo: ela muda pouco, precisa de revisão em code review (adicionar
 * um domínio como "oficial" tem consequência editorial direta — passa a
 * disparar push) e deve estar sob controle de versão para auditoria. Uma tela
 * de admin que permitisse marcar qualquer site como "oficial" seria um belo
 * vetor de manipulação interna.
 */

import type { SignalConnector, SignalContext, SignalMeasurement } from '@subcarioca/core';
import { SOURCE_TIERS, type SourceTier } from '@subcarioca/core';

/**
 * Domínios classificados por nível de autoridade.
 * A chave é o domínio "raiz" — o casamento é por sufixo, então
 * "news.xbox.com" casa com "xbox.com".
 */
const DOMAIN_AUTHORITY: Record<string, SourceTier> = {
  // --- Oficiais: estúdios, publishers, plataformas ---
  'rockstargames.com': 'official',
  'nintendo.com': 'official',
  'playstation.com': 'official',
  'xbox.com': 'official',
  'marvel.com': 'official',
  'starwars.com': 'official',
  'dc.com': 'official',
  'blizzard.com': 'official',
  'ea.com': 'official',
  'ubisoft.com': 'official',
  'netflix.com': 'official',
  'hbo.com': 'official',
  'crunchyroll.com': 'official',
  'shonenjump.com': 'official',
  'take2games.com': 'official',
  'valvesoftware.com': 'official',

  // --- Imprensa tier 1: veículos consolidados ---
  'variety.com': 'tier1Press',
  'hollywoodreporter.com': 'tier1Press',
  'deadline.com': 'tier1Press',
  'ign.com': 'tier1Press',
  'eurogamer.net': 'tier1Press',
  'gamespot.com': 'tier1Press',
  'polygon.com': 'tier1Press',
  'theverge.com': 'tier1Press',
  'kotaku.com': 'tier1Press',
  'bloomberg.com': 'tier1Press',
  'reuters.com': 'tier1Press',

  // --- Imprensa tier 1 brasileira: veículos consolidados de tecnologia ---
  //
  // ⚠ ESTA TABELA NÃO É DOCUMENTAÇÃO — ELA DECIDE O SCORE.
  // `curate.ts` grava `effectiveTier = source.tier === 'official' ? 'official'
  // : classifyDomain(url).tier`, ou seja: para tudo que não é fonte oficial,
  // quem manda é o DOMÍNIO, não o `tier` declarado no catálogo de feeds.
  // Domínio ausente daqui cai no padrão 'aggregator' (0,3 contra 0,8 de
  // tier1Press) — o que rebaixaria toda a imprensa brasileira que acabamos de
  // adicionar e a faria quase nunca alcançar a faixa QUENTE. Adicionar a fonte
  // em `rss-sources.ts` sem adicionar o domínio aqui é meio trabalho feito.
  'tecmundo.com.br': 'tier1Press',
  'canaltech.com.br': 'tier1Press',

  // --- Imprensa tier 2: portais nerd relevantes (nossos concorrentes diretos) ---
  'omelete.com.br': 'tier2Press',
  'jovemnerd.com.br': 'tier2Press',
  // Endereço antigo do IGN Brasil. Hoje a operação publica em `br.ign.com`, que
  // casa com a regra `ign.com` acima e portanto é classificado como tier1Press —
  // correto para uma redação do porte da deles. A linha fica por retrocompa-
  // tibilidade com URLs antigas que ainda circulam.
  'ign.com.br': 'tier2Press',
  'legiaodosherois.com.br': 'tier2Press',
  'einerd.com.br': 'tier2Press',
  'adrenaline.com.br': 'tier2Press',
  'theenemy.com.br': 'tier2Press',
  // Estes dois JÁ ESTAVAM no catálogo de feeds declarados como imprensa, mas
  // faltavam nesta tabela — então todo tópico deles era gravado como
  // 'aggregator' (0,3 em vez de 0,6), na prática metade do peso de autoridade.
  // Achado ao conferir o que o ciclo real gravou no banco de dev em 15/08/2026:
  // 12 dos 74 tópicos do ciclo estavam rebaixados assim, em silêncio.
  'cbr.com': 'tier2Press',
  'animenewsnetwork.com': 'tier2Press',
  'tecnoblog.net': 'tier2Press',
  'arkade.com.br': 'tier2Press',
  'gameblast.com.br': 'tier2Press',
  'cinepop.com.br': 'tier2Press',
  'jbox.com.br': 'tier2Press',
  'intoxianime.com': 'tier2Press',
  'animeunited.com.br': 'tier2Press',
  'universohq.com': 'tier2Press',

  // --- Insiders com histórico verificável ---
  // Peso intermediário: acertam com frequência, mas exigem apuração.
  'insider-gaming.com': 'credibleInsider',

  // --- Agregadores ---
  'reddit.com': 'aggregator',
  'news.google.com': 'aggregator',
  'flipboard.com': 'aggregator',

  // --- Não verificados ---
  '4chan.org': 'unverified',
  'pastebin.com': 'unverified',
};

/**
 * Extrai o domínio e classifica.
 *
 * SEGURANÇA: `new URL()` é usado em vez de regex de propósito. Regex sobre URL
 * é notoriamente fácil de enganar — `https://rockstargames.com.evil.com/` passa
 * numa checagem ingênua de "contém rockstargames.com" e faria o sistema tratar
 * um domínio hostil como fonte oficial, com direito a push automático. O parser
 * nativo isola o hostname corretamente, e o casamento por sufixo exige o ponto
 * separador.
 */
export function classifyDomain(url: string | null): {
  tier: SourceTier;
  domain: string | null;
} {
  if (!url) return { tier: 'unverified', domain: null };

  let hostname: string;
  try {
    const parsed = new URL(url);
    // Apenas http(s). Um `javascript:` ou `data:` aqui não faria sentido e
    // poderia virar problema se a URL fosse renderizada adiante.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { tier: 'unverified', domain: null };
    }
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { tier: 'unverified', domain: null };
  }

  for (const [domain, tier] of Object.entries(DOMAIN_AUTHORITY)) {
    // Exige igualdade exata ou subdomínio legítimo (com o ponto).
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return { tier, domain };
    }
  }

  // Domínio desconhecido não é "não confiável" nem "confiável": é desconhecido.
  // Usamos 'aggregator' como valor neutro para não punir veículos legítimos que
  // simplesmente ainda não entraram na tabela.
  return { tier: 'aggregator', domain: hostname };
}

/**
 * Contexto estendido: o orquestrador injeta a URL da fonte do tópico.
 * Fazemos isso com uma extensão opcional da interface para não poluir
 * `SignalContext` com campos que só um conector usa.
 */
export interface SourceAwareContext extends SignalContext {
  sourceUrl?: string | null;
  sourceTier?: string | null;
}

export const sourceAuthorityConnector: SignalConnector = {
  id: 'source-authority',
  displayName: 'Autoridade da fonte',
  dimensions: ['sourceAuthority'],
  cost: 'free',
  stage: 'discovery',
  // Timeout mínimo: é computação local, nunca deveria levar mais que isso.
  timeoutMs: 500,

  isAvailable() {
    return true;
  },

  async collect(context: SignalContext): Promise<SignalMeasurement[]> {
    const extended = context as SourceAwareContext;

    // Se o tópico já traz um tier definido (ex.: veio de um feed que sabemos
    // ser oficial), respeitamos. Caso contrário, classificamos pela URL.
    const tier =
      extended.sourceTier && extended.sourceTier in SOURCE_TIERS
        ? (extended.sourceTier as SourceTier)
        : classifyDomain(extended.sourceUrl ?? null).tier;

    const value = SOURCE_TIERS[tier];

    const labels: Record<SourceTier, string> = {
      official: 'Fonte OFICIAL (estúdio/publisher) — confirmada',
      // "internacional" saiu do rótulo quando TecMundo e Canaltech entraram na
      // faixa: o que a classificação mede é PORTE E CONSOLIDAÇÃO do veículo, e
      // não o país dele. O rótulo aparece na fila do painel, então dizer
      // "internacional" ao lado de uma manchete do TecMundo seria só confusão.
      tier1Press: 'Veículo consolidado do setor',
      tier2Press: 'Portal de nicho relevante',
      credibleInsider: 'Insider com histórico de acertos — requer apuração',
      aggregator: 'Agregador ou fonte não classificada',
      unverified: 'Fonte NÃO VERIFICADA — tratar como rumor',
    };

    return [
      {
        dimension: 'sourceAuthority',
        connectorId: this.id,
        value,
        rawValue: tier,
        explanation: labels[tier],
        // Confiança alta: classificar domínio é determinístico. A incerteza
        // está no CONTEÚDO da notícia, não na identificação de quem publicou.
        confidence: 0.95,
        observedAt: new Date(),
      },
    ];
  },
};
