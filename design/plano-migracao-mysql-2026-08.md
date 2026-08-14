# Plano de avaliação e migração — Postgres (Neon) → MySQL/MariaDB (Hostinger)

**Documento:** estudo de viabilidade e roteiro de execução
**Data:** 2026-08-11
**Status:** PLANEJAMENTO — nada foi alterado. `schema.prisma` intacto, nenhuma migração rodada, banco de produção não tocado.
**Motivação declarada pelo dono:** custo (sair do free tier da Neon) e latência (ficar na mesma infraestrutura da hospedagem).
**Restrição declarada pelo dono:** *"Gosto da página atual e acho que temos potencial com o que temos, então vamos tentar não se distanciar tanto, na medida do possível."*

> **Revisão 2 (2026-08-11).** A primeira versão deste documento partiu da premissa,
> lida no `README.md`, de que o site rodava num VPS — e concluía contra a migração
> com base nisso. **A premissa estava errada** e foi corrigida por verificação
> direta na conta Hostinger (ver §2.1). O site roda em **hospedagem compartilhada**,
> no mesmo produto do `cariocatech`. Com isso, a recomendação executiva **mudou de
> "não migrar" para "migrar, sob condições"**. Todo o levantamento técnico das
> seções 3, 4, 5 e 6 foi revisto e **permanece válido** — ele não dependia da
> topologia.

---

## 1. Resumo executivo

### 1.1 A recomendação: **sim, migrar — sob quatro condições**

A migração **faz sentido** e os dois motivos que a originaram (custo e latência) se sustentam depois de verificados. Mas ela cobra um preço real e permanente na qualidade da busca, e esse preço precisa ser aceito conscientemente, não descoberto depois.

**O argumento decisivo não é nenhum dos dois que foram citados.** É este:

> ### O free tier da Neon suspende o banco após 5 minutos de inatividade
>
> No plano gratuito, o *scale to zero* é **obrigatório e não desativável**: o compute
> suspende após 300 s ociosos, e a primeira consulta seguinte paga um *cold start* de
> tipicamente **300 ms a 1 s** antes de qualquer resultado. Só planos pagos permitem
> desligar o autosuspend.
>
> Um portal de notícias recém-lançado passa **a maior parte do dia ocioso**. Isso
> significa que uma fatia grande dos visitantes reais — justamente os que chegam
> espaçados, de busca ou de rede social — cai numa página que só começa a montar
> depois de acordar o banco. E como as páginas são renderizadas no servidor, esse
> atraso não é "o site carregou e os dados chegaram depois": é **tela em branco**.

Isso é uma degradação **visível para o leitor, em quase toda primeira visita**, e é maior do que qualquer coisa que a migração introduz. Somam-se a ela:

- **Toda consulta hoje atravessa a internet pública** da hospedagem até a Neon. Uma página do portal faz várias consultas; o custo se multiplica. Com o MySQL da mesma conta, o caminho passa a ser interno.
- **Custo e dependência:** o MySQL já está incluso e pago. O free tier da Neon tem limites e pode virar cobrança.
- **O caminho já foi percorrido:** o `cariocatech` fez exatamente esta migração, na **mesma conta**, na **mesma infraestrutura**, com a **mesma versão do Prisma**. As armadilhas já estão documentadas (§6.3).

**As quatro condições:**

| # | Condição | Por quê |
|---|---|---|
| **C1** | **Aceitar formalmente a regressão da busca** (§9.1), depois de ver o resultado das 30 buscas reais (§6.5d) — **antes** do corte | É a única perda genuinamente permanente. Descobri-la depois é o cenário em que o rollback já ficou caro. |
| **C2** | **Fazer a auditoria de tamanho de coluna com calma** (§3.3), começando por `Topic.query` | É o item de maior volume e o que mais quebra se for feito às pressas. Há um caso já garantido de falha (§4.2). |
| **C3** | **Limitar o pool de conexões** explicitamente na `DATABASE_URL` | O LiteSpeed sobe até 6 processos-filho (§2.1); sem `connection_limit`, o pool padrão do Prisma multiplicado por 6 estoura o limite do MySQL compartilhado. Ver R5. |
| **C4** | **Ensaio geral + `mysqldump` diário para fora da Hostinger** antes de considerar concluída | Banco e site na mesma conta: um incidente de conta levaria os dois. O próprio README já registra backup como pendência não resolvida. |

### 1.2 A alternativa honesta, para comparação

Se a perda de busca (§9.1) for considerada inaceitável, existe **uma** saída que preserva tudo: **pagar o plano da Neon** (~US$ 19/mês), o que desliga o autosuspend e elimina o cold start. Isso mantém `tsvector`, `ts_rank`, stemming de português e os arrays nativos — **zero mudança de código**.

A escolha, posta de forma limpa, é:

| | Migrar para MySQL | Pagar a Neon |
|---|---|---|
| Custo mensal | **R$ 0** | ~US$ 19 |
| Cold start | **Eliminado** | Eliminado |
| Latência por consulta | **Interna** | Continua externa |
| Busca | **Pior** (§9.1) | Idêntica |
| Esforço | Alto (§10) | **Nenhum** |
| Risco | Migração de dados ao vivo | **Nenhum** |

**Minha recomendação continua sendo migrar**, porque o site é um projeto que precisa se pagar, o valor da diferença de busca é pequeno perto de US$ 228/ano, e as perdas têm mitigação desenhada (§5.4). Mas **esta é uma decisão de negócio, não técnica**, e o dono tem todo o direito de escolher a segunda coluna. As duas são defensáveis; o que não é defensável é migrar sem saber que a busca piora.

### 1.3 Um alerta operacional que trava a decisão

