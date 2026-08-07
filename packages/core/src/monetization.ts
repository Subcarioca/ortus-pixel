/**
 * =============================================================================
 * MONETIZAÇÃO — vocabulário de ofertas de afiliado e disclosure
 * =============================================================================
 *
 * LEIA ISTO ANTES DE MEXER EM QUALQUER COISA AQUI:
 *
 *   NADA neste arquivo pode, em hipótese alguma, alimentar `packages/scoring`.
 *
 * O algoritmo de popularidade (`score`, `heat`, `seoOpportunity`, `WeightSet`)
 * NUNCA pode ser influenciado por sinal de monetização — RPM previsto,
 * `affiliateWeight`, densidade de anúncio, comissão da loja. Isso é decisão de
 * produto do dono do site, validada e fechada; não é uma escolha de engenharia
 * a ser reaberta em code review.
 *
 * POR QUE A REGRA EXISTE (o racional importa mais que a regra):
 * um score que enxerga receita deixa de responder "o que o público quer ler
 * agora?" e passa a responder "o que rende mais por clique?". As duas perguntas
 * coincidem por algumas semanas e depois divergem para sempre: a home vira
 * vitrine de placa de vídeo, o leitor perde a confiança na curadoria e o ativo
 * que sustenta TODA a receita (a audiência) apodrece. A separação é o que
 * protege o negócio de si mesmo.
 *
 * COMO A REGRA É GARANTIDA NA PRÁTICA — três camadas, não só boa intenção:
 *   1. Direção das dependências: `scoring` importa `core`, mas o motor só
 *      consome `SignalDimension`/`WeightSet`. Nenhum tipo daqui aparece na
 *      assinatura de `calculateScore`.
 *   2. Teste de arquitetura: `packages/scoring/src/monetization-firewall.test.ts`
 *      varre o código-fonte do motor e FALHA o build se qualquer termo de
 *      monetização aparecer lá.
 *   3. Política de anúncio mora no app (`apps/web/src/lib/ads.ts`), que é um
 *      consumidor de `scoring` — e um pacote nunca importa quem o consome.
 *
 * `affiliateWeight` (em taxonomy.ts) continua existindo e continua servindo
 * SÓ para: (a) densidade/prioridade de bloco na UI e (b) priorização humana de
 * pauta evergreen. Nunca para o cálculo automático de score.
 */

/**
 * Tipo de divulgação obrigatória do vínculo comercial.
 *
 * Hoje só usamos 'affiliate' (afiliado orgânico: escolhemos o produto, ganhamos
 * comissão se o leitor comprar). 'sponsored' já está no vocabulário porque o
 * schema do banco não pode travar essa evolução — mas a LÓGICA de publieditorial
 * pago NÃO está implementada, de propósito: ela exige contrato, aprovação
 * editorial e um fluxo de revisão que ainda não existe.
 *
 * Modelar agora e implementar depois custa uma string; descobrir depois que a
 * coluna não comporta o caso custa migração de banco com dados em produção.
 */
export const DISCLOSURE_KINDS = ['affiliate', 'sponsored'] as const;

export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

/**
 * Converte string do banco em `DisclosureKind`.
 *
 * FALHA SEGURA (mesmo princípio de `toArticleStatus`): valor desconhecido cai
 * em 'affiliate', que é o disclosure MAIS restritivo dos dois em termos de
 * obrigação de aviso — ou seja, na dúvida a gente avisa o leitor. Cair para
 * "sem disclosure" seria o erro caro: publicidade não sinalizada é infração ao
 * CDC (art. 36) e ao Código do CONAR, além de política do Google.
 */
export function toDisclosureKind(value: unknown): DisclosureKind {
  return DISCLOSURE_KINDS.includes(value as DisclosureKind)
    ? (value as DisclosureKind)
    : 'affiliate';
}

