/**
 * =============================================================================
 * DICIONÁRIO DE RISCO EDITORIAL — a LISTA, separada do MOTOR
 * =============================================================================
 *
 * Este arquivo é DADO, não lógica. Ele existe separado de `editorial-risk.ts`
 * por um motivo prático: quem vai revisar, cortar e acrescentar linha aqui é a
 * chefia de redação — não necessariamente quem programa. Uma lista de termos
 * enterrada no meio de um algoritmo de varredura não é revisada por ninguém, e
 * uma lista que ninguém revisa envelhece até virar ruído.
 *
 * -----------------------------------------------------------------------------
 * ⚠ ESTE ARQUIVO CONTÉM PALAVRAS OFENSIVAS, ESCRITAS POR EXTENSO
 * -----------------------------------------------------------------------------
 * É inevitável: um filtro de termos precisa conter os termos que filtra. Elas
 * estão aqui como ENTRADA DE DICIONÁRIO, do mesmo jeito que estariam num manual
 * de redação — e nunca aparecem em nenhuma superfície pública do site.
 *
 * -----------------------------------------------------------------------------
 * COMO OS PADRÕES SÃO ESCRITOS (e por que ninguém tira acento aqui)
 * -----------------------------------------------------------------------------
 * A primeira versão deste módulo normalizava o texto (minúsculas + remoção de
 * acento) antes de comparar. Foi DESCARTADA, e o motivo é bom demais para não
 * ficar registrado: sem acento, `é` e `e` viram a mesma letra — e a regra mais
 * importante do arquivo inteiro ("«é corrupto» sem fonte é imputação de crime")
 * passaria a casar com a conjunção. "O elenco tem heróis e bandidos" seria
 * sinalizado como acusação. Um bot que grita em frase inocente é desligado na
 * primeira semana, e aí ele não protege mais nada.
 *
 * Então os padrões são escritos COM acento e casados com a flag `i` (que já
 * resolve maiúscula/minúscula). Onde a grafia sem acento é plausível de verdade
 * (`débil`/`debil`), o padrão traz as duas formas explicitamente.
 *
 * As FRONTEIRAS de palavra não são `\b`: `\b` é ASCII e enxerga fronteira entre
 * "l" e "ó", o que faria `mongol` casar dentro de "Mongólia". O motor embrulha
 * cada padrão em `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` — fronteira de verdade
 * para português. Ver `compileRule` em `editorial-risk.ts`.
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTA LISTA NÃO É
 * -----------------------------------------------------------------------------
 * Não é um censor e não é um parecer jurídico. É uma checagem de véspera: ela
 * levanta a mão, explica por que levantou e devolve a decisão a um humano. Toda
 * entrada aqui vai gerar algum falso positivo — o desenho assume isso, e é por
 * isso que NADA nesta lista bloqueia publicação (ver o cabeçalho do motor).
 */

/**
 * Import SÓ DE TIPO, e por isso não existe ciclo em tempo de execução: o motor
 * importa a lista (valor), a lista importa do motor apenas os nomes das
 * categorias (apagados na compilação). Manter o vocabulário do lado do motor é
 * o que garante que uma categoria nova apareça na tela — o `Record` de rótulos
 * lá não compila com uma chave faltando.
 */
import type { EditorialRiskCategory, EditorialRiskSeverity } from './editorial-risk';

export interface RiskRule {
  /**
   * O padrão, SEM fronteira de palavra — quem acrescenta é o motor.
   *
   * Escrito como RegExp (e não string) de propósito: barra invertida simples,
   * destaque de sintaxe no editor e erro de compilação se a expressão for
   * inválida. Uma string `"\\s+(um|uma)"` erra em silêncio.
   */
  pattern: RegExp;
  category: EditorialRiskCategory;
  severity: EditorialRiskSeverity;
  /** Por que isto foi sinalizado. Frase pronta para aparecer na tela. */
  reason: string;
  /** Troca sugerida, quando existe uma óbvia e consagrada. */
  suggestion?: string;
  /**
   * SÓ para acusações: a regra só vale se NÃO houver atribuição por perto.
   *
   * É o que separa "Fulano é corrupto" (imputação nossa) de "Fulano é acusado
   * de corrupção pelo MP" (relato de fato atribuído). Ver `ATTRIBUTION_MARKERS`.
   */
  needsAttribution?: boolean;
}

