/**
 * =============================================================================
 * DADOS FICTÍCIOS PARA ENSAIAR A MIGRAÇÃO
 * =============================================================================
 *
 *   npm run db:seed && npm run db:fixtures && npm run db:rehearse-load
 *
 * ⚠ Só para o banco de DESENVOLVIMENTO. Recusa-se a rodar contra produção.
 *
 * -----------------------------------------------------------------------------
 * POR QUE O `db:seed` NÃO BASTA PARA ESTE FIM
 * -----------------------------------------------------------------------------
 * O `db:seed` existe para dar ao site uma home apresentável em desenvolvimento —
 * e cumpre isso muito bem. Mas ele povoa só 12 das 29 tabelas. As 17 que ficam
 * vazias não são um resto irrelevante: são justamente onde moram os casos que
 * podem quebrar a migração em silêncio.
 *
 * Um ensaio que passa sem tocar nessas tabelas dá uma confiança que não foi
 * conquistada. Este arquivo existe para fechar essa distância, e cada bloco
 * abaixo cobre um risco NOMEADO:
 *
 *   1. `Json?` NULO           → `Prisma.DbNull` vs. `null`. Passar `null` cru
 *                               numa coluna `Json?` é erro de execução no
 *                               Prisma. Cobre `SignalReading.rawPayload`,
 *                               `AuditLog.before/after`, `Article.blocks` e
 *                               `Article.reviewData` — cada um com uma linha
 *                               NULA e outra PREENCHIDA.
 *   2. `Json` NOT NULL        → o `@default` não chega ao banco no MySQL
 *      sem default no banco      (prisma#23250). Cobre `PipelineEvent.payload`.
 *   3. ARRAYS que viraram Json → `PushSubscription.preferredCategories` e
 *                               `preferredFranchises`, `Subscriber.preferred-
 *                               Categories`. Inclui o caso VAZIO, que é o que a
 *                               segmentação de push interpreta como "quer tudo".
 *   4. AUTO-REFERÊNCIA        → `Comment.parentId`. É o único ponto do grafo em
 *                               que uma tabela depende de si mesma, e a única
 *                               razão de a cópia de comentários ser ordenada por
 *                               `createdAt`. Sem uma RESPOSTA nos dados de
 *                               teste, essa ordenação nunca é exercitada.
 *   5. LIMITES DE COLUNA      → uma matéria com corpo de ~30 mil caracteres (que
 *                               estoura `TEXT` e exige o `MEDIUMTEXT`), um
 *                               `Topic.query`/`title` no limite dos 250, uma URL
 *                               de afiliado longa e um User-Agent real. Como o
 *                               servidor NÃO está em `sql_mode` estrito, o modo
 *                               de falha destes campos é truncamento SILENCIOSO
 *                               — e quem o denuncia é a soma de `CHAR_LENGTH`
 *                               conferida pelo ensaio.
 *   6. SESSÕES E SENHAS       → `StaffSession`/`CommentSession` com `tokenHash`,
 *                               e um autor com `passwordHash` no formato real do
 *                               scrypt. É o requisito explícito do dono do site:
 *                               ninguém pode ser deslogado pela migração.
 *
 * Os dados são inventados e reconhecíveis (tudo começa com `fixture-`), para
 * que ninguém os confunda com conteúdo real ao olhar o banco.
 */

import { randomBytes, createHash } from 'node:crypto';

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const BANCO_DE_PRODUCAO = 'u754239208_ortuspixel';

/** Hash de token no mesmo formato do resto do sistema: SHA-256 hex. */
const hashDeToken = (semente: string) => createHash('sha256').update(semente).digest('hex');

/** User-Agent real e longo — passa de 191 caracteres, que é o ponto. */
const USER_AGENT_LONGO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0 OPR/120.0.0.0 (Edition std-1) ' +
  'ArbitraryVendorToken/9.9.9 (compatible; testes-de-migracao; +https://ortuspixel.com/bot)';

