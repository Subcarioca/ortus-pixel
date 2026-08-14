import { Prisma } from '@prisma/client';

/**
 * =============================================================================
 * PONTE ENTRE UM TIPO DE DOMÍNIO E UMA COLUNA `Json` DO PRISMA
 * =============================================================================
 *
 * O PROBLEMA, que não é óbvio: o Prisma tipa coluna `Json` como
 * `InputJsonValue`, que exige assinatura de índice (`{ [k: string]: ... }`).
 * Uma `interface` do TypeScript NÃO tem assinatura de índice — só `type` com
 * objeto literal tem. Resultado: `ArticleBlock[]`, que é um dado perfeitamente
 * serializável, é recusado pelo compilador na gravação.
 *
 * A saída de todo mundo é escrever `as any` no lugar da chamada. Este arquivo
 * existe para que essa conversão aconteça UMA vez, com nome, e com o motivo
 * escrito ao lado — em vez de N `any` espalhados pelas rotas, cada um deles um
 * ponto onde o compilador para de ajudar sem ninguém lembrar por quê.
 *
 * A garantia de que o valor é de fato serializável não vem do compilador aqui:
 * vem de o dado já ter passado pelo validador de entrada (server/blocks-input.ts),
 * que só constrói objetos de tipos primitivos. Esta função é uma tradução de
 * tipos, não uma validação — e é por isso que ela é curta e o validador é longo.
 */
export function toJsonColumn(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * =============================================================================
 * LEITURA DE UMA COLUNA `Json` QUE GUARDA UMA LISTA DE STRINGS
 * =============================================================================
 *
 * POR QUE ESTA FUNÇÃO PASSOU A EXISTIR: na migração do Postgres para o
 * MySQL/MariaDB, os oito campos que eram `String[]` viraram `Json` — porque
 * MySQL não tem tipo array. São eles: `Franchise.aliases`, `Topic.aliases`,
 * `Author.expertiseAreas`, `Topic.emotionalTriggers`, `Article.tldr`,
 * `Subscriber.preferredCategories`, `PushSubscription.preferredCategories` e
 * `PushSubscription.preferredFranchises`.
 *
 * O QUE SE PERDEU, e é exatamente o que esta função repõe: antes, o BANCO
 * garantia que a coluna continha uma lista de strings — o tipo `text[]` não
 * admitia outra coisa, e o Prisma Client entregava `string[]` ao TypeScript sem
 * ressalva. Agora a coluna é um `LONGTEXT` com JSON dentro: ela aceita
 * `{"a":1}`, `42`, `null` ou `["a", 7, null]` com igual naturalidade, e o Prisma
 * tipa o retorno como `JsonValue` — que INCLUI `null`.
 *
 * Logo, a garantia de forma deixou de ser do banco e passou a ser da BORDA DE
 * LEITURA. É o mesmo raciocínio que o schema já aplica a `Article.blocks`:
 * "banco é fronteira, e fronteira se trata com desconfiança". A diferença é que
 * ali a desconfiança era uma escolha; aqui ela virou necessidade.
 *
 * DEGRADA EM SILÊNCIO, DE PROPÓSITO. Um valor malformado devolve lista vazia (ou
 * descarta o item ruim) em vez de lançar. O motivo é concreto: estes campos
 * alimentam TL;DR, sinônimos e chips de exibição. Uma linha estranha no banco
 * não pode derrubar a página de uma matéria — o leitor perderia o artigo
 * inteiro por causa de um resumo. Onde a ausência do dado importaria de fato,
 * quem reclama é o validador de escrita, que continua no lugar.
 *
 * NÃO É VALIDAÇÃO DE DOMÍNIO. Ela garante "é uma lista de strings", não "são
 * slugs de categoria válidos". Quem faz a segunda parte continua sendo o
 * chamador — veja `mapAuthor`, que ainda encadeia `.filter(isCategorySlug)`.
 */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Valor a gravar numa coluna `Json?` que deve ficar NULA.
 *
 * `Prisma.DbNull` (nulo no banco) e não `Prisma.JsonNull` (o literal JSON
 * `null` dentro da coluna). A diferença importa: `JsonNull` grava um valor, e
 * `blocks IS NULL` — que é como o resto do código pergunta "esta matéria usa
 * blocos?" — passaria a responder "sim, e o conteúdo é null".
 */
export const JSON_COLUMN_NULL = Prisma.DbNull;
