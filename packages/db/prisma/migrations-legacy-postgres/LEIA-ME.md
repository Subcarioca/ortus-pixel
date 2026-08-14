# Migrações do PostgreSQL — histórico, não instruções

Esta pasta guarda as três migrações que construíram o banco quando o projeto
rodava em **PostgreSQL (Neon)**. Ela foi renomeada de `migrations/` para
`migrations-legacy-postgres/` na migração para MySQL/MariaDB, e a renomeação é
a parte importante deste arquivo.

## Por que renomear, e não apagar

**Apagar seria perder a única explicação escrita de decisões que ainda governam
o banco de hoje.** A migração `20260809120000_...`, por exemplo, documenta em
detalhe por que a busca usava `setweight(A/B/C)` e por que a coluna era
`GENERATED ... STORED` — e são exatamente esses dois raciocínios que a busca
atual, em `FULLTEXT`, tenta preservar por outros meios. Quem for calibrar os
pesos `5 : 2 : 1` de `searchContent` precisa saber de onde eles vieram.

Também é o registro do que o banco *era* enquanto a Neon continuar de pé como
plano de rollback (7 dias após o corte, conforme o plano).

## Por que renomear, então

Porque `prisma/migrations/` é um **nome com significado operacional**: é a pasta
que o `prisma migrate` lê. Deixá-la ali criava duas armadilhas concretas:

1. **`prisma migrate deploy`** rodado por engano tentaria aplicar SQL de
   PostgreSQL (`tsvector`, `TEXT[]`, `ARRAY[]::TEXT[]`, índice `GIN`) contra um
   MariaDB. Falharia — mas só depois de já ter executado parte dos comandos.
2. **Confusão de leitura.** Uma pasta chamada `migrations` ao lado de um schema
   MySQL sugere que aquele é o histórico vigente. Não é: **este projeto não usa
   `prisma migrate`.** O usuário do MySQL da Hostinger não tem `CREATE DATABASE`,
   e `migrate dev` precisa de um *shadow database*.

Com o nome atual, o Prisma ignora a pasta e um humano entende o que ela é.

## O caminho vigente

```
npm run db:push        # aplica o schema.prisma
npm run db:fulltext    # cria os 4 índices FULLTEXT da busca (obrigatório depois)
```

O SQL que o `db push` não sabe gerar vive em `../migrations-manual/`.

## ⚠ Não use isto como referência de tipos

O SQL daqui descreve o schema **antigo**. Vários tipos mudaram na migração:
`TEXT[]` virou `Json`, `String` sem anotação virou `@db.Text`/`@db.VarChar(N)`
explícito, e a coluna `searchVector` deixou de existir. A fonte da verdade é, e
sempre foi, o `schema.prisma`.
