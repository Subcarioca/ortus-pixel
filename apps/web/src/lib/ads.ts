/**
 * =============================================================================
 * POLÍTICA COMERCIAL — quantos anúncios, onde, e quando afiliado é permitido
 * =============================================================================
 *
 * Implementa a tabela de densidade do design (design/README.md §7.1). Ela é
 * DADO ESTÁTICO no front, versionado com o código — não vem do banco e não tem
 * tela de administração. Isso é deliberado: densidade de anúncio é decisão
 * editorial, e decisão editorial editável por formulário acaba editada por
 * quem tem meta de receita, numa sexta-feira à noite, sem revisão.
 *
 * ONDE ESTE ARQUIVO MORA E POR QUÊ:
 *
 * Em `apps/web`, que é CONSUMIDOR de `packages/scoring`. Como pacote nunca
 * importa quem o consome, é estruturalmente impossível o motor de score
 * enxergar esta tabela. Não é disciplina de time, é direção de dependência —
 * a única forma de restrição que sobrevive a uma troca de equipe.
 *
 * A relação entre score e monetização é de MÃO ÚNICA:
 *
 *   temperatura -> densidade comercial : PERMITIDO (e é o coração da tabela).
 *   densidade   -> temperatura         : PROIBIDO. Nenhum dado de receita, RPM
 *                                        ou densidade volta para o cálculo.
 *                                        Ver packages/core/src/monetization.ts
 *                                        e monetization-firewall.test.ts.
 *
 * A REGRA EM UMA FRASE (design §7.1): "quanto mais quente e mais factual, menos
 * comercial; quanto mais evergreen e mais perto de uma decisão de compra, mais
 * tolerância."
 *
 * É contraintuitivo para a receita de hoje e certo para a de doze meses. Quem
 * chega numa notícia urgente veio de push, quer confirmar um fato em dez
 * segundos e está no celular: um retângulo empurrando a manchete transforma o
 * pageview mais valioso do mês numa rejeição. Quem chega num review de placa de
 * vídeo está decidindo uma compra — ali o bloco comercial é serviço, não ruído.
 */

import type { ContentFormat, Heat } from '@subcarioca/core';

/**
 * Formatos de slot. Os nomes são os das classes CSS do design (`.ad--*`), e não
 * a nomenclatura do AdSense: quem lê este código está pensando em layout.
 */
export type AdSlotFormat = 'leader' | 'rect' | 'rail' | 'feed';

export interface AdSlotSpec {
  /** Posicionamento. Vira `data-ad-slot` e rótulo de métrica. */
  id: string;
  format: AdSlotFormat;
  /**
   * Onde o slot entra no corpo do artigo.
   * 'mid'  = no meio do texto (só formatos evergreen o aceitam);
   * 'end'  = depois do último parágrafo;
   * 'rail' = trilho lateral (só existe a partir de 1024px).
   */
  placement: 'mid' | 'end' | 'rail' | 'feed';
}

/**
 * Política comercial resolvida para uma página.
 *
 * Um único objeto com TODAS as decisões comerciais daquela renderização, e não
 * três funções soltas consultadas em lugares diferentes do JSX. O motivo é
 * concreto: as regras têm dependência entre si ("conteúdo urgente não tem
 * afiliado E tem no máximo um slot E não tem ancorado"). Resolvidas juntas, é
 * impossível aplicar metade delas.
 */
export interface CommercePolicy {
  /** Slots de anúncio do corpo + trilho lateral. */
  adSlots: AdSlotSpec[];
  /**
   * Bloco de ofertas de afiliado pode ser exibido?
   *
   * `false` em conteúdo URGENTE, por regra editorial do design (§7, regra 2):
   * "em breaking, link comercial vira suspeita de motivação editorial". O leitor
   * que vê um link de compra numa notícia quente pergunta — com razão — se a
   * notícia existe por causa do link.
   */
  affiliateAllowed: boolean;
  /** Faixa ancorada no mobile. Nunca em conteúdo urgente. */
  anchorAllowed: boolean;
}

/**
 * Densidade por FORMATO (a linha da tabela §7.1).
 *
 * O formato manda mais que a temperatura porque ele descreve a INTENÇÃO do
 * leitor: um review é um review sendo ele evergreen ou não. A temperatura entra
 * depois, como travessão de segurança (ver `commercePolicy`).
 */
