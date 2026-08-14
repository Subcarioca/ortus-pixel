/**
 * =============================================================================
 * MIGRAÇÃO DE DADOS — PostgreSQL (Neon) → MySQL/MariaDB (Hostinger)
 * =============================================================================
 *
 *   SOURCE_DATABASE_URL="postgresql://..." npm run db:migrate-data -- --ensaio
 *   SOURCE_DATABASE_URL="postgresql://..." npm run db:migrate-data -- --executar
 *
 * Passo T17 do plano (design/plano-migracao-mysql-2026-08.md, seção 6).
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM SCRIPT, E NÃO UMA FERRAMENTA PRONTA
 * -----------------------------------------------------------------------------
 * Registrado para poupar a pesquisa a quem vier depois: **não existe ferramenta
 * boa para este caminho.** O `pgloader` migra PARA o Postgres, não a partir
 * dele. O `pg_dump` produz SQL de Postgres, que o MySQL não lê. E conversores
 * genéricos de dump não sabem transformar `text[]` em JSON nem respeitar a ordem
 * das chaves estrangeiras — que são exatamente os dois problemas desta migração.
 *
 * Com dois Prisma Clients, as transformações viram três linhas de TypeScript em
 * vez de expressões regulares sobre um dump, e um campo esquecido vira erro de
 * compilação em vez de coluna vazia descoberta em produção.
 *
 * -----------------------------------------------------------------------------
 * AS QUATRO GARANTIAS DESTE SCRIPT
 * -----------------------------------------------------------------------------
 * 1. NÃO ESCREVE NA ORIGEM. O client do Postgres é usado só em `findMany`. A
 *    Neon permanece intacta, porque ela É o plano de rollback (§6.7).
 * 2. É RE-EXECUTÁVEL. Todo `createMany` usa `skipDuplicates`. Se cair no meio,
 *    rode de novo: o que já entrou é ignorado e a cópia continua. Sem isso, uma
 *    queda de rede aos 80% obrigaria a truncar tudo e recomeçar.
 * 3. RECUSA AMBIENTES ERRADOS. Confere fornecedor e nome dos dois bancos antes
 *    de escrever qualquer coisa (`guardas()`).
 * 4. PRESERVA `id`, `createdAt` e `updatedAt`. Os `id` são `cuid()` gerados na
 *    aplicação, então copiá-los mantém todas as chaves estrangeiras válidas E,
 *    principalmente, mantém as URLs já indexadas pelo Google.
 *
 * -----------------------------------------------------------------------------
 * ⚠ O QUE ESTE SCRIPT NÃO FAZ, E PRECISA SER FEITO EM VOLTA DELE
 * -----------------------------------------------------------------------------
 * - NÃO congela as escritas na origem. Copiar com o site ainda gravando produz
 *   contagens que não batem. Ver §6.2 do plano (fase 1).
 * - NÃO cria os índices FULLTEXT. Rode `npm run db:fulltext` DEPOIS da carga —
 *   e é obrigatoriamente depois, nunca antes: ver a nota sobre ordem em
 *   `ordemDosIndicesFulltext()`, no fim deste arquivo.
 * - NÃO verifica o resultado. Isso é o `verify-migration.ts` (T18), e ele é
 *   parte do procedimento, não um extra.
 */

import { PrismaClient as ClientOrigem } from '../../../node_modules/.prisma/client-postgres';
import { PrismaClient as ClientDestino, Prisma } from '@prisma/client';

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO
// -----------------------------------------------------------------------------

/**
 * Tamanho do lote de LEITURA e de ESCRITA.
 *
 * 500 é o meio-termo do plano (§6.4). Abaixo disso, o custo de ida e volta
 * domina; acima, duas coisas começam a doer ao mesmo tempo: a memória do
 * processo (um lote de `Article` carrega o corpo inteiro de cada matéria) e o
 * `max_allowed_packet` do MySQL, que rejeita um `INSERT` grande demais com um
 * erro que não parece ter relação nenhuma com o tamanho do lote.
 */
