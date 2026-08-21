import 'server-only';

import { prisma } from '@subcarioca/db';

import { readVisitorId, ensureVisitorId } from './follows';
import { getReaderSession } from './reader-session';

/**
 * =============================================================================
 * SEGUIR CATEGORIA (editoria) — o mesmo mecanismo de `FranchiseFollow`
 * =============================================================================
 *
 * ESTE ARQUIVO É DELIBERADAMENTE PARECIDO COM `server/follows.ts`, e o
 * cabeçalho de lá tem o racional completo (dois sujeitos possíveis — visitante
 * anônimo por cookie e conta logada —, e por que os dois existem). Não repetido
 * aqui para não virar uma segunda fonte de verdade sobre a mesma decisão de
 * produto; ESTE comentário só cobre o que é DIFERENTE.
 *
 * A DIFERENÇA: `Category` NÃO tem um `followerCount` desnormalizado como
 * `Franchise` tem. Decisão consciente, não esquecimento — hoje NENHUMA tela do
 * site exibe "quantas pessoas seguem esta editoria" (a franquia mostra o
 * número no hub e na home; a categoria não tem hub de leitor equivalente).
 * Manter um contador que ninguém lê seria custo de escrita (mais uma coluna
 * para toda ação de seguir/deixar de seguir tocar) sem benefício — o mesmo
 * critério que já rege a ausência de índice em `contentSensitivity` no schema.
 * Se um dia uma tela precisar do número, ele nasce quando a tela nascer, com
 * `COUNT(*)` (a tabela é pequena — uma linha por leitor por categoria seguida,
 * não por matéria) ou com o contador, a depender de onde ele for lido.
 *
 * O visitante anônimo é o MESMO cookie (`ortuspixel_visitor`) usado por
 * `FranchiseFollow` — é a mesma pessoa navegando o mesmo site sem login, então
 * reaproveitar o identificador é o comportamento certo, não um atalho.
 */

export interface FollowedCategory {
  slug: string;
  name: string;
  followedAt: Date;
}

/** Categorias seguidas pelo leitor atual. A PREFERÊNCIA é sempre da CONTA quando ela existe. */
export async function getFollowedCategories(): Promise<FollowedCategory[]> {
  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  const where = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  if (!where) return [];

  const rows = await prisma.categoryFollow.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      category: { select: { slug: true, name: true } },
    },
  });

  return rows.map((row) => ({
    slug: row.category.slug,
    name: row.category.name,
    followedAt: row.createdAt,
  }));
}

/** O leitor atual segue esta categoria? Usado para o estado inicial do botão. */
export async function isFollowingCategory(categorySlug: string): Promise<boolean> {
  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  const subject = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  if (!subject) return false;

  const found = await prisma.categoryFollow.findFirst({
    where: { category: { slug: categorySlug }, ...subject },
    select: { id: true },
  });

  return found !== null;
}

export type CategoryFollowOutcome = 'followed' | 'unfollowed' | 'unknown-category';

/**
 * Segue uma categoria. Sem contador desnormalizado a manter (ver cabeçalho),
 * então — ao contrário de `followFranchise` — não precisa de transação: é uma
 * escrita só.
 */
export async function followCategory(categorySlug: string): Promise<CategoryFollowOutcome> {
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  });
  if (!category) return 'unknown-category';

  const session = await getReaderSession();
  const visitorId = await ensureVisitorId();

  const existing = await prisma.categoryFollow.findFirst({
    where: {
      categoryId: category.id,
      ...(session ? { commentAuthorId: session.authorId } : { visitorId }),
    },
    select: { id: true, commentAuthorId: true },
  });

  if (existing) {
    // Seguiu anônimo neste aparelho e logou em outra aba: adota a linha.
    if (session && !existing.commentAuthorId) {
      await prisma.categoryFollow.update({
        where: { id: existing.id },
        data: { commentAuthorId: session.authorId },
      });
    }
    return 'followed';
  }

  await prisma.categoryFollow.create({
    data: {
      categoryId: category.id,
      visitorId,
      commentAuthorId: session?.authorId ?? null,
    },
  });

  return 'followed';
}

/** Deixa de seguir. Espelha `followCategory`. */
export async function unfollowCategory(categorySlug: string): Promise<CategoryFollowOutcome> {
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  });
  if (!category) return 'unknown-category';

  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  const subject = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  if (!subject) return 'unfollowed';

  await prisma.categoryFollow.deleteMany({
    where: { categoryId: category.id, ...subject },
  });

  return 'unfollowed';
}

/**
 * Vincula à conta os follows de CATEGORIA feitos anonimamente neste
 * navegador. Chamada no retorno do OAuth, ao lado de
 * `reconcileFollowsOnLogin` (franquia) — ver o cabeçalho de `server/follows.ts`
 * para o racional completo e o registro da corrida conhecida no MySQL/InnoDB,
 * que se aplica aqui do MESMO jeito (mesmo padrão de escrita, mesma tabela de
 * isolamento). Sem contador a corrigir aqui (ver cabeçalho deste arquivo), a
 * versão desta função é mais simples: só apagar duplicata e adotar o resto.
 */
export async function reconcileCategoryFollowsOnLogin(authorId: string): Promise<void> {
  const visitorId = await readVisitorId();
  if (!visitorId) return;

  await prisma.$transaction(async (tx) => {
    const anonymous = await tx.categoryFollow.findMany({
      where: { visitorId, commentAuthorId: null },
      select: { id: true, categoryId: true },
    });
    if (anonymous.length === 0) return;

    const alreadyOwned = await tx.categoryFollow.findMany({
      where: {
        commentAuthorId: authorId,
        categoryId: { in: anonymous.map((row) => row.categoryId) },
      },
      select: { categoryId: true },
    });
    const ownedIds = new Set(alreadyOwned.map((row) => row.categoryId));

    const duplicates = anonymous.filter((row) => ownedIds.has(row.categoryId));
    const adoptable = anonymous.filter((row) => !ownedIds.has(row.categoryId));

    if (duplicates.length > 0) {
      await tx.categoryFollow.deleteMany({
        where: { id: { in: duplicates.map((row) => row.id) } },
      });
    }

    if (adoptable.length > 0) {
      await tx.categoryFollow.updateMany({
        where: { id: { in: adoptable.map((row) => row.id) } },
        data: { commentAuthorId: authorId },
      });
    }
  });
}