const SLOTS_BY_FORMAT: Record<ContentFormat, AdSlotSpec[]> = {
  // Breaking: 1 slot, depois do último parágrafo, nunca antes do TL;DR.
  breaking: [{ id: 'artigo-fim', format: 'leader', placement: 'end' }],
  // Cobertura ao vivo: 1 slot depois da timeline, nunca entre atualizações.
  // (Um slot entre atualizações seria reimpresso a cada recarga da página — má
  // leitura e, do lado do AdSense, o padrão que rende "impressão inválida".)
  live: [{ id: 'artigo-fim', format: 'leader', placement: 'end' }],
  trailer: [{ id: 'artigo-fim', format: 'leader', placement: 'end' }],
  review: [
    { id: 'artigo-meio', format: 'rect', placement: 'mid' },
    { id: 'artigo-fim', format: 'leader', placement: 'end' },
  ],
  comparison: [
    { id: 'artigo-meio', format: 'rect', placement: 'mid' },
    { id: 'artigo-fim', format: 'leader', placement: 'end' },
  ],
  guide: [
    { id: 'artigo-meio', format: 'rect', placement: 'mid' },
    { id: 'artigo-fim', format: 'leader', placement: 'end' },
  ],
  listicle: [
    { id: 'artigo-meio', format: 'rect', placement: 'mid' },
    { id: 'artigo-fim', format: 'leader', placement: 'end' },
  ],
  theory: [{ id: 'artigo-fim', format: 'leader', placement: 'end' }],
};

/** O trilho lateral existe em todo artigo com sidebar (≥1024px). */
const RAIL_SLOT: AdSlotSpec = { id: 'artigo-trilho', format: 'rail', placement: 'rail' };

/**
 * Formatos com vocação comercial (§7.1, coluna "Afiliado").
 *
 * Notícia e breaking ficam de fora: não é que o link seja proibido por lei, é
 * que a credibilidade de uma notícia factual não sobrevive à suspeita de que
 * ela foi escrita para vender alguma coisa.
 */
const AFFILIATE_FORMATS: ContentFormat[] = ['review', 'comparison', 'guide', 'listicle'];

/**
 * O sistema de anúncios está ligado?
 *
 * Sem Publisher ID configurado, NADA é renderizado — nem o espaço reservado.
 * Mesma filosofia dos conectores e do push: ausência de credencial DESLIGA o
 * recurso, em vez de deixar um retângulo cinza "AdSense aqui" no ar.
 *
 * `NEXT_PUBLIC_` porque o ID do publisher é público por natureza — ele aparece
 * na URL do script do AdSense em qualquer site do mundo. Tratá-lo como segredo
 * levaria alguém a colocá-lo numa variável de servidor e descobrir, depois do
 * deploy, que o navegador precisa dele.
 */
export const ADSENSE_CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? '';
export const ADS_ENABLED = ADSENSE_CLIENT_ID.length > 0;

/**
 * Resolve a política comercial de um artigo.
 *
 * A ordem das travas importa: primeiro o formato define o teto, depois a
 * TEMPERATURA só sabe REDUZIR. Nenhuma combinação aumenta a densidade em
 * relação à linha da tabela — o pior caso possível é o que está documentado.
 */
export function commercePolicy(heat: Heat, format: ContentFormat): CommercePolicy {
  const isUrgent = heat === 'hot';

  // Conteúdo urgente: um slot só, sem afiliado, sem ancorado. Vale para
  // QUALQUER formato — um review que por algum motivo virou urgente entra
  // aqui também.
  if (isUrgent) {
    return {
      adSlots: ADS_ENABLED
        ? [{ id: 'artigo-fim', format: 'leader', placement: 'end' }, RAIL_SLOT]
        : [],
      affiliateAllowed: false,
      anchorAllowed: false,
    };
  }

  const bodySlots = SLOTS_BY_FORMAT[format] ?? [];

  return {
    adSlots: ADS_ENABLED ? [...bodySlots, RAIL_SLOT] : [],
    affiliateAllowed: AFFILIATE_FORMATS.includes(format),
    anchorAllowed: ADS_ENABLED,
  };
}

/**
 * Slot in-feed das listagens (categoria, sub-seção).
 *
 * Um a cada 6 cards, sempre depois de uma linha completa da grade (§7.1). Antes
 * do sexto card, o anúncio disputa espaço com o conteúdo que a pessoa veio ver;
 * a partir dali, ela já demonstrou intenção de rolar.
 *
 * A página EM ALTA é zona livre: nenhum slot no fluxo do ranking. É a página
 * que sustenta a credibilidade do produto ("este ranking é editorial") — um
 * anúncio no meio dela contamina exatamente o que ela existe para provar.
 */
export const FEED_AD_EVERY = 6;

export function feedAdSlot(index: number): AdSlotSpec | null {
  if (!ADS_ENABLED) return null;
  if (index === 0 || index % FEED_AD_EVERY !== 0) return null;
  return { id: `feed-${index}`, format: 'feed', placement: 'feed' };
}

/** Rótulo obrigatório acima de todo slot (design §7.2). */
export const AD_LABEL = 'Publicidade';