// =============================================================================
// 1. TERMOS DISCRIMINATÓRIOS — ofensa a categoria protegida
// =============================================================================
//
// Critério de entrada nesta lista: o termo, no contexto de uma matéria de games,
// cinema, anime ou tecnologia, praticamente não tem uso legítimo. Racismo,
// injúria racial, homofobia e transfobia são CRIME no Brasil (Lei 7.716/89, Lei
// 14.532/23 e a decisão do STF na ADO 26) — e a responsabilidade do veículo pelo
// que publica é pacífica.
//
// Termo AMBÍGUO não entra como 'alto': entra como 'atencao', com a explicação do
// que precisa ser conferido. "Macaco" é um animal e também é injúria racial; a
// diferença está na frase, e frase é coisa que humano lê.

export const DISCRIMINATORY_RULES: RiskRule[] = [
  // --- Homofobia e transfobia -----------------------------------------------
  {
    pattern: /viado|viadinho|viadagem|viadão/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo homofóbico. Injúria por orientação sexual é crime (STF, ADO 26).',
  },
  {
    pattern: /boiola|baitola|bichona|frutinha/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo homofóbico usado como ofensa.',
  },
  {
    pattern: /traveco|travecão|traveca/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo transfóbico. A palavra correta é "travesti" ou "mulher trans".',
    suggestion: 'travesti / mulher trans',
  },
  {
    // Reapropriados por parte da própria comunidade — o que muda tudo quando
    // aparecem em citação direta ou em nome de obra ("Bicha Nerd"). Por isso
    // 'atencao': o problema não é a palavra existir no texto, é ela ser NOSSA.
    pattern: /bicha|bichinha|sapatão|sapatona/,
    category: 'discriminacao',
    severity: 'atencao',
    reason:
      'Termo com uso ofensivo e também reapropriado pela própria comunidade. Confira se está em citação/nome de obra — se for voz do site, troque.',
  },

  // --- Racismo ---------------------------------------------------------------
  {
    pattern: /crioulo|crioula/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo racista. Injúria racial é crime (Lei 14.532/2023).',
  },
  {
    pattern: /serviço de preto|coisa de preto|programa de índio|inveja branca/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Expressão de origem racista, sem uso legítimo em texto jornalístico.',
  },
  {
    // O animal existe, e o portal cobre Donkey Kong e "Planeta dos Macacos".
    // Sinalizar como 'alto' aqui seria treinar todo mundo a ignorar o aviso.
    pattern: /macaco|macaca|mulato|mulata/,
    category: 'discriminacao',
    severity: 'atencao',
    reason:
      'Palavra com uso racista quando se refere a pessoa. Confira o contexto: falando de gente, troque.',
    suggestion: 'para pessoas: negro, negra, pessoa parda',
  },

  // --- Capacitismo -----------------------------------------------------------
  {
    pattern: /retardado|retardada|mongol[oó]ide|d[ée]bil mental|imbecil mental/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo capacitista usado como ofensa. Ofende pessoas com deficiência intelectual.',
  },
  {
    pattern: /aleijado|aleijada|manco|coxo|surdo-mudo|mudinho/,
    category: 'discriminacao',
    severity: 'atencao',
    reason: 'Termo capacitista ou desatualizado para deficiência física/auditiva.',
    suggestion: 'pessoa com deficiência física / pessoa surda',
  },
  {
    // Diagnóstico virando adjetivo é o capacitismo mais comum em crítica de
    // games ("level design esquizofrênico"). Não é crime, é deselegante — e o
    // aviso aqui existe para melhorar o texto, não para evitar processo.
    pattern: /esquizofr[êe]nico|bipolar|autista|down/,
    category: 'discriminacao',
    severity: 'atencao',
    reason:
      'Diagnóstico usado como adjetivo depreciativo é capacitismo. Se não é sobre a condição de verdade, troque.',
    suggestion: 'confuso, inconstante, desconexo',
  },

  // --- Misoginia -------------------------------------------------------------
  {
    pattern: /vadia|vagabunda|piranha|rapariga|biscate|feminazi|mulherzinha/,
    category: 'discriminacao',
    severity: 'alto',
    reason: 'Termo misógino usado como ofensa.',
  },
  {
    // "Puta que pariu", "puta jogo" e "putaria" são interjeição e gíria, não
    // ofensa de gênero. A ambiguidade é grande demais para 'alto'.
    pattern: /puta|histérica|escandalosa/,
    category: 'discriminacao',
    severity: 'atencao',
    reason:
      'Pode ser interjeição/gíria ou ofensa de gênero, dependendo de quem é o sujeito. Confira o contexto.',
  },

  // --- Intolerância religiosa ------------------------------------------------
  {
    pattern: /macumbeiro|macumbeira|adorador do diabo|seita/,
    category: 'discriminacao',
    severity: 'atencao',
    reason:
      'Termo pejorativo sobre religião. Intolerância religiosa é crime (Lei 7.716/89) e atinge sobretudo religiões de matriz africana.',
    suggestion: 'nome correto da religião (candomblé, umbanda) ou "religião"',
  },

  // --- Xenofobia -------------------------------------------------------------
  {
    // Muito frequente em pauta de hardware e periférico — justamente por isso
    // vale a pena estar aqui: é o deslize mais provável neste portal.
    pattern: /xing[ -]?ling|japa|jamanta chinesa|coisa de chinês/,
    category: 'discriminacao',
    severity: 'atencao',
    reason: 'Termo xenofóbico. "Xing ling"/"japa" carregam estereótipo de nacionalidade.',
    suggestion: 'produto genérico / sem marca conhecida; "japonês"',
  },
];

