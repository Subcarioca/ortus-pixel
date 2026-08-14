/**
 * =============================================================================
 * EVENTOS DE AUDIÊNCIA — vocabulário único do que medimos
 * =============================================================================
 *
 * Este arquivo é lido por TRÊS lados que nunca se encontram: o rastreador que
 * roda no navegador do leitor, a rota que grava no banco e a tela do painel que
 * agrega. Um vocabulário copiado nos três seria o bug mais chato possível de
 * achar — o navegador manda `'affiliateClick'`, a rota grava sem reclamar
 * (é uma string), e a tela filtra por `'affiliate.click'` e mostra zero. Nada
 * quebra, nenhum log aparece, e a conclusão de quem olha é "ninguém clica em
 * afiliado".
 *
 * -----------------------------------------------------------------------------
 * POR QUE MEDIR POR CONTA PRÓPRIA SE EXISTE GA4
 * -----------------------------------------------------------------------------
 * Pelo mesmo motivo que o `PipelineEvent` existe: o GA4 responde perguntas de
 * MARKETING ("de onde vem o tráfego"), e estas são perguntas EDITORIAIS ("esta
 * matéria puxa leitura para outras?"). Levar essa resposta para dentro do painel
 * — ao lado da matéria, com a mesma regra de "só o que é meu" — é a diferença
 * entre um dado que o redator usa toda semana e um relatório que ele nunca abre
 * porque está noutra ferramenta, com outro login.
 *
 * -----------------------------------------------------------------------------
 * O QUE CADA EVENTO CUSTA, E O QUE CADA UM RESPONDE
 * -----------------------------------------------------------------------------
 * Nenhum evento entra nesta lista sem uma pergunta editorial que só ele responde.
 * Medir "tudo o que der" é como o volume de dados fica inútil: mil colunas e
 * nenhuma decisão.
 */

export const ANALYTICS_EVENT_KINDS = [
  /**
   * Uma pessoa abriu a matéria. Responde "o que é lido".
   *
   * ⚠ É contagem de EVENTOS, não de gente: sem identificador de visitante (ver
   * o comentário do model `AnalyticsEvent` no schema), recarregar a página conta
   * de novo. O rastreador reduz isso no cliente (uma vez por matéria por aba),
   * mas o número correto de se dizer em voz alta é "visualizações", nunca
   * "visitantes".
   */
  'article.view',

  /**
   * Clique num link interno que leva a OUTRA matéria — do corpo, do bloco
   * "Leia também" ou das relacionadas. Responde "esta matéria segura o leitor no
   * site?", que é a única métrica que justifica o custo editorial de escrever
   * caixas de "Leia também" à mão.
   */
  'article.link',

  /**
   * Clique num slot de anúncio. Responde "esta posição vale o incômodo que
   * causa?".
   *
   * ⚠ MEDIÇÃO APROXIMADA POR CONSTRUÇÃO, e isto precisa estar escrito onde o
   * número é definido, não numa nota de rodapé: o anúncio vive dentro de um
   * `<iframe>` de outro domínio, e a política de mesma origem do navegador nos
   * impede — corretamente — de enxergar cliques lá dentro. O que conseguimos
   * observar é o clique que chega ao NOSSO contêiner. A receita de verdade
   * continua sendo a do relatório do AdSense; este número serve para COMPARAR
   * posições entre si ('artigo-meio' × 'artigo-fim'), nunca para conferir
   * pagamento.
   */
  'ad.click',

  /**
   * Clique num link de oferta de afiliado. Responde "o bloco de ofertas
   * converte?" — e, principalmente, permite descobrir que ele NÃO converte em
   * certos formatos antes de a monetização virar argumento para colocá-lo em
   * todo lugar.
   */
  'affiliate.click',
] as const;

export type AnalyticsEventKind = (typeof ANALYTICS_EVENT_KINDS)[number];

export function isAnalyticsEventKind(value: unknown): value is AnalyticsEventKind {
  return (ANALYTICS_EVENT_KINDS as readonly unknown[]).includes(value);
}

/** Rótulos das colunas da tela do painel. */
export const ANALYTICS_EVENT_LABELS: Record<AnalyticsEventKind, string> = {
  'article.view': 'Visualizações',
  'article.link': 'Cliques para outras matérias',
  'ad.click': 'Cliques em anúncio',
  'affiliate.click': 'Cliques em afiliado',
};

/**
 * Janela padrão das consultas do painel, em dias.
 *
 * NÃO É UM NÚMERO DE ENFEITE — é o que mantém a tela viável enquanto a tabela
 * cresce. Toda consulta de analytics filtra por `createdAt >= agora - janela`,
 * e é esse filtro que faz o índice `[articleId, kind, createdAt]` ser usado em
 * vez de uma varredura completa. Uma tela "desde sempre" ficaria mais lenta a
 * cada semana, sem nenhuma mudança de código, até o dia em que estourasse.
 */
export const ANALYTICS_WINDOW_DAYS = 30;

/**
 * Atributo de dado usado pelo rastreador no HTML.
 *
 * Fica aqui, e não escrito à mão em cada componente, porque o rastreador (um
 * arquivo) e os componentes que marcam os elementos (vários) precisam concordar
 * na string exata. Um `data-analytics="afiliado"` num canto e um seletor
 * `[data-analytics="affiliate"]` no outro produzem silêncio, não erro.
 */
export const ANALYTICS_ATTR = {
  /** Marca a âncora de uma oferta de afiliado. O valor é o id da oferta. */
  offerId: 'data-analytics-offer',
  /** Marca o contêiner de um slot de anúncio. O valor é o id do slot. */
  adSlot: 'data-analytics-ad',
} as const;