const LOTE = 500;

/** Lote menor para as tabelas cujas linhas são grandes (corpo de matéria, Json). */
const LOTE_PESADO = 200;

/** Nome do banco de PRODUÇÃO no destino. Ver `guardas()`. */
const BANCO_DESTINO_PRODUCAO = 'u754239208_ortuspixel';

// -----------------------------------------------------------------------------
// TRANSFORMAÇÕES
// -----------------------------------------------------------------------------

/**
 * `text[]` do Postgres → `Json` do MySQL.
 *
 * A "transformação" é quase um repasse: o Prisma Client da origem devolve
 * `string[]`, e o do destino aceita array como `Json`. O que NÃO é repasse é o
 * `?? []`, e ele não é paranoia:
 *
 * no destino, estas colunas são `Json` NOT NULL cujo `@default("[]")` **não
 * chegou ao banco**, por um bug conhecido do Prisma no conector MySQL
 * (prisma#23250 — ver o comentário em `Author.socialLinks` no schema). Sem
 * default no banco, `undefined`/`null` vira violação de NOT NULL e a linha
 * falha NA CARGA. Com o `?? []`, ela entra vazia, que é a semântica correta.
 */
function lista(valor: string[] | null | undefined): string[] {
  return valor ?? [];
}

/**
 * Colunas `Json` ANULÁVEIS precisam de `Prisma.DbNull`, não de `null`.
 *
 * Esta é a pegadinha mais fácil de errar da migração inteira, e ela só aparece
 * em tempo de execução. O Prisma distingue duas coisas que em JavaScript são a
 * mesma: `DbNull` (a coluna está NULA) e `JsonNull` (a coluna contém o literal
 * JSON `null`). Passar `null` cru numa coluna `Json?` é erro.
 *
 * `DbNull` e não `JsonNull` porque é o que preserva o significado: o resto do
 * código pergunta `blocks IS NULL` para saber "esta matéria usa o editor de
 * blocos?". Com `JsonNull` a resposta viraria "sim, e o conteúdo é null" — e
 * toda matéria antiga passaria a renderizar vazia. Mesmo raciocínio de
 * `JSON_COLUMN_NULL` em src/json.ts.
 */
function jsonOuNulo(valor: Prisma.JsonValue | null | undefined) {
  return valor === null || valor === undefined ? Prisma.DbNull : (valor as Prisma.InputJsonValue);
}

/** `Json` NOT NULL cujo default não existe no banco (prisma#23250). */
function jsonOuVazio(
  valor: Prisma.JsonValue | null | undefined,
  padrao: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  return valor === null || valor === undefined ? padrao : (valor as Prisma.InputJsonValue);
}

// -----------------------------------------------------------------------------
// A TABELA DE MIGRAÇÃO
// -----------------------------------------------------------------------------

/**
 * Um passo da migração. `ler` e `escrever` são fechados sobre os dois clients,
 * o que mantém a tipagem ponta a ponta: se um campo mudar de nome ou de tipo em
 * qualquer um dos lados, isto para de compilar.
 */
export interface Passo {
  /** Nome do model, para log e para o script de verificação. */
  nome: string;
  /**
   * Chave de paginação.
   *   'id'        → paginação por CURSOR. Obrigatória nas tabelas grandes:
   *                 `OFFSET 500000` faz o banco contar 500 mil linhas para
   *                 descartá-las, e o custo cresce a cada lote.
   *   'offset'    → paginação por deslocamento. Só para tabelas de junção, que
   *                 têm chave composta (não têm `id`) e são pequenas.
   */
  paginacao: 'id' | 'offset';
  lote?: number;
  contarOrigem: () => Promise<number>;
  /** Devolve um lote da origem. `cursor` é o último `id` já processado. */
  ler: (cursor: string | null, pulo: number, tamanho: number) => Promise<Record<string, unknown>[]>;
  /** Grava o lote no destino. Devolve quantas linhas entraram. */
  escrever: (linhas: never[]) => Promise<number>;
}