// =============================================================================
// 2. TERMO INADEQUADO — deslize de vocabulário com troca consagrada
// =============================================================================
//
// Categoria separada de propósito. Aqui não há crime nem processo: há um termo
// que a imprensa séria já parou de usar, com substituto conhecido. Misturar
// isto com xingamento faria o painel gritar do mesmo jeito para as duas coisas —
// e a segunda vez que alguém lê "ALERTA GRAVE" por causa de "opção sexual" é a
// última vez que alguém lê o alerta.
//
// Todos são 'atencao', e TODOS trazem sugestão de troca: um aviso que só aponta
// o erro custa trabalho ao redator; um que já entrega a palavra certa economiza.

export const OUTDATED_TERM_RULES: RiskRule[] = [
  {
    pattern: /homossexualismo/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: 'O sufixo "-ismo" trata orientação sexual como doença. Fora da CID desde 1990.',
    suggestion: 'homossexualidade',
  },
  {
    pattern: /opção sexual|opção de gênero/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: '"Opção" sugere escolha. O termo técnico e jornalístico é "orientação".',
    suggestion: 'orientação sexual / identidade de gênero',
  },
  {
    pattern: /transexualismo|mudança de sexo/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: 'Termo patologizante e desatualizado.',
    suggestion: 'transexualidade / cirurgia de afirmação de gênero',
  },
  {
    pattern: /hermafrodita/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: 'Termo da biologia aplicado a pessoas. Impróprio para gente.',
    suggestion: 'intersexo',
  },
  {
    pattern: /portador de deficiência|portadora de deficiência|portador de necessidades/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: 'Deficiência não se "porta". Terminologia oficial da LBI (Lei 13.146/2015).',
    suggestion: 'pessoa com deficiência',
  },
  {
    pattern: /[íi]ndio|[íi]ndios|silv[íi]cola/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason: 'Termo colonial. Manuais de redação e a própria legislação usam "indígena".',
    suggestion: 'indígena / povo originário',
  },
  {
    // Cobertura de morte de artista é rotina num portal de cultura pop, e a
    // recomendação da OMS sobre noticiar suicídio existe porque a forma de
    // narrar tem efeito medido de contágio. Risco reputacional real, custo zero
    // para corrigir.
    pattern: /cometeu suicídio|suicidou-se covardemente|se matou/,
    category: 'termo-inadequado',
    severity: 'atencao',
    reason:
      '"Cometer" associa suicídio a crime. A recomendação da OMS para cobertura responsável pede outra construção.',
    suggestion: 'morreu por suicídio / tirou a própria vida',
  },
];

