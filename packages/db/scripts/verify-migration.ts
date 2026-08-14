/**
 * =============================================================================
 * VERIFICAÇÃO DA MIGRAÇÃO — o critério de aceite do corte
 * =============================================================================
 *
 *   SOURCE_DATABASE_URL="postgresql://..." npm run db:verify-migration
 *
 * Passo T18 do plano (seção 6.5). **Sem este script verde, não se vira a chave.**
 *
 * -----------------------------------------------------------------------------
 * POR QUE CONTAR LINHAS NÃO BASTA
 * -----------------------------------------------------------------------------
 * Contagem igual prova que nada se perdeu. Não prova que nada se CORROMPEU — e
 * é a corrupção que dói, porque ela é silenciosa. Os três casos que motivaram
 * cada bloco abaixo:
 *
 *   (a) uma tabela esquecida         → contagem pega na hora;
 *   (b) um `@db.Text` faltando       → contagem passa, e o corpo das matérias
 *                                      chega TRUNCADO. Pior ainda porque este
 *                                      servidor não está em `sql_mode` estrito:
 *                                      ele corta em silêncio, sem erro nenhum.
 *                                      Quem pega é `SUM(LENGTH(content))`;
 *   (c) um `passwordHash` alterado   → contagem passa, e a redação inteira
 *                                      descobre no dia seguinte que não entra
 *                                      mais no painel.
 *
 * -----------------------------------------------------------------------------
 * ABORTA NA PRIMEIRA DIVERGÊNCIA — de propósito
 * -----------------------------------------------------------------------------
 * Um relatório com trinta linhas vermelhas convida a decidir quais "não são
 * graves". Numa madrugada de janela de corte, esse julgamento é ruim. Ou está
 * tudo certo, ou o corte não acontece.
 */

import { PrismaClient as ClientOrigem } from '../../../node_modules/.prisma/client-postgres';
import { PrismaClient as ClientDestino, Prisma as PrismaDestino } from '@prisma/client';

const origem = new ClientOrigem();
const destino = new ClientDestino();

let conferidas = 0;

class Divergencia extends Error {}

/** Compara dois valores e aborta se diferirem. */
/**
 * Normaliza para Number antes de comparar. Não é só `bigint`: `SUM()` no MySQL
 * chega como objeto `Decimal` (do `decimal.js` que o Prisma usa por baixo),
 * nunca `bigint` nem `number` puro — `typeof` dá `"object"`. Um objeto nunca é
 * `===` a um primitivo, então a checagem antiga FALHAVA SEMPRE nessa
 * comparação especificamente, e sempre pelo mesmo motivo: tipo, não valor.
 * `Number(x)` funciona igual para `bigint`, `Decimal` (que implementa
 * `valueOf`/`toString`) e `number` — por isso normalizamos os dois lados por
 * ele, em vez de checar `typeof` caso a caso.
 */
function paraNumero(valor: unknown): unknown {
  if (typeof valor === 'bigint') return Number(valor);
  if (typeof valor === 'object' && valor !== null && 'toString' in valor) {
    const n = Number(valor.toString());
    if (!Number.isNaN(n)) return n;
  }
  return valor;
}

function conferir(rotulo: string, na_origem: unknown, no_destino: unknown, detalhe?: string) {
  conferidas += 1;
  const a = paraNumero(na_origem);
  const b = paraNumero(no_destino);

  if (a !== b) {
    throw new Divergencia(
      `${rotulo}\n     origem : ${String(a)}\n     destino: ${String(b)}` +
        (detalhe ? `\n     ${detalhe}` : ''),
    );
  }
  console.log(`  ✓ ${rotulo.padEnd(52)} ${String(a)}`);
}

// -----------------------------------------------------------------------------
// (a) CONTAGEM POR TABELA
// -----------------------------------------------------------------------------

async function contagens() {
  console.log('\n(a) CONTAGEM POR TABELA\n');

  // A lista vem do `dmmf`, não de uma constante escrita à mão: uma constante
  // teria o mesmo problema que o script existe para detectar — alguém acrescenta
  // um model e esquece de incluí-lo na verificação.
  const models = PrismaDestino.dmmf.datamodel.models.map((m) => m.name);

  for (const model of models) {
    // O nome do model no client é camelCase ("pushSubscription" para
    // "PushSubscription"). É a única tradução necessária.
    const chave = model.charAt(0).toLowerCase() + model.slice(1);
    const o = origem as unknown as Record<string, { count: () => Promise<number> }>;
    const d = destino as unknown as Record<string, { count: () => Promise<number> }>;

    const [na, no] = await Promise.all([o[chave]!.count(), d[chave]!.count()]);
    conferir(`${model}`, na, no);
  }
}

// -----------------------------------------------------------------------------
// (b) INTEGRIDADE DE NEGÓCIO
// -----------------------------------------------------------------------------

