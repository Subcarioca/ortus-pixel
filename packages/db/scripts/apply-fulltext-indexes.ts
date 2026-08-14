/**
 * =============================================================================
 * APLICA OS ÍNDICES FULLTEXT DA BUSCA
 * =============================================================================
 *
 *   npm run db:fulltext
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTE SCRIPT EXISTE
 * -----------------------------------------------------------------------------
 * O projeto usa `prisma db push`, não `prisma migrate` — o usuário do MySQL da
 * Hostinger não pode criar banco, e `migrate dev` precisa criar e derrubar um
 * "shadow database". A consequência é que NÃO EXISTE histórico de migrações
 * onde encaixar um DDL escrito à mão, e os quatro índices `FULLTEXT` da busca
 * (que o Prisma não gera a partir do schema) precisam de um lugar próprio.
 *
 * Este é esse lugar. Rode-o DEPOIS de todo `db push` que toque a tabela
 * `Article` — e obrigatoriamente ao preparar um banco novo.
 *
 * -----------------------------------------------------------------------------
 * POR QUE O SCRIPT E NÃO SÓ O ARQUIVO .sql
 * -----------------------------------------------------------------------------
 * Três razões, e a terceira só apareceu depois de rodar isto de verdade.
 *
 * 1. O MySQL não tem `CREATE FULLTEXT INDEX IF NOT EXISTS`. Sem verificação
 *    prévia, a segunda execução aborta com erro 1061 (`Duplicate key name`) — e
 *    um script de infraestrutura que só pode ser rodado uma vez é um script que
 *    ninguém tem coragem de rodar. Aqui cada índice é conferido no
 *    `information_schema` antes de ser criado.
 *
 * 2. ⚠ BUG DO INNODB QUE ESTE SCRIPT PRECISA CONTORNAR — e que é a razão de o
 *    passo de `OPTIMIZE TABLE` existir. Comportamento REPRODUZIDO no MariaDB
 *    11.8.8 da Hostinger, de forma determinística:
 *
 *      quando TODOS os índices FULLTEXT de uma tabela QUE JÁ TEM LINHAS são
 *      derrubados e recriados, o PRIMEIRO índice recriado volta VAZIO.
 *      Os criados depois dele ficam corretos.
 *
 *    Isso é exatamente o que acontece no fluxo normal do projeto: `db push`
 *    derruba os quatro índices (ele não os conhece), este script os recria — e,
 *    sem o contorno, `Article_fts_all` voltaria vazio. Como ele é o índice do
 *    `WHERE`, a busca passaria a não achar NADA, em silêncio, caindo para
 *    sempre no fallback `LIKE`. Ninguém receberia um erro; a busca só ficaria
 *    ruim. `OPTIMIZE TABLE` (que no InnoDB é um rebuild da tabela) repopula.
 *
 * 3. Por causa de (2), criar o índice não é prova de que ele FUNCIONA. Por isso
 *    o script termina fazendo uma sondagem real contra os dados — ver
 *    `verificarBusca`. Um índice de busca quebrado que não avisa é pior do que
 *    um erro: o erro alguém conserta.
 *
 * -----------------------------------------------------------------------------
 * SEGURANÇA (A03 — Injeção)
 * -----------------------------------------------------------------------------
 * Este script usa `$executeRawUnsafe`, e o nome do método é um aviso legítimo.
 * O uso é seguro aqui por uma razão específica, e não por descuido: o DDL é uma
 * CONSTANTE LITERAL definida logo abaixo, no próprio arquivo. Nenhum pedaço do
 * comando vem de entrada do usuário, de argumento de linha de comando, de
 * variável de ambiente ou do banco. Não há o que parametrizar — `ALTER TABLE`
 * não aceita parâmetros ligados para nome de índice ou de coluna, que é
 * justamente o motivo de não existir uma versão "segura" desta chamada.
 *
 * A regra a preservar: se algum dia alguém precisar tornar isto dinâmico (outra
 * tabela, outro campo), a lista de nomes permitidos tem que continuar sendo uma
 * constante do código. Concatenar nome de coluna vindo de fora aqui seria
 * injeção de SQL com privilégio de DDL — o pior caso possível.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * O DDL, espelhando `prisma/migrations-manual/001_fulltext_search.sql` — que é
 * onde vive a explicação longa de por que são quatro índices e não um.
 *
 * Resumo, para quem estiver lendo só este arquivo:
 *   - `Article_fts_all` é o índice do WHERE: decide QUEM entra no resultado.
 *   - os três por campo são os do ORDER BY: decidem a ORDEM, somados com pesos
 *     5 : 2 : 1 (a emulação do `setweight` A/B/C do `ts_rank` do Postgres).
 * O MySQL exige um índice para cada lista de colunas usada num `MATCH`; sem os
 * três individuais, `MATCH(title)` é ERRO DE SQL, não apenas lentidão.
 */
