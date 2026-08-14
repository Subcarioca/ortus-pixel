import 'server-only';

/**
 * =============================================================================
 * ETIQUETAGEM DA MATÉRIA — franquias e tags, gravadas do mesmo jeito nos dois
 * caminhos de escrita
 * =============================================================================
 *
 * O QUE FALTAVA, E POR QUE ISSO IMPORTAVA MAIS DO QUE PARECE
 * -----------------------------------------------------------------------------
 * O painel sabia gravar `categoryId` e mais nada de classificação. Consequência
 * concreta, e silenciosa: TODA matéria criada pela redação nascia sem franquia e
 * sem tag. O hub de franquia — descrito no próprio schema como "motor de
 * retenção do produto" — só tinha o que o seed havia colocado lá, e ninguém
 * percebia, porque um hub vazio não dá erro: ele só não tem nada.
 *
 * -----------------------------------------------------------------------------
 * A ESTRATÉGIA DE ESCRITA: SUBSTITUIR, NÃO ACRESCENTAR
 * -----------------------------------------------------------------------------
 * O formulário envia a lista COMPLETA de franquias e tags a cada salvamento, e
 * esta função faz o banco refletir exatamente essa lista. A alternativa —
 * mandar só o que mudou — obrigaria o cliente a calcular diferenças e a manter
 * um estado "o que estava lá antes" que, no dia em que dessincronizasse,
 * deixaria vínculos fantasmas que ninguém consegue remover pela tela.
 *
 * `deleteMany` + `createMany` em vez de comparar item a item: são no máximo seis
 * franquias e oito tags. Um diff economizaria duas queries e custaria uma dúzia
 * de linhas de lógica com casos de borda próprios — a troca não se paga.
 *
 * ⚠ SEMPRE DENTRO DA TRANSAÇÃO DE QUEM CHAMA. É por isso que a função recebe o
 * `tx` em vez de usar o `prisma` global: se a matéria for gravada e a
 * etiquetagem falhar, as duas coisas precisam voltar juntas. Uma matéria
 * publicada com metade das etiquetas é pior do que uma matéria não publicada,
 * porque ninguém vai reparar.
 */

import type { Prisma } from '@prisma/client';

/**
 * O tipo do cliente transacional do Prisma.
 *
 * `Prisma.TransactionClient` é o próprio cliente MENOS as operações que não
 * fazem sentido dentro de uma transação (`$transaction`, `$connect`...). Usá-lo
 * na assinatura é o que impede, em tempo de compilação, alguém passar o
 * `prisma` global aqui e furar a atomicidade sem perceber.
 */
type Tx = Prisma.TransactionClient;

export interface ArticleTaxonomyInput {
  franchiseIds: string[];
  tags: { slug: string; name: string }[];
}

/**
 * Faz os vínculos de franquia e tag da matéria refletirem exatamente a entrada.
 */
export async function syncArticleTaxonomy(
  tx: Tx,
  articleId: string,
  input: ArticleTaxonomyInput,
): Promise<void> {
  // ---------------------------------------------------------------------------
  // FRANQUIAS
  // ---------------------------------------------------------------------------
  await tx.articleFranchise.deleteMany({ where: { articleId } });

  if (input.franchiseIds.length > 0) {
    await tx.articleFranchise.createMany({
      data: input.franchiseIds.map((franchiseId) => ({ articleId, franchiseId })),
      // `skipDuplicates` como cinto de segurança: a entrada já vem sem
      // repetição (um `Set` em article-input.ts), mas a chave primária composta
      // desta tabela transforma uma repetição que escape num erro 500 no meio da
      // transação — caro demais para depender de uma única linha de defesa.
      skipDuplicates: true,
    });
  }

  // ---------------------------------------------------------------------------
  // TAGS — criar as que ainda não existem, depois vincular
  // ---------------------------------------------------------------------------
  await tx.articleTag.deleteMany({ where: { articleId } });

  if (input.tags.length === 0) return;

  /**
   * `createMany` + `skipDuplicates` em vez de N `upsert`.
   *
   * O caso comum é "a tag já existe" (a redação reusa as mesmas dezenas de
   * termos), e `upsert` faria uma ida ao banco por tag para descobrir isso.
   * Aqui é UMA ida: tenta criar todas, o banco ignora as que colidem com o
   * índice único de `slug`, e a leitura seguinte resolve os ids de todas —
   * novas e antigas — de uma vez.
   *
   * `kind: 'generic'` é o padrão do schema. Classificar a tag como
   * 'character'/'studio'/'event' é um refinamento editorial que o formulário
   * ainda não oferece; quando oferecer, é aqui que o valor entra.
   */
  await tx.tag.createMany({
    data: input.tags.map((tag) => ({ slug: tag.slug, name: tag.name })),
    skipDuplicates: true,
  });

  const rows = await tx.tag.findMany({
    where: { slug: { in: input.tags.map((tag) => tag.slug) } },
    select: { id: true },
  });

  if (rows.length === 0) return;

  await tx.articleTag.createMany({
    data: rows.map((tag) => ({ articleId, tagId: tag.id })),
    skipDuplicates: true,
  });
}
