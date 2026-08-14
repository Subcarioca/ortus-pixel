/**
 * =============================================================================
 * ENSAIO DO CAMINHO DE ESCRITA DA MIGRAÇÃO — sem precisar de um PostgreSQL
 * =============================================================================
 *
 *   npm run db:rehearse-load
 *
 * ⚠ DESTRUTIVO: TRUNCA o banco apontado por `DATABASE_URL` e o reconstrói a
 * partir do que leu. Recusa-se a rodar contra o banco de produção.
 *
 * -----------------------------------------------------------------------------
 * O PROBLEMA QUE ESTE SCRIPT RESOLVE
 * -----------------------------------------------------------------------------
 * `migrate-data.ts` só pode ser testado de ponta a ponta com um PostgreSQL
 * povoado do outro lado — e a única origem real é a produção, que ninguém vai
 * usar para ensaiar. Sem alternativa, a tentação é "testar em produção", no dia
 * do corte, que é exatamente quando não se quer descobrir nada.
 *
 * A saída: a parte perigosa da migração não é LER. É ESCREVER. Ler é um
 * `findMany`; se a conexão com a Neon não funcionar, isso aparece no primeiro
 * segundo e não corrompe nada. É na escrita que moram os erros silenciosos:
 *
 *   - ordem de chave estrangeira trocada;
 *   - `Prisma.DbNull` vs. `null` nas colunas `Json?`;
 *   - o `?? []` faltando numa coluna `Json` NOT NULL sem default no banco;
 *   - `createMany` ignorando `id`/`createdAt`/`updatedAt` explícitos;
 *   - lote grande demais estourando o `max_allowed_packet`.
 *
 * Este script exercita TODOS eles, usando **a mesma tabela de passos** do
 * `migrate-data.ts` (importada, não copiada — uma cópia divergiria no primeiro
 * ajuste e o ensaio passaria a testar outra coisa). Ele chama
 * `montarPassos(destino, destino)`: uma cópia MySQL→MySQL, em que a origem é o
 * próprio banco povoado por `db:seed`.
 *
 * O QUE ELE **NÃO** COBRE, dito com todas as letras:
 *   - o driver do PostgreSQL e a conexão com a Neon;
 *   - a conversão `text[]` → array JS, que acontece na leitura. É um repasse (o
 *     client do Postgres já devolve `string[]`), mas não é exercitado aqui;
 *   - o volume real de dados. O tempo medido aqui NÃO dimensiona a janela de
 *     corte; para isso existe `migrate-data.ts --ensaio` contra a Neon.
 */

import { PrismaClient, Prisma } from '@prisma/client';

import { montarPassos, conferirCobertura, migrarPasso } from './migrate-data';

const prisma = new PrismaClient();

const BANCO_DE_PRODUCAO = 'u754239208_ortuspixel';

/** Instantâneo do que existe antes de truncar, para comparar depois. */
interface Instantaneo {
  contagens: Record<string, number>;
  somaConteudo: number;
  hashesDeSenha: Record<string, string | null>;
  tldrPorArtigo: Record<string, number>;
}

async function tirarInstantaneo(): Promise<Instantaneo> {
  const contagens: Record<string, number> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const chave = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const m = prisma as unknown as Record<string, { count: () => Promise<number> }>;
    contagens[model.name] = await m[chave]!.count();
  }

  const soma = await prisma.$queryRaw<{ s: bigint | null }[]>`
    SELECT SUM(CHAR_LENGTH(\`content\`)) AS s FROM \`Article\``;

  const autores = await prisma.author.findMany({ select: { id: true, passwordHash: true } });
  const hashesDeSenha: Record<string, string | null> = {};
  for (const a of autores) hashesDeSenha[a.id] = a.passwordHash;

  const artigos = await prisma.article.findMany({ select: { id: true, tldr: true } });
  const tldrPorArtigo: Record<string, number> = {};
  for (const a of artigos) {
    tldrPorArtigo[a.id] = Array.isArray(a.tldr) ? a.tldr.length : -1;
  }

  return { contagens, somaConteudo: Number(soma[0]?.s ?? 0), hashesDeSenha, tldrPorArtigo };
}

/**
 * Lê TUDO para a memória antes de truncar.
 *
 * Só é aceitável porque este ensaio roda sobre o banco de desenvolvimento, com
 * dados de `db:seed` (dezenas de linhas). O `migrate-data.ts` de verdade nunca
 * faz isto — ele lê em lotes, exatamente para não depender da memória.
 */
async function lerTudo(): Promise<Record<string, Record<string, unknown>[]>> {
  const dados: Record<string, Record<string, unknown>[]> = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const chave = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const m = prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>;
    dados[model.name] = (await m[chave]!.findMany()) as Record<string, unknown>[];
  }
  return dados;
}

/**
 * Trunca todas as tabelas.
 *
 * `SET FOREIGN_KEY_CHECKS = 0` porque não existe ordem de `TRUNCATE` que agrade
 * a todas as FKs de um grafo com auto-referência (`Comment.parentId`). É seguro
 * aqui e SÓ aqui: estamos esvaziando tudo, então não há integridade a preservar
 * — e a checagem é religada logo em seguida, na mesma conexão.
 */
async function truncarTudo() {
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const model of Prisma.dmmf.datamodel.models) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${model.name}\``);
    }
  } finally {
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  }
}

function comparar(rotulo: string, antes: unknown, depois: unknown) {
  if (antes !== depois) {
    throw new Error(`${rotulo}\n     antes : ${String(antes)}\n     depois: ${String(depois)}`);
  }
}