**Migrar para MariaDB congela o projeto no Prisma 6.** O Prisma 7 gera SQL específico do MySQL 8 (`CAST(... AS json)`) que o parser do MariaDB 10.11+ rejeita — introspecção e consultas quebram ([prisma/prisma#29023](https://github.com/prisma/prisma/issues/29023)). O projeto está no `@prisma/client@6.19.3` (ver `package.json`), então hoje está seguro; mas a partir da migração, subir para o Prisma 7 deixa de ser manutenção de rotina e vira bloqueio de fornecedor.

*(Atenuante: o `cariocatech` já vive nessa mesma restrição, na mesma conta. Não é um problema novo para a operação — é um problema que passa a valer para os dois projetos ao mesmo tempo.)*

### 1.3 Um alerta operacional que trava a decisão

**Migrar para MariaDB congela o projeto no Prisma 6.** O Prisma 7 gera SQL específico do MySQL 8 (`CAST(... AS json)`) que o parser do MariaDB 10.11+ rejeita — introspecção e consultas quebram ([prisma/prisma#29023](https://github.com/prisma/prisma/issues/29023)). O projeto está no `@prisma/client@6.19.3` (ver `package.json`), então hoje está seguro; mas a partir da migração, subir para o Prisma 7 deixa de ser uma tarefa de manutenção de rotina e passa a ser um bloqueio de fornecedor. No Postgres esse problema não existe.

---

## 2. Como este levantamento foi feito

### 2.1 ⚠ A infraestrutura real — e por que o README engana

**Achado que precisa ser registrado, porque vai enganar a próxima pessoa também.**

O `README.md` dedica uma seção inteira (*"Deploy em produção (VPS)"*, linhas 164-175) a uma arquitetura **que nunca foi implantada**: VPS Ubuntu/Debian, PM2, Nginx, Postgres gerenciado, `ecosystem.config.js`. A tabela da linha 170 até apresenta as escolhas como *"fechadas pelo dono do site"*.

**A verificação direta na conta Hostinger diz outra coisa:**

| Verificação | Resultado |
|---|---|
| `hosting_listWebsitesV1` | `ortuspixel.com` → `root_directory: /home/u754239208/domains/ortuspixel.com/public_html`, `vhost_type: main` |
| Conta | `u754239208` — **a mesma do `cariocatech.com`** |
| `VPS_getVirtualMachinesV1` | **zero instâncias** |

Corroborado pelo próprio código: o cabeçalho de `server.js` (branch `deploy-standalone`) descreve `hbuilds/versions/<uuid>/nodejs`, `LSAPI_CHILDREN` e processos-filho do **LiteSpeed** — assinatura inconfundível do **Node.js App Hosting compartilhado** da Hostinger. O histórico daquela branch é uma sequência de commits lidando com o engine do Prisma nesse ambiente.

**Consequências para este documento:**
1. **O Ortus Pixel está no mesmo produto de hospedagem que o `cariocatech`.** O MySQL da conta é, para efeitos práticos, local — o argumento original de "mesma infraestrutura, sem ida de rede externa" **vale**.
2. A revisão 1 deste relatório recomendava "Postgres no próprio VPS". **Essa opção não existe**: não há VPS, e hospedagem compartilhada não permite instalar um serviço de banco nativo. A seção foi removida.
3. ⚠ **`LSAPI_CHILDREN` (padrão 6)** significa **até 6 processos Node**, cada um com seu Prisma Client e seu pool de conexões. Isso é um problema de dimensionamento real e novo — ver R5 e a condição C3.
4. ❓ **Como o curator roda em produção é uma pergunta em aberto.** Não há PM2 nesse ambiente, e o Node.js App Hosting sobe um processo web, não um daemon de fundo. Ou ele roda por cron do hPanel, ou roda manualmente, ou não roda. **A resposta muda o perfil de escrita no banco** (§4.2) e precisa ser confirmada antes do dimensionamento (tarefa **T02**).

**Recomendação separada, independente da migração:** corrigir a seção de deploy do `README.md`. Documentação que descreve uma infraestrutura inexistente já custou uma análise inteira; da próxima vez pode custar uma decisão errada.

### 2.2 Verificações de código

Tudo abaixo foi verificado lendo o código, não presumido. Correções ao enunciado da tarefa:

| Item do enunciado | O que o código realmente diz |
|---|---|
| `SearchTerm.aliases` | **Não existe** esse model. É `Topic.aliases` (schema, linha 286). |
| `TopicCandidate.emotionalTriggers` | **Não existe** esse model. É `Topic.emotionalTriggers` (linha 318). |
| `ReaderProfile.preferredCategories/preferredFranchises` | **Não existe** esse model. São `Subscriber.preferredCategories` (linha 884) e `PushSubscription.preferredCategories`/`preferredFranchises` (linhas 919-920). |
| "8 campos `String[]` em pelo menos 5 models" | **Confirmado: são 8 campos, em 5 models.** A contagem estava certa; os nomes, não. |
| "busca por volta da linha 1188" | **Confirmado**, `apps/web/src/server/queries.ts`, `$queryRaw` na linha 1187. |
| `mode: 'insensitive'` | **Confirmado**, `queries.ts` linhas 1196 e 1202 (só esses dois lugares no projeto). |
| MariaDB implementa `Json` como `LONGTEXT` de forma transparente | **Confirmado** e sem impacto — mas com uma ressalva importante sobre `@default` que o cariocatech não sofreu porque não usa `Json` com default. Ver item 3.4. |

**Superfície de SQL cru no projeto inteiro** (`grep` por `queryRaw|executeRaw`): apenas **dois** pontos.
- `apps/web/src/app/api/health/route.ts:24` → `SELECT 1` (portável, nenhuma mudança).
- `apps/web/src/server/queries.ts:1187` → a busca full-text (o problema inteiro).

Isso é uma boa notícia estrutural: o acoplamento ao Postgres está **concentrado**, não espalhado.

---

## 3. Parte 1 — Levantamento completo de incompatibilidades

### 3.1 Bloqueador A — Busca full-text (`tsvector`, `@@`, `ts_rank`, GIN)

| Onde | O que é |
|---|---|
| `packages/db/prisma/schema.prisma:636` | `searchVector Unsupported("tsvector")? @default(dbgenerated())` |
| `packages/db/prisma/schema.prisma:650` | `@@index([searchVector], type: Gin)` |
| `packages/db/prisma/migrations/20260809120000_.../migration.sql` | Coluna `GENERATED ALWAYS AS (setweight(...A) \|\| setweight(...B) \|\| setweight(...C)) STORED` + índice GIN |
| `apps/web/src/server/queries.ts:1187-1194` | `websearch_to_tsquery('portuguese', $1)`, operador `@@`, `ts_rank(...)`, `NULLS LAST` |

**Quem lê/escreve:** ninguém escreve — é coluna gerada pelo banco. Quem lê é **exclusivamente** `searchContent()` em `queries.ts`. A coluna nunca aparece em nenhum `select` do Prisma Client (é `Unsupported`, então o Client a ignora).

**O que muda:** nada disso existe em MySQL/MariaDB. Substituição completa. Proposta concreta na **seção 5**.

**Efeito colateral positivo:** a migração **elimina** o hack do `@default(dbgenerated())`, cujo único propósito era impedir que o Prisma emitisse `ALTER COLUMN "searchVector" DROP DEFAULT` em toda migração futura (ver o comentário nas linhas 630-635 do schema). Com `FULLTEXT` sobre colunas reais, essa armadilha some.

### 3.2 Bloqueador B — Os 8 campos `String[]`

MySQL/MariaDB não têm array nativo. Confirmado por `grep -n "String\[\]"`:

| # | Campo | Linha | Quem ESCREVE | Quem LÊ | Filtra no banco? |
|---|---|---|---|---|---|
| 1 | `Franchise.aliases` | 119 | `prisma/seed.ts:250` | `curator/pipeline/curate.ts:324,331`; `db/src/mappers.ts:206` | Não |
| 2 | `Author.expertiseAreas` | 194 | `prisma/seed.ts:151` | `db/src/mappers.ts:175` (`.filter(isCategorySlug)`) | Não |
| 3 | `Topic.aliases` | 286 | `curate.ts:291` (sempre `[]`); `seed.ts:611,910` | `curate.ts:377` → conectores (`youtube.ts:105`, `serp-competition.ts:188`) | Não |
| 4 | `Topic.emotionalTriggers` | 318 | `curate.ts:431`; `seed.ts:621,920` | `admin/page.tsx:193` → `topic-row.tsx:191` | Não |
| 5 | `Article.tldr` | 558 | `api/admin/articles/[id]:120`; `api/admin/topics/[id]:228`; `server/article-input.ts:196` | `queries.ts:184,208,251,954`; `[categoria]/[slug]/page.tsx:360-370`; formulários do admin | Não |
| 6 | `Subscriber.preferredCategories` | 884 | *(nenhum caminho de escrita ativo hoje)* | — | Não |
| 7 | `PushSubscription.preferredCategories` | 919 | `api/push/subscribe/route.ts:133,140` | `server/push-sender.ts:98` | **SIM** ⚠ |
| 8 | `PushSubscription.preferredFranchises` | 920 | *(nenhum caminho de escrita ativo hoje)* | — | Não |

**Sete dos oito são triviais.** São sempre lidos e escritos junto do registro pai, como bloco, nunca filtrados no banco. Trocar `String[]` por `Json` os resolve com uma mudança de tipo e nenhuma mudança de lógica: o Prisma Client continua devolvendo um array JS.

**O oitavo não é trivial, e o enunciado não o mencionou.** `apps/web/src/server/push-sender.ts:98`:

```ts
OR: [{ preferredCategories: { isEmpty: true } }, { preferredCategories: { has: categorySlug } }],
```

`isEmpty` e `has` são **filtros de array do Prisma que só existem no conector Postgres**. Com `Json`, esse `where` não compila. Este é o **único** ponto do projeto em que um array é filtrado dentro do banco (confirmado por `grep` de `isEmpty|hasSome|hasEvery|has:`).

**Três saídas, em ordem de preferência:**

- **(a) Filtrar em memória — recomendado.** Trazer os inscritos ativos que passam no `minScoreThreshold` e aplicar a regra de categoria em JavaScript. A base de push é de centenas a poucos milhares de linhas, e o disparo já roda em lotes (`BATCH_SIZE`), fora do caminho da requisição do leitor. É a mudança menor e mais legível.
- **(b) `JSON_CONTAINS` via SQL cru.** Preciso, mas **não usa índice** (varredura completa) e acrescenta um segundo ponto de SQL cru ao projeto — que hoje tem só um. Ganho nenhum sobre (a) nesta escala.
- **(c) Tabela de junção `PushSubscriptionCategory`.** Modelagem "correta", indexável, e a única que escala de verdade. Mas cria tabela, migração de dados e código novo, para um problema que ainda não existe. Contraria diretamente o "não se distanciar tanto". **Fica registrada como o caminho para quando a base de push passar de dezenas de milhares.**

### 3.3 Bloqueador C — O limite de 191 caracteres (o maior volume de trabalho)

**Este é o item que o enunciado subestimou.** No conector MySQL, o Prisma mapeia `String` para `VARCHAR(191)` por padrão. O schema atual tem **zero** anotações `@db.` (verificado: `grep "@db\." schema.prisma` não retorna nada) — porque no Postgres `String` é `TEXT`, ilimitado, e nunca foi preciso pensar nisso.

Em MySQL com `sql_mode` estrito (padrão), gravar mais de 191 caracteres não trunca em silêncio: **dá erro 1406 `Data too long` e a escrita falha**. Numa redação, isso significa "o redator clica em Publicar e recebe erro 500".

**Achado concreto, encontrado ao cruzar código com schema:**

```ts
// services/curator/src/pipeline/curate.ts:283
query: item.title.slice(0, 200),
```

O curator **já corta explicitamente em 200 caracteres** — 9 a mais que o limite do MySQL. Ou seja, existe um caminho de código, rodando continuamente em produção, que produz exatamente o valor que quebraria. Sem `@db.VarChar(255)` (ou `@db.Text`) em `Topic.query`, **o pipeline de curadoria começa a falhar em toda manchete longa**, silenciosamente, dentro de um `$transaction`.

**Colunas que precisam de anotação explícita** (classificadas pelo uso real):

`@db.Text` — texto livre, sem limite prático:

| Model | Campos |
|---|---|
| `Article` | `content` ⚠ (corpo inteiro — em `Json` os `blocks` já são LONGTEXT), `excerpt`, `seoDescription` |
| `Comment` | `content` ⚠, `moderationNote` |
| `LiveUpdate` | `content` |
| `Author` | `bio` |
| `Category` / `Subcategory` | `description`, `seoDescription` |
| `Franchise` | `description` |
| `Topic` | `summary`, `scoreSummary`, `manualOverrideReason` |
| `ConnectorHealth` | `lastError` |
| `PipelineRun` | `error` |
| `PushDelivery` | `error` |
| `AuditLog` | `reason` |
| `CommentAuthor` | `blockReason` |
| `SignalReading` | `rawValue`, `explanation` |

`@db.VarChar(N)` — precisa continuar indexável ou tem limite conhecido:

| Model.campo | Sugestão | Por quê |
|---|---|---|
| `PushSubscription.endpoint` | `@db.VarChar(512)` ⚠⚠ | É **`@unique`**. Endpoints de FCM/Mozilla passam fácil de 191. Não pode virar `Text` (InnoDB não indexa `TEXT` sem prefixo). 512 × 4 bytes = 2048 < 3072 (limite do InnoDB com row format `DYNAMIC`) — cabe. |
| `Topic.query` | `@db.VarChar(255)` ⚠ | O `.slice(0, 200)` citado acima. |
| `Article.title`, `Topic.title`, `ReleaseEvent.title`, `PushNotification.title` | `@db.VarChar(255)` | Manchetes passam de 191 com frequência. |
| `Article.seoTitle`, `Category.seoTitle` | `@db.VarChar(255)` | — |
| `Article.canonicalUrl`, `coverImageUrl`, `videoUrl`, `videoThumbnailUrl` | `@db.VarChar(1024)` | URLs de CDN com parâmetros passam de 191 rotineiramente. |
| `Franchise.heroImageUrl`, `logoUrl`; `Author.avatarUrl`; `CommentAuthor.avatarUrl`; `AffiliateOffer.offerUrl`, `imageUrl`; `PushNotification.url`, `iconUrl`; `Topic.sourceUrl` | `@db.VarChar(1024)` | Idem. `offerUrl` é link de afiliado com código de rastreio — dos mais longos que existem. |
| `Subscriber.signupUserAgent`; `StaffSession.userAgent`; `CommentSession.userAgent`; `PushSubscription.userAgent` | `@db.VarChar(512)` | User-Agents modernos passam de 191 com folga. |
| `Article.coverImageAlt`, `PushNotification.body`, `AffiliateOffer.productName` | `@db.VarChar(512)` | — |

**Não precisam de anotação** (cabem em 191 com folga e vários são índice único): todos os `slug`, `tokenHash` (SHA-256 hex = 64), `dedupeHash`, `email`, `p256dh`, `auth`, `ipHash`, `emailHash`, `providerAccountHash`, `status`, `format`, `band`, `kind`, `systemRole`, `currency`, `region`, `connectorId`, `dimension`, `weightsVersion`, `eventType`, `entityType`, `entityId`, `action`.

> **Regra prática para a revisão:** todo campo que um humano digita livremente ou que carrega URL vira `Text` ou `VarChar` longo. Todo campo de vocabulário fechado, hash ou slug fica no padrão.

### 3.4 Diferenças de comportamento (não bloqueiam, mas mudam o sistema)

| # | Assunto | Postgres hoje | MySQL/MariaDB | Impacto |
|---|---|---|---|---|
| 1 | **`Json` com `@default`** | `Author.socialLinks Json @default("[]")` (linha 193) e `PipelineEvent.payload Json @default("{}")` (linha 1212) funcionam | Bug conhecido do Prisma: a migração para MySQL é gerada **sem** o default ([prisma#23250](https://github.com/prisma/prisma/issues/23250)) | **Baixo pela aplicação** (o Prisma Client envia o default que conhece do schema), **alto para escrita crua**. O script de migração de dados da seção 6 e qualquer `INSERT` manual precisam passar o valor explicitamente, senão erro de `NOT NULL`. |
| 2 | **Índices `sort: Desc`** | 14 índices usam `(sort: Desc)` e o Postgres os cria descendentes | MariaDB **aceita a sintaxe e ignora** ([MDEV-13756](https://jira.mariadb.org/browse/MDEV-13756), ainda aberto) | Baixo. O InnoDB varre o índice ao contrário; o custo extra é pequeno. Mas convém saber que os índices da home e do `/trending` **não** serão o que o schema diz que são. |
| 3 | **`mode: 'insensitive'`** | `queries.ts:1196,1202` | Opção **inexistente** no conector MySQL — é erro de compilação, precisa ser removida | Baixo, e o comportamento se preserva: com collation `..._ci` (case-insensitive), `contains` já é insensível a maiúsculas. **Bônus:** com collation `_ai_ci` também fica insensível a **acento** — "franquia" passa a achar "Franquía". |
| 4 | **`NULL` distinto em índice único** | `FranchiseFollow.@@unique([franchiseId, commentAuthorId])` depende disso (schema, linhas 1008-1014) | **MySQL/MariaDB se comportam igual**: `NULL` não colide com `NULL` em índice único | **Nenhum.** Comportamento preservado. Vale registrar porque o comentário do schema atribui a propriedade ao Postgres, e alguém poderia "consertar" o que não está quebrado. |
| 5 | **`NULLS LAST`** | `ORDER BY ... publishedAt DESC NULLS LAST` | Sintaxe inexistente. Mas em MySQL `NULL` é o menor valor, então **`ORDER BY publishedAt DESC` já põe os nulos por último** | Nenhum — basta apagar o `NULLS LAST`. A ordenação resultante é idêntica. |
| 6 | **Nível de isolamento** | `READ COMMITTED` (padrão do PG) | `REPEATABLE READ` (padrão do InnoDB) | **Médio, merece teste.** Afeta os padrões otimistas do projeto: o `updateMany` condicional de "assumir pauta" (`api/admin/topics/[id]/route.ts:206`) e a reconciliação de follows no login (`server/follows.ts:275-315`). Sob `REPEATABLE READ` o InnoDB usa *gap locks*, o que muda o perfil de deadlock. Nenhum dos dois padrões fica incorreto, mas ambos precisam de teste de concorrência antes do corte. |
| 7 | **Nomes de tabela e maiúsculas** | `"Article"` com aspas, case-sensitive | `lower_case_table_names` varia por servidor; em Linux normalmente é 0 (case-sensitive) | Baixo, mas **verifique no servidor da Hostinger antes**. Se estiver como 1, os nomes `PascalCase` do schema viram minúsculas e o SQL cru da busca precisa acompanhar. |
| 8 | **Tamanho máximo de linha** | Sem problema | InnoDB limita a linha a ~8 KB (fora `TEXT`/`BLOB`, guardados fora da página) | Nenhum, **desde que** o item 3.3 seja feito. Se muitos campos virarem `VarChar` longo em vez de `Text`, `Article` pode estourar o limite. Outro motivo para preferir `@db.Text` no texto livre. |
| 9 | **Prisma 7** | Sem restrição | **Quebrado com MariaDB** ([prisma#29023](https://github.com/prisma/prisma/issues/29023)) | **Alto no médio prazo.** Ver 1.3. |

### 3.5 O que NÃO muda (a parte tranquila)

- **`Json` de modo geral.** MariaDB guarda como `LONGTEXT`; o Prisma Client serializa e desserializa igual. `Article.blocks`, `Article.reviewData`, `ScoreSnapshot.contributions`, `SignalReading.rawPayload`, `AuditLog.before/after` — todos funcionam sem tocar em nenhuma linha de aplicação. Confirmado pelo precedente do `cariocatech` (`prisma/schema.prisma:134-144`). **Ressalva:** só o `@default`, item 3.4.1.
- **`cuid()` como chave primária.** Gerado no cliente, não no banco. Indiferente.
- **`@relation` / `onDelete: Cascade`.** InnoDB suporta integralmente. As garantias de LGPD por FK (`FranchiseFollow`, `CommentAuthor`) continuam valendo.
- **`@updatedAt`, `@default(now())`.** Geridos pelo Prisma Client.
- **`Float`, `Int`, `Boolean`, `DateTime`.** Mapeiam direto. `Boolean` vira `TINYINT(1)`, transparente.
- **Índices compostos comuns.** Todos portáveis (menos o `Desc`, item 3.4.2).

---

## 4. Parte 2 — Pipeline de curadoria

Arquivo principal: `services/curator/src/pipeline/curate.ts`. Auditoria dos padrões de escrita:

### 4.1 O que está seguro

**`prisma.topic.upsert({ where: { dedupeHash }, update: {}, create: {...} })`** (linha 281). O Prisma implementa `upsert` de forma portável (o `update: {}` vazio é intencional: preserva a precedência editorial de quem chegou primeiro). Nenhuma sintaxe específica de Postgres — nada de `ON CONFLICT` escrito à mão. Funciona igual.

**`prisma.$transaction([...])` em lote** (linha 421). Agrupa `topic.update` + `scoreSnapshot.create` + `signalReading.createMany`. É transação normal; o InnoDB é transacional. Funciona.

**`createMany`** (linha 457). Suportado no MySQL. **Nota:** `skipDuplicates` (usado em `push-sender.ts:172`) é suportado no MySQL — a restrição do Prisma é com SQL Server, não com MySQL. Sem impacto.

**`Json` no `contributions`** (linha 450). Item 3.5 — transparente.

### 4.2 O que precisa de atenção

| Risco | Onde | Detalhe |
|---|---|---|
| ⚠ **`Topic.query` estoura 191** | `curate.ts:283` | `item.title.slice(0, 200)`. **O achado mais concreto do levantamento.** Sem `@db.VarChar(255)`, toda manchete longa derruba a transação inteira da linha 421 — e como isso acontece dentro do curator (processo de fundo), ninguém vê o erro até o score parar de atualizar. |
| ⚠ **Volume de escrita em banco compartilhado** | `curate.ts:421-470` | Cada ciclo grava 1 `update` + 1 `ScoreSnapshot` + N `SignalReading`. O schema descreve `ScoreSnapshot` como *"a tabela que mais cresce do sistema"* (linha 377). **A gravidade depende da pergunta em aberto de §2.1.4:** se o curator roda por cron espaçado, é uma rajada periódica — perfeitamente absorvível. Se rodasse em laço contínuo, seria escrita sustentada, o perfil que planos compartilhados limitam por uso justo. **Confirmar antes (T03)**, e, em qualquer caso, aplicar a política de retenção de 90 dias que o README já prevê mas que não está implementada — senão a tabela cresce sem teto num banco com cota de disco. |
| ⚠ **Pool de conexões × 6 processos** | todo o app | Não é do curator, mas aparece aqui porque o curator seria **mais um** cliente além dos até 6 filhos do LiteSpeed (§2.1.3). Ver R5 e C3. |
| △ **Deadlock sob `REPEATABLE READ`** | `curate.ts:421` vs. escritas do painel | O curator atualiza `Topic` continuamente enquanto um editor pode estar assumindo a mesma pauta (`updateMany` condicional). Os *gap locks* do InnoDB tornam essa disputa mais provável do que no Postgres. Precisa de teste (tarefa T14 da seção 10) e, possivelmente, de política de retentativa. |
| △ **`emotionalTriggers`** | `curate.ts:431` | Escrita de array. Vira `Json` — sem mudança de lógica (item 3.2). |
| ✓ **`aliases` de franquia** | `curate.ts:324,331` | Lido do banco e concatenado em memória (`[franchise.name, ...franchise.aliases]`). Como `Json`, continua array JS. Sem mudança. |

**Conclusão da Parte 2:** o curator **não** tem dependência de sintaxe do Postgres. Os riscos dele são o limite de 191 caracteres (mecânico, resolvível) e o perfil de carga contra um banco compartilhado (de infraestrutura, não de código).

---

## 5. Parte 3 — Busca: proposta concreta

### 5.1 O que precisamos preservar

O contrato atual (`queries.ts:1178-1235`):
- **Entrada:** `searchContent(rawTerm: unknown)`, normalizada por `normalizeSearchTerm`.
- **Saída:** `Promise<SearchResults | null>` com `{ term, articles, franchises, categories }`.
- **Comportamento:** só `status = 'published'`; máximo 24 artigos; ordem = relevância, desempate por data mais recente; nunca lança exceção por texto esquisito digitado pelo usuário; `safeQuery` degrada para vazio se o banco falhar.
- **Arquitetura em duas etapas:** o SQL cru devolve **só os `id`**, e os cards vêm depois do `CARD_SELECT` de sempre. Essa separação é o que faz a busca não divergir das outras listagens.

**Essa arquitetura em duas etapas é a razão pela qual a migração da busca é factível sem tocar em quem chama.** Só o primeiro `$queryRaw` muda. A função mantém assinatura, tipo de retorno e semântica.

### 5.2 Opção A — `FULLTEXT` nativo (avaliação honesta)

**O que se ganha em relação a um `LIKE`:** índice invertido de verdade (custo proporcional ao que casa, não ao tamanho da tabela), relevância por IDF, e operadores de busca booleana.

**O que se PERDE em relação ao `tsvector` de hoje:**

1. **Radicalização (*stemming*) de português — a perda mais séria.** O `to_tsvector('portuguese')` reduz "jogos"→"jogo", "lançamentos"→"lançamento". **MariaDB não tem stemming de nenhuma língua** — nem o plugin `ngram` do MySQL. Consequência direta: hoje, quem busca "jogos" acha uma matéria cujo título diz "jogo". Depois da migração, **não acha mais**. O comentário da migração atual chama o stemming de *"o principal ganho sobre um `ILIKE`"* — e é exatamente ele que se perde. *(Mitigado em parte pelo modo booleano com prefixo, item 5.4.)*

2. **Tamanho mínimo de token = 3 caracteres.** `innodb_ft_min_token_size` vale 3 por padrão. Termos de 2 letras — **"IA"**, "PS", "GT", "3D" — simplesmente **não entram no índice** e nunca são encontrados. Para um portal nerd que cobre IA e consoles, isso não é hipotético. **E em hospedagem compartilhada esse parâmetro não pode ser alterado**: exige editar `my.cnf`, reiniciar o servidor e reconstruir os índices. Num MariaDB no próprio VPS, seria ajustável. **Esta limitação é permanente no cenário Hostinger compartilhado.**

3. **Ranking degrada em acervo pequeno.** A relevância do modo natural é IDF pura. A documentação do MySQL é explícita: *"for very small tables, word distribution does not adequately reflect their semantic value, and this model may sometimes produce bizarre results"*. Um portal recém-lançado é exatamente uma tabela pequena. O `ts_rank` com `setweight` é bem mais estável nesse regime, porque o peso do campo domina a distribuição estatística.

4. **Peso por campo não existe nativamente.** O `setweight(A/B/C)` não tem equivalente. Dá para **emular** (item 5.3), mas é aproximação: as pontuações de `MATCH` não são normalizadas, então os pesos precisam de calibração empírica, não têm garantia matemática.

**O que se GANHA, e é justo registrar:** com collation acento-insensível (`utf8mb4_uca1400_ai_ci` no MariaDB 11.8, ou `utf8mb4_general_ci`), **"lancamento" passa a encontrar "lançamento"**. A migração atual documenta isso como limitação conhecida e aceita (*"o dicionário não remove ACENTOS"*, e a correção foi descartada por exigir a extensão `unaccent`). No MySQL isso vem de graça com a collation. **É uma melhoria real, e ela compensa parte da perda de stemming** — porque erro de acento é provavelmente mais comum na busca real de um leitor brasileiro do que a diferença singular/plural. *(Precisa ser validado empiricamente — tarefa T09.)*

### 5.3 Opção B — `LIKE` sobre título e resumo

**Avaliação séria, não descarte automático:** o acervo é pequeno, e `LIKE '%jogo%'` **acha "jogos"** — resolve o problema do stemming numa das direções. É a mesma abordagem já usada, com sucesso, para franquia e editoria.

**Por que não serve como motor principal:** varredura completa com o corpo do artigo junto (`content` é `LONGTEXT`) não escala, e o comentário do próprio código já explica por que artigo e franquia usam motores diferentes (*"o corpo é grande, o acervo cresce todo dia"*). Além disso, `LIKE` **não tem relevância nenhuma** — o resultado sairia só por data, e o hero da busca deixaria de fazer sentido. Buscar "zelda breath" (duas palavras) devolveria **zero**, porque não existe essa sequência literal.

**Mas serve muito bem como REDE DE SEGURANÇA** — é a proposta do item 5.4.

### 5.4 Opção C — **Recomendada: `FULLTEXT` booleano com prefixo, com peso por campo e fallback `LIKE`**

Combina o melhor dos dois e ataca diretamente as duas piores perdas (stemming e resultado vazio).

**Três decisões de projeto:**

1. **Modo BOOLEANO com sufixo `*`, não modo natural.** Cada termo digitado vira `termo*`. Isso faz "jogo" achar "jogos", "jogador", "jogando" — **recupera boa parte do que o stemming fazia**, por prefixo em vez de radical. Não é equivalente (não pega "correu"→"correr"), mas cobre o caso dominante em português, que é sufixo de plural e derivação. O modo booleano também **ignora o limiar de 50%** (que, de todo modo, é do MyISAM, não do InnoDB).

2. **Peso por campo emulado com três `MATCH` separados**, na proporção **5 : 2 : 1**. Não é número escolhido no chute: os pesos padrão do `ts_rank` são `{D,C,B,A} = {0.1, 0.2, 0.4, 1.0}`; com título em A, resumo em B e corpo em C, a proporção é `1.0 : 0.4 : 0.2` = **5 : 2 : 1**. Preserva a intenção original — *"'Zelda' no TÍTULO vence 'Zelda' citado de passagem no meio de um texto sobre outra coisa"*.

3. **Higienização do termo antes do `AGAINST`, pelo mesmo motivo que hoje se usa `websearch_to_tsquery` em vez de `to_tsquery`.** O comentário do código é claro: o parser precisa *"aceitar qualquer texto humano sem lançar exceção"*. No modo booleano, os caracteres `+ - > < ( ) ~ * " @` são operadores, e um `@` digitado por engano vira erro — **e um erro 500 numa busca**. Removê-los na aplicação preserva exatamente a garantia atual. **Isso não é defesa contra injeção** (essa continua sendo a parametrização do `$queryRaw`); é defesa contra erro de sintaxe do parser de full-text.

**Helper de higienização** (novo, em `queries.ts`, ao lado de `normalizeSearchTerm`):

```ts
/**
 * Converte o termo humano em expressão do modo BOOLEANO do MySQL/MariaDB.
 *
 * POR QUE ESTA FUNÇÃO EXISTE — é o substituto direto do `websearch_to_tsquery`.
 * O motivo é o mesmo que está documentado na versão Postgres: no modo booleano,
 * `+ - > < ( ) ~ * " @` são OPERADORES. Um `@` digitado por engano vira erro de
 * sintaxe, e um erro de sintaxe numa busca vira 500 para o leitor. Removemos os
 * operadores para que qualquer coisa que um humano digite continue sendo uma
 * busca válida — exatamente a garantia que temos hoje.
 *
 * ATENÇÃO: isto NÃO é proteção contra injeção de SQL. Essa proteção continua
 * sendo a parametrização do `$queryRaw` (o valor vai como parâmetro ligado,
 * jamais concatenado). Confundir as duas coisas levaria alguém a "otimizar"
 * removendo a parametrização por achar que a sanitização já basta.
 *
 * O sufixo `*` é o que recupera parte do stemming que o Postgres nos dava de
 * graça: "jogo*" casa jogo, jogos, jogador. Não é equivalente a radicalização
 * (não liga "correu" a "correr"), mas cobre o caso dominante do português, que
 * é plural e sufixo de derivação.
 *
 * Tokens com menos de 3 caracteres são DESCARTADOS porque o índice do InnoDB
 * não os contém (`innodb_ft_min_token_size` = 3, imutável em hospedagem
 * compartilhada). Mantê-los não acharia nada e ainda arriscaria zerar a busca
 * inteira; o fallback `LIKE` é quem cobre esse caso.
 */
export function toBooleanFtsQuery(term: string): string | null {
  const tokens = term
    .replace(/[+\-><()~*"@]/g, ' ')  // operadores do modo booleano
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;   // sinaliza "vá direto para o fallback"
  return tokens.map((t) => `${t}*`).join(' ');
}
```

**Índices necessários** (migração escrita à mão, mesmo padrão já adotado hoje para a coluna gerada):

```sql
-- ÍNDICE COMBINADO: é o do WHERE. Decide QUEM entra no resultado.
ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_all` (`title`, `excerpt`, `content`);

-- ÍNDICES POR CAMPO: são os do ORDER BY. Decidem a ORDEM.
-- O MySQL exige um índice FULLTEXT para cada lista de colunas usada num MATCH;
-- sem estes três, `MATCH(title)` é erro, não apenas lentidão.
ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_title`   (`title`);
ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_excerpt` (`excerpt`);
ALTER TABLE `Article` ADD FULLTEXT INDEX `Article_fts_content` (`content`);
```

> **Custo dos quatro índices:** escrita de artigo fica mais cara (quatro índices invertidos a manter). É aceitável e a assimetria é a certa: publica-se dezenas de matérias por dia e faz-se buscas o tempo todo. Vale notar que **isso é mais caro que hoje**, onde uma coluna `STORED` única alimenta um índice GIN.

**A consulta — substitui exatamente o `$queryRaw` da linha 1187:**

```ts
// `ftsQuery` já veio de `toBooleanFtsQuery`; aparece 4 vezes, sempre como
// PARÂMETRO LIGADO (o Prisma envia como `?`), nunca concatenado.
//
// `ORDER BY ... publishedAt DESC` (sem `NULLS LAST`): no MySQL, NULL é o menor
// valor, então DESC já joga os nulos para o fim — mesmo resultado da cláusula
// explícita do Postgres, sem precisar dela.
prisma.$queryRaw<{ id: string }[]>`
  SELECT a.id
  FROM \`Article\` a
  WHERE a.\`status\` = 'published'
    AND MATCH(a.\`title\`, a.\`excerpt\`, a.\`content\`)
        AGAINST (${ftsQuery} IN BOOLEAN MODE)
  ORDER BY
    ( 5.0 * MATCH(a.\`title\`)   AGAINST (${ftsQuery} IN BOOLEAN MODE)
    + 2.0 * MATCH(a.\`excerpt\`) AGAINST (${ftsQuery} IN BOOLEAN MODE)
    + 1.0 * MATCH(a.\`content\`) AGAINST (${ftsQuery} IN BOOLEAN MODE)
    ) DESC,
    a.\`publishedAt\` DESC
  LIMIT 24
`
```

**A rede de segurança** — roda **só** quando o full-text devolve zero (ou quando `toBooleanFtsQuery` devolveu `null`, caso do termo de 2 letras). Custo zero no caminho feliz:

```ts
// FALLBACK. Cobre os dois buracos conhecidos do FULLTEXT do InnoDB:
//   1. termos com menos de 3 caracteres ("IA", "PS"), que não estão no índice;
//   2. buscas por pedaço de palavra no MEIO ("elda" achando "Zelda").
// Só título e resumo — varrer `content` (LONGTEXT) sem índice é o que não pode.
// A ordem é só por data: `LIKE` não tem relevância, e fingir que tem seria pior
// do que assumir. Sem `mode: 'insensitive'`: a collation `_ai_ci` já garante
// insensibilidade a caixa E a acento.
prisma.article.findMany({
  where: {
    status: 'published',
    OR: [{ title: { contains: term } }, { excerpt: { contains: term } }],
  },
  select: { id: true },
  orderBy: { publishedAt: 'desc' },
  take: 24,
})
```

**As outras duas consultas de `searchContent` (franquia e editoria)** mudam **só** pela remoção de `mode: 'insensitive'` (linhas 1196 e 1202). O comportamento se preserva pela collation — e melhora, ficando também insensível a acento.

### 5.5 Por que NÃO um serviço externo

Foi considerado e descartado: Algolia, Meilisearch em nuvem, Typesense, Elasticsearch.

- **Contradiz a motivação da migração.** O objetivo declarado é **cortar custo** e **eliminar ida de rede externa**. Um serviço de busca hospedado acrescenta os dois de volta — e desta vez no caminho da requisição do leitor.
- **A escala não justifica.** Um portal com centenas a poucos milhares de matérias resolve busca dentro do banco. A régua para reconsiderar é concreta: **acervo passando de ~50 mil matérias, ou a busca virando fonte relevante de tráfego**.
- **Meilisearch auto-hospedado** seria a alternativa honesta se a busca fosse crítica: é gratuito, tem tolerância a erro de digitação e stemming de verdade. **Mas não é executável nesta infraestrutura:** hospedagem compartilhada não roda um segundo serviço persistente (é a mesma limitação que já deixa em aberto como o curator roda — §2.1.4). Ele só voltaria à mesa se o projeto migrasse para um VPS. **Fica registrado como o plano para esse cenário**, não para hoje.

---

## 6. Parte 4 — Plano de migração de dados

### 6.1 Premissas

Dados reais em produção: matérias publicadas, comentários de leitores, contas de redação com senha já trocada por pessoas de verdade, seguidores de franquia, e a série temporal do curator (`ScoreSnapshot` + `SignalReading`, as tabelas que mais crescem).

**Não existe ferramenta pronta boa para este caminho.** Registrando para evitar uma pesquisa perdida: o `pgloader` migra **para** o Postgres, não a partir dele. O `pg_dump` produz SQL de Postgres, que o MySQL não lê. Conversores genéricos de dump não sabem transformar `text[]` em JSON nem respeitar a ordem das chaves estrangeiras.

**Portanto: um script de migração dedicado, com dois Prisma Clients.** É a abordagem certa aqui, e por razões concretas:
- As transformações (`String[]` → `Json`) são três linhas de TypeScript em vez de expressões regulares sobre um dump.
- Reaproveita a tipagem do Prisma: um campo esquecido é erro de compilação, não linha faltando descoberta em produção.
- Permite verificar (contar, comparar) no mesmo processo que migra.

### 6.2 Estratégia de corte: janela curta, sem downtime de LEITURA

Foi avaliado o *dual-write* (escrever nos dois bancos durante a transição) e **descartado**: exige código novo em todo caminho de escrita, e esse código é jogado fora depois. Risco alto, para economizar uma janela de madrugada.

**A abordagem recomendada — leitor nunca vê o site fora do ar:**

| Fase | Duração | Site (leitura) | Escritas | Banco ativo |
|---|---|---|---|---|
| 0. Preparação | dias antes | Normal | Normais | Neon |
| 1. Congelar escrita | ~1 min | **Normal** | Bloqueadas | Neon |
| 2. Copiar dados | ~10–30 min | **Normal** (serve da Neon) | Bloqueadas | Neon (só leitura) |
| 3. Verificar | ~10 min | **Normal** | Bloqueadas | Neon (só leitura) |
| 4. Virar a chave | ~30 s | **Reinício do app no hPanel** | Bloqueadas | → MySQL |
| 5. Descongelar | ~1 min | Normal | Normais | MySQL |
| 6. Observação | 7 dias | Normal | Normais | MySQL (Neon **intacta**) |

**Indisponibilidade de leitura: apenas o reinício do app no hPanel (segundos).** Indisponibilidade de escrita (comentar, seguir, inscrever-se na newsletter, publicar matéria): ~30–50 minutos. Fazer entre 4h e 6h (horário de Brasília), o vale de tráfego de um portal de notícias.

**Como congelar as escritas** (a decidir com o dono — a primeira é a mais simples e a mais segura):
- **(a) Recomendado.** Suspender o cron do curator (a maior fonte de escrita — §2.1.4) + uma variável `READ_ONLY=1` que faz as rotas de mutação devolverem 503 com uma mensagem honesta ("estamos em manutenção rápida, volte em 30 minutos"). Exige um pequeno guard, mas ele é reutilizável para sempre.
- **(b)** Bloquear os `POST`/`PATCH`/`DELETE` de `/api/` e `/admin` por `.htaccess` (LiteSpeed lê `.htaccess`). Zero código, mas devolve erro cru.

> ⚠ **Cuidado específico deste ambiente:** com até 6 processos-filho do LiteSpeed (§2.1.3), uma variável de ambiente só passa a valer para **todos** eles depois do restart da aplicação. Não presuma que o `READ_ONLY=1` valeu no instante em que foi salvo — **confirme** que as escritas estão realmente recusadas antes de começar a copiar. Copiar com um filho antigo ainda gravando na Neon é o caminho para contagens que não batem.

### 6.3 Fase 0 — Preparação (dias antes, sem risco)

1. Criar o banco MySQL na Hostinger (**separado** — ver seção 7) com collation **`utf8mb4_uca1400_ai_ci`** (MariaDB 11.8). *Insensível a caixa e a acento* — é o que preserva o comportamento do `mode: 'insensitive'` e o que dá o ganho de acento na busca.
2. **Definir o host da `DATABASE_URL`.** Como a aplicação roda **na mesma hospedagem** do banco, o caminho de produção deve ser `localhost` (ou `127.0.0.1`) — é o que elimina a ida de rede e o que torna TLS desnecessário em produção (§9.3). ⚠ **Lição do cariocatech, válida para as máquinas de DESENVOLVIMENTO:** para rodar `db push`/`db:seed`/scripts de migração **da sua máquina**, é preciso o MySQL Remoto — e ali o hostname exibido no hPanel (`srv892.hstgr.io`) **não aceitou conexão**; só o **IP do servidor** funcionou (hPanel → Bancos de Dados → MySQL Remoto). Se der *"can't reach database server"*, **tente o IP antes de procurar qualquer outra causa**.
3. ⚠ **Definir `connection_limit` na `DATABASE_URL`** (condição C3). Com até 6 filhos do LiteSpeed, o padrão do Prisma (`num_cpus × 2 + 1`, que num host compartilhado pode ser alto) multiplicado por 6 estoura o `max_user_connections`. Começar com `?connection_limit=3&pool_timeout=20` e ajustar medindo. **Conferir o limite real do plano antes** (`SHOW VARIABLES LIKE 'max_user_connections'`).
4. Verificar `lower_case_table_names` no servidor (item 3.4.7) e a versão: `SELECT VERSION();` (esperado `11.8.x-MariaDB`).
5. Criar a branch com **todas** as mudanças de schema e código das seções 3 e 5. Rodar a suíte de testes contra um MariaDB local **da mesma versão** (Docker), com o banco semeado por `db:seed`.
6. **Ensaio geral completo** contra uma cópia da produção. Esta etapa não é opcional: é onde os problemas aparecem enquanto ainda são baratos. Medir o tempo — ele dimensiona a janela real.
7. Confirmar `binaryTargets` (já corretos no schema, linha 29).

### 6.4 Fase 1-2 — Congelar e copiar

**Ordem de inserção obrigatória** (derivada das chaves estrangeiras do schema — inserir fora de ordem quebra por FK):

```
1  Category
2  Subcategory        → Category
3  Franchise          → Category
4  Tag
5  Author
6  Topic              → Category
7  TopicFranchise     → Topic, Franchise
8  CommentAuthor
9  Article            → Category, Subcategory, Author, Topic
10 ArticleFranchise / ArticleTag / LiveUpdate
11 AffiliateOffer → ArticleAffiliateOffer
12 ReleaseEvent       → Franchise
13 ScoreSnapshot / SignalReading      → Topic     (as maiores)
14 ConnectorHealth / Subscriber
15 PushSubscription / PushNotification → Article  → PushDelivery
16 FranchiseFollow    → Franchise, CommentAuthor
17 StaffSession / CommentSession
18 Comment            → Article, CommentAuthor, Comment(parentId)  ⚠
19 PipelineEvent / PipelineRun / AuditLog
```

⚠ **`Comment` tem auto-referência** (`parentId` → `Comment.id`). Inserir **ordenado por `createdAt` ascendente**: uma resposta é sempre criada depois do comentário que responde, então o pai já estará lá. *Se algum registro legado violar isso*, o plano B é inserir tudo com `parentId = null` e aplicar os vínculos num segundo passo — mas o primeiro caminho deve bastar.

**Transformações a aplicar** (as únicas do processo):

```ts
// Os 8 campos `String[]` → `Json`. O Prisma Client já devolve `string[]` na
// origem e aceita array como Json no destino: a "transformação" é passar adiante.
// O `?? []` não é paranoia: `Json` NOT NULL sem default (bug do item 3.4.1)
// rejeita `undefined`, e aí a linha falha na carga em vez de na leitura.
aliases:           src.aliases ?? [],
expertiseAreas:    src.expertiseAreas ?? [],
emotionalTriggers: src.emotionalTriggers ?? [],
tldr:              src.tldr ?? [],
preferredCategories: src.preferredCategories ?? [],
preferredFranchises: src.preferredFranchises ?? [],

// `Json` com default declarado no schema mas AUSENTE no banco (item 3.4.1).
// Preencher SEMPRE, explicitamente.
socialLinks: src.socialLinks ?? [],
payload:     src.payload ?? {},

// `searchVector` NÃO é copiado: não existe no destino. Os índices FULLTEXT são
// construídos pelo próprio MySQL a partir de title/excerpt/content.
```

**Preservar `id`, `createdAt` e `updatedAt` originais.** Os `id` são `cuid()` gerados na aplicação, então copiá-los mantém **todas** as chaves estrangeiras válidas — e, principalmente, mantém **as URLs das matérias já indexadas pelo Google**. Para `updatedAt` (que o Prisma sobrescreve sozinho), usar `$executeRaw` ou aceitar a atualização; a decisão precisa ser consciente, porque `updatedAt` alimenta o `sitemap.xml` (`queries.ts`, `getAllPublishedSlugs`).

**Lotes de 500 a 1000 registros** para `ScoreSnapshot` e `SignalReading` — são as maiores e não cabem em memória de uma vez.

### 6.5 Fase 3 — Verificação (o critério de aceite do corte)

**Sem os quatro blocos abaixo verdes, NÃO se vira a chave.**

**(a) Contagem por tabela** — automatizável, e o script deve **abortar** na primeira divergência:

```ts
for (const model of TODOS_OS_MODELS) {
  const [origem, destino] = await Promise.all([pg[model].count(), my[model].count()]);
  if (origem !== destino) throw new Error(`DIVERGÊNCIA em ${model}: ${origem} → ${destino}`);
}
```

**(b) Integridade de negócio** — as contagens podem bater com os dados errados:

| Verificação | Como |
|---|---|
| Matérias publicadas | `count({ where: { status: 'published' } })` idêntico |
| **Corpo íntegro** ⚠ | `SUM(LENGTH(content))` nos dois bancos. **É o detector do truncamento em 191** (item 3.3). Se divergir, a anotação `@db.Text` faltou em algum lugar. |
| Blocos | Nº de artigos com `blocks` não nulo idêntico; e o **array desserializa** como array em amostra |
| Comentários por status | `groupBy(['status'])` idêntico |
| Árvore de respostas | Nº de comentários com `parentId` não nulo idêntico, e **zero órfãos** |
| Seguidores | `SUM(Franchise.followerCount)` vs. `count(FranchiseFollow)` — a mesma relação de antes (nota: já podem divergir hoje; o que importa é **manter a mesma diferença**) |
| Arrays | Amostra de 20 artigos: `tldr` volta como array de strings com o mesmo tamanho |
| Afiliados | `hasAffiliateLinks = true` bate com quem tem `ArticleAffiliateOffer` |

**(c) Nenhuma sessão quebrada** — o requisito citado explicitamente:

O mecanismo é `tokenHash` (SHA-256 do token opaco do cookie) e o token vive **no navegador**, não no banco. **Copiar as linhas de `StaffSession` preserva os logins**: ninguém da redação é deslogado. Verificar:
- `count(StaffSession where expiresAt > now())` idêntico nos dois bancos;
- idem para `CommentSession` (leitores logados por Discord/Google);
- **`Author.passwordHash` byte a byte idêntico** ⚠ — as senhas foram trocadas por pessoas de verdade. O formato é `scrypt$N$r$p$sal$hash` (`packages/db/src/password.ts`). **Comparar os hashes de todas as contas ativas, não uma amostra.** Um hash corrompido = alguém trancado do lado de fora do painel.
- Conferir que nenhum `passwordHash` virou `NULL` — `NULL` é estado legítimo no schema ("assina mas não tem acesso"), então um erro aqui **não** dispara constraint nenhuma: falha em silêncio e só aparece quando a pessoa tenta entrar.

**(d) Verificação funcional da busca** ⚠ — **antes** do corte, contra o banco novo já carregado:

Montar uma planilha com **30 buscas reais** (tiradas do log, ou as que a redação usa) e comparar lado a lado com a produção atual. É o **único** jeito honesto de saber se a Opção C ficou aceitável. Conferir obrigatoriamente:
- singular/plural ("jogo" vs. "jogos") → deve funcionar pelo prefixo;
- **acento** ("lancamento") → deve **melhorar**;
- **termo de 2 letras** ("IA") → **vai cair no fallback**; confirmar que o fallback pega;
- duas palavras ("zelda breath");
- nome de franquia (deve casar também na aba de franquias);
- termo que hoje devolve vazio (deve continuar vazio, sem erro).

**Este é o momento de calibrar os pesos 5/2/1.** Se título estiver perdendo para corpo, ajustar antes de virar a chave — depois fica mais caro.

### 6.6 Fase 4-5 — Virar a chave

1. **Guardar a `DATABASE_URL` antiga da Neon** (é o botão de rollback) — em gerenciador de senhas ou num arquivo fora do repositório. **Nunca commitada.**
2. **Trocar a `DATABASE_URL`** nas variáveis de ambiente do app no hPanel, apontando para `localhost` e **com o limite de pool** (C3):
   ```
   mysql://USUARIO:SENHA@localhost:3306/BANCO?connection_limit=3&pool_timeout=20
   ```
3. **Publicar o build novo** (schema + código das seções 3 e 5) pelo fluxo de deploy por git já em uso, e **reiniciar a aplicação pelo hPanel**.
   > ⚠ Conferir que **todos** os processos-filho subiram com a variável nova. O modo mais confiável é uma rota de diagnóstico que informe a qual banco aquele processo está ligado — o histórico da branch `deploy-standalone` mostra que já foi preciso um `/api/debug-prisma` para exatamente esse tipo de dúvida.
4. **Fumaça, nesta ordem:** `/api/health` → home → uma matéria → **busca** → login no `/admin` (**a sessão precisa continuar viva**) → comentar → seguir franquia.
5. **Religar o curator** e acompanhar o **primeiro ciclo inteiro** no log — é onde o limite de 191 em `Topic.query` apareceria (§4.2).

### 6.7 Rollback

**O plano de rollback é forte porque a Neon fica INTACTA.** Nada é apagado lá. Durante a cópia ela está em modo de leitura; depois do corte, ela simplesmente para de receber escritas.

| Quando o problema aparece | O que fazer | Perda |
|---|---|---|
| Durante a cópia (fases 2-3) | Abortar o script. `TRUNCATE` no MySQL, corrigir, recomeçar. | **Nenhuma.** A Neon nem foi tocada. |
| Verificação falha (fase 3) | Não virar a chave. Descongelar as escritas. Site volta ao normal na Neon. | **Nenhuma.** |
| Nos primeiros minutos depois do corte | Repor a `DATABASE_URL` da Neon no hPanel e reiniciar o app. | Só as escritas feitas no MySQL depois do corte (minutos). |
| Dias depois (ex.: a busca decepcionou) | ⚠ **Aqui o rollback deixa de ser grátis.** A Neon está desatualizada em dias de comentários, follows e matérias. Voltar exige **migrar de volta** (o mesmo script, invertido). | Alta se improvisado. |

**Duas regras que decorrem disso:**
1. **Manter a Neon viva e paga (se preciso) por no mínimo 7 dias após o corte.** Desligar antes é economizar dezenas de reais para arriscar o acervo. O período de observação **é** o seguro.
2. **A busca precisa ser aprovada ANTES do corte** (item 6.5d), não depois. Ela é justamente o problema que só apareceria dias depois — quando o rollback já ficou caro.

**E, independentemente disso:** configurar `mysqldump` diário para **fora da Hostinger** antes de considerar a migração concluída. O README já registra isso como pendência não resolvida, e a regra que ele mesmo enuncia continua valendo — *"não pode ser o mesmo provedor do banco"*. Com banco e site na mesma conta Hostinger, um incidente de conta leva os dois.

---

## 7. Parte 5 — Provisionamento: banco próprio ou compartilhado com o cariocatech?

### **Banco PRÓPRIO, separado. Sem ressalvas.**

O argumento decisivo é técnico e encerra a discussão antes dos outros:

1. **Colisão de nomes de tabela — impedimento absoluto.** Os dois schemas declaram um model `Category`. Num único banco MySQL, `Category` do Ortus Pixel e `Category` da CariocaTech seriam **a mesma tabela**. O MySQL não tem *schemas* dentro de um banco como o Postgres (`?schema=public` na `DATABASE_URL` atual não tem equivalente). Compartilhar exigiria renomear tabelas — mudança grande de schema nos dois projetos, exatamente o oposto de "não se distanciar".

E os que valeriam mesmo sem o primeiro:

2. **Raio de explosão.** `prisma migrate deploy` errado, ou um `db push` distraído, atingiria os dois negócios ao mesmo tempo. São **duas empresas diferentes**; um problema numa loja de informática não pode derrubar um portal de notícias.
3. **Restauração de backup vira dano.** Restaurar o backup da CariocaTech de ontem, num banco compartilhado, **sobrescreveria** os comentários e as matérias do Ortus Pixel do mesmo período. Um incidente pequeno num projeto vira perda de dados no outro.
4. **Credenciais.** A Hostinger cria um usuário por banco. Bancos separados = a `DATABASE_URL` do Ortus Pixel **não abre** o banco da loja. Isso importa **mais** agora que se sabe que os dois sites moram na mesma conta e no mesmo sistema de arquivos: sem separação de banco, a única barreira entre os dois negócios seria a permissão de arquivo. É privilégio mínimo aplicado à camada que mais importa.
5. **Ciclo de vida.** Vender, migrar ou desligar um dos projetos deve ser uma operação independente. Bancos compartilhados amarram os dois para sempre.
6. **Diagnóstico.** Uma consulta lenta é atribuível ao projeto certo na hora.

**Custo de separar:** nenhum. Planos da Hostinger permitem múltiplos bancos MySQL, e o limite raramente é 1.

**Nomeação sugerida:** `u754239208_ortuspixel` com usuário `u754239208_ortus`, senha própria (gerada, nunca reaproveitada da CariocaTech — a senha da loja não pode abrir o banco do portal).

### 7.1 As opções reais, dada a infraestrutura de verdade

Com o site em hospedagem compartilhada (§2.1), o leque é este — e ele é curto, porque instalar um serviço de banco no sistema **não é possível** neste produto:

| Cenário | Latência | Custo | Veredito |
|---|---|---|---|
| **A.** **MySQL/MariaDB da própria conta** (`localhost`) | Interna, sem rede | **R$ 0** | ✅ **Recomendado.** Elimina o cold start e a ida externa. Caminho já validado pelo `cariocatech`. |
| **B.** Continuar na Neon, plano **gratuito** | Externa + **cold start de 300 ms–1 s** | R$ 0 | ⚠ O problema descrito em §1.1. É o estado atual. |
| **C.** Continuar na Neon, plano **pago** | Externa, sem cold start | ~US$ 19/mês | Legítimo. Preserva a busca integralmente (§1.2). |
| **D.** Postgres gerenciado de terceiro (Supabase, Railway…) | Externa | Varia | Troca de fornecedor sem resolver a ida de rede. Só faria sentido se a Neon especificamente decepcionasse. |
| ~~**E.** Instalar Postgres/MariaDB no servidor~~ | — | — | ❌ **Impossível** em hospedagem compartilhada. Era a "Opção Zero" da revisão 1 deste documento, escrita sob a premissa errada de que havia um VPS. |

**Três confirmações antes de começar o cenário A** (tarefas T02-T04):
- `max_user_connections` do plano comporta até 6 processos-filho × `connection_limit` + o curator (C3);
- **como o curator roda** e com que frequência (§2.1.4) — define o perfil de escrita;
- a cota de disco do plano comporta o crescimento de `ScoreSnapshot`/`SignalReading` **com** a política de retenção de 90 dias aplicada.

---

## 8. Riscos consolidados

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | **A busca piora perceptivelmente** (sem stemming, cego a 2 letras) | **Alta** | Médio | Opção C (prefixo + fallback). **Validar com 30 buscas reais ANTES do corte** (6.5d). Aceitar conscientemente — é a condição C1. |
| R2 | **Truncamento em 191 quebra escrita** | **Alta se a seção 3.3 for feita às pressas** | **Alto** | Revisar campo a campo; `SUM(LENGTH(content))` como detector (6.5b). Condição C2. |
| R3 | **`Topic.query` derruba o curator** | **Alta** | Alto | `@db.VarChar(255)`. Acompanhar o primeiro ciclo inteiro no log (6.6.5). |
| R4 | **Esgotar `max_user_connections`** — até 6 filhos do LiteSpeed × pool do Prisma, mais o curator | **Alta sem C3** | **Alto** (site fora do ar, não degradado) | `connection_limit=3` explícito na `DATABASE_URL` (C3). Conferir o limite do plano antes (T04). **O risco novo mais provável desta migração.** |
| R5 | Cota de disco / uso justo do plano compartilhado | Média | Alto | Confirmar frequência real do curator (§2.1.4) e **implementar a retenção de 90 dias** de `ScoreSnapshot`/`SignalReading`, hoje só prevista no README. |
| R6 | Deadlock sob `REPEATABLE READ` | Baixa-Média | Médio | Teste de concorrência (T14). Retentativa se preciso. |
| R7 | **Congelamento no Prisma 6** | **Certa** | Médio (cresce com o tempo) | Fixar a versão. Acompanhar [prisma#29023](https://github.com/prisma/prisma/issues/29023). Já é a realidade do `cariocatech`. |
| R8 | Senha da redação corrompida na cópia | Baixa | **Alto** | Comparar `passwordHash` de **todas** as contas ativas (6.5c). |
| R9 | Rollback tardio | Baixa | **Alto** | Neon viva por 7 dias. Aprovar a busca antes do corte. |
| R10 | Hostname do hPanel não conecta (nas máquinas de dev) | **Alta** (aconteceu no cariocatech) | Baixo | Usar o IP. Já documentado (6.3.2). |
| R11 | **Backup e site na mesma conta** | Certa se não tratada | **Crítico** | `mysqldump` diário para **fora** da Hostinger (C4). Vale desde o primeiro dia. |
| ~~R-old~~ | ~~MySQL remoto sem TLS na internet pública~~ | — | — | **Deixou de existir** com a infraestrutura real: a conexão é `localhost`. Ver §9.3. |

---

## 9. O que fica genuinamente diferente (a parte honesta)

O dono pediu para não se distanciar do que existe. Aqui está, sem maquiagem, o que **muda de verdade**.

### 9.1 A busca fica pior em três aspectos concretos

**Isto não tem como ser escondido, e não deve ser.**

1. **Singular e plural param de se ligar sozinhos.** Hoje "jogos" acha "jogo" porque o Postgres radicaliza com o dicionário de português. O MariaDB **não tem stemming de língua nenhuma**. A Opção C recupera boa parte pelo prefixo (`jogo*` acha "jogos"), mas **só na direção do prefixo**: quem busca "jogos" **não** acha "jogo". Hoje acha.
2. **Termos de duas letras somem do índice.** "IA", "PS", "3D", "GT" — invisíveis para o full-text, porque `innodb_ft_min_token_size` vale 3 e **não pode ser alterado em hospedagem compartilhada**. O fallback `LIKE` cobre, mas só por título e resumo, e sem relevância. Para um portal que cobre **IA**, isso não é detalhe.
3. **A ordenação por relevância fica menos previsível em acervo pequeno.** A documentação do MySQL avisa que a relevância por IDF *"may sometimes produce bizarre results"* em tabelas pequenas. O `ts_rank` com `setweight` é mais estável — e o portal é, hoje, uma tabela pequena.

**E fica melhor em um aspecto:** **acento deixa de importar.** "lancamento" passa a achar "lançamento" — limitação que a migração atual documenta como conhecida e aceita. Isso vale para a busca de artigo **e** para as buscas de franquia e editoria.

**Balanço honesto:** para o leitor típico, o ganho de acento provavelmente compensa parte da perda de plural. Mas **a busca não fica igual**, e existe uma classe de consulta ("IA", "jogos"→"jogo") que hoje funciona e passa a não funcionar bem.

### 9.2 O que muda fora da busca

| Área | Hoje | Depois |
|---|---|---|
| **Interface do leitor** | — | **Nada muda.** Nem uma linha de CSS, nem um componente. A promessa de "não distanciar" é integralmente cumprida no visual. |
| **URLs / SEO** | — | **Nada muda** (os `id` e `slug` são preservados). |
| **Painel da redação** | — | **Nada muda** na tela. Sessões e senhas preservadas. |
| **TL;DR, gatilhos, aliases** | Arrays nativos | `Json`. **Comportamento idêntico** — continuam arrays no TypeScript. |
| **Segmentação de push** | Filtrada no banco | Filtrada em memória (item 3.2a). Resultado igual; escala pior lá na frente. |
| **Índices `Desc`** | Descendentes de verdade | MariaDB ignora. Varredura reversa; diferença imperceptível nesta escala. |
| **Manutenção do Prisma** | Livre | **Preso no v6** enquanto o #29023 não for resolvido. |
| **Backup** | Responsabilidade da Neon (mas **não configurado**) | Responsabilidade nossa. `mysqldump` diário para fora da Hostinger — **obrigatório** (C4). |
| **Cold start** ⭐ | 300 ms–1 s na primeira visita após 5 min ociosos | **Eliminado.** O maior ganho da migração para o leitor. |
| **Latência por consulta** | Ida à internet pública | Interna à hospedagem. |
| **Conexões** | Pooler da Neon absorve os 6 filhos do LiteSpeed | ⚠ Precisa de `connection_limit` explícito (C3/R4). |

### 9.3 Segurança: o que melhora e os dois pontos a vigiar

**Boa notícia, e ela vem da infraestrutura real:** a migração **melhora** a postura de segurança do transporte **no caminho de produção**. Hoje, toda consulta sai da hospedagem e atravessa a internet pública até a Neon — protegida por TLS (`sslmode=require`), mas ainda assim exposta a tudo que uma rede pública implica. Com o MySQL da própria conta em `localhost`, **o tráfego de produção não chega a tocar a rede**. Um canal que não existe não pode ser interceptado.

> ### ⚠ Correção (2026-08-11, durante a execução dos Blocos 1-2)
>
> **A frase acima vale para PRODUÇÃO, e só para ela.** A revisão 2 deste documento
> concluiu que "o risco deixa de existir" e removeu o alerta de tráfego em texto
> claro. Isso foi longe demais: eliminou-se o risco do caminho de produção
> (`localhost`) e, junto, o registro de que **existe um segundo caminho**.
>
> O caminho de **desenvolvimento e de migração de dados** — máquina de quem
> desenvolve → MySQL Remoto da Hostinger — **atravessa a internet pública**. Ele
> é obrigatório para rodar `db push`, `db:seed` e o script de migração da seção 6
> (a lição do cariocatech, §6.3.2, é sobre exatamente esse caminho). E é
> justamente por ele que passa, uma única vez, **o acervo inteiro do site**:
> matérias, comentários, e-mails de assinantes e os `passwordHash` da redação.
>
> Sem TLS, tudo isso — e a senha do banco, em toda conexão — viaja em texto claro.
> **Portanto:**
>
> - A `DATABASE_URL` de desenvolvimento **deve** carregar `sslaccept=accept_invalid_certs`.
>   Verificado em uso: cifra `ECDHE-RSA-AES256-GCM-SHA384` negociada.
> - `accept_invalid_certs` significa **cifrar sem validar a cadeia** do
>   certificado (o do servidor compartilhado é autoassinado). Protege contra
>   **escuta passiva**, que é o risco dominante numa rede pública; **não** protege
>   contra um adversário ativo capaz de se pôr no meio do caminho. É um
>   compromisso consciente, não uma configuração completa.
> - Confirme com `SHOW STATUS LIKE 'Ssl_cipher'`. **Valor vazio significa SEM
>   criptografia** — e nesse caso o script de migração de dados **não deve rodar**.
> - Nada disso se aplica a produção, onde a conexão é `localhost`.
>
> **Lição de método:** ao corrigir uma premissa errada, conferir se a correção não
> apaga também o que continuava verdadeiro. Aqui, "não existe VPS" estava certo,
> mas daí não segue "não existe caminho de rede".

**Os dois pontos que continuam exigindo disciplina:**

1. ⚠ **Não deixar o MySQL Remoto aberto depois de usar.** Ele será necessário na máquina de desenvolvimento para rodar o script de migração (§6.4) e o `db push`. Ao terminar, **remover a liberação** — em especial, nunca deixar `%` (qualquer origem) cadastrado. Um banco de produção acessível da internet inteira, protegido só por senha, é um convite a força bruta. **Esta é a única janela de exposição que a migração cria, e ela é temporária por escolha, não por natureza.**

2. ⚠ **Backup fora do provedor (C4/R11).** Com site e banco na mesma conta `u754239208`, a superfície de "perder tudo de uma vez" aumenta: um incidente de conta (suspensão, comprometimento de credencial do hPanel, erro de faturamento) atinge os dois ao mesmo tempo. A regra que o próprio README enuncia — *"não pode ser o mesmo provedor do banco"* — passa a valer **com mais força** do que valia com a Neon, porque antes havia separação de fornecedor por acidente de arquitetura. **Perde-se essa separação, e ela precisa ser reposta de propósito.**

**Sem mudança:** as senhas continuam em `scrypt` (`packages/db/src/password.ts`), as sessões continuam opacas com hash no banco, e os hashes de e-mail e de ID de provedor continuam como estão. A migração **não toca** em nenhuma das decisões de minimização de dado da LGPD descritas no schema.

---

## 10. Lista de tarefas ordenada (roteiro de implementação futura)

> Não implementar agora. Este é o roteiro de quem for executar.

### Bloco 0 — Decisão (antes de escrever qualquer código)

| # | Tarefa | Critério de conclusão |
|---|---|---|
| T00 | **Decisão do dono entre migrar (cenário A) e pagar a Neon (cenário C)**, apresentando a tabela de §1.2 — incluindo, explicitamente, que **a busca piora** (§9.1) | Decisão registrada. **Se for C, nada mais desta lista é necessário.** |
| T01 | **Medir o custo real do problema atual:** cronometrar a primeira requisição após 5+ min de ociosidade, comparada com uma requisição "quente" | Número na mão. É a justificativa da migração — e, se o cold start for pequeno na prática, enfraquece o caso e vale reabrir T00. |
| T02 | ⚠ **Responder à pergunta em aberto de §2.1.4:** como e com que frequência o curator roda em produção | Resposta documentada. Dimensiona R5 e a janela de corte. |
| T03 | Conferir `max_user_connections` e a cota de disco do plano | Números na mão; `connection_limit` definido (C3). |
| T04 | Provisionar o banco **próprio**, `utf8mb4_uca1400_ai_ci`, e conferir `VERSION()` e `lower_case_table_names` | Banco criado; MySQL Remoto liberado **só** para o IP de desenvolvimento, com data para fechar (§9.3). |
| T04b | **Corrigir a seção de deploy do `README.md`** (§2.1) | Independente da migração. Impede que a próxima análise repita o erro desta. |

### Bloco 1 — Schema (branch, sem tocar em produção)

| # | Tarefa | Cuidado |
|---|---|---|
| T05 | `provider = "mysql"`; reescrever o cabeçalho do schema (o racional do ADR 0002 muda) | Explicar **por que** mudou, no padrão do projeto. |
| T06 | **Os 8 `String[]` → `Json`** | Não esquecer o `@default("[]")`. |
| T07 | ⚠ **Anotações de tamanho, campo a campo** (seção 3.3) | **A tarefa mais longa e a que mais quebra se apressada.** Começar por `Topic.query`, `Article.content`, `Comment.content`, `PushSubscription.endpoint`. |
| T08 | Remover `searchVector`, o `@@index(Gin)` e o `@default(dbgenerated())` | Some junto a armadilha do `DROP DEFAULT`. |
| T09 | Migração inicial escrita à mão, com os 4 índices `FULLTEXT` (5.4) | Comentar no padrão do projeto. |

### Bloco 2 — Código

| # | Tarefa | Arquivo |
|---|---|---|
| T10 | ⚠ **Reescrever `searchContent`**: `toBooleanFtsQuery` + consulta booleana ponderada + fallback | `apps/web/src/server/queries.ts` |
| T11 | Remover os dois `mode: 'insensitive'` | `queries.ts:1196,1202` |
| T12 | ⚠ **Filtro de push em memória** (3.2a) | `apps/web/src/server/push-sender.ts:98` |
| T13 | Varrer o projeto por quebras de tipo (`tldr`, `aliases` etc. como `Json`) | `npm run typecheck` limpo |
| T14 | ⚠ **Teste de concorrência** sob `REPEATABLE READ`: curator + "assumir pauta" + reconciliação de follows | `topics/[id]/route.ts`, `follows.ts` |
| T15 | Fixar `prisma`/`@prisma/client` em `~6.19.x` com comentário apontando o #29023 | `package.json` |
| T16 | Suíte completa contra MariaDB 11.8 local (Docker), semeado por `db:seed` | `npm test` + `check:classes` verdes |

### Bloco 3 — Migração de dados

| # | Tarefa |
|---|---|
| T17 | Escrever o script de dois clientes, na ordem de FK da seção 6.4, com transformações e lotes |
| T18 | Escrever o script de verificação da seção 6.5 (a, b, c) — **aborta na primeira divergência** |
| T19 | Implementar o congelamento de escrita (6.2a) |
| T20 | **Ensaio geral** contra cópia da produção; **cronometrar** para dimensionar a janela |
| T21 | ⚠ **Planilha das 30 buscas reais** (6.5d) e **calibração dos pesos 5/2/1** |

### Bloco 4 — Corte

| # | Tarefa |
|---|---|
| T22 | Agendar a janela (4h-6h BRT) e comunicar a redação |
| T23 | Executar as fases 1 a 5 da seção 6.2 |
| T24 | Fumaça na ordem do item 6.6.4 — **incluindo login no painel com sessão preexistente** |
| T25 | Acompanhar o **primeiro ciclo inteiro** do curator no log (risco R3) |

### Bloco 5 — Depois

| # | Tarefa |
|---|---|
| T26 | ⚠ **`mysqldump` diário para FORA da Hostinger** (C4/R11). Não fechar a migração sem isso. |
| T26b | ⚠ **Fechar o MySQL Remoto** aberto em T04 (§9.3.1) |
| T27 | Manter a Neon viva por **7 dias**. Só então desligar. |
| T28 | Atualizar `README.md` (ADR 0002, seção de deploy, `.env.*.example`) e registrar as lições, no padrão do cariocatech |
| T29 | **Medir de novo o T01** com o banco novo — é a comprovação de que a migração entregou o que prometeu |
| T30 | Implementar a **retenção de 90 dias** de `ScoreSnapshot`/`SignalReading` (R5) — hoje só existe no papel |
| T31 | Acompanhar a busca por 30 dias. Se a Opção C decepcionar, reavaliar (§5.5) |

---

## 11. Fontes consultadas

- [MySQL — Natural Language Full-Text Searches](https://dev.mysql.com/doc/refman/8.4/en/fulltext-natural-language.html)
- [MySQL — Fine-Tuning Full-Text Search (limiar de 50%, MyISAM)](https://dev.mysql.com/doc/refman/8.0/en/fulltext-fine-tuning.html)
- [MySQL — Full-Text Stopwords](https://dev.mysql.com/doc/refman/8.0/en/fulltext-stopwords.html)
- [MariaDB — Full-Text Index Overview](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/full-text-indexes/full-text-index-overview)
- [MariaDB MDEV-13756 — índice descendente ainda não implementado](https://jira.mariadb.org/browse/MDEV-13756)
- [Prisma — Indexes / `@@fulltext` e o preview `fullTextIndex`](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [Prisma #29023 — Prisma v7 quebrado com MariaDB 10.11+](https://github.com/prisma/prisma/issues/29023)
- [Prisma #23250 — `@default` de `Json` não migrado no MySQL](https://github.com/prisma/prisma/issues/23250)
- [Neon — Connection latency and timeouts (autosuspend e cold start)](https://neon.com/docs/connect/connection-latency)
- [Neon — Benchmarking latency](https://neon.com/docs/guides/benchmarking-latency)
- Precedente interno: `R:\cariocatech\README.md` (seção "Escolha de hospedagem") e `R:\cariocatech\prisma\schema.prisma` (cabeçalho)
- Infraestrutura real: `hosting_listWebsitesV1` e `VPS_getVirtualMachinesV1` da conta `u754239208`; cabeçalho de `server.js` na branch `deploy-standalone`
