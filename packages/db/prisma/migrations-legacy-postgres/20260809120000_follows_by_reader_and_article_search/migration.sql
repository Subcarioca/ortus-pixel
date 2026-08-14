-- =============================================================================
-- FOLLOWS VINCULADOS À CONTA DO LEITOR + BUSCA FULL-TEXT DE ARTIGOS
-- =============================================================================
--
-- Esta migração foi ESCRITA À MÃO a partir do `prisma migrate diff`, e não
-- gerada por `migrate dev`, por um motivo concreto: o Prisma não modela COLUNA
-- GERADA. O `diff` produzia `ADD COLUMN "searchVector" tsvector` (uma coluna
-- comum, que alguém teria de popular e manter sincronizada em cada escrita).
-- A versão abaixo declara a coluna como `GENERATED ALWAYS AS ... STORED`, o que
-- transfere essa responsabilidade para o banco e torna a dessincronização
-- impossível por construção.
--
-- O restante do arquivo é exatamente o SQL do `diff`, sem alteração.

-- -----------------------------------------------------------------------------
-- 1) FranchiseFollow: o mesmo follow passa a poder pertencer a uma CONTA
-- -----------------------------------------------------------------------------
ALTER TABLE "FranchiseFollow" ADD COLUMN "commentAuthorId" TEXT;

CREATE INDEX "FranchiseFollow_commentAuthorId_idx" ON "FranchiseFollow"("commentAuthorId");

-- Impede a mesma CONTA seguir a mesma franquia duas vezes.
--
-- Esta única linha é o que dispensou um índice parcial e um CHECK escritos à
-- mão: no Postgres, NULL é distinto de NULL dentro de um índice único, então as
-- linhas anônimas (`commentAuthorId` nulo) NÃO colidem entre si — só as de
-- conta são restringidas. É exatamente a semântica desejada.
CREATE UNIQUE INDEX "FranchiseFollow_franchiseId_commentAuthorId_key" ON "FranchiseFollow"("franchiseId", "commentAuthorId");

-- ON DELETE CASCADE: apagar a conta apaga os follows. É o direito de eliminação
-- da LGPD garantido pelo banco, e não pela lembrança de quem escrever a rotina
-- de exclusão.
ALTER TABLE "FranchiseFollow" ADD CONSTRAINT "FranchiseFollow_commentAuthorId_fkey" FOREIGN KEY ("commentAuthorId") REFERENCES "CommentAuthor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 2) Vetor de busca do artigo
-- -----------------------------------------------------------------------------
--
-- PESOS: A = título, B = resumo, C = corpo. É o que faz "Zelda" no TÍTULO
-- vencer "Zelda" citado de passagem no meio de um texto sobre outra coisa.
-- Sem `setweight`, todo casamento vale igual e o ranking fica aleatório.
--
-- DICIONÁRIO 'portuguese': aplica stemming da língua, então "jogos" encontra
-- "jogo" e "lançamentos" encontra "lançamento" — o principal ganho sobre um
-- `ILIKE '%termo%'`, que compara texto cru.
--
-- LIMITAÇÃO CONHECIDA E ACEITA: o dicionário não remove ACENTOS, então quem
-- digitar "lancamento" não encontra "lançamento". A correção seria a extensão
-- `unaccent` embrulhada numa função marcada IMMUTABLE (exigência da coluna
-- gerada). Ficou de fora de propósito: acrescentaria uma extensão e uma função
-- ao banco, que precisariam existir também em produção — e o deploy é hoje a
-- parte mais frágil do projeto. Trocar uma limitação pequena de busca por um
-- motivo novo de quebra de deploy seria um mau negócio.
--
-- `coalesce` em todos os campos: `NULL` propagaria por toda a concatenação e
-- zeraria o vetor inteiro de um artigo só porque o resumo estava vazio.
ALTER TABLE "Article" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce("excerpt", '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce("content", '')), 'C')
  ) STORED;

-- GIN: o custo da busca acompanha o número de linhas que CASAM, não o tamanho
-- da tabela. Sem ele, cada busca varre a tabela inteira.
CREATE INDEX "Article_searchVector_idx" ON "Article" USING GIN ("searchVector");
