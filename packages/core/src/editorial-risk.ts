/**
 * =============================================================================
 * VERIFICADOR DE RISCO EDITORIAL — o "bot" que lê a matéria antes de publicar
 * =============================================================================
 *
 * O PEDIDO, NAS PALAVRAS DE QUEM PEDIU: "nenhum texto ou matéria publicada no
 * site deve ferir nenhuma diretriz de respeito ou qualquer legalidade que possa
 * gerar processo para a empresa. Deve existir um bot que procure palavras-chave
 * e faça alerta para serem trocadas ou avise antes de qualquer publicação
 * potencialmente perigosa."
 *
 * -----------------------------------------------------------------------------
 * ISTO NÃO É `contentSensitivity`, E A CONFUSÃO SERIA CARA
 * -----------------------------------------------------------------------------
 * O projeto já tem `content-sensitivity.ts`, e as duas coisas se parecem o
 * bastante para alguém fundi-las um dia. Não podem ser fundidas:
 *
 *   contentSensitivity  — classifica o TEMA (nudez, violência real, tragédia).
 *                         É uma escolha DECLARADA pelo redator, sobre conteúdo
 *                         legítimo, e a consequência é COMERCIAL: corta anúncio
 *                         para proteger a conta do AdSense.
 *
 *   risco editorial     — procura DEFEITO no texto (xingamento, acusação sem
 *   (este módulo)         fonte, dado pessoal vazado). É uma suspeita LEVANTADA
 *                         pela máquina, sobre conteúdo que provavelmente não
 *                         deveria estar ali daquele jeito, e a consequência é
 *                         JURÍDICA E REPUTACIONAL.
 *
 * Uma matéria pode ser 'adult' e impecável; pode ser 'none' e caluniar alguém no
 * segundo parágrafo. São eixos independentes, com reações independentes.
 *
 * -----------------------------------------------------------------------------
 * O AVISO NUNCA BLOQUEIA. A DECISÃO CONTINUA SENDO HUMANA.
 * -----------------------------------------------------------------------------
 * Mesmo princípio que rege o painel inteiro desde o primeiro dia — "override
 * humano sempre deve poder vencer o algoritmo" (ver o cabeçalho de
 * `app/admin/page.tsx`). Vale ainda mais aqui, porque este verificador é uma
 * HEURÍSTICA e vai errar nos dois sentidos:
 *
 *   - falso positivo: "o protagonista é um ladrão" numa análise de jogo;
 *   - falso negativo: uma acusação escrita com outras palavras, que nenhuma
 *     lista de gatilhos prevê.
 *
 * Um verificador heurístico com poder de VETO seria um editor-chefe cego. O
 * desenho é outro: ele levanta a mão, mostra o trecho, explica o motivo, e quem
 * publica assume — com o reconhecimento gravado em `AuditLog`. Trocamos a trava
 * (que seria contornada por quem tem pressa) pela RASTREABILIDADE (que sobrevive
 * à pressa e responde, meses depois, "quem publicou sabendo?").
 *
 * -----------------------------------------------------------------------------
 * POR QUE REGRAS ESTÁTICAS, E NÃO UM MODELO DE LINGUAGEM
 * -----------------------------------------------------------------------------
 * Um LLM leria contexto muito melhor do que qualquer regex deste arquivo. Mesmo
 * assim, a primeira camada é explícita, e por três razões que ainda valem:
 *
 *   1. REGISTRO EXPLÍCITO É RASTREÁVEL. Dá para apontar a linha exata que
 *      sinalizou e discutir se ela deve continuar existindo. "O modelo achou
 *      que era ofensivo" não é auditável nem recorrível.
 *   2. CUSTO E LATÊNCIA ZERO. Roda dentro da requisição que já existe, sem
 *      chave de API, sem cota, sem cair quando o fornecedor cai — e sem mandar
 *      matéria embargada para servidor de terceiro.
 *   3. É TESTÁVEL. Cada regra tem caso de teste; um modelo probabilístico
 *      exigiria conjunto de avaliação para não regredir em silêncio.
 *
 * A camada de IA é um passo seguinte natural (revisar o que ESTE módulo marcou,
 * ou o que ele deixou passar) — e este módulo já entrega o formato de saída que
 * ela usaria: `EditorialRiskFinding`.
 */

