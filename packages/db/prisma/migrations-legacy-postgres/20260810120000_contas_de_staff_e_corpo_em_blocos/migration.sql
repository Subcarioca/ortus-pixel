-- =============================================================================
-- CONTAS DE STAFF (admin/redator) + CORPO DE MATÉRIA EM BLOCOS
-- =============================================================================
--
-- Esta migração faz três coisas, nesta ordem, e a ordem importa:
--   1. dá ao `Author` os campos de autenticação (ele já era a assinatura da
--      matéria; passa a ser também a conta que entra no painel);
--   2. NORMALIZA o vocabulário de `systemRole` para 'admin' | 'redator';
--   3. cria `StaffSession` e a coluna `Article.blocks`.
--
-- O passo 2 é o único com risco real, e por isso está escrito à mão em vez de
-- gerado: o vocabulário anterior era 'admin' | 'editor' | 'writer', e existem
-- linhas em produção com os três valores. Se ele fosse apenas renomeado no
-- schema, as contas 'editor'/'writer' passariam a ter um nível que o código não
-- reconhece — e um nível não reconhecido, dependendo de como a comparação for
-- escrita, tanto pode trancar a pessoa para fora quanto deixá-la entrar como
-- admin. A conversão explícita abaixo elimina os dois cenários.
--
-- 'editor' vira 'redator' (e não 'admin'), de propósito: PRIVILÉGIO MÍNIMO na
-- dúvida. Promover uma conta depois é um clique na tela de contas; descobrir
-- que uma migração distribuiu poder de administrador em silêncio é um incidente.

-- --- 1. Campos de autenticação no Author -------------------------------------
ALTER TABLE "Author" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "systemRole" SET DEFAULT 'redator';

-- --- 2. Normalização do vocabulário de nível de acesso ------------------------
-- Qualquer valor que não seja exatamente 'admin' é rebaixado. O `NOT IN` cobre
-- também lixo eventual ('Admin', string vazia, valor de teste) sem precisar
-- enumerar o que existe hoje.
UPDATE "Author" SET "systemRole" = 'redator' WHERE "systemRole" <> 'admin';

-- --- 3. Sessão de painel + corpo em blocos ------------------------------------
ALTER TABLE "Article" ADD COLUMN     "blocks" JSONB;

CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

CREATE INDEX "StaffSession_authorId_idx" ON "StaffSession"("authorId");

CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

CREATE INDEX "Author_systemRole_isActive_idx" ON "Author"("systemRole", "isActive");

-- `ON DELETE CASCADE`: apagar a conta encerra as sessões dela junto. Não é
-- arrumação — é o que impede uma sessão órfã continuar valendo depois de a conta
-- deixar de existir.
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;