// =============================================================================
// 3. ACUSAÇÃO GRAVE SEM ATRIBUIÇÃO — o núcleo do risco de processo
// =============================================================================
//
// É AQUI que mora o pedido original ("alegação grave sem fonte abre a empresa a
// processo"). No direito brasileiro a diferença entre relatar e caluniar é quase
// toda de REGÊNCIA:
//
//   "A editora fraudou os números."          → imputação NOSSA. Calúnia (CP 138)
//                                               se o fato for crime; difamação
//                                               (CP 139) se só ofende a fama.
//   "A editora é acusada de fraudar os       → relato de fato de terceiro, com
//    números, segundo o processo nº X."        fonte. É jornalismo.
//
// A heurística: achar o gatilho e procurar, na MESMA FRASE (mais uma folga para
// trás, porque atribuição costuma vir na oração anterior), qualquer marca de
// atribuição ou de dúvida. Achou marca → não sinaliza.
//
// ⚠ ISTO NÃO É ANÁLISE SINTÁTICA. Não há sujeito, não há negação, não há
// correferência: "não é verdade que ele é corrupto" será sinalizado. Preferimos
// esse falso positivo ao falso negativo — o aviso custa um clique, a matéria
// custa um processo.
//
// VERBOS DELIBERADAMENTE FORA DA LISTA: "matou", "destruiu", "torturou",
// "ameaçou", "roubou" (sozinho). Num portal de games eles aparecem dezenas de
// vezes por semana em sentido ficcional ou figurado ("matou o chefe", "roubou a
// cena"). Incluí-los transformaria o verificador em barulho — que é o único jeito
// garantido de tornar um alerta inútil.

export const ACCUSATION_RULES: RiskRule[] = [
  {
    // A cópula. Repare que `é` está acentuado: é o que impede a conjunção "e"
    // de casar (ver o cabeçalho do arquivo).
    pattern:
      /(é|são|era|eram|foi|foram)\s+(um |uma |uns |umas )?(corrupt[oa]s?|criminos[oa]s?|bandid[oa]s?|ladr(ão|ões|a|as)|golpist[ao]s?|estelionatári[oa]s?|ped[óo]fil[oa]s?|estuprador(a|es|as)?|assediador(a|es|as)?|racistas?|nazistas?|misógin[oa]s?|homof[óo]bic[oa]s?|transf[óo]bic[oa]s?|abusador(a|es|as)?|fraudador(a|es|as)?|caloteir[oa]s?|charlat(ão|ões|ã)|picaretas?)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason:
      'Afirmação categórica de que alguém É criminoso ou desonesto, sem atribuir a fonte. É a construção clássica de calúnia/difamação (CP, arts. 138 a 140).',
    suggestion:
      'atribua: "é acusado de…", "segundo o processo…", "de acordo com a denúncia do MP…"',
  },
  {
    pattern:
      /(cometeu|cometeram|praticou|praticaram)\s+(um |uma )?(crime|fraude|estelionato|ass[ée]dio|pl[áa]gio|racismo|abuso|homic[íi]dio|estupro|agress(ão|ões)|preconceito|corrupção)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Imputação direta de crime, sem fonte citada.',
    suggestion: 'atribua a quem acusa: "é acusado de ter cometido…", "segundo a denúncia…"',
  },
  {
    pattern:
      /(fraudou|fraudaram|sonegou|sonegaram|subornou|subornaram|corrompeu|desviou (dinheiro|verba|verbas|recursos|milhões)|lavou dinheiro)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Verbo que imputa crime financeiro em frase afirmativa, sem fonte.',
    suggestion: 'atribua: "teria fraudado, segundo…", "é acusado de sonegar…"',
  },
  {
    pattern:
      /(plagiou|plagiaram|copiou descaradamente|roubou (a arte|o trabalho|o c[óo]digo|a ideia|o design|as animações))/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason:
      'Acusação de plágio afirmada como fato. Plágio é violação de direito autoral — imputá-lo sem fonte é o caminho mais curto para uma notificação extrajudicial.',
    suggestion: 'descreva o que se vê ("as animações são muito parecidas com…") ou cite quem acusa',
  },
  {
    pattern: /(assediou|assediaram|estuprou|estupraram|espancou|espancaram|agrediu|agrediram)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Imputação de crime contra pessoa, afirmada como fato consumado, sem fonte.',
    suggestion: 'atribua: "é acusado de assediar…", "segundo o processo movido por…"',
  },
  {
    pattern:
      /(trabalho escravo|trabalho an[áa]logo [àa] escravid[ãa]o|exploração infantil|caixa dois|propina|suborno|lavagem de dinheiro|apropriação indébita|pir[âa]mide financeira)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Menção a crime grave sem atribuir a fonte que o afirma.',
    suggestion: 'diga de onde veio: "segundo o relatório do MPT…", "de acordo com a ação…"',
  },
  {
    pattern:
      /(mentiu|mentiram|enganou|enganaram)\s+(os |as |o |a )?(jogadores|consumidores|clientes|p[úu]blico|f[ãa]s|investidores|acionistas)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason:
      'Afirmar má-fé como fato ("mentiu para os jogadores") imputa conduta desonesta e pode virar ação por dano à imagem — inclusive de pessoa jurídica (Súmula 227 do STJ).',
    suggestion: 'descreva o fato verificável: "prometeu X e entregou Y"',
  },
  {
    pattern: /(maquiou|manipulou|forjou|falsificou)\s+(os |as )?(n[úu]meros|dados|resultados|benchmarks?|vendas)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Acusação de falsificação de dados afirmada como fato.',
    suggestion: 'atribua a análise: "segundo a apuração de X, os números não batem"',
  },
  {
    pattern: /(é|era|foi)\s+(uma\s+)?(fraude|farsa|golpe aplicado|estelionato)/,
    category: 'acusacao',
    severity: 'alto',
    needsAttribution: true,
    reason: 'Chamar um produto ou empresa de fraude/farsa é imputação de conduta criminosa.',
    suggestion: 'opine sobre o produto ("não entrega o que promete") ou cite quem acusa',
  },
];