/**
 * Textos do selo de disclosure.
 *
 * Ficam aqui, e não dentro do componente, por dois motivos:
 *  - o mesmo texto precisa aparecer no artigo, no bloco de oferta e (no futuro)
 *    na newsletter e no feed RSS;
 *  - texto de conformidade legal revisado por alguém de fora do time de front
 *    não pode estar espalhado por três JSX diferentes.
 *
 * REGRA DE REDAÇÃO DO AVISO (não é firula): precisa ser claro, em português
 * simples, e dizer as duas coisas que importam ao leitor — que ganhamos dinheiro
 * e que o preço para ele não muda.
 */
export const DISCLOSURE_TEXT: Record<DisclosureKind, { label: string; body: string }> = {
  affiliate: {
    label: 'Conteúdo com links de afiliado',
    body:
      'Este texto contém links de afiliado: se você comprar por eles, a Ortus Pixel pode receber uma comissão da loja, sem custo adicional para você. A escolha dos produtos é editorial e independente — nenhuma loja paga para aparecer aqui.',
  },
  sponsored: {
    label: 'Conteúdo patrocinado',
    body:
      'Este conteúdo foi patrocinado. O anunciante pagou pela publicação e participou da definição do tema.',
  },
};

/**
 * Disponibilidade da oferta na loja.
 * Lista fechada porque vira `schema.org/ItemAvailability` — string livre
 * quebraria o dado estruturado e o Search Console reportaria erro.
 */
export const OFFER_AVAILABILITY = ['in-stock', 'out-of-stock', 'unknown'] as const;
export type OfferAvailability = (typeof OFFER_AVAILABILITY)[number];

export function toOfferAvailability(value: unknown): OfferAvailability {
  return OFFER_AVAILABILITY.includes(value as OfferAvailability)
    ? (value as OfferAvailability)
    : 'unknown';
}

/** Mapeia para a URL canônica de schema.org usada no JSON-LD. */
export const SCHEMA_AVAILABILITY: Record<OfferAvailability, string | null> = {
  'in-stock': 'https://schema.org/InStock',
  'out-of-stock': 'https://schema.org/OutOfStock',
  // Sem informação NÃO vira "InStock" por conveniência: declarar disponibilidade
  // falsa em dado estruturado é motivo de ação manual do Google.
  unknown: null,
};

/**
 * VALIDADE DO PREÇO — a decisão mais importante deste arquivo.
 *
 * Preço de e-commerce muda várias vezes por dia. Um portal que exibe "R$ 2.899"
 * numa página cacheada por 1 hora vai, mais cedo ou mais tarde, exibir um preço
 * que não existe mais. As consequências não são cosméticas:
 *   - o leitor clica, vê outro valor e perde a confiança no site;
 *   - dado estruturado com preço errado é violação de política do Google
 *     (Merchant listings) e pode render ação manual;
 *   - no Brasil, anunciar preço que não se pratica é publicidade enganosa
 *     (CDC, art. 37) — mesmo sendo o preço de terceiro, quem exibe responde.
 *
 * A defesa adotada é FALHAR SEGURO: passado este prazo desde a última
 * atualização, a UI **para de exibir o número** e mostra apenas o botão "ver
 * preço na loja". Não é o cache que garante a corretude do preço — é esta
 * regra, que funciona mesmo se o cache falhar, se o job de atualização morrer
 * ou se o editor esquecer.
 *
 * 24h é o compromisso: curto o bastante para não exibir preço obsoleto, longo
 * o bastante para o editor não precisar reconferir tudo toda manhã.
 */
export const PRICE_FRESHNESS_HOURS = 24;

/**
 * Aviso ANTECIPADO para o editor no painel (não para o leitor).
 * Em 12h a oferta ainda exibe preço, mas já aparece marcada como "conferir" na
 * tela de afiliados — o editor consegue agir ANTES de o preço sumir do site.
 */
export const PRICE_WARNING_HOURS = 12;

export type PriceFreshness = 'fresh' | 'warning' | 'stale';

/**
 * Classifica a idade do preço.
 *
 * Recebe `now` por parâmetro (em vez de chamar `Date.now()` dentro) porque isso
 * mantém a função PURA e testável — mesmo princípio do motor de score.
 */
