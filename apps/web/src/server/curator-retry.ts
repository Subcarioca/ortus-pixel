/**
 * =============================================================================
 * QUANDO REPETIR UM CICLO QUE MORREU — a política, isolada e testável
 * =============================================================================
 *
 * Este módulo responde UMA pergunta: "o processo filho do curator morreu; vale a
 * pena rodá-lo de novo agora?". Ele não spawna nada, não toca no banco e não
 * conhece HTTP — isso é de `curator-runner.ts`.
 *
 * Ele é separado pelo MESMO motivo de `curator-bundle.ts`: `curator-runner.ts`
 * importa `'server-only'`, um especificador resolvido pelo bundler do Next que
 * NÃO existe como módulo comum — um teste em `node --test` sequer consegue
 * carregar aquele arquivo (ver o `//test` do package.json de apps/web). Uma
 * regra que decide se o servidor vai executar um processo DE NOVO é o último
 * lugar do projeto onde se deve abrir mão de teste.
 *
 * =============================================================================
 * O BUG QUE ORIGINOU ESTE ARQUIVO (evidência de produção, não hipótese)
 * =============================================================================
 * Numa sessão SSH no servidor, o dono do site capturou esta falha do botão
 * "Buscar pautas agora" — na PRIMEIRÍSSIMA operação de banco do ciclo:
 *
 *     thread 'tokio-runtime-worker' panicked at .../futures-timer-3.0.2/
 *       src/native/delay.rs:112:21:
 *     timer has gone away
 *     prisma:error
 *     Invalid `prisma.pipelineRun.create()` invocation in
 *       .../curator/curator.cjs:2862:40
 *     PANIC: timer has gone away
 *     This is a non-recoverable error which probably happens when the Prisma
 *     Query Engine has a panic.
 *
 * -----------------------------------------------------------------------------
 * A CAUSA RAIZ, CONFIRMADA PELA PRÓPRIA EQUIPE DO PRISMA
 * -----------------------------------------------------------------------------
 * Não é bug de lógica do curator, e não é o teto de tempo de 75s matando o filho
 * (o panic acontece em ~1s, na primeira query). É ESGOTAMENTO DO LIMITE DE
 * PROCESSOS/THREADS DO SISTEMA. Nas palavras de um engenheiro do Prisma, na
 * issue prisma/prisma#24100 — que é a issue canônica para a qual as outras 24
 * com este mesmo título foram fechadas como duplicata:
 *
 *   "`PANIC: timer has gone away` can happen if the system ran out of the limit
 *    of processes/threads (which are pretty much the same thing from the point
 *    of view of Linux). [...] Just starting Node.js by itself already 'eats' 15
 *    processes from the limit. Prisma Query Engine then also spawns a similar
 *    number of threads."
 *
 * O engine nativo do Prisma (o `.so.node` carregado DENTRO do processo Node)
 * sobe um runtime Tokio cujo número de threads é, por padrão, o número de
 * núcleos da máquina — em servidor compartilhado, isso costuma ser dezenas.
 * Quando o sistema recusa a criação da thread do timer, a tarefa que esperava
 * por ela entra em pânico com esta mensagem exata.
 *
 * POR QUE ISSO BATE COM ESTE PROJETO COMO UMA LUVA: o botão faz o processo do
 * SITE (Next, que já tem seu próprio engine Prisma carregado e suas threads)
 * dar `spawn` num SEGUNDO processo Node que carrega um SEGUNDO engine Prisma.
 * Nesse instante o mesmo limite de usuário da hospedagem compartilhada precisa
 * acomodar o dobro. Se sobrar folga, funciona (e já funcionou: pautas reais
 * chegaram ao painel por este botão); se não sobrar, panica.
 *
 * -----------------------------------------------------------------------------
 * POR QUE REPETIR É A RESPOSTA CERTA PARA ESTA FALHA ESPECÍFICA
 * -----------------------------------------------------------------------------
 * Três propriedades, e as três precisam valer — é por isso que a repetição NÃO é
 * aplicada a qualquer falha, só a esta:
 *
 *   1. É TRANSITÓRIA POR NATUREZA. A folga no limite de processos depende de
 *      quantas requisições o site está atendendo naquele segundo. Um segundo
 *      depois, o quadro é outro. Repetir uma falha determinística seria só
 *      gastar o triplo do tempo para dar o mesmo erro.
 *
 *   2. NÃO DEIXA ESTADO SUJO. O panic observado é em `pipelineRun.create()`, a
 *      PRIMEIRA escrita do ciclo: nada foi gravado, nenhum conector foi
 *      chamado, nenhum orçamento de API foi gasto. E mesmo se o panic caísse
 *      mais tarde, o cabeçalho de `runCurationCycle` estabelece que o ciclo é
 *      idempotente — "rodar duas vezes seguidas não duplica tópicos nem
 *      redispara alertas já enviados".
 *
 *   3. A ALTERNATIVA É PIOR. Sem repetição, a falha vira "o botão não funciona"
 *      para quem clicou e "o pipeline parou" para o agendador do GitHub Actions
 *      — sendo que a segunda tentativa quase sempre passa.
 *
 * ⚠ O QUE A REPETIÇÃO NÃO FAZ: ela trata o SINTOMA. A correção de causa raiz é
 * dar folga de processos/threads ao servidor (aumentar o limite com o suporte da
 * hospedagem, ou reduzir as threads que o engine cria). Enquanto isso não for
 * decidido, esta política mantém o botão utilizável — e o log grita o suficiente
 * para ninguém confundir "está estável" com "está sendo remendado".
 */