import {
  ACCUSATION_RULES,
  ALL_RISK_RULES,
  ATTRIBUTION_MARKERS,
  FICTION_MARKERS,
  type RiskRule,
} from './editorial-risk-terms';

// =============================================================================
// VOCABULÁRIO
// =============================================================================

export const EDITORIAL_RISK_CATEGORIES = [
  'discriminacao',
  'termo-inadequado',
  'acusacao',
  'ofensa-pessoal',
  'dado-pessoal',
] as const;

export type EditorialRiskCategory = (typeof EDITORIAL_RISK_CATEGORIES)[number];

/**
 * Dois níveis, não cinco.
 *
 * 'alto'    — pode gerar processo ou é ofensa inequívoca. Publicar assim exige
 *             justificativa escrita (ver `requiresJustification`).
 * 'atencao' — provavelmente é falso positivo, ou é escolha de vocabulário.
 *             Avisa e sai da frente.
 *
 * Uma terceira faixa no meio só faria alguém ter de decidir se um caso é "médio"
 * ou "alto" — pergunta que não muda nada na tela nem na exigência.
 */
export type EditorialRiskSeverity = 'alto' | 'atencao';

/** Onde o trecho foi encontrado. Corresponde aos campos do formulário. */
export type EditorialRiskField = 'titulo' | 'resumo' | 'corpo';

export interface EditorialRiskFinding {
  category: EditorialRiskCategory;
  severity: EditorialRiskSeverity;
  field: EditorialRiskField;
  /** O trecho exato que disparou a regra, como está escrito no texto. */
  match: string;
  /**
   * Contexto à esquerda e à direita, já recortado e com as quebras de linha
   * achatadas.
   *
   * São TRÊS campos (`before`/`match`/`after`) em vez de um trecho com índices
   * porque quem renderiza precisa destacar o meio: com índices, a tela teria de
   * fatiar a string de novo — e qualquer divergência de contagem (emoji, acento
   * composto) destacaria o pedaço errado. Assim o destaque é impossível de
   * errar, e nenhum HTML precisa ser montado à mão.
   */
  before: string;
  after: string;
  /** Por que foi sinalizado, em português, pronto para a tela. */
  reason: string;
  /** Troca sugerida, quando existe uma consagrada. */
  suggestion: string | null;
}

export const EDITORIAL_RISK_CATEGORY_LABELS: Record<EditorialRiskCategory, string> = {
  discriminacao: 'Termo discriminatório',
  'termo-inadequado': 'Termo inadequado ou desatualizado',
  acusacao: 'Acusação grave sem fonte',
  'ofensa-pessoal': 'Xingamento ou ofensa a pessoa',
  'dado-pessoal': 'Dado pessoal no texto',
};

export const EDITORIAL_RISK_FIELD_LABELS: Record<EditorialRiskField, string> = {
  titulo: 'Título',
  resumo: 'Resumo',
  corpo: 'Corpo da matéria',
};

/**
 * A frase que a tela mostra junto do resultado — em UM lugar só.
 *
 * Ela não é disclaimer decorativo: é o que impede o efeito colateral mais
 * provável desta funcionalidade, que é a redação passar a achar que "o robô
 * aprovou" significa "está juridicamente seguro". Não significa, e a tela
 * precisa dizer isso toda vez.
 */
export const EDITORIAL_RISK_DISCLAIMER =
  'Esta checagem é automática e por palavras-chave: ela erra para os dois lados. ' +
  'Não sinalizar nada NÃO garante que o texto esteja seguro, e sinalizar não significa que esteja errado. ' +
  'A leitura final é sempre humana.';

// =============================================================================
// COMPILAÇÃO DAS REGRAS
// =============================================================================