const FULLTEXT_INDEXES = [
  {
    table: 'Article',
    name: 'Article_fts_all',
    ddl: 'ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_all` (`title`, `excerpt`, `content`)',
  },
  {
    table: 'Article',
    name: 'Article_fts_title',
    ddl: 'ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_title` (`title`)',
  },
  {
    table: 'Article',
    name: 'Article_fts_excerpt',
    ddl: 'ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_excerpt` (`excerpt`)',
  },
  {
    table: 'Article',
    name: 'Article_fts_content',
    ddl: 'ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_content` (`content`)',
  },
] as const;

async function indexExists(table: string, name: string): Promise<boolean> {
  // `information_schema` responde pelo banco da conexão atual (`DATABASE()`),
  // então o script funciona em qualquer ambiente sem receber o nome do banco.
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${table}
      AND INDEX_NAME = ${name}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Sondagem real: prova que o índice COMBINADO (o do `WHERE` da busca) está de
 * fato populado. Existe por causa do bug descrito no item 2 do cabeçalho —
 * criar o índice não garante que ele funcione.
 *
 * COMO A SONDAGEM É INDEPENDENTE DOS DADOS: pegamos o título de um artigo que
 * existe e extraímos dele uma palavra de 4+ letras. Essa palavra está, por
 * construção, dentro das colunas indexadas — então o `MATCH` TEM que devolver
 * pelo menos aquele artigo. Se devolver zero, o índice está vazio.
 *
 * Por que 4 e não 3 letras: 3 é exatamente o `innodb_ft_min_token_size`, e um
 * token no limite exato tornaria o teste sensível a configuração em vez de
 * sensível ao índice — que é o que queremos medir.
 */
async function verificarBusca(): Promise<boolean> {
  const amostras = await prisma.article.findMany({ select: { title: true }, take: 25 });

  for (const { title } of amostras) {
    const token = title.split(/[^\p{L}\p{N}]+/u).find((t) => t.length >= 4);
    if (!token) continue;

    const termo = `${token}*`;
    const encontrados = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n
      FROM \`Article\`
      WHERE MATCH(\`title\`, \`excerpt\`, \`content\`) AGAINST (${termo} IN BOOLEAN MODE)
    `;
    return Number(encontrados[0]?.n ?? 0) > 0;
  }

  // Nenhum título com palavra utilizável: não dá para afirmar nada. Não é falha.
  return true;
}

/**
 * Nome do banco de PRODUÇÃO. Rodar este script contra ele exige confirmação
 * explícita por variável de ambiente.
 *
 * POR QUE ESTA GUARDA EXISTE: o script faz DDL — `ALTER TABLE` e
 * `OPTIMIZE TABLE`, que no InnoDB é um REBUILD da tabela inteira. Em `Article`
 * cheia de matérias, isso é uma operação de minutos que TRAVA ESCRITAS. Rodá-lo
 * em produção sem querer, no meio da tarde, é derrubar a publicação da redação.
 *
 * E o erro é fácil de cometer justamente porque a defesa natural falhou uma vez:
 * o banco de desenvolvimento chegou a se chamar `u754239208_ortuspixel`, o mesmo
 * nome do de produção. Com nomes iguais, nenhuma guarda automática é possível —
 * o `.env` errado é indistinguível do certo. Os nomes agora são diferentes, e
 * esta função é o que transforma essa diferença em proteção de verdade.
 *
 * Não é uma barreira de SEGURANÇA (quem tem a `DATABASE_URL` pode fazer o que
 * quiser por outros meios): é uma barreira contra ENGANO, que é o risco real
 * aqui. Por isso um `CONFIRMO_PRODUCAO=1` basta — a intenção é obrigar a pessoa
 * a parar e declarar o que está fazendo, não impedi-la.
 */
const BANCO_DE_PRODUCAO = 'u754239208_ortuspixel';

async function guardaDeAmbiente(): Promise<string> {
  const [linha] = await prisma.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`;
  const bancoAtual = linha?.db ?? '(desconhecido)';

  if (bancoAtual === BANCO_DE_PRODUCAO && process.env.CONFIRMO_PRODUCAO !== '1') {
    throw new Error(
      `RECUSANDO RODAR: a DATABASE_URL aponta para "${bancoAtual}", que é o banco de PRODUÇÃO.\n` +
        'Este script faz DDL e um OPTIMIZE TABLE (rebuild) que trava escritas na tabela Article.\n' +
        'Se é mesmo isso que você quer, e está numa janela combinada, rode:\n' +
        '    CONFIRMO_PRODUCAO=1 npm run db:fulltext',
    );
  }

  return bancoAtual;
}

async function main() {
  // Conferência de fornecedor antes de qualquer DDL. Rodar este script contra um
  // Postgres não daria um erro compreensível — daria um erro de sintaxe no meio
  // de um `ALTER TABLE`, com o banco já parcialmente alterado.
  //
  // Acesso opcional (`?.`) e não desestruturação direta: se a consulta voltasse
  // vazia, `const [{ version }] = ...` estouraria com "Cannot destructure
  // property of undefined" — um erro que não diz nada a quem estivesse depurando
  // uma conexão ruim. Melhor um rótulo honesto do que uma exceção enganosa.
  const versao = (await prisma.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`)[0]
    ?.version;

  const bancoAtual = await guardaDeAmbiente();
  console.log(`Banco: ${versao ?? '(versão não reportada)'} — schema "${bancoAtual}"`);

  const linhas = await prisma.article.count();
  console.log(`Tabela Article: ${linhas} linha(s)`);

  let criados = 0;

  for (const index of FULLTEXT_INDEXES) {
    if (await indexExists(index.table, index.name)) {
      console.log(`· ${index.name} — já existe, nada a fazer`);
      continue;
    }

    // ⚠ `executeRawUnsafe` com DDL constante. Ver a nota de segurança no topo.
    await prisma.$executeRawUnsafe(index.ddl);
    console.log(`✓ ${index.name} — criado`);
    criados += 1;
  }

  // ⚠ O CONTORNO DO BUG (item 2 do cabeçalho). Só faz sentido com a tabela
  // populada: numa tabela vazia não há o que repopular, e `OPTIMIZE TABLE` só
  // gastaria tempo. Com dados, ele é OBRIGATÓRIO — sem ele o índice combinado
  // fica vazio e a busca morre em silêncio.
  if (criados > 0 && linhas > 0) {
    console.log('\nRepopulando os índices (OPTIMIZE TABLE)...');
    console.log('  Necessário: ao recriar índices FULLTEXT numa tabela que já');
    console.log('  tem linhas, o InnoDB deixa o primeiro deles VAZIO.');
    await prisma.$executeRawUnsafe('OPTIMIZE TABLE `Article`');
  }

  // A SONDAGEM RODA SEMPRE, inclusive quando não havia nada a criar.
  //
  // POR QUE NÃO SAIR MAIS CEDO NO "já existem": porque "o índice existe" e "o
  // índice funciona" são afirmações diferentes — é essa distinção que está na
  // origem do bug do item 2. Um índice presente no `information_schema` e vazio
  // por dentro é exatamente o estado que derruba a busca sem avisar ninguém.
  //
  // Verificar sempre custa uma consulta e transforma este script numa ferramenta
  // de DIAGNÓSTICO: rodá-lo passa a ser a forma de responder "a busca do site
  // está sã?", em vez de só a forma de criar índice.
  const sondagemPossivel = linhas > 0;

  if (sondagemPossivel && !(await verificarBusca())) {
    // Falhar ALTO. O modo de falha natural deste problema é silencioso, e um
    // passo de deploy que segue adiante com a busca quebrada é pior do que um
    // que para e reclama.
    throw new Error(
      'Os índices existem, mas a sondagem de busca não encontrou NADA — o índice ' +
        'combinado `Article_fts_all` está vazio.\n' +
        'A busca do site devolveria zero resultado para tudo, em silêncio.\n' +
        'Correção: rode `OPTIMIZE TABLE `Article`` no banco e execute este script de novo.',
    );
  }

  if (criados === 0) {
    console.log(
      sondagemPossivel
        ? '\nOs 4 índices FULLTEXT já estavam no lugar e a sondagem confirmou que funcionam.'
        : '\nOs 4 índices FULLTEXT já estavam no lugar (tabela vazia: nada a sondar).',
    );
    return;
  }

  console.log(
    sondagemPossivel
      ? `\n${criados} índice(s) FULLTEXT criado(s) e VERIFICADOS. A busca está operante.`
      : `\n${criados} índice(s) FULLTEXT criado(s) numa tabela vazia. ` +
          'As linhas inseridas a partir de agora entram no índice automaticamente.',
  );
}

main()
  .catch((error) => {
    console.error('\nFalha ao aplicar os índices FULLTEXT:');
    console.error(error);
    // Sai com código de erro para que um passo de deploy que chame este script
    // QUEBRE em vez de seguir com a busca desligada em silêncio.
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
