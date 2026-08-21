/**
 * =============================================================================
 * BOT DE TRIAGEM DE COMENTÁRIO DENUNCIADO
 * =============================================================================
 *
 * O QUE ELE É: uma função PURA que recebe o texto de um comentário e responde
 * "isto é ataque?". Nada de banco, nada de rede, nada de estado — o que entra é
 * uma string, o que sai é um veredito. É essa pureza que permite testá-lo com o
 * runner do Node em milissegundos e chamá-lo de dentro de uma rota sem
 * transformar uma denúncia numa chamada de API paga.
 *
 * O QUE ELE NÃO É: um moderador. Ele não lê contexto, não entende ironia e não
 * sabe quem está falando com quem. Ele reconhece PALAVRAS de uma lista. Todo o
 * desenho abaixo parte de aceitar essa limitação em vez de fingir que ela não
 * existe.
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO MAIS IMPORTANTE DO ARQUIVO: TRÊS NÍVEIS, E SÓ DOIS EXCLUEM
 * -----------------------------------------------------------------------------
 * O produto pedido é "denúncia → se o bot confirma que é ofensivo, o comentário
 * é excluído automaticamente, sem humano no meio". Uma remoção automática é uma
 * decisão IRREVERSÍVEL na prática (ninguém volta para conferir), então a
 * pergunta que desenha a lista não é "esta palavra é feia?" e sim "eu aceito
 * remover, sem revisão, todo comentário que contenha esta palavra?".
 *
 * Com um nível só, a resposta seria não para metade da lista. Com três, cada
 * palavra vai para o lugar certo:
 *
 *   'hate'      — discurso de ódio: ataque à pessoa por raça, orientação,
 *                 identidade, deficiência ou origem, e incitação a se matar.
 *                 REMOVE. Não existe uso legítimo disso na área de comentários
 *                 de um portal de cultura pop, e o custo de deixar no ar é
 *                 desproporcional ao de remover errado.
 *
 *   'insult'    — xingamento DIRECIONADO ("idiota", "vai se foder", "fdp").
 *                 REMOVE. É exatamente o que o dono do site descreveu como
 *                 "xingamento", e a lista abaixo só aceita termos cujo uso
 *                 não-ofensivo é improvável.
 *
 *   'profanity' — palavrão de ÊNFASE ("porra, que trailer bom", "que merda de
 *                 final"). NÃO remove. Vira sinal para a fila humana e nada
 *                 mais. Remover isto automaticamente apagaria metade da conversa
 *                 legítima de um fandom — e, pior, entregaria a qualquer leitor
 *                 um botão para derrubar o comentário alheio: bastaria denunciar
 *                 quem escreveu "que porra é essa?".
 *
 * -----------------------------------------------------------------------------
 * O CRITÉRIO DE ENTRADA NA LISTA QUE REMOVE
 * -----------------------------------------------------------------------------
 * Um termo só entra em 'hate' ou 'insult' se ele NÃO tiver uso literal comum. É
 * por isso que ficaram de fora, apesar de serem xingamentos frequentes:
 *
 *   "burro", "anta", "jumento", "cavalo"  — são animais, e o site fala de
 *                                           filme, jogo e quadrinho o tempo todo.
 *   "palhaço"                             — o Coringa é palhaço. Literalmente.
 *   "lixo"                                — "esse jogo é lixo" é crítica de
 *                                           produto, não ofensa a pessoa.
 *   "veado"                               — o animal existe; a grafia "viado",
 *                                           que é a usada como slur, está na
 *                                           lista.
 *   "monstro", "aberração"                — vocabulário nativo de terror e de
 *                                           quadrinho.
 *   "corno"                               — descreve situação de trama ("o
 *                                           corno do Otelo") tanto quanto xinga.
 *
 * A EXCEÇÃO CONSCIENTE A ESSE CRITÉRIO são alguns termos de 'hate' que TÊM uso
 * não-ofensivo real — a reapropriação de "viado" e "bicha" dentro da própria
 * comunidade LGBT+ é o exemplo. Eles ficaram mesmo assim, e o motivo é a
 * assimetria: numa seção de comentários de portal aberto, o uso
 * esmagadoramente majoritário é ataque, e deixar um ataque no ar custa mais do
 * que remover uma fala afetuosa que o autor pode reescrever (o comentário
 * continua no banco e a moderação consegue restaurá-lo).
 *
 * Nenhum deles some do radar: um comentário com "burro" continua sendo
 * denunciável, e a denúncia continua chegando ao painel. O que ele não sofre é
 * remoção automática.
 *
 * -----------------------------------------------------------------------------
 * LIMITAÇÕES CONHECIDAS E ACEITAS (a lista é PONTO DE PARTIDA, não muralha)
 * -----------------------------------------------------------------------------
 *  1. OFUSCAÇÃO POR SEPARADOR — "i.d.i.o.t.a", "i d i o t a" passam. Tratar isso
 *     exigiria remover pontuação DENTRO das palavras, o que quebraria a
 *     fronteira de palavra e faria "socorro. Ana chegou" virar candidato a
 *     qualquer coisa. O ganho não paga o falso positivo.
 *  2. CRIATIVIDADE — grafia nova, gíria regional, ofensa por perífrase
 *     ("aquilo que sua mãe faz por dinheiro"). Nenhuma denylist pega isso.
 *  3. CONTEXTO — citação, autodepreciação e ironia são removidas junto. O
 *     comentário rejeitado NÃO é apagado do banco (ver o schema de `Comment`),
 *     então a moderação consegue reverter uma remoção contestada.
 *
 * O caminho de crescimento é acrescentar termo a esta lista com um teste junto —
 * e é justamente por isso que ela vive no `core`, versionada, e não numa tabela
 * de banco editável sem revisão.
 */