async function integridade() {
  console.log('\n(b) INTEGRIDADE DE NEGÓCIO\n');

  conferir(
    'Artigos publicados',
    await origem.article.count({ where: { status: 'published' } }),
    await destino.article.count({ where: { status: 'published' } }),
  );

  // ⚠ O DETECTOR DE TRUNCAMENTO. Se este número divergir, alguma anotação
  // `@db.Text`/`@db.MediumText` está faltando no schema novo e o corpo das
  // matérias chegou cortado. É o mais importante de todo o bloco (b).
  const somaOrigem =
    (await origem.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(LENGTH("content")) AS s FROM "Article"`)[0]
      ?.s ?? 0n;
  const somaDestino =
    (await destino.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(CHAR_LENGTH(\`content\`)) AS s FROM \`Article\``)[0]
      ?.s ?? 0n;
  // `CHAR_LENGTH` no MySQL e `LENGTH` no Postgres: os dois contam CARACTERES.
  // (`LENGTH` do MySQL contaria BYTES, e qualquer acento faria a comparação
  // falhar sem que nada estivesse errado.)
  conferir(
    'Soma do tamanho de Article.content',
    somaOrigem,
    somaDestino,
    'DIVERGIU = truncamento. Falta @db.Text/@db.MediumText em alguma coluna.',
  );

  // SQL cru dos dois lados, e não o filtro tipado do Prisma: a distinção
  // `Prisma.DbNull` (SQL NULL) vs `Prisma.JsonNull` (JSON "null") só existe no
  // Postgres, e a forma certa de expressá-la (`{ blocks: { not: DbNull } }`,
  // não `{ NOT: { blocks: DbNull } }`) é fácil de errar — foi como este script
  // quebrou na primeira versão. `IS NOT NULL` em SQL puro é a MESMA pergunta
  // nos dois motores, sem nenhuma dessas armadilhas de tipagem.
  const blocksOrigem =
    (await origem.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Article" WHERE "blocks" IS NOT NULL`)[0]
      ?.n ?? 0n;
  const blocksDestino =
    (await destino.$queryRawUnsafe<{ n: unknown }[]>(
      'SELECT COUNT(*) AS n FROM `Article` WHERE `blocks` IS NOT NULL',
    ))[0]?.n ?? 0;
  conferir('Artigos com blocks preenchido', blocksOrigem, blocksDestino);

  for (const status of ['pending', 'approved', 'rejected', 'spam']) {
    conferir(
      `Comentários com status "${status}"`,
      await origem.comment.count({ where: { status } }),
      await destino.comment.count({ where: { status } }),
    );
  }

  conferir(
    'Comentários que são resposta (parentId)',
    await origem.comment.count({ where: { NOT: { parentId: null } } }),
    await destino.comment.count({ where: { NOT: { parentId: null } } }),
  );

  // Órfão = resposta cujo pai não veio junto. No destino a FK impediria a
  // inserção, então isto é mais uma prova de que a ordem por `createdAt`
  // funcionou do que uma checagem de integridade referencial.
  const orfaos = await destino.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM \`Comment\` c
    WHERE c.\`parentId\` IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM \`Comment\` p WHERE p.\`id\` = c.\`parentId\`)`;
  conferir('Comentários órfãos no destino (deve ser 0)', 0, Number(orfaos[0]!.n));

  conferir(
    'Artigos marcados com link de afiliado',
    await origem.article.count({ where: { hasAffiliateLinks: true } }),
    await destino.article.count({ where: { hasAffiliateLinks: true } }),
  );

  // A relação entre contador e realidade precisa ser a MESMA dos dois lados —
  // não precisa estar correta. Se `followerCount` já divergia de `FranchiseFollow`
  // antes da migração (o plano avisa que pode), o que não se pode é a migração
  // MUDAR essa diferença.
  const somaSeguidoresOrigem = (await origem.franchise.aggregate({ _sum: { followerCount: true } }))
    ._sum.followerCount;
  const somaSeguidoresDestino = (await destino.franchise.aggregate({ _sum: { followerCount: true } }))
    ._sum.followerCount;
  conferir('Soma de Franchise.followerCount', somaSeguidoresOrigem, somaSeguidoresDestino);

  // ---- Os arrays viraram Json: a FORMA sobreviveu? ----
  // Amostra, e não varredura: o que se testa aqui é a TRANSFORMAÇÃO, que ou está
  // certa para todas as linhas ou errada para todas. Vinte linhas provam o caso.
  const amostra = await origem.article.findMany({
    where: { NOT: { tldr: { isEmpty: true } } },
    select: { id: true, tldr: true },
    take: 20,
    orderBy: { id: 'asc' },
  });

  for (const art of amostra) {
    const noDestino = await destino.article.findUnique({
      where: { id: art.id },
      select: { tldr: true },
    });
    const chegou = noDestino?.tldr;

    if (!Array.isArray(chegou)) {
      throw new Divergencia(
        `Article.tldr do artigo ${art.id} não voltou como ARRAY do destino.\n` +
          `     recebido: ${JSON.stringify(chegou)}`,
      );
    }
    conferir(`tldr do artigo ${art.id.slice(0, 8)}… (itens)`, art.tldr.length, chegou.length);
  }
}

// -----------------------------------------------------------------------------
// (c) SESSÕES E SENHAS — o requisito explícito do dono do site
// -----------------------------------------------------------------------------

async function sessoesESenhas() {
  console.log('\n(c) SESSÕES E SENHAS\n');

  const agora = new Date();

  // O token vive no NAVEGADOR; o banco guarda só o SHA-256. Copiar as linhas
  // preserva os logins — ninguém da redação é deslogado pela migração.
  conferir(
    'Sessões de redação ainda válidas',
    await origem.staffSession.count({ where: { expiresAt: { gt: agora } } }),
    await destino.staffSession.count({ where: { expiresAt: { gt: agora } } }),
  );
  conferir(
    'Sessões de leitor ainda válidas',
    await origem.commentSession.count({ where: { expiresAt: { gt: agora } } }),
    await destino.commentSession.count({ where: { expiresAt: { gt: agora } } }),
  );

  // ⚠ TODAS as contas, não uma amostra. As senhas foram trocadas por pessoas de
  // verdade; um hash corrompido tranca alguém para fora do painel e NÃO dispara
  // constraint nenhuma. É barato comparar tudo e caro descobrir depois.
  const contas = await origem.author.findMany({
    select: { id: true, email: true, passwordHash: true, isActive: true },
    orderBy: { id: 'asc' },
  });

  let comSenha = 0;
  for (const conta of contas) {
    const noDestino = await destino.author.findUnique({
      where: { id: conta.id },
      select: { passwordHash: true, email: true },
    });

    if (!noDestino) {
      throw new Divergencia(`Autor ${conta.email} não existe no destino.`);
    }

    // `null` é estado LEGÍTIMO ("assina matéria, mas não tem acesso ao painel").
    // Por isso comparamos os dois valores em vez de exigir que exista: o erro a
    // pegar é o hash que VIROU null, não o que já era.
    if (conta.passwordHash !== noDestino.passwordHash) {
      throw new Divergencia(
        `passwordHash de ${conta.email} DIFERE entre origem e destino.\n` +
          `     origem : ${conta.passwordHash === null ? 'NULL' : `${conta.passwordHash.length} caracteres`}\n` +
          `     destino: ${noDestino.passwordHash === null ? 'NULL' : `${noDestino.passwordHash.length} caracteres`}\n` +
          '     Um hash truncado ou nulo tranca esta pessoa fora do painel.',
      );
    }

    if (conta.email !== noDestino.email) {
      throw new Divergencia(`E-mail de login de ${conta.email} difere no destino.`);
    }

    if (conta.passwordHash !== null) comSenha += 1;
    conferidas += 1;
  }

  console.log(
    `  ✓ ${'passwordHash idêntico em todas as contas'.padEnd(52)} ${contas.length} (${comSenha} com senha)`,
  );
}

// -----------------------------------------------------------------------------

async function main() {
  console.log('\n=== VERIFICAÇÃO DA MIGRAÇÃO ===');

  const vOrigem = (await origem.$queryRaw<{ v: string }[]>`SELECT version() AS v`)[0]?.v ?? '';
  const vDestino = (await destino.$queryRaw<{ v: string }[]>`SELECT VERSION() AS v`)[0]?.v ?? '';
  console.log(`  origem : ${vOrigem.split(' ').slice(0, 2).join(' ')}`);
  console.log(`  destino: ${vDestino}`);

  await contagens();
  await integridade();
  await sessoesESenhas();

  console.log(`\n=== ${conferidas} conferências, nenhuma divergência. ===`);
  console.log(
    'Falta ainda o item (d) da seção 6.5, que NÃO é automatizável: as 30 buscas\n' +
      'reais comparadas lado a lado com a produção atual. A busca é a única perda\n' +
      'permanente desta migração e a única que só aparece depois do corte, quando\n' +
      'o rollback já ficou caro. Não pule.',
  );
}

main()
  .catch((erro) => {
    if (erro instanceof Divergencia) {
      console.error('\n=== DIVERGÊNCIA — NÃO VIRE A CHAVE ===\n');
      console.error(`  ${erro.message}\n`);
      console.error(
        'A origem continua intacta e o site segue nela. Corrija a causa,\n' +
          'TRUNQUE o destino, rode a migração de novo e verifique outra vez.',
      );
    } else {
      console.error('\n=== ERRO NA VERIFICAÇÃO ===\n');
      console.error(erro);
    }
    process.exit(1);
  })
  .finally(async () => {
    await origem.$disconnect();
    await destino.$disconnect();
  });