// =============================================================================
// 4. OFENSA PESSOAL — o risco de injúria (CP art. 140)
// =============================================================================
//
// A distinção que importa, e que NENHUM regex resolve: opinião sobre OBRA é
// crítica protegida ("o jogo é um lixo" é legítimo, ainda que deselegante);
// xingamento sobre PESSOA é injúria ("o diretor é um incompetente").
//
// Como a máquina não sabe quem é o sujeito da frase, tudo aqui é 'atencao' e o
// texto do aviso pergunta exatamente isso a quem escreveu. É o desenho honesto:
// a regra não decide, ela lembra.

export const PERSONAL_INSULT_RULES: RiskRule[] = [
  {
    pattern:
      /idiotas?|imbecis?|burr[oa]s?|est[úu]pid[oa]s?|ot[áa]ri[oa]s?|babacas?|canalhas?|escrot[oa]s?|cretin[oa]s?|energ[úu]men[oa]s?|patétic[oa]s?|incompetentes?|fracassad[oa]s?|lixo humano|verme/,
    category: 'ofensa-pessoal',
    severity: 'atencao',
    reason:
      'Xingamento. Sobre uma OBRA é crítica; sobre uma PESSOA é injúria (CP art. 140). Confira quem é o sujeito da frase.',
    suggestion: 'critique o trabalho, não a pessoa: "a decisão de X foi mal executada porque…"',
  },
];

// =============================================================================
// 5. DADO PESSOAL — LGPD, e o único grupo com quase zero falso positivo
// =============================================================================
//
// Publicar CPF, RG ou telefone de alguém é tratamento de dado pessoal sem base
// legal (LGPD, Lei 13.709/2018) — e, ao contrário do resto deste arquivo, não
// depende de interpretação nenhuma: o número está no texto ou não está.
//
// Costuma entrar por descuido em captura de tela transcrita, em print de
// processo ou em texto colado de uma fonte. É barato de achar e caro de deixar
// passar.