/**
 * As assinaturas que identificam ESTE panic no stderr do filho.
 *
 * -----------------------------------------------------------------------------
 * POR QUE SÃO VÁRIAS, E POR QUE NENHUMA DELAS É A PALAVRA "panic" SOZINHA
 * -----------------------------------------------------------------------------
 * Várias porque o panic se anuncia em camadas, e nem toda camada chega ao
 * stderr em toda falha: primeiro a thread do Rust (`tokio-runtime-worker
 * panicked`), depois a mensagem do timer, depois o Prisma Client traduzindo o
 * ocorrido (`PANIC:` / `PrismaClientRustPanicError`). Casar com qualquer uma
 * basta; exigir todas transformaria uma variação de formatação numa regressão
 * silenciosa.
 *
 * E nunca a palavra solta porque o próprio texto explicativo do Prisma contém
 * "...when the Prisma Query Engine has a panic" — casar com isso faria QUALQUER
 * mensagem de erro que cite o assunto disparar uma re-execução.
 *
 * A comparação é feita em minúsculas (ver `ehPanicoDoEngineDoPrisma`), então
 * escreva as assinaturas aqui já em minúsculas.
 */
const ASSINATURAS_DO_PANICO = [
  // A linha final que o Prisma Client imprime. É a mais estável das quatro: faz
  // parte da mensagem de erro pública dele, não do formato de panic do Rust.
  'panic: timer has gone away',
  // O panic cru do Rust, como apareceu no log de produção.
  'timer has gone away',
  // A thread do runtime interno que morreu. Cobre as variantes do MESMO
  // esgotamento que não passam pelo timer.
  "thread 'tokio-runtime-worker' panicked",
  // A forma mais explícita do mesmo problema, relatada na issue #24100 por quem
  // rodava em contêiner: o SO recusando a criação da thread.
  "os can't spawn worker thread",
  // O nome do erro no lado JavaScript. Aparece quando o curator loga a exceção
  // capturada em vez de deixar o processo morrer com o texto cru.
  'prismaclientrustpanicerror',
] as const;

/**
 * O stderr desta execução é o panic do engine nativo do Prisma?
 *
 * Deliberadamente TOLERANTE (basta uma assinatura, em qualquer ponto do texto) e
 * assumidamente falível: o custo de um falso positivo é uma execução extra de um
 * ciclo idempotente — barato; o custo de um falso negativo é o botão voltar a
 * falhar sozinho em produção — caro, e foi o que originou este código.
 */
export function ehPanicoDoEngineDoPrisma(stderr: string | undefined | null): boolean {
  if (!stderr) return false;
  const texto = stderr.toLowerCase();
  return ASSINATURAS_DO_PANICO.some((assinatura) => texto.includes(assinatura));
}

/**
 * TETO DE TENTATIVAS — 3 (a original + 2 repetições).
 *
 * O número sai do formato da falha, não de gosto. Ela é uma disputa por um
 * recurso escasso do sistema: ou existe folga de processos na janela de poucos
 * segundos que temos, ou não existe. Duas repetições cobrem o caso comum (uma
 * rajada de tráfego no site que passa) e mantêm o custo total baixo; a partir da
 * quarta, a chance marginal cai e o que se ganha é o administrador esperando
 * mais para receber a mesma má notícia — pior que recebê-la logo.
 */