async function main() {
  const banco =
    (await prisma.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`)[0]?.db ?? '?';
  if (banco === BANCO_DE_PRODUCAO) {
    throw new Error(`RECUSANDO RODAR: "${banco}" é o banco de PRODUÇÃO.`);
  }
  console.log(`\n=== DADOS FICTÍCIOS DE MIGRAÇÃO — banco "${banco}" ===\n`);

  const categoria = await prisma.category.findFirstOrThrow();
  const franquia = await prisma.franchise.findFirstOrThrow();
  const autor = await prisma.author.findFirstOrThrow();
  const topico = await prisma.topic.findFirstOrThrow();
  const artigoExistente = await prisma.article.findFirstOrThrow();

  // ---- 5. LIMITES DE COLUNA -------------------------------------------------
  // ~30 mil caracteres: acima do teto de 65.535 BYTES do `TEXT` quando há
  // acentuação, e a razão de `Article.content` ser `@db.MediumText`.
  const corpoEnorme = 'Parágrafo de teste com acentuação: ação, coração, lançamento. '.repeat(500);

  const artigoLimites = await prisma.article.create({
    data: {
      slug: `fixture-limites-${Date.now()}`,
      title: 'Fixture: matéria com corpo enorme e campos no limite das colunas',
      excerpt: 'Resumo de teste com acentuação para exercitar a collation.',
      content: corpoEnorme,
      status: 'published',
      categoryId: categoria.id,
      authorId: autor.id,
      publishedAt: new Date(),
      tldr: ['Primeiro ponto', 'Segundo ponto', 'Terceiro ponto'],
      // `blocks` PREENCHIDO e `reviewData` PREENCHIDO — o par nulo vem abaixo.
      blocks: [{ tipo: 'paragrafo', dados: { texto: 'Bloco de teste.' } }],
      reviewData: { nota: 8.5, pros: ['a', 'b'], contras: ['c'] },
      coverImageUrl: `https://cdn.exemplo.test/${'x'.repeat(900)}.jpg`,
    },
  });

  // O par com `Json?` NULO — risco 1. Sem esta linha, o `Prisma.DbNull` do
  // script de migração nunca é exercitado.
  const artigoNulos = await prisma.article.create({
    data: {
      slug: `fixture-nulos-${Date.now()}`,
      title: 'Fixture: matéria antiga, sem blocos e sem review',
      excerpt: '',
      content: 'Corpo curto em Markdown, como as matérias anteriores ao editor de blocos.',
      status: 'published',
      categoryId: categoria.id,
      authorId: autor.id,
      publishedAt: new Date(),
      tldr: [], // array VAZIO: caso distinto de "array com itens"
      blocks: Prisma.DbNull,
      reviewData: Prisma.DbNull,
    },
  });
  console.log('  ✓ 2 artigos (corpo enorme + Json nulo/preenchido, tldr cheio/vazio)');

  // Tópico com `query` e `title` no limite dos 250 caracteres.
  await prisma.topic.create({
    data: {
      query: 'Manchete longa de teste para o limite da coluna '.repeat(6).slice(0, 250),
      title: 'Manchete longa de teste para o limite da coluna '.repeat(6).slice(0, 250),
      dedupeHash: `fixture-${randomBytes(8).toString('hex')}`,
      summary: 'Resumo do tópico de teste.',
      categoryId: categoria.id,
      aliases: ['apelido-um', 'apelido-dois'],
      emotionalTriggers: ['leak', 'hype'],
      sourceUrl: `https://exemplo.test/noticia?${'utm_param=valor&'.repeat(60)}`,
    },
  });
  console.log('  ✓ 1 tópico com query/title de 250 caracteres e URL longa');

  // ---- Tag / ArticleTag / LiveUpdate ----------------------------------------
  const tag = await prisma.tag.create({
    data: { slug: `fixture-tag-${Date.now()}`, name: 'Fixture Tag', kind: 'generic' },
  });
  await prisma.articleTag.create({ data: { articleId: artigoLimites.id, tagId: tag.id } });
  await prisma.liveUpdate.create({
    data: {
      articleId: artigoLimites.id,
      content: 'Atualização ao vivo de teste, com acentuação e um texto razoavelmente longo. '.repeat(10),
      isHighlight: true,
      authorName: 'Redação',
    },
  });
  console.log('  ✓ Tag, ArticleTag e LiveUpdate');

  // ---- 4. AUTO-REFERÊNCIA em Comment ----------------------------------------
  const leitor = await prisma.commentAuthor.create({
    data: {
      provider: 'discord',
      providerAccountHash: hashDeToken(`fixture-conta-${Date.now()}`),
      displayName: 'Leitor de Teste',
      avatarUrl: `https://cdn.discordapp.com/avatars/${'9'.repeat(400)}.png`,
      emailHash: hashDeToken('fixture@exemplo.test'),
      approvedCount: 3,
    },
  });
  const leitorBloqueado = await prisma.commentAuthor.create({
    data: {
      provider: 'google',
      providerAccountHash: hashDeToken(`fixture-bloqueado-${Date.now()}`),
      displayName: 'Leitor Bloqueado',
      isBlocked: true,
      blockedAt: new Date(),
      blockReason: 'Motivo de bloqueio escrito pela moderação, em texto livre e razoavelmente longo. '.repeat(5),
    },
  });

  const comentarioPai = await prisma.comment.create({
    data: {
      articleId: artigoExistente.id,
      authorAccountId: leitor.id,
      authorName: leitor.displayName,
      content: 'Comentário raiz de teste.',
      status: 'approved',
      createdAt: new Date(Date.now() - 60_000), // ⚠ ANTES da resposta, de propósito
    },
  });
  await prisma.comment.create({
    data: {
      articleId: artigoExistente.id,
      authorAccountId: leitorBloqueado.id,
      authorName: leitorBloqueado.displayName,
      content: 'Resposta de teste — é ela que exige a ordenação por createdAt na migração.',
      status: 'pending',
      parentId: comentarioPai.id,
      moderationNote: 'Nota de moderação em texto livre.',
      createdAt: new Date(),
    },
  });
  console.log('  ✓ CommentAuthor (normal + bloqueado) e Comment com RESPOSTA (parentId)');

  // ---- 6. SESSÕES E SENHAS --------------------------------------------------
  await prisma.author.update({
    where: { id: autor.id },
    data: {
      // Formato real de `packages/db/src/password.ts`: scrypt$N$r$p$sal$hash.
      passwordHash: `scrypt$16384$8$1$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`,
    },
  });
  await prisma.staffSession.create({
    data: {
      tokenHash: hashDeToken(`fixture-staff-${Date.now()}`),
      authorId: autor.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      userAgent: USER_AGENT_LONGO,
      ipHash: hashDeToken('127.0.0.1'),
    },
  });
  await prisma.commentSession.create({
    data: {
      tokenHash: hashDeToken(`fixture-leitor-${Date.now()}`),
      authorId: leitor.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      userAgent: USER_AGENT_LONGO,
    },
  });
  await prisma.franchiseFollow.create({
    data: { franchiseId: franquia.id, visitorId: `fixture-visitante-${Date.now()}`, commentAuthorId: leitor.id },
  });
  await prisma.franchiseFollow.create({
    data: { franchiseId: franquia.id, visitorId: `fixture-anonimo-${Date.now()}` },
  });
  console.log('  ✓ passwordHash real, StaffSession, CommentSession e 2 FranchiseFollow');

  // ---- 3. ARRAYS que viraram Json -------------------------------------------
  await prisma.subscriber.create({
    data: {
      email: `fixture-${Date.now()}@exemplo.test`,
      status: 'confirmed',
      confirmedAt: new Date(),
      preferredCategories: [categoria.slug],
      signupUserAgent: USER_AGENT_LONGO,
      signupIpHash: hashDeToken('10.0.0.1'),
    },
  });
  // Endereço no limite da RFC 5321 (254 caracteres) — a razão de `email` ser
  // `VarChar(255)` e não os 191 do padrão do Prisma. O carimbo de tempo no meio
  // mantém o script RE-EXECUTÁVEL: sem ele, a segunda rodada colide no índice
  // único e o script morre no meio, deixando o banco pela metade.
  const emailNoLimite = `${`fixture-${Date.now()}-`.padEnd(240, 'a')}@exemplo.test`.slice(0, 254);
  await prisma.subscriber.create({
    data: {
      email: emailNoLimite,
      status: 'pending',
      preferredCategories: [], // VAZIO: "quer tudo"
    },
  });

  const inscricaoPush = await prisma.pushSubscription.create({
    data: {
      // Endpoint longo, perto do teto de 512 da coluna `@unique`. O carimbo de
      // tempo mantém o script re-executável (a coluna é única).
      endpoint: `https://fcm.googleapis.com/fcm/send/${`${Date.now()}-`.padEnd(400, 'e')}`,
      p256dh: randomBytes(65).toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
      userAgent: USER_AGENT_LONGO,
      preferredCategories: [categoria.slug],
      preferredFranchises: [franquia.slug],
    },
  });
  await prisma.pushSubscription.create({
    data: {
      endpoint: `https://updates.push.services.mozilla.com/wpush/v2/${randomBytes(40).toString('hex')}`,
      p256dh: randomBytes(65).toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
      preferredCategories: [], // VAZIO
      preferredFranchises: [],
    },
  });

  const campanha = await prisma.pushNotification.create({
    data: {
      articleId: artigoLimites.id,
      title: 'Fixture: notificação de teste com título razoavelmente longo para a coluna',
      body: 'Corpo da notificação de teste, com acentuação e tamanho suficiente para exercitar o VarChar(512). '.repeat(3),
      url: `https://ortuspixel.com/${categoria.slug}/${artigoLimites.slug}?${'utm=x&'.repeat(50)}`,
      iconUrl: 'https://ortuspixel.com/icone-192.png',
      status: 'sent',
      sentAt: new Date(),
      recipientCount: 2,
      deliveredCount: 1,
    },
  });
  await prisma.pushDelivery.create({
    data: { notificationId: campanha.id, subscriptionId: inscricaoPush.id, status: 'sent' },
  });
  await prisma.pushDelivery.createMany({
    data: [],
  });
  console.log('  ✓ Subscriber e PushSubscription (arrays cheios E vazios), PushNotification, PushDelivery');

  // ---- 1 e 2. Json nulo, Json preenchido, Json NOT NULL sem default ---------
  await prisma.signalReading.createMany({
    data: [
      {
        topicId: topico.id,
        connectorId: 'fixture-conector',
        dimension: 'buzz',
        value: 42,
        confidence: 0.8,
        rawValue: 'valor bruto de teste',
        explanation: 'Explicação longa da medição, em texto livre. '.repeat(20),
        rawPayload: { itens: [1, 2, 3], origem: 'teste' },
      },
      {
        topicId: topico.id,
        connectorId: 'fixture-conector',
        dimension: 'seo',
        value: 7,
        confidence: 0.5,
        rawValue: null,
        explanation: null,
        rawPayload: Prisma.DbNull, // ⚠ o caso que exige `DbNull` na migração
      },
    ],
  });

  await prisma.connectorHealth.create({
    data: {
      connectorId: `fixture-conector-${Date.now()}`,
      circuitState: 'open',
      consecutiveFailures: 3,
      lastError: 'Erro simulado com stack trace longo.\n    at funcao (arquivo.ts:1:1)\n'.repeat(20),
    },
  });

  await prisma.pipelineEvent.createMany({
    data: [
      { eventType: 'topic.discovered', topicId: topico.id, payload: { score: 82, anterior: 61 } },
      // `payload` é `Json` NOT NULL cujo default NÃO existe no banco: precisa vir
      // preenchido sempre. Aqui vai um objeto vazio, de propósito.
      { eventType: 'topic.scored', topicId: topico.id, payload: {} },
    ],
  });

  await prisma.pipelineRun.create({
    data: {
      stage: 'full',
      status: 'failed',
      finishedAt: new Date(),
      durationMs: 12_345,
      error: 'Falha simulada do ciclo, com detalhe longo. '.repeat(30),
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: autor.id,
        action: 'override.applied',
        entityType: 'Topic',
        entityId: topico.id,
        before: { currentScore: 61 },
        after: { currentScore: 90 },
        reason: 'Justificativa escrita por um editor, em texto livre e comprido. '.repeat(10),
      },
      {
        actorId: null,
        action: 'article.deleted',
        entityType: 'Article',
        entityId: artigoNulos.id,
        before: Prisma.DbNull, // ⚠ de novo o caso `DbNull`
        after: Prisma.DbNull,
        reason: null,
      },
    ],
  });
  console.log('  ✓ SignalReading, ConnectorHealth, PipelineEvent, PipelineRun e AuditLog');
  console.log('    (cada um com uma linha de Json NULO e outra PREENCHIDA)');

  // ---- Resumo ----
  let total = 0;
  let vazias = 0;
  for (const model of Prisma.dmmf.datamodel.models) {
    const chave = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const m = prisma as unknown as Record<string, { count: () => Promise<number> }>;
    const n = await m[chave]!.count();
    total += n;
    if (n === 0) {
      vazias += 1;
      console.log(`    ⚠ ainda vazia: ${model.name}`);
    }
  }
  console.log(`\n${total} linhas em ${Prisma.dmmf.datamodel.models.length - vazias} tabelas povoadas.`);
  console.log('Agora rode: npm run db:fulltext && npm run db:rehearse-load');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