/**
 * Envelopa o padrão em fronteiras de palavra que entendem português.
 *
 * `\b` é ASCII: entre "l" e "ó" ele enxerga fronteira, e `\bmongol\b` casaria
 * dentro de "Mongólia" — um falso positivo constrangedor e difícil de descobrir.
 * As asserções `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` usam a classe Unicode de
 * letra e número, que é a definição que queremos de verdade.
 *
 * Flags: `g` (todas as ocorrências), `i` (maiúscula/minúscula) e `u` (exigida
 * pelas classes `\p{...}`).
 */
function compileRule(rule: RiskRule): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${rule.pattern.source})(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Compiladas UMA vez, na carga do módulo.
 *
 * São poucas dezenas de expressões e elas nunca mudam em tempo de execução;
 * recompilar a cada salvamento seria trabalho repetido sem nenhum ganho. Note
 * que as instâncias são compartilhadas entre requisições — o que é seguro aqui
 * porque a varredura usa `matchAll`, que trabalha sobre uma cópia interna e não
 * carrega `lastIndex` de uma chamada para a outra (um `re.exec` em laço, sim,
 * carregaria — e é exatamente o bug que este comentário existe para evitar).
 */
const COMPILED_RULES: { rule: RiskRule; regex: RegExp }[] = ALL_RISK_RULES.map((rule) => ({
  rule,
  regex: compileRule(rule),
}));

const ACCUSATION_RULE_SET = new Set<RiskRule>(ACCUSATION_RULES);

// =============================================================================
// PARÂMETROS DA VARREDURA
// =============================================================================

/** Caracteres de contexto mostrados de cada lado do trecho sinalizado. */
const CONTEXT_RADIUS = 100;

/**
 * Folga para TRÁS na busca por atribuição, além da frase do gatilho.
 *
 * "A denúncia foi protocolada ontem. A empresa fraudou os números." — a fonte
 * está na oração anterior, e é assim que se escreve português. Olhar só a frase
 * do gatilho sinalizaria um texto corretamente atribuído.
 */
const ATTRIBUTION_LOOKBACK = 200;

/**
 * Teto de achados devolvidos.
 *
 * Não é economia de memória: é usabilidade. Um painel com 200 avisos não é lido,
 * é fechado — e um `AuditLog` com 200 objetos por publicação deixa de ser trilha
 * e vira lixo. Se o texto tem mais que isto, o problema não é de detalhe.
 */
const MAX_FINDINGS = 25;

// =============================================================================
// A VARREDURA
// =============================================================================

export interface ArticleTextForRisk {
  title: string;
  excerpt: string;
  /**
   * Corpo em texto puro. Com o editor de blocos, é a projeção que o servidor já
   * monta (`blocksToPlainText`) — de modo que legenda de imagem e citação entram
   * na varredura sem este módulo precisar conhecer blocos.
   */
  content: string;
}

/**
 * Lê a matéria inteira e devolve o que merece um segundo olhar.
 *
 * Função PURA: sem banco, sem rede, sem `Date`. É o que permite testá-la com
 * `node --test` e chamá-la tanto na criação quanto na edição sem nenhum arranjo.
 */
export function scanArticleForRisk(article: ArticleTextForRisk): EditorialRiskFinding[] {
  const fields: { field: EditorialRiskField; text: string }[] = [
    { field: 'titulo', text: article.title },
    { field: 'resumo', text: article.excerpt },
    { field: 'corpo', text: article.content },
  ];

  const findings: EditorialRiskFinding[] = [];
  /**
   * Deduplicação por (campo, categoria, termo).
   *
   * Uma matéria sobre um processo de assédio repete "assediou" oito vezes. Sem
   * isto, o painel mostraria o mesmo aviso oito vezes e o redator teria de rolar
   * a tela para descobrir que é tudo a mesma coisa. Uma ocorrência de cada é o
   * que ele precisa para decidir.
   */
  const seen = new Set<string>();

  for (const { field, text } of fields) {
    if (!text) continue;

    for (const { rule, regex } of COMPILED_RULES) {
      for (const match of text.matchAll(regex)) {
        const index = match.index ?? 0;
        const matched = match[0];

        const severity = resolveSeverity(rule, text, index);
        // `null` = a regra olhou o contexto e concluiu que não há o que avisar
        // (o caso mais comum: a acusação está devidamente atribuída).
        if (severity === null) continue;

        const key = `${field}|${rule.category}|${matched.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          category: rule.category,
          severity,
          field,
          match: matched,
          before: context(text, Math.max(0, index - CONTEXT_RADIUS), index, 'esquerda'),
          after: context(
            text,
            index + matched.length,
            Math.min(text.length, index + matched.length + CONTEXT_RADIUS),
            'direita',
          ),
          reason: severity === 'atencao' && rule.needsAttribution
            ? `${rule.reason} (Rebaixado para atenção: o trecho parece estar entre aspas ou falar de ficção — confira.)`
            : rule.reason,
          suggestion: rule.suggestion ?? null,
        });

        if (findings.length >= MAX_FINDINGS) return sortFindings(findings);
      }
    }
  }

  return sortFindings(findings);
}

/**
 * Decide a gravidade DESTA ocorrência — ou `null` para descartá-la.
 *
 * Só as regras de acusação olham o contexto; as demais valem pelo termo. Aqui
 * mora toda a esperteza (e toda a limitação) do verificador.
 */
function resolveSeverity(
  rule: RiskRule,
  text: string,
  index: number,
): EditorialRiskSeverity | null {
  if (!rule.needsAttribution) return rule.severity;

  const sentence = sentenceAround(text, index);

  /**
   * PERGUNTA NÃO É AFIRMAÇÃO. "A editora fraudou os números?" é uma pergunta
   * retórica de título, não uma imputação — e sinalizá-la treinaria a redação a
   * ignorar avisos de acusação, que são justamente os que importam.
   *
   * (Que a pergunta retórica também tem risco jurídico é verdade; mas é risco de
   * outra natureza, que uma lista de palavras não sabe medir.)
   */
  if (sentence.text.trimEnd().endsWith('?')) return null;

  const window = text.slice(Math.max(0, sentence.start - ATTRIBUTION_LOOKBACK), sentence.end);
  if (ATTRIBUTION_MARKERS.test(window)) return null;

  /**
   * Aspas e ficção REBAIXAM, não suprimem.
   *
   * Aspas: reproduzir a ofensa de terceiro não é isenção automática no direito
   * brasileiro — o veículo responde pelo que escolhe publicar. Então o aviso
   * continua; muda o tom.
   *
   * Ficção: "o protagonista é um ladrão" é o caso mais provável de falso
   * positivo neste portal. Mas a mesma matéria pode falar do enredo num
   * parágrafo e do processo real contra o estúdio no seguinte.
   */
  if (isInsideQuotes(text, index) || FICTION_MARKERS.test(sentence.text)) {
    return 'atencao';
  }

  return rule.severity;
}

/**
 * Limites da frase que contém a posição dada.
 *
 * Corte ingênuo por pontuação — "Sr.", "etc." e "3.5" cortam frase onde não há.
 * Isso é aceitável porque a única consequência de uma frase curta demais é a
 * janela de atribuição ficar menor, e o `ATTRIBUTION_LOOKBACK` já compensa. Um
 * segmentador de sentenças de verdade seria uma dependência inteira para
 * resolver um problema que não temos.
 */
function sentenceAround(text: string, index: number): { text: string; start: number; end: number } {
  const BOUNDARY = /[.!?…\n]/;

  let start = index;
  while (start > 0 && !BOUNDARY.test(text[start - 1] ?? '')) start -= 1;

  let end = index;
  while (end < text.length && !BOUNDARY.test(text[end] ?? '')) end += 1;
  // Inclui o próprio sinal de pontuação: é ele que responde "isto era pergunta?".
  if (end < text.length) end += 1;

  return { text: text.slice(start, end), start, end };
}

/**
 * A posição está dentro de uma citação?
 *
 * Contagem de aspas, e não casamento de pares: aspas retas não têm lado, então
 * "ímpar = está dentro" é a única leitura possível. Para as tipográficas, o
 * saldo entre abertas e fechadas responde. Apóstrofo (') fica de fora de
 * propósito — em português ele é elisão ("d'água"), não citação.
 */
function isInsideQuotes(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const straight = (before.match(/"/g) ?? []).length % 2 === 1;
  const opened = (before.match(/[“«]/g) ?? []).length;
  const closed = (before.match(/[”»]/g) ?? []).length;
  return straight || opened > closed;
}

/**
 * Recorta o contexto e achata as quebras de linha.
 *
 * O "…" só entra quando o recorte de fato cortou alguma coisa: um reticências
 * mentiroso no começo do título faria o redator procurar um texto que não existe.
 */
function context(text: string, from: number, to: number, side: 'esquerda' | 'direita'): string {
  const slice = text.slice(from, to).replace(/\s+/g, ' ');
  if (side === 'esquerda') return (from > 0 ? '…' : '') + slice;
  return slice + (to < text.length ? '…' : '');
}

/**
 * Ordem de exibição: o que pode virar processo primeiro; dentro do mesmo nível,
 * a ordem em que a pessoa lê o formulário (título, resumo, corpo).
 */
function sortFindings(findings: EditorialRiskFinding[]): EditorialRiskFinding[] {
  const fieldOrder: Record<EditorialRiskField, number> = { titulo: 0, resumo: 1, corpo: 2 };
  return [...findings].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'alto' ? -1 : 1;
    return fieldOrder[a.field] - fieldOrder[b.field];
  });
}

// =============================================================================
// PERGUNTAS QUE AS ROTAS E A TELA FAZEM AO RESULTADO
// =============================================================================

export function hasHighRisk(findings: EditorialRiskFinding[]): boolean {
  return findings.some((f) => f.severity === 'alto');
}

/**
 * Publicar assim exige justificativa escrita?
 *
 * Sim para 'alto'; não para 'atencao'. A assimetria é deliberada e tem o mesmo
 * espírito da escada de sensibilidade ("só sobe sozinha"): a fricção vai para
 * onde está o risco, e não para todo lugar.
 *
 * Exigir um texto a cada aviso — inclusive nos muitos que serão falso positivo —
 * ensinaria a redação a digitar "ok" às 23h. Um campo obrigatório que todo mundo
 * preenche com "ok" é pior do que não ter campo: ele dá a ilusão de trilha de
 * auditoria sem nenhuma informação dentro.
 */
export function requiresJustification(findings: EditorialRiskFinding[]): boolean {
  return hasHighRisk(findings);
}

/** Mesmos limites da justificativa de override de score — um padrão só no painel. */
export const RISK_JUSTIFICATION_MIN = 5;
export const RISK_JUSTIFICATION_MAX = 200;

/**
 * Resumo de uma linha, para a mensagem da API e para o assunto do registro.
 * Exemplo: "2 trechos de alto risco (acusação grave sem fonte, dado pessoal no
 * texto) e 1 ponto de atenção".
 */
export function summarizeRisk(findings: EditorialRiskFinding[]): string {
  if (findings.length === 0) return 'Nenhum trecho sinalizado.';

  const high = findings.filter((f) => f.severity === 'alto');
  const low = findings.length - high.length;

  const parts: string[] = [];
  if (high.length > 0) {
    const categories = [...new Set(high.map((f) => EDITORIAL_RISK_CATEGORY_LABELS[f.category]))];
    parts.push(
      `${high.length} ${high.length === 1 ? 'trecho' : 'trechos'} de alto risco (${categories
        .join(', ')
        .toLowerCase()})`,
    );
  }
  if (low > 0) {
    parts.push(`${low} ${low === 1 ? 'ponto' : 'pontos'} de atenção`);
  }

  return parts.join(' e ');
}

/**
 * Versão enxuta para gravar em `AuditLog`.
 *
 * De propósito SEM o contexto (`before`/`after`): a trilha precisa registrar o
 * que foi sinalizado e reconhecido, não guardar uma segunda cópia da matéria
 * dentro de uma coluna `Json`. O texto integral daquele momento continua
 * recuperável pelo próprio artigo e pelo histórico.
 */
export function toAuditFindings(
  findings: EditorialRiskFinding[],
): { categoria: string; gravidade: string; campo: string; trecho: string }[] {
  return findings.map((f) => ({
    categoria: f.category,
    gravidade: f.severity,
    campo: f.field,
    trecho: f.match,
  }));
}