export function priceFreshness(
  priceUpdatedAt: Date | null,
  now: Date = new Date(),
): PriceFreshness {
  // Sem data de atualização, tratamos como obsoleto. Nunca como "fresco":
  // ausência de informação não é informação positiva.
  if (!priceUpdatedAt) return 'stale';

  const ageHours = (now.getTime() - priceUpdatedAt.getTime()) / 3_600_000;

  if (ageHours >= PRICE_FRESHNESS_HOURS) return 'stale';
  if (ageHours >= PRICE_WARNING_HOURS) return 'warning';
  return 'fresh';
}

/** Atalho de leitura para a UI pública: "posso mostrar o número?". */
export function canDisplayPrice(offer: Pick<AffiliateOffer, 'priceCents' | 'priceUpdatedAt'>, now?: Date): boolean {
  return offer.priceCents !== null && priceFreshness(offer.priceUpdatedAt, now) !== 'stale';
}

/**
 * Categoria do PROGRAMA de afiliados.
 *
 * Deliberadamente NÃO é o nome da rede (Amazon, Awin, Rakuten...). O dono do
 * site ainda não escolheu a rede, e amarrar o modelo a uma delas obrigaria a
 * remodelar o schema quando a decisão sair. A rede vive num campo de texto
 * livre (`network`), que na fase 2 passa a ser preenchido pelo integrador.
 *
 * O que categorizamos aqui é o TIPO de produto, porque é isso que a UI usa para
 * decidir onde e como o bloco aparece — e é estável independentemente da rede.
 */
export const AFFILIATE_PROGRAM_CATEGORIES = [
  'hardware',
  'periferico',
  'console',
  'jogo',
  'colecionavel',
  'streaming',
  'livro-hq',
  'outro',
] as const;

export type AffiliateProgramCategory = (typeof AFFILIATE_PROGRAM_CATEGORIES)[number];

export function toAffiliateProgramCategory(value: unknown): AffiliateProgramCategory {
  return AFFILIATE_PROGRAM_CATEGORIES.includes(value as AffiliateProgramCategory)
    ? (value as AffiliateProgramCategory)
    : 'outro';
}

export const AFFILIATE_PROGRAM_LABELS: Record<AffiliateProgramCategory, string> = {
  hardware: 'Hardware',
  periferico: 'Periférico',
  console: 'Console',
  jogo: 'Jogo',
  colecionavel: 'Colecionável',
  streaming: 'Assinatura / streaming',
  'livro-hq': 'Livro / HQ',
  outro: 'Outro',
};

/**
 * Oferta de afiliado — tipo de DOMÍNIO (nunca o tipo do Prisma).
 *
 * Preço em CENTAVOS, como inteiro. Nunca `float`:
 * 0.1 + 0.2 !== 0.3 em ponto flutuante binário, e dinheiro em float acumula
 * erro de arredondamento que aparece na hora errada. Inteiro em centavos é o
 * padrão da indústria para valores monetários.
 */
export interface AffiliateOffer {
  id: string;
  /** Nome do produto como aparece para o leitor. */
  productName: string;
  /** Loja/varejista — TEXTO LIVRE por enquanto (a rede ainda não foi escolhida). */
  retailerName: string;
  /** Marca/fabricante. Opcional; vira `schema.org/Brand` quando presente. */
  brand: string | null;
  priceCents: number | null;
  currency: string;
  /** URL final de afiliado. Validada e sanitizada na borda de renderização. */
  offerUrl: string;
  programCategory: AffiliateProgramCategory;
  /** Rede de afiliados (fase 2). Texto livre, nulo enquanto for cadastro manual. */
  network: string | null;
  imageUrl: string | null;
  availability: OfferAvailability;
  disclosureKind: DisclosureKind;
  /**
   * Quando o PREÇO foi atualizado pela última vez — não confundir com
   * `updatedAt` da linha (que muda quando o editor corrige uma vírgula no
   * título). São perguntas diferentes e por isso são colunas diferentes.
   */
  priceUpdatedAt: Date | null;
  isActive: boolean;
}

/** Formata centavos como moeda brasileira. */
export function formatPrice(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}