// =============================================================================
// NORMALIZAÇÃO
// =============================================================================

/**
 * Deixa o texto comparável: sem acento, sem caixa, sem pontuação, sem leet.
 *
 * As três primeiras etapas são as MESMAS de `normalizeTitle` na deduplicação de
 * tópicos (services/curator/src/pipeline/dedupe.ts) — e não é coincidência: é
 * literalmente o mesmo problema, "duas grafias da mesma coisa precisam colapsar
 * no mesmo texto". A cópia é deliberada e não uma importação porque `core` não
 * pode depender do `curator` (a seta aponta ao contrário), e mover a função para
 * cá arrastaria o vocabulário de deduplicação junto.
 *
 * A quarta etapa é específica daqui: o mapa de LEET. "1d10t4" e "c4ralho" são
 * a forma mais barata de escapar de uma denylist, e desfazê-los custa um
 * `replace`. O mapa é curto de propósito — cada substituição a mais é uma chance
 * a mais de transformar uma palavra inocente noutra.
 */
export function normalizeForModeration(text: string): string {
  return (
    text
      .normalize('NFD')
      // O NFD separa a letra do diacrítico; aqui some o diacrítico.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      // Leet básico. Feito ANTES de descartar a pontuação porque '@' e '$' são
      // pontuação para a regex seguinte e sumiriam antes de virar letra.
      .replace(/[@4]/g, 'a')
      .replace(/[$5]/g, 's')
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/7/g, 't')
      // Tudo que não é letra ou número vira espaço — inclusive o que separava
      // "vai-se-foder". A fronteira de palavra passa a funcionar de forma
      // previsível a partir daqui.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Colapsa letra repetida: "idiotaaaa" → "idiota", "carallho" → "caralho".
 *
 * Aplicada ao TEXTO e aos TERMOS da lista, sempre em par — é isso que faz a
 * comparação continuar honesta. Se só o texto fosse colapsado, "burrrro" viraria
 * "buro" e não casaria com nada; colapsando os dois lados, o alongamento deixa
 * de ser um esconderijo.
 *
 * O preço, dito sem maquiagem: pares legítimos colapsam junto ("carro" e "caro"
 * viram a mesma coisa). Por isso a variante colapsada é usada COMO SEGUNDA
 * passagem, e não no lugar da primeira — e por isso nenhum termo da lista pode
 * ter um "vizinho colapsado" inocente (foi conferido termo a termo).
 */
function collapseRepeats(text: string): string {
  return text.replace(/(.)\1+/gu, '$1');
}

// =============================================================================
// AS LISTAS
// =============================================================================

/**
 * DISCURSO DE ÓDIO — ataque por raça, orientação, identidade, deficiência,
 * origem, e incitação ao suicídio.
 *
 * Escritos SEM ACENTO e em minúsculas porque a comparação acontece depois da
 * normalização: um "otário" com acento aqui simplesmente nunca casaria. É a
 * mesma razão pela qual as formas de gênero e as variantes de grafia aparecem
 * uma a uma em vez de virarem regex com classe de caractere — a lista precisa
 * ser LEGÍVEL por quem for revisá-la, e um `otari[oa]s?` no meio de oitenta
 * termos é onde um erro se esconde.
 */
const HATE_TERMS: readonly string[] = [
  // Racismo
  'crioulo',
  'criolo',
  'neguinho de merda',
  'preto imundo',
  'volta pra senzala',
  'macaco de merda',
  'favelado',
  'favelada',
  // Homofobia / transfobia
  'viado',
  'viadinho',
  'viadao',
  'bicha',
  'bichinha',
  'boiola',
  'baitola',
  'sapatao',
  'traveco',
  'travecao',
  // Escritas por extenso, uma forma de gênero por linha: o sufixo automático
  // cobre só plural, e "trans nojenta" com um `(?:a|o)` embutido seria a
  // exceção ilegível que o cabeçalho da lista pediu para evitar.
  'trans nojento',
  'trans nojenta',
  // Capacitismo
  'mongoloide',
  'retardado',
  'retardada',
  'retardados',
  'debil mental',
  // Xenofobia / intolerância religiosa
  'nordestino imundo',
  'macumbeiro de merda',
  // Incitação ao suicídio e ameaça — frases inteiras de propósito: "se mata"
  // solto aparece em "ele se mata de trabalhar", e o verbo isolado não pode
  // derrubar comentário nenhum.
  'vai se matar',
  'se mata logo',
  'se mate',
  'morre logo',
  'espero que voce morra',
  'devia morrer',
  'vou te matar',
  'vou te achar',
];

/**
 * XINGAMENTO DIRECIONADO — ataque à pessoa, sem uso literal plausível.
 *
 * Toda entrada aqui foi passada pelo filtro descrito no cabeçalho: "eu aceito
 * remover, sem revisão humana, QUALQUER comentário que contenha isto?". As que
 * não passaram (burro, anta, palhaço, lixo…) estão listadas lá em cima, com o
 * motivo, para que ninguém as "esqueça" de volta para cá sem discutir.
 */
const INSULT_TERMS: readonly string[] = [
  // Xingamentos de uma palavra
  'idiota',
  'imbecil',
  'otario',
  'otaria',
  'babaca',
  'arrombado',
  'arrombada',
  'escroto',
  'escrota',
  'cuzao',
  'cuzona',
  'desgracado',
  'desgracada',
  'energumeno',
  'panaca',
  'cretino',
  'cretina',
  'canalha',
  'vagabundo',
  'vagabunda',
  'escoria',
  'verme humano',
  'lixo humano',
  'trouxa',
  'estupido',
  'estupida',
  'jumento ignorante',
  'analfabeto funcional',
  // Siglas — muito usadas justamente por escaparem de filtro ingênuo.
  'fdp',
  'vsf',
  'vtnc',
  'tnc',
  // Frases. A normalização já colapsou hífen e espaço múltiplo, então elas
  // casam mesmo escritas como "vai-se-foder".
  'filho da puta',
  'filha da puta',
  'filhos da puta',
  'filho de uma puta',
  'vai se foder',
  'va se foder',
  'vao se foder',
  'toma no cu',
  'vai tomar no cu',
  'enfia no cu',
  'chupa meu pau',
  'vai a merda',
  'sua puta',
  'seu merda',
  'seu bosta',
  'sua vaca',
  'sua cadela',
  'nojento de merda',
  'burro de merda',
  'cala a boca idiota',
];

/**
 * PALAVRÃO DE ÊNFASE — NÃO remove nada sozinho.
 *
 * Por que a lista existe, então: para que a fila humana saiba distinguir "duas
 * denúncias num comentário com linguagem pesada" de "duas denúncias num
 * comentário educado que alguém não gostou". São situações diferentes e a
 * moderação decide diferente. O bot mede; quem decide é gente.
 */
const PROFANITY_TERMS: readonly string[] = [
  'caralho',
  'carai',
  'porra',
  'merda',
  'bosta',
  'cacete',
  'buceta',
  'boceta',
  'piroca',
  'foda',
  'fodase',
  'foda se',
  'foder',
  'puta que pariu',
  'puta merda',
  'pqp',
  'krl',
  'cu',
];

// =============================================================================
// COMPILAÇÃO DOS PADRÕES
// =============================================================================

/** Escapa metacaractere antes de interpolar em RegExp. Mesma função, mesmo
 *  motivo, que a de `matchFranchises` no curator. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Monta o padrão de uma categoria.
 *
 * FRONTEIRA DE PALAVRA (`\b`) É O CORAÇÃO DISTO, e é o mesmo cuidado que o
 * curator toma ao casar nome de franquia: sem ela, "cu" casaria dentro de
 * "curioso", "escuro" e "documento"; "puta" casaria dentro de "reputação",
 * "disputa" e "amputar"; "idiota" dentro de nada, mas "sapatao" dentro de
 * "sapataozinho" — e uma remoção automática disparada por substring seria
 * indefensável na primeira reclamação.
 *
 * O sufixo `(?:s|es)?` cobre o plural sem precisar de duas entradas na lista
 * para cada termo. Ele fica FORA do `\b` final justamente para que "idiotas"
 * case e "idiotice" (que é outra palavra) não.
 *
 * As alternativas são ordenadas da MAIS LONGA para a mais curta porque a
 * alternância de regex é preguiçosa: sem isso, "puta" casaria antes de "filho da
 * puta" e o veredito registraria o termo errado — o que muda a categoria e,
 * portanto, a decisão.
 */
function buildPattern(terms: readonly string[]): RegExp {
  const alternatives = [...terms]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');

  return new RegExp(`\\b(?:${alternatives})(?:s|es)?\\b`, 'gu');
}

/**
 * Dois padrões por categoria: um para o texto normalizado e outro para a versão
 * com letras repetidas colapsadas.
 *
 * Compilados UMA vez, na carga do módulo. Montar estas regex a cada denúncia
 * seria trabalho repetido para um resultado que nunca muda — e a denúncia é
 * justamente o caminho que precisa responder rápido, porque quem clicou está
 * esperando com a página aberta.
 */
const PATTERNS = {
  hate: {
    plain: buildPattern(HATE_TERMS),
    collapsed: buildPattern(HATE_TERMS.map(collapseRepeats)),
  },
  insult: {
    plain: buildPattern(INSULT_TERMS),
    collapsed: buildPattern(INSULT_TERMS.map(collapseRepeats)),
  },
  profanity: {
    plain: buildPattern(PROFANITY_TERMS),
    collapsed: buildPattern(PROFANITY_TERMS.map(collapseRepeats)),
  },
} as const;

// =============================================================================
// O VEREDITO
// =============================================================================

/** Gravidade encontrada. A ordem da lista É a ordem de severidade. */
export const MODERATION_SEVERITIES = ['none', 'profanity', 'insult', 'hate'] as const;
export type ModerationSeverity = (typeof MODERATION_SEVERITIES)[number];

export interface CommentScreening {
  /**
   * O bot CONFIRMA que isto é ataque?
   *
   * `true` apenas para 'insult' e 'hate'. É este campo, e nenhum outro, que a
   * rota de denúncia consulta para remover o comentário — quem chama não precisa
   * (nem deve) reimplementar a comparação de severidade.
   */
  offensive: boolean;
  severity: ModerationSeverity;
  /**
   * Os trechos que dispararam o veredito, no máximo cinco.
   *
   * Existem para a NOTA DE MODERAÇÃO: sem eles, "removido automaticamente" é uma
   * afirmação que ninguém consegue conferir depois. NUNCA devem voltar na
   * resposta HTTP da denúncia — devolvê-los ensinaria, a quem quisesse
   * contornar, exatamente quais palavras evitar.
   */
  matches: string[];
}

const MAX_MATCHES = 5;

/**
 * Analisa o texto de um comentário.
 *
 * Aceita `unknown` porque quem chama está do lado de fora da fronteira de
 * confiança (o conteúdo vem do banco, que veio de um formulário): um `null` ou
 * um número caído aqui devolve "nada encontrado" em vez de derrubar a rota de
 * denúncia inteira.
 */
export function screenComment(input: unknown): CommentScreening {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { offensive: false, severity: 'none', matches: [] };
  }

  // Teto defensivo: `COMMENT_MAX_LENGTH` já é 1.500, mas este módulo é público
  // e pode ser chamado de outro lugar amanhã. Regex com alternância longa sobre
  // um texto de megabytes é o caminho conhecido para prender o event loop.
  const normalized = normalizeForModeration(input.slice(0, 4_000));
  const collapsed = collapseRepeats(normalized);

  // A ordem importa: a categoria mais grave encontrada é a que vale, e paramos
  // na primeira. Um comentário com slur E palavrão é um caso de slur.
  for (const severity of ['hate', 'insult'] as const) {
    const matches = collectMatches(severity, normalized, collapsed);
    if (matches.length > 0) {
      return { offensive: true, severity, matches };
    }
  }

  const profanity = collectMatches('profanity', normalized, collapsed);
  if (profanity.length > 0) {
    // Note o `offensive: false`. É a linha que sustenta a decisão do cabeçalho:
    // palavrão de ênfase NÃO derruba comentário automaticamente — ele só chega
    // à fila humana com um sinal a mais.
    return { offensive: false, severity: 'profanity', matches: profanity };
  }

  return { offensive: false, severity: 'none', matches: [] };
}