async function main() {
  const banco =
    (await prisma.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`)[0]?.db ?? '?';

  if (banco === BANCO_DE_PRODUCAO) {
    throw new Error(
      `RECUSANDO RODAR: "${banco}" é o banco de PRODUÇÃO e este script TRUNCA tudo.\n` +
        'Este ensaio só faz sentido contra o banco de desenvolvimento.',
    );
  }

  console.log(`\n=== ENSAIO DO CAMINHO DE ESCRITA — banco "${banco}" ===\n`);

  const antes = await tirarInstantaneo();
  const totalAntes = Object.values(antes.contagens).reduce((a, b) => a + b, 0);
  if (totalAntes === 0) {
    throw new Error('O banco está vazio. Rode `npm run db:seed` antes do ensaio.');
  }
  console.log(`Instantâneo: ${totalAntes} linhas em ${Object.keys(antes.contagens).length} tabelas.`);
  console.log(`  soma de Article.content: ${antes.somaConteudo} caracteres`);

  const dados = await lerTudo();
  console.log('Dados carregados para a memória.');

  await truncarTudo();
  const vazio = await prisma.article.count();
  console.log(`Banco truncado (Article agora tem ${vazio} linhas).\n`);

  // ---- A parte que importa: recarregar com A TABELA DE PASSOS DE VERDADE ----
  //
  // A "origem" é um objeto que finge ser um Prisma Client, devolvendo as linhas
  // que guardamos em memória. Isso mantém os `escrever` — que são o código real
  // sendo testado — exatamente como estão no `migrate-data.ts`.
  const origemFalsa = new Proxy(
    {},
    {
      get(_alvo, prop: string) {
        const nome = prop.charAt(0).toUpperCase() + prop.slice(1);
        const linhas = dados[nome] ?? [];
        return {
          count: async () => linhas.length,
          findMany: async (args: { take: number; skip?: number; cursor?: { id: string } }) => {
            // Reproduz a semântica de cursor/offset que os passos esperam.
            let inicio = args.skip ?? 0;
            if (args.cursor) {
              const i = linhas.findIndex((l) => l.id === args.cursor!.id);
              inicio = i + (args.skip ?? 0);
            }
            return linhas.slice(inicio, inicio + args.take);
          },
        };
      },
    },
  );

  const passos = montarPassos(origemFalsa as never, prisma);
  conferirCobertura(passos);
  console.log('');

  let escritas = 0;
  for (const passo of passos) {
    escritas += (await migrarPasso(passo, true)).escritas;
  }
  console.log(`\n${escritas} linhas regravadas.\n`);

  // ---- Conferência ----
  console.log('=== CONFERINDO ===\n');
  const depois = await tirarInstantaneo();

  for (const [model, n] of Object.entries(antes.contagens)) {
    comparar(`contagem de ${model}`, n, depois.contagens[model]);
  }
  console.log(`  ✓ contagem idêntica nas ${Object.keys(antes.contagens).length} tabelas`);

  comparar('soma de Article.content (detector de truncamento)', antes.somaConteudo, depois.somaConteudo);
  console.log(`  ✓ soma de Article.content preservada (${depois.somaConteudo} caracteres)`);

  for (const [id, hash] of Object.entries(antes.hashesDeSenha)) {
    comparar(`passwordHash do autor ${id}`, hash, depois.hashesDeSenha[id]);
  }
  console.log(`  ✓ passwordHash idêntico nas ${Object.keys(antes.hashesDeSenha).length} contas`);

  for (const [id, n] of Object.entries(antes.tldrPorArtigo)) {
    comparar(`tldr do artigo ${id}`, n, depois.tldrPorArtigo[id]);
    if (depois.tldrPorArtigo[id] === -1) {
      throw new Error(`tldr do artigo ${id} não voltou como array.`);
    }
  }
  console.log(`  ✓ tldr continua array em ${Object.keys(antes.tldrPorArtigo).length} artigos`);

  // `createMany` respeitou os timestamps explícitos? Se não respeitar,
  // `updatedAt` vira "agora" em tudo — e `updatedAt` alimenta o `lastModified`
  // do sitemap.xml, ou seja, o Google seria avisado de que o acervo inteiro
  // mudou no mesmo instante. É a checagem que o plano pede em §6.4.
  const original = dados.Article?.[0];
  if (original) {
    const regravado = await prisma.article.findUnique({
      where: { id: original.id as string },
      select: { createdAt: true, updatedAt: true, publishedAt: true },
    });
    comparar(
      'Article.createdAt preservado',
      (original.createdAt as Date).toISOString(),
      regravado!.createdAt.toISOString(),
    );
    comparar(
      'Article.updatedAt preservado',
      (original.updatedAt as Date).toISOString(),
      regravado!.updatedAt.toISOString(),
    );
    console.log('  ✓ createdAt e updatedAt preservados (sitemap.xml intacto)');
  }

  console.log('\n=== ENSAIO OK — o caminho de escrita da migração está correto. ===');
  console.log('Lembre: rode `npm run db:fulltext` depois, os índices foram truncados junto.');
}

main()
  .catch((erro) => {
    console.error('\n=== ENSAIO FALHOU ===\n');
    console.error(erro instanceof Error ? erro.message : erro);
    console.error('\n⚠ O banco de desenvolvimento pode ter ficado incompleto.');
    console.error('  Recupere com: npm run db:push && npm run db:seed && npm run db:fulltext');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
