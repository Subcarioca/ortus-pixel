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
 * Valor a gravar numa coluna `Json?` que deve ficar NULA.
 *
 * `Prisma.DbNull` (nulo no banco) e não `Prisma.JsonNull` (o literal JSON
 * `null` dentro da coluna). A diferença importa: `JsonNull` grava um valor, e
 * `blocks IS NULL` — que é como o resto do código pergunta "esta matéria usa
 * blocos?" — passaria a responder "sim, e o conteúdo é null".
 */
export const JSON_COLUMN_NULL = Prisma.DbNull;