/** Atalho para quem só precisa do sim/não. */
export function isOffensiveComment(input: unknown): boolean {
  return screenComment(input).offensive;
}

/**
 * Roda os dois padrões da categoria e junta os achados, sem repetir.
 *
 * A passagem colapsada roda SEMPRE, e não só quando a primeira falha: as duas
 * enxergam coisas diferentes ("idiota" na primeira, "idiotaaaa" na segunda), e o
 * custo de uma regex a mais sobre um texto de no máximo 1.500 caracteres é
 * irrelevante perto de deixar passar o caso que motivou a denúncia.
 */
function collectMatches(
  category: keyof typeof PATTERNS,
  normalized: string,
  collapsed: string,
): string[] {
  /**
   * A CHAVE do mapa é a forma COLAPSADA, e o valor é o trecho como foi
   * encontrado. Sem isso, "arrombado" apareceria duas vezes na nota de
   * moderação — uma por passagem —, escrito de dois jeitos ("arrombado" e
   * "arombado"), e a nota que existe para tornar a remoção conferível viraria
   * justamente o oposto: um ruído que parece erro.
   */
  const found = new Map<string, string>();

  for (const [pattern, haystack] of [
    [PATTERNS[category].plain, normalized],
    [PATTERNS[category].collapsed, collapsed],
  ] as const) {
    for (const match of haystack.matchAll(pattern)) {
      const key = collapseRepeats(match[0]);
      if (!found.has(key)) found.set(key, match[0]);
      if (found.size >= MAX_MATCHES) return [...found.values()];
    }
  }

  return [...found.values()];
}