/**
 * Exportada para permitir o ENSAIO DO CAMINHO DE ESCRITA sem um Postgres à mão
 * (ver `scripts/rehearse-load.ts`): chamando `montarPassos(destino, destino)`, a
 * mesma tabela de passos faz uma cópia MySQL→MySQL. Isso exercita de verdade a
 * ordem das chaves estrangeiras, as transformações, o `DbNull` e os lotes — tudo
 * menos o driver do Postgres, que é a parte que não tem como dar errado em
 * silêncio (ou conecta, ou não).
 */
export function montarPassos(origem: ClientOrigem, destino: ClientDestino): Passo[] {
  /**
   * Fábrica dos passos "sem transformação nenhuma" — a maioria.
   *
   * O `...linha` é literal: copiamos TODOS os campos escalares da origem. Isso é
   * seguro e é o ponto: `findMany` sem `include` devolve só escalares (nenhuma
   * relação), e a coluna `searchVector` nem aparece, porque é `Unsupported` e o
   * Prisma Client a ignora — exatamente o comportamento de que precisamos aqui.
   *
   * A alternativa (listar campo a campo) pareceria mais explícita e seria pior:
   * um campo novo acrescentado ao schema no futuro seria silenciosamente NÃO
   * copiado, e ninguém descobriria até alguém reclamar do dado faltando.
   */
  const simples = (
    nome: string,
    modeloOrigem: { count: () => Promise<number>; findMany: (a: unknown) => Promise<unknown> },
    modeloDestino: { createMany: (a: unknown) => Promise<{ count: number }> },
    opcoes: { paginacao?: 'id' | 'offset'; lote?: number; ordem?: Record<string, 'asc'> } = {},
  ): Passo => ({
    nome,
    paginacao: opcoes.paginacao ?? 'id',
    lote: opcoes.lote,
    contarOrigem: () => modeloOrigem.count(),
    ler: async (cursor, pulo, tamanho) => {
      const base: Record<string, unknown> = {
        take: tamanho,
        orderBy: opcoes.ordem ?? { id: 'asc' },
      };
      if ((opcoes.paginacao ?? 'id') === 'offset') {
        base.skip = pulo;
      } else if (cursor) {
        base.cursor = { id: cursor };
        base.skip = 1; // o cursor é o último já processado
      }
      return (await modeloOrigem.findMany(base)) as Record<string, unknown>[];
    },
    escrever: async (linhas) => {
      const r = await modeloDestino.createMany({ data: linhas, skipDuplicates: true });
      return r.count;
    },
  });

  /**
   * A ORDEM ABAIXO É A ORDEM DAS CHAVES ESTRANGEIRAS (§6.4 do plano).
   * Inserir fora dela quebra por FK. Não reordene sem redesenhar o grafo.
   */
  return [
    // ---- 1-5: taxonomia e pessoas, que não dependem de nada ----
    simples('Category', origem.category as never, destino.category as never),
    simples('Subcategory', origem.subcategory as never, destino.subcategory as never),

    // Franquia: primeiro model com array (`aliases`).
    {
      ...simples('Franchise', origem.franchise as never, destino.franchise as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.franchise.createMany({
          data: (linhas as unknown as { aliases: string[] }[]).map((l) => ({
            ...l,
            aliases: lista(l.aliases),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },

    simples('Tag', origem.tag as never, destino.tag as never),

    // Autor: dois campos delicados. `expertiseAreas` era array; `socialLinks` é
    // `Json` cujo default não existe no banco (prisma#23250).
    // ⚠ `passwordHash` viaja aqui dentro, no `...l`. É o dado mais sensível da
    // migração: um hash corrompido tranca uma pessoa fora do painel sem disparar
    // erro nenhum. O `verify-migration.ts` compara TODOS eles, não uma amostra.
    {
      ...simples('Author', origem.author as never, destino.author as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.author.createMany({
          data: (
            linhas as unknown as { expertiseAreas: string[]; socialLinks: Prisma.JsonValue }[]
          ).map((l) => ({
            ...l,
            expertiseAreas: lista(l.expertiseAreas),
            socialLinks: jsonOuVazio(l.socialLinks, []),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },

    // ---- 6-8: tópicos ----
    {
      ...simples('Topic', origem.topic as never, destino.topic as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.topic.createMany({
          data: (
            linhas as unknown as { aliases: string[]; emotionalTriggers: string[] }[]
          ).map((l) => ({
            ...l,
            aliases: lista(l.aliases),
            emotionalTriggers: lista(l.emotionalTriggers),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
    simples('TopicFranchise', origem.topicFranchise as never, destino.topicFranchise as never, {
      paginacao: 'offset',
      ordem: { topicId: 'asc' },
    }),
    simples('CommentAuthor', origem.commentAuthor as never, destino.commentAuthor as never),

    // ---- 9-10: artigos ----
    // Lote menor: cada linha traz o corpo inteiro da matéria (`content`) mais os
    // `blocks` em Json. 500 dessas de uma vez é o caminho mais curto para um
    // estouro de memória ou de `max_allowed_packet`.
    {
      ...simples('Article', origem.article as never, destino.article as never, {
        lote: LOTE_PESADO,
      }),
      escrever: async (linhas: never[]) => {
        const r = await destino.article.createMany({
          data: (
            linhas as unknown as {
              tldr: string[];
              blocks: Prisma.JsonValue;
              reviewData: Prisma.JsonValue;
            }[]
          ).map((l) => ({
            ...l,
            tldr: lista(l.tldr),
            // `Json?`: precisa de `DbNull`, não de `null`. Ver `jsonOuNulo`.
            blocks: jsonOuNulo(l.blocks),
            reviewData: jsonOuNulo(l.reviewData),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
    simples('ArticleFranchise', origem.articleFranchise as never, destino.articleFranchise as never, {
      paginacao: 'offset',
      ordem: { articleId: 'asc' },
    }),
    simples('ArticleTag', origem.articleTag as never, destino.articleTag as never, {
      paginacao: 'offset',
      ordem: { articleId: 'asc' },
    }),
    simples('LiveUpdate', origem.liveUpdate as never, destino.liveUpdate as never),

    // ---- 11-12: monetização e calendário ----
    simples('AffiliateOffer', origem.affiliateOffer as never, destino.affiliateOffer as never),
    simples(
      'ArticleAffiliateOffer',
      origem.articleAffiliateOffer as never,
      destino.articleAffiliateOffer as never,
      { paginacao: 'offset', ordem: { articleId: 'asc' } },
    ),
    simples('ReleaseEvent', origem.releaseEvent as never, destino.releaseEvent as never),

    // ---- 13: a série temporal — as duas maiores tabelas do sistema ----
    // Paginação por CURSOR aqui não é preferência: é o que impede o script de
    // ficar progressivamente mais lento à medida que avança.
    {
      ...simples('ScoreSnapshot', origem.scoreSnapshot as never, destino.scoreSnapshot as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.scoreSnapshot.createMany({
          data: (linhas as unknown as { contributions: Prisma.JsonValue }[]).map((l) => ({
            ...l,
            // `contributions` é `Json` NOT NULL na origem e no destino; o `?? {}`
            // cobre a linha legada eventualmente gravada sem ele.
            contributions: jsonOuVazio(l.contributions, {}),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
    {
      ...simples('SignalReading', origem.signalReading as never, destino.signalReading as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.signalReading.createMany({
          data: (linhas as unknown as { rawPayload: Prisma.JsonValue }[]).map((l) => ({
            ...l,
            rawPayload: jsonOuNulo(l.rawPayload),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },

    // ---- 14: saúde e newsletter ----
    simples('ConnectorHealth', origem.connectorHealth as never, destino.connectorHealth as never),
    {
      ...simples('Subscriber', origem.subscriber as never, destino.subscriber as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.subscriber.createMany({
          data: (linhas as unknown as { preferredCategories: string[] }[]).map((l) => ({
            ...l,
            preferredCategories: lista(l.preferredCategories),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },

    // ---- 15: push ----
    {
      ...simples('PushSubscription', origem.pushSubscription as never, destino.pushSubscription as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.pushSubscription.createMany({
          data: (
            linhas as unknown as { preferredCategories: string[]; preferredFranchises: string[] }[]
          ).map((l) => ({
            ...l,
            preferredCategories: lista(l.preferredCategories),
            preferredFranchises: lista(l.preferredFranchises),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
    simples('PushNotification', origem.pushNotification as never, destino.pushNotification as never),
    simples('PushDelivery', origem.pushDelivery as never, destino.pushDelivery as never),

    // ---- 16-17: comunidade ----
    simples('FranchiseFollow', origem.franchiseFollow as never, destino.franchiseFollow as never),
    simples('StaffSession', origem.staffSession as never, destino.staffSession as never),
    simples('CommentSession', origem.commentSession as never, destino.commentSession as never),

    // ---- 18: comentários — ⚠ AUTO-REFERÊNCIA ----
    // `parentId` aponta para outro `Comment`. Ordenamos por `createdAt` ASCENDENTE
    // porque uma resposta é sempre criada DEPOIS do comentário que responde: assim
    // o pai já está no destino quando a resposta chega.
    // (Se algum registro legado violar isso, o plano B do §6.4 é inserir tudo com
    // `parentId = null` e vincular num segundo passo. O `verify-migration.ts`
    // detecta o caso ao contar órfãos.)
    simples('Comment', origem.comment as never, destino.comment as never, {
      paginacao: 'offset',
      ordem: { createdAt: 'asc' },
      lote: LOTE_PESADO,
    }),

    // ---- 19: instrumentação ----
    {
      ...simples('PipelineEvent', origem.pipelineEvent as never, destino.pipelineEvent as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.pipelineEvent.createMany({
          data: (linhas as unknown as { payload: Prisma.JsonValue }[]).map((l) => ({
            ...l,
            payload: jsonOuVazio(l.payload, {}),
          })) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
    simples('PipelineRun', origem.pipelineRun as never, destino.pipelineRun as never),
    {
      ...simples('AuditLog', origem.auditLog as never, destino.auditLog as never),
      escrever: async (linhas: never[]) => {
        const r = await destino.auditLog.createMany({
          data: (linhas as unknown as { before: Prisma.JsonValue; after: Prisma.JsonValue }[]).map(
            (l) => ({ ...l, before: jsonOuNulo(l.before), after: jsonOuNulo(l.after) }),
          ) as never,
          skipDuplicates: true,
        });
        return r.count;
      },
    },
  ];
}

// -----------------------------------------------------------------------------
// GUARDAS DE AMBIENTE
// -----------------------------------------------------------------------------

/**
 * Confere ANTES de escrever qualquer linha:
 *   - a origem é mesmo PostgreSQL e o destino é mesmo MySQL/MariaDB;
 *   - os dois não são o mesmo banco;
 *   - se o destino for produção, exige confirmação explícita.
 *
 * Parece excesso de zelo. Não é: este script escreve o acervo inteiro do site, e
 * o erro de configuração mais provável — apontar as duas variáveis para o mesmo
 * lugar — é justamente o que nenhuma checagem de tipo pega.
 */
async function guardas(origem: ClientOrigem, destino: ClientDestino, executar: boolean) {
  const vOrigem = (await origem.$queryRaw<{ v: string }[]>`SELECT version() AS v`)[0]?.v ?? '';
  const vDestino = (await destino.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`)[0]?.v ?? '';

  if (!/postgres/i.test(vOrigem)) {
    throw new Error(`ORIGEM não parece PostgreSQL: "${vOrigem}". Confira SOURCE_DATABASE_URL.`);
  }
  if (!/mariadb|mysql/i.test(vDestino)) {
    throw new Error(`DESTINO não parece MySQL/MariaDB: "${vDestino}". Confira DATABASE_URL.`);
  }

  const bancoDestino =
    (await destino.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`)[0]?.db ?? '?';

  console.log(`  origem : ${vOrigem.split(' ').slice(0, 2).join(' ')}`);
  console.log(`  destino: ${vDestino} — schema "${bancoDestino}"`);

  if (executar && bancoDestino === BANCO_DESTINO_PRODUCAO && process.env.CONFIRMO_PRODUCAO !== '1') {
    throw new Error(
      `RECUSANDO ESCREVER: o destino é "${bancoDestino}", o banco de PRODUÇÃO.\n` +
        'Se esta é a janela de corte combinada, rode:\n' +
        '    CONFIRMO_PRODUCAO=1 npm run db:migrate-data -- --executar',
    );
  }
}

// -----------------------------------------------------------------------------
// EXECUÇÃO
// -----------------------------------------------------------------------------

export async function migrarPasso(
  passo: Passo,
  executar: boolean,
): Promise<{ lidas: number; escritas: number }> {
  const total = await passo.contarOrigem();
  const tamanho = passo.lote ?? LOTE;

  if (total === 0) {
    console.log(`  ${passo.nome.padEnd(24)} origem vazia`);
    return { lidas: 0, escritas: 0 };
  }

  let cursor: string | null = null;
  let pulo = 0;
  let lidas = 0;
  let escritas = 0;

  for (;;) {
    const linhas = await passo.ler(cursor, pulo, tamanho);
    if (linhas.length === 0) break;

    lidas += linhas.length;
    if (executar) {
      escritas += await passo.escrever(linhas as never[]);
    }

    if (passo.paginacao === 'id') {
      cursor = linhas[linhas.length - 1]!.id as string;
    } else {
      pulo += linhas.length;
    }

    if (linhas.length < tamanho) break;
    process.stdout.write(`  ${passo.nome.padEnd(24)} ${lidas}/${total}\r`);
  }

  const rotulo = executar ? `${escritas} gravadas` : 'ENSAIO (nada gravado)';
  console.log(`  ${passo.nome.padEnd(24)} ${lidas}/${total} lidas · ${rotulo}      `);
  return { lidas, escritas };
}

async function main() {
  const args = process.argv.slice(2);
  const executar = args.includes('--executar');
  const ensaio = args.includes('--ensaio');

  if (executar === ensaio) {
    // Sem padrão: escrever o acervo inteiro não pode ser o que acontece quando
    // alguém roda o comando sem pensar. Exigir a escolha É a proteção.
    console.error(
      'Escolha o modo, explicitamente:\n' +
        '  --ensaio    lê tudo da origem e NÃO grava nada (mede o tempo da janela)\n' +
        '  --executar  copia de verdade',
    );
    process.exit(2);
  }

  if (!process.env.SOURCE_DATABASE_URL) {
    console.error('Falta SOURCE_DATABASE_URL (a URL da Neon, somente leitura).');
    process.exit(2);
  }

  const origem = new ClientOrigem();
  const destino = new ClientDestino();

  try {
    console.log(`\n=== MIGRAÇÃO DE DADOS — modo ${executar ? 'EXECUTAR' : 'ENSAIO'} ===\n`);

    // A cobertura é conferida ANTES das guardas de propósito: ela não toca em
    // banco nenhum (lê o `dmmf`, que é estático), e um erro de programação deve
    // aparecer antes de qualquer conexão, não depois.
    const passos = montarPassos(origem, destino);
    conferirCobertura(passos);

    await guardas(origem, destino, executar);

    console.log(`\n${passos.length} tabelas, na ordem das chaves estrangeiras:\n`);
    const inicio = Date.now();
    let lidas = 0;
    let escritas = 0;

    for (const passo of passos) {
      const r = await migrarPasso(passo, executar);
      lidas += r.lidas;
      escritas += r.escritas;
    }

    const segundos = Math.round((Date.now() - inicio) / 1000);
    console.log(`\n${lidas} linhas lidas, ${escritas} gravadas, em ${segundos}s.`);

    if (executar) {
      console.log(
        '\nPRÓXIMOS PASSOS, nesta ordem:\n' +
          '  1. npm run db:fulltext       (os índices de busca — o db push não os cria)\n' +
          '  2. npm run db:verify-migration  (o critério de aceite do corte, §6.5)\n' +
          '  Só depois dos dois verdes é que se vira a chave da DATABASE_URL.',
      );
    } else {
      console.log(
        '\nEnsaio concluído. O tempo acima é a base para dimensionar a janela de\n' +
          'corte — some a verificação e uma folga generosa antes de combinar horário.',
      );
    }
  } finally {
    await origem.$disconnect();
    await destino.$disconnect();
  }
}

/**
 * Confere que TODO model do schema aparece na lista de passos.
 *
 * POR QUE ISTO EXISTE: o risco mais caro deste script não é copiar errado — é
 * ESQUECER uma tabela. Copiar errado costuma explodir; esquecer é silencioso, e
 * só aparece quando alguém procura um dado que sumiu, possivelmente depois de a
 * Neon ter sido desligada. A lista de models vem do próprio Prisma (`dmmf`), não
 * de uma constante escrita à mão — uma constante teria exatamente o mesmo
 * problema que se quer evitar.
 */
export function conferirCobertura(passos: Passo[]) {
  const noSchema = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
  const nosPassos = passos.map((p) => p.nome).sort();
  const faltando = noSchema.filter((m) => !nosPassos.includes(m));
  const sobrando = nosPassos.filter((m) => !noSchema.includes(m));

  if (faltando.length > 0 || sobrando.length > 0) {
    throw new Error(
      'A lista de passos não cobre o schema.\n' +
        (faltando.length ? `  NÃO seriam copiadas: ${faltando.join(', ')}\n` : '') +
        (sobrando.length ? `  Não existem no schema: ${sobrando.join(', ')}\n` : ''),
    );
  }
  console.log(`  cobertura: ${noSchema.length}/${noSchema.length} models do schema`);
}

/**
 * NOTA SOBRE A ORDEM DOS ÍNDICES FULLTEXT — leia antes de "otimizar" o roteiro.
 *
 * É tentador criar os índices ANTES da carga, para não pagar um rebuild depois.
 * Funciona, e nesse caso o `db:fulltext` numa tabela vazia é instantâneo — os
 * índices são alimentados linha a linha durante os `createMany`.
 *
 * O QUE NÃO PODE é criar os índices DEPOIS e presumir que estão populados. Há um
 * comportamento do InnoDB, reproduzido neste servidor, em que recriar todos os
 * índices FULLTEXT de uma tabela que já tem linhas deixa o PRIMEIRO deles VAZIO
 * — e o primeiro é justamente `Article_fts_all`, o índice do `WHERE` da busca. O
 * sintoma seria a busca não achar nada, em silêncio, para sempre.
 *
 * Por isso o `db:fulltext` roda `OPTIMIZE TABLE` e faz uma sondagem real antes
 * de declarar sucesso. Rode-o DEPOIS da carga: mais lento, e à prova do bug.
 */
function ordemDosIndicesFulltext() {}
void ordemDosIndicesFulltext;

/**
 * `main()` só roda quando este arquivo é EXECUTADO, nunca quando é importado.
 *
 * Sem esta guarda, `scripts/rehearse-load.ts` — que importa `montarPassos` para
 * ensaiar a carga — dispararia uma migração de verdade no instante do `import`.
 * É o tipo de efeito colateral que ninguém espera de uma linha de importação.
 */
const executadoDiretamente = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/migrate-data.ts');

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error('\n=== MIGRAÇÃO INTERROMPIDA ===');
    console.error(erro instanceof Error ? erro.message : erro);
    console.error(
      '\nA ORIGEM NÃO FOI ALTERADA — este script só lê dela.\n' +
        'Para recomeçar: corrija a causa e rode de novo. Os `createMany` usam\n' +
        '`skipDuplicates`, então o que já entrou é ignorado e a cópia continua.',
    );
    process.exit(1);
  });
}