export const PERSONAL_DATA_RULES: RiskRule[] = [
  {
    pattern: /\d{3}\.\d{3}\.\d{3}-\d{2}|CPF\s*(n[ºo°]?\s*)?:?\s*\d[\d.\s-]{9,16}\d/,
    category: 'dado-pessoal',
    severity: 'alto',
    reason: 'CPF no texto. Publicar dado pessoal sem base legal viola a LGPD.',
    suggestion: 'remova o número ou substitua por "CPF preservado"',
  },
  {
    pattern: /RG\s*(n[ºo°]?\s*)?:?\s*[\d.\s-]{6,14}\d/,
    category: 'dado-pessoal',
    severity: 'alto',
    reason: 'Número de RG no texto. Dado pessoal identificável (LGPD).',
    suggestion: 'remova o número',
  },
  {
    pattern: /\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}/,
    category: 'dado-pessoal',
    severity: 'alto',
    reason: 'Telefone no texto. Só publique se for contato comercial divulgado pelo próprio dono.',
    suggestion: 'remova o número ou use o canal oficial de imprensa',
  },
  {
    pattern: /\d{5}-\d{3}/,
    category: 'dado-pessoal',
    severity: 'atencao',
    reason: 'Parece um CEP. Endereço residencial de pessoa identificada não deve ir ao ar.',
  },
  {
    // E-mail de assessoria é informação pública e legítima; e-mail pessoal de
    // alguém citado na matéria, não. Por isso 'atencao' e não 'alto'.
    pattern: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}(\.[A-Za-z]{2,})?/,
    category: 'dado-pessoal',
    severity: 'atencao',
    reason:
      'E-mail no texto. Contato de imprensa/assessoria é aceitável; e-mail pessoal de alguém citado, não.',
  },
];

// =============================================================================
// MARCAS DE ATRIBUIÇÃO E DÚVIDA — o que DESLIGA uma acusação
// =============================================================================
//
// A presença de qualquer uma destas expressões perto do gatilho é lida como "a
// afirmação não é do site, ou não é categórica". A lista é generosa DE PROPÓSITO:
// o erro que queremos evitar é o falso positivo em texto que já está correto.
// Redação que escreveu "segundo a denúncia" fez o trabalho certo e não pode ser
// interrogada por isso.
//
// "Condenado" está aqui porque condenação é fato público documentado — a frase
// "foi condenado por fraude" não é acusação nossa, é registro de decisão.
export const ATTRIBUTION_MARKERS =
  /acus(a|ou|am|aram|ado|ada|ados|adas|ação|ações)|denunci(a|ou|ado|ada|ando)|den[úu]ncia|supost[oa]|supostamente|alegad[oa]|alegadamente|aleg(a|am|ou|aram)|teria|teriam|seria|seriam|segundo|de acordo com|conforme|apurou|apura[çc][ãa]o|investigad[oa]|investiga[çc][ãa]o|suspeit[oa]|processad[oa]|processo|a[çc][ãa]o judicial|indiciad[oa]|condenad[oa]|r[ée]u|admitiu|confessou|afirm(a|ou|am|aram)|dis(se|seram)|declarou|relat(a|ou|am|aram)|apont(a|ou|am|aram)|revelou|noticiou|publicou|em nota|comunicado|entrevista|processar/i;

// =============================================================================
// MARCAS DE FICÇÃO — o que REBAIXA uma acusação de 'alto' para 'atencao'
// =============================================================================
//
// Peculiaridade deste portal, e a razão de esta lista existir: aqui se escreve
// sobre criminosos o tempo todo — só que eles são personagens. "O protagonista é
// um ladrão" não gera processo nenhum.
//
// REBAIXA, e não SUPRIME: uma matéria pode falar do enredo no parágrafo de cima e
// do processo real contra o estúdio no de baixo. Sumir com o aviso porque a
// palavra "personagem" apareceu perto seria trocar um falso positivo barato por
// um falso negativo caro.
export const FICTION_MARKERS =
  /personagem|protagonista|vil(ão|ã|ões)|anti-?her[óo]i|no jogo|do jogo|no filme|do filme|na s[ée]rie|da s[ée]rie|no anime|do anime|no mang[áa]|na hist[óo]ria|do enredo|no enredo|na trama|fic[çc][ãa]o|roteiro|elenco|interpreta|vive o|dubl(a|ador|adora)/i;

/** Todas as regras, na ordem em que fazem sentido ser lidas por um humano. */
export const ALL_RISK_RULES: RiskRule[] = [
  ...DISCRIMINATORY_RULES,
  ...OUTDATED_TERM_RULES,
  ...ACCUSATION_RULES,
  ...PERSONAL_INSULT_RULES,
  ...PERSONAL_DATA_RULES,
];
