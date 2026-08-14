/**
 * =============================================================================
 * SENSIBILIDADE DO CONTEÚDO — o vocabulário e as consequências de cada nível
 * =============================================================================
 *
 * O PROBLEMA QUE ISTO RESOLVE: um portal de cultura pop publica, com alguma
 * regularidade, matéria que não combina com anúncio automático — a morte de um
 * ator, um caso de assédio na indústria, um jogo adulto, arte com nudez. Sem uma
 * marca no dado, a única defesa é alguém lembrar; e "alguém lembrar" falha
 * exatamente no dia de maior tráfego, que é quando o estrago é maior.
 *
 * -----------------------------------------------------------------------------
 * POR QUE TRÊS NÍVEIS, E NÃO UM `isAdult: boolean`
 * -----------------------------------------------------------------------------
 * Porque as duas situações pedem reações diferentes, e um booleano obrigaria a
 * escolher a resposta errada para metade dos casos:
 *
 *   none      — o normal. Nada muda.
 *
 *   sensitive — tema pesado tratado jornalisticamente. O risco aqui é de
 *               CONTEXTO: um banner de brinquedo ao lado da notícia da morte de
 *               alguém não viola política nenhuma, e ainda assim é a coisa mais
 *               constrangedora que o site pode fazer. A resposta proporcional é
 *               reduzir a densidade comercial e avisar o leitor — não sumir com
 *               a matéria do circuito.
 *
 *   adult     — conteúdo adulto. Aqui não é bom gosto, é regra: veicular
 *               AdSense em página adulta viola a política do programa, e a
 *               punição não recai sobre a página — recai sobre a CONTA, com
 *               todo o histórico de receita junto. Por isso este nível não
 *               "reduz" nada: ele CORTA toda superfície monetizada.
 *
 * -----------------------------------------------------------------------------
 * A ESCADA SÓ SOBE SOZINHA (ver `canLowerSensitivity`, em staff.ts)
 * -----------------------------------------------------------------------------
 * Qualquer pessoa da redação pode marcar uma matéria como MAIS sensível; só
 * administrador pode marcar como MENOS. A assimetria é o desenho, não uma
 * desconfiança do redator: marcar demais custa alguns centavos de receita e é
 * corrigível a qualquer momento; marcar de menos custa a conta do AdSense e não
 * é corrigível depois de o robô do Google ter visto a página.
 *
 * O `rank` numérico abaixo existe SÓ para essa comparação. É por isso que ele é
 * derivado da ordem da lista, e não digitado à mão: acrescentar um nível no meio
 * da escada não pode exigir que alguém lembre de renumerar o resto.
 */

/** Níveis, do menos para o MAIS restritivo. A ordem É a semântica. */
export const CONTENT_SENSITIVITY_LEVELS = ['none', 'sensitive', 'adult'] as const;

export type ContentSensitivity = (typeof CONTENT_SENSITIVITY_LEVELS)[number];

/**
 * Converte o que veio do banco (ou do formulário) num nível válido.
 *
 * Valor desconhecido cai em 'none'. É a MESMA direção de falha segura de
 * `toArticleStatus` (que cai em 'draft') e `toAccessLevel` (que cai em
 * 'redator')? Não — e a diferença merece ser dita, porque parece incoerência.
 *
 * Ali, o padrão seguro é o mais restritivo. Aqui, o padrão seguro é o menos:
 * uma string estranha na coluna significa quase sempre "ninguém classificou
 * ainda" (é o estado de TODO o acervo anterior a este campo), e assumir 'adult'
 * para o acervo inteiro tiraria o site inteiro do ar comercialmente por causa de
 * um dado ausente. O risco real — publicar conteúdo adulto sem marcar — não é
 * mitigado por este `??`: ele é mitigado no formulário, onde a classificação é
 * uma escolha explícita de quem publica.
 */
export function toContentSensitivity(value: unknown): ContentSensitivity {
  return (CONTENT_SENSITIVITY_LEVELS as readonly unknown[]).includes(value)
    ? (value as ContentSensitivity)
    : 'none';
}

export function isContentSensitivity(value: unknown): value is ContentSensitivity {
  return (CONTENT_SENSITIVITY_LEVELS as readonly unknown[]).includes(value);
}

/**
 * Posição na escada. Maior = mais restritivo.
 *
 * Derivado do índice na lista, e não uma tabela paralela de números: duas
 * fontes para a mesma ordem é uma delas ficar para trás.
 */
export function sensitivityRank(level: ContentSensitivity): number {
  return CONTENT_SENSITIVITY_LEVELS.indexOf(level);
}

/** Rótulos do painel. */
export const CONTENT_SENSITIVITY_LABELS: Record<ContentSensitivity, string> = {
  none: 'Conteúdo comum',
  sensitive: 'Tema sensível (violência real, tragédia, saúde mental)',
  adult: 'Conteúdo adulto (fora de qualquer anúncio automático)',
};

/**
 * Explicação da CONSEQUÊNCIA de cada nível, para aparecer ao lado do campo.
 *
 * Um `<select>` com três palavras faz o redator escolher no chute. O que ele
 * precisa saber para escolher certo não é o nome do nível — é o que acontece
 * com a matéria depois.
 */
export const CONTENT_SENSITIVITY_HINTS: Record<ContentSensitivity, string> = {
  none: 'Anúncios e ofertas seguem a política normal do formato.',
  sensitive:
    'Reduz a publicidade na página (nenhum anúncio no meio do texto) e desliga o bloco de ofertas. A matéria continua no ar normalmente.',
  adult:
    'Remove TODA publicidade automática e todo link comercial da página. Use quando o conteúdo não puder ser exibido ao lado de anúncio — a política do AdSense pune a conta inteira, não só a página.',
};

/**
 * Esta matéria pode exibir publicidade automática (AdSense)?
 *
 * Função de UMA linha que existe para não haver duas leituras da mesma regra: a
 * política comercial (`lib/ads.ts`) e qualquer superfície futura (newsletter,
 * push, feed patrocinado) perguntam AQUI, e não reimplementam a comparação.
 */
export function allowsAutomaticAds(level: ContentSensitivity): boolean {
  return level !== 'adult';
}

/**
 * Esta matéria pode exibir link comercial (afiliado)?
 *
 * Mais restritivo que a regra de anúncio, e de propósito: anúncio é de terceiro
 * e o leitor sabe disso; link de afiliado é NOSSO e sugere recomendação
 * editorial. Recomendar uma compra dentro de uma matéria sobre tragédia é pior
 * do que exibir um banner ao lado dela.
 */
export function allowsAffiliateLinks(level: ContentSensitivity): boolean {
  return level === 'none';
}

/**
 * O leitor precisa de um aviso antes do conteúdo?
 *
 * Devolve o TEXTO do aviso (ou `null`), e não um booleano, porque quem chama
 * não deve ter de saber qual frase corresponde a qual nível — essa decisão é de
 * produto e mora aqui.
 *
 * ⚠ O TRATAMENTO VISUAL DESTE AVISO (interstitial que cobre o conteúdo? faixa
 * acima do texto? borrado com "mostrar mesmo assim", como já existe para
 * spoiler?) é decisão de DESIGN e não está definida aqui de propósito. O que
 * este módulo garante é que a informação exista e chegue à página.
 */
export function sensitivityNotice(level: ContentSensitivity): string | null {
  switch (level) {
    case 'adult':
      return 'Esta matéria contém conteúdo adulto.';
    case 'sensitive':
      return 'Esta matéria trata de um tema sensível e pode causar desconforto.';
    case 'none':
      return null;
  }
}