export const TENTATIVAS_MAXIMAS = 3;

/**
 * ESPERA ANTES DE CADA REPETIÇÃO — 1,5s e depois 3s.
 *
 * ⚠ ESTA PAUSA NÃO É CORTESIA, É PARTE DA CORREÇÃO. Como a causa é falta de
 * folga no limite de processos/threads, repetir IMEDIATAMENTE é o pior momento
 * possível: as threads do processo que acabou de morrer ainda estão sendo
 * recolhidas pelo sistema, e a nova tentativa disputaria exatamente o recurso
 * que ainda não foi devolvido. A pausa é o tempo de o sistema respirar.
 *
 * Cresce (1,5s → 3s) porque a segunda repetição já sabe algo que a primeira não
 * sabia: a pressão não era um pico de um segundo. Esperar mais é a única
 * variável que temos.
 *
 * O total no pior caso (4,5s de espera) é folgado dentro do orçamento de tempo
 * do disparo, e some perto dos ~15s de um ciclo real.
 */
export function esperaAntesDaTentativa(tentativa: number): number {
  if (tentativa <= 2) return 1_500;
  return 3_000;
}

/**
 * FOLGA MÍNIMA PARA VALER A PENA TENTAR DE NOVO — 20 segundos.
 *
 * Um ciclo real mede ~15s. Começar uma tentativa com menos de 20s de orçamento
 * restante é quase garantir uma segunda morte — desta vez por tempo esgotado —,
 * e o preço é alto: o administrador espera mais para ver uma mensagem PIOR
 * ("passou do tempo") que esconde a causa verdadeira (o panic) atrás do último
 * sintoma. Melhor desistir com o diagnóstico correto na mão.
 */
const FOLGA_MINIMA_PARA_REPETIR_MS = 20_000;

/** O que a política decidiu, e — o que mais importa no log — por quê. */
export interface DecisaoDeRepeticao {
  repetir: boolean;
  /** Frase curta para o log do servidor. Sempre preenchida, inclusive no "não". */
  motivo: string;
  /** Quanto esperar antes de tentar de novo. Zero quando `repetir` é falso. */
  esperarMs: number;
}

/**
 * Decide se a falha desta tentativa merece outra.
 *
 * As três condições são conjuntivas de propósito, e a ORDEM delas é a ordem em
 * que produzem a mensagem de log mais útil: primeiro o que a falha É (só o panic
 * do engine se repete), depois quantas já foram, e por último se ainda há tempo.
 */
export function decidirRepeticao(params: {
  /** Número da tentativa que ACABOU de falhar, começando em 1. */
  tentativa: number;
  /** O stderr capturado dessa tentativa. */
  stderr: string | undefined | null;
  /** Quanto sobra do orçamento total de tempo do disparo, em ms. */
  msRestantesNoOrcamento: number;
}): DecisaoDeRepeticao {
  const { tentativa, stderr, msRestantesNoOrcamento } = params;

  // 1. A falha é a que sabemos ser transitória? Qualquer outra (DATABASE_URL
  //    ausente, bundle corrompido, erro de conector) é determinística: repetir
  //    só gastaria tempo para chegar à mesma conclusão.
  if (!ehPanicoDoEngineDoPrisma(stderr)) {
    return { repetir: false, motivo: 'a falha não é o PANIC do engine do Prisma', esperarMs: 0 };
  }

  // 2. Ainda há tentativa no orçamento?
  if (tentativa >= TENTATIVAS_MAXIMAS) {
    return {
      repetir: false,
      motivo: `o PANIC se repetiu nas ${TENTATIVAS_MAXIMAS} tentativas`,
      esperarMs: 0,
    };
  }

  // 3. Sobra tempo para a próxima tentativa ter chance real de terminar?
  const esperarMs = esperaAntesDaTentativa(tentativa + 1);
  if (msRestantesNoOrcamento - esperarMs < FOLGA_MINIMA_PARA_REPETIR_MS) {
    return {
      repetir: false,
      motivo: 'o PANIC ocorreu, mas não sobra tempo no orçamento para outra tentativa',
      esperarMs: 0,
    };
  }

  return {
    repetir: true,
    motivo: 'PANIC do engine do Prisma (limite de processos/threads do servidor)',
    esperarMs,
  };
}
