import 'server-only';

import { cookies } from 'next/headers';

import { prisma } from '@subcarioca/db';

import { generateToken } from './security';
import { getReaderSession } from './reader-session';

/**
 * =============================================================================
 * SEGUIR FRANQUIAS — retenção sem exigir cadastro
 * =============================================================================
 *
 * A REGRA DE PRODUTO QUE DESENHA ESTE ARQUIVO: ler o Ortus Pixel nunca exigiu
 * conta, e seguir uma franquia também não vai exigir. "Crie uma conta para
 * seguir" é exatamente onde a intenção morre — a pessoa queria um clique, não
 * um cadastro.
 *
 * Daí os DOIS SUJEITOS possíveis de um follow (ver o comentário do model
 * `FranchiseFollow` no schema):
 *
 *   ANÔNIMO — cookie `ortuspixel_visitor`. Funciona no primeiro clique, sem
 *             nenhuma fricção. Morre com a limpeza de cookies e não atravessa
 *             aparelhos, e tudo bem: é o degrau de entrada.
 *   LOGADO  — a mesma identidade OAuth que já existia para comentar. Sobrevive
 *             a troca de aparelho e alimenta a página /minha-conta.
 *
 * A ponte entre os dois é `reconcileFollowsOnLogin`, chamada no retorno do
 * OAuth: quem seguiu anonimamente e depois logou LEVA os follows junto. Sem
 * isso, logar teria o efeito absurdo de "perder" o que a pessoa acabou de
 * seguir — e ela nunca mais confiaria no botão.
 *
 * PRIVACIDADE: o cookie de visitante é um identificador OPACO e aleatório. Ele
 * não é derivado de IP, de user-agent nem de nada que descreva a pessoa; serve
 * só para reencontrar as linhas dela. É o mínimo necessário para a
 * funcionalidade existir sem login.
 */

const VISITOR_COOKIE = 'ortuspixel_visitor';

/**
 * Um ano. O follow anônimo precisa durar o suficiente para valer a pena; abaixo
 * disso o leitor voltaria depois de um mês e encontraria tudo "desseguido", sem
 * entender por quê.
 */
const VISITOR_COOKIE_DAYS = 365;

/** Lê o id de visitante. NÃO cria — ver `ensureVisitorId`. */
export async function readVisitorId(): Promise<string | null> {
  const store = await cookies();
  return store.get(VISITOR_COOKIE)?.value ?? null;
}

/**
 * Lê o id de visitante, criando-o se ainda não existir.
 *
 * SÓ PODE SER CHAMADA DE ROTA (ou Server Action): o Next 15 proíbe escrever
 * cookie durante a renderização de um Server Component. É por isso que a
 * LEITURA (`readVisitorId`) e a ESCRITA estão separadas em duas funções — a
 * página só lê, a rota de seguir é quem cria.
 */
export async function ensureVisitorId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE)?.value;
  if (existing) return existing;

  const visitorId = generateToken();

  store.set(VISITOR_COOKIE, visitorId, {
    // `httpOnly`: nenhum script da página precisa ler este valor, e mantê-lo
    // fora do alcance do JavaScript reduz o estrago de um XSS eventual.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax`: o cookie não precisa acompanhar requisição cross-site de escrita.
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_COOKIE_DAYS * 86_400,
  });

  return visitorId;
}

export interface FollowedFranchise {
  slug: string;
  name: string;
  logoUrl: string | null;
  followedAt: Date;
}

/**
 * Franquias seguidas pelo leitor atual.
 *
 * A PREFERÊNCIA É SEMPRE DA CONTA quando ela existe: o cookie pode ser de um
 * aparelho emprestado ou de uma sessão antiga, enquanto a conta é a identidade
 * que a pessoa declarou. Consultar os dois e unir traria de volta follows que
 * ela pode ter removido estando logada.
 */
export async function getFollowedFranchises(): Promise<FollowedFranchise[]> {
  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  const where = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  // Nem conta nem cookie: não há o que consultar. Devolver cedo evita uma ida
  // ao banco para, garantidamente, não encontrar nada.
  if (!where) return [];

  const rows = await prisma.franchiseFollow.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      franchise: { select: { slug: true, name: true, logoUrl: true } },
    },
  });

  return rows.map((row) => ({
    slug: row.franchise.slug,
    name: row.franchise.name,
    logoUrl: row.franchise.logoUrl,
    followedAt: row.createdAt,
  }));
}

/** O leitor atual segue esta franquia? Usado para o estado inicial do botão. */
export async function isFollowing(franchiseSlug: string): Promise<boolean> {
  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  // O encadeamento explícito (em vez de um espalhamento condicional) existe
  // para que o TypeScript consiga estreitar `visitorId` para `string` no ramo
  // anônimo. Com o espalhamento, `visitorId: string | null` escapava para o
  // filtro do Prisma — e um `null` ali não filtra "sem conta", filtra nada.
  const subject = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  if (!subject) return false;

  const found = await prisma.franchiseFollow.findFirst({
    where: { franchise: { slug: franchiseSlug }, ...subject },
    select: { id: true },
  });

  return found !== null;
}

export type FollowOutcome = 'followed' | 'unfollowed' | 'unknown-franchise';

/**
 * Segue uma franquia.
 *
 * `followerCount` é DESNORMALIZADO em `Franchise` (a home e o hub exibem o
 * número em toda renderização, e um `COUNT` por card seria caro no pico). Por
 * isso a escrita acontece dentro de uma TRANSAÇÃO: sem ela, um erro entre o
 * `create` e o `update` deixaria o contador mentindo para sempre, e nada no
 * sistema o corrigiria depois.
 */
export async function followFranchise(franchiseSlug: string): Promise<FollowOutcome> {
  const franchise = await prisma.franchise.findUnique({
    where: { slug: franchiseSlug },
    select: { id: true },
  });
  if (!franchise) return 'unknown-franchise';

  const session = await getReaderSession();
  const visitorId = await ensureVisitorId();

  return prisma.$transaction(async (tx): Promise<FollowOutcome> => {
    // Já segue? Então não há o que fazer — e, principalmente, o contador NÃO
    // pode ser incrementado de novo. Duplo clique no botão é o caso comum, não
    // a exceção.
    const existing = await tx.franchiseFollow.findFirst({
      where: {
        franchiseId: franchise.id,
        ...(session ? { commentAuthorId: session.authorId } : { visitorId }),
      },
      select: { id: true, commentAuthorId: true },
    });

    if (existing) {
      // Caso real: seguiu anônimo neste aparelho e acabou de logar em outra
      // aba. A linha existe pelo cookie, mas ainda sem dono — adotamos aqui.
      if (session && !existing.commentAuthorId) {
        await tx.franchiseFollow.update({
          where: { id: existing.id },
          data: { commentAuthorId: session.authorId },
        });
      }
      return 'followed';
    }

    await tx.franchiseFollow.create({
      data: {
        franchiseId: franchise.id,
        visitorId,
        commentAuthorId: session?.authorId ?? null,
      },
    });

    await tx.franchise.update({
      where: { id: franchise.id },
      data: { followerCount: { increment: 1 } },
    });

    return 'followed';
  });
}

/** Deixa de seguir. Espelha `followFranchise`, inclusive na transação. */
export async function unfollowFranchise(franchiseSlug: string): Promise<FollowOutcome> {
  const franchise = await prisma.franchise.findUnique({
    where: { slug: franchiseSlug },
    select: { id: true },
  });
  if (!franchise) return 'unknown-franchise';

  const session = await getReaderSession();
  const visitorId = await readVisitorId();

  // Mesmo estreitamento de tipo aplicado em `isFollowing`, pelo mesmo motivo.
  const subject = session
    ? { commentAuthorId: session.authorId }
    : visitorId
      ? { visitorId, commentAuthorId: null }
      : null;

  // Nem conta nem cookie: não há follow possível para remover.
  if (!subject) return 'unfollowed';

  return prisma.$transaction(async (tx): Promise<FollowOutcome> => {
    const { count } = await tx.franchiseFollow.deleteMany({
      where: { franchiseId: franchise.id, ...subject },
    });

    // Só decrementa o que realmente saiu. Decrementar sem conferir permitiria
    // que um botão clicado duas vezes empurrasse o contador para baixo de zero.
    if (count > 0) {
      await tx.franchise.update({
        where: { id: franchise.id },
        data: { followerCount: { decrement: count } },
      });
    }

    return 'unfollowed';
  });
}

/**
 * Vincula à conta os follows feitos anonimamente neste navegador.
 *
 * Chamada no retorno do OAuth. O caso que ela resolve: a pessoa clicou em
 * "Seguir" em três franquias sem estar logada e só depois entrou com o Discord.
 * Sem esta função, os três follows continuariam presos ao cookie e a página
 * /minha-conta apareceria vazia logo após o login.
 *
 * O CUIDADO NÃO ÓBVIO: `commentAuthorId` tem índice ÚNICO junto de
 * `franchiseId`. Se a conta já seguia a mesma franquia em outro aparelho, um
 * `updateMany` cego violaria a restrição e derrubaria o login inteiro — bem no
 * meio do fluxo de autenticação, que é o pior lugar possível para falhar. Por
 * isso as linhas anônimas que colidem são APAGADAS (a conta já tem a sua), e só
 * as demais são adotadas.
 *
 * -----------------------------------------------------------------------------
 * ⚠ CORRIDA CONHECIDA, E O QUE A MIGRAÇÃO PARA O MySQL MUDOU NELA
 * -----------------------------------------------------------------------------
 * REGISTRO DE ANÁLISE — nada aqui foi alterado; isto é documentação de um risco
 * real que a auditoria de isolamento da migração de banco encontrou. Se alguém
 * for mexer nesta função, é este o parágrafo que precisa ler antes.
 *
 * A corrida em si JÁ EXISTIA no Postgres: entre o `findMany` que monta
 * `alreadyOwned` e o `updateMany` que adota as linhas, nada impede que OUTRA
 * sessão insira um follow para o mesmo par (franquia, conta). Os dois `findMany`
 * são leituras SEM TRAVA nos dois bancos. Se isso acontecer, o `updateMany` viola
 * o índice único e a exceção derruba o login — o cenário que o parágrafo acima
 * descreve. Para acontecer, é preciso que a MESMA PESSOA conclua dois logins em
 * aparelhos diferentes com milissegundos de diferença: é raro, mas não é
 * impossível.
 *
 * O QUE MUDOU: o InnoDB usa REPEATABLE READ por padrão, contra o READ COMMITTED
 * do Postgres. Numa transação como esta, as leituras simples passam a enxergar um
 * SNAPSHOT congelado no primeiro `SELECT`, em vez do último estado comitado. Na
 * prática, a janela da corrida deixa de ser "entre o segundo SELECT e o UPDATE" e
 * passa a ser "do PRIMEIRO SELECT até o UPDATE". Ela fica MAIOR, não menor:
 *
 *   Postgres  → um follow comitado por outra sessão entre os dois SELECTs seria
 *               visto, a linha entraria em `duplicates` e seria apagada. Sem erro.
 *   MariaDB   → o mesmo follow NÃO é visto (está fora do snapshot), a linha vai
 *               para `adoptable`, e o `updateMany` estoura o índice único.
 *
 * POR QUE NÃO FOI CORRIGIDO AGORA: mudar isto é mudança de comportamento, e a
 * migração de banco não é o lugar de embutir uma. A correção certa, quando for
 * feita, é tratar a violação em vez de tentar prevê-la — envolver a adoção num
 * `catch` de erro de unicidade (P2002) que apaga a linha anônima e segue, ou
 * simplesmente apagar-e-recriar em vez de adotar. Prevenir por leitura nunca
 * fecha a janela; só a estreita.
 *
 * SOBRE GAP LOCKS (a outra preocupação clássica do REPEATABLE READ): não se
 * aplicam aqui. Todos os três comandos de escrita desta transação — o
 * `deleteMany`, o `updateMany` e o `franchise.update` — filtram por CHAVE
 * PRIMÁRIA com valores exatos, que é o caso em que o InnoDB trava apenas os
 * registros encontrados. Não há risco novo de deadlock neste caminho.
 */
export async function reconcileFollowsOnLogin(authorId: string): Promise<void> {
  const visitorId = await readVisitorId();
  if (!visitorId) return;

  await prisma.$transaction(async (tx) => {
    const anonymous = await tx.franchiseFollow.findMany({
      where: { visitorId, commentAuthorId: null },
      select: { id: true, franchiseId: true },
    });
    if (anonymous.length === 0) return;

    const alreadyOwned = await tx.franchiseFollow.findMany({
      where: {
        commentAuthorId: authorId,
        franchiseId: { in: anonymous.map((row) => row.franchiseId) },
      },
      select: { franchiseId: true },
    });
    const ownedIds = new Set(alreadyOwned.map((row) => row.franchiseId));

    const duplicates = anonymous.filter((row) => ownedIds.has(row.franchiseId));
    const adoptable = anonymous.filter((row) => !ownedIds.has(row.franchiseId));

    if (duplicates.length > 0) {
      await tx.franchiseFollow.deleteMany({
        where: { id: { in: duplicates.map((row) => row.id) } },
      });

      // Cada linha apagada era um seguidor contado. O contador precisa
      // acompanhar, senão a fusão de identidades infla a métrica de retenção —
      // justamente a métrica que o produto usa para priorizar pauta.
      for (const row of duplicates) {
        await tx.franchise.update({
          where: { id: row.franchiseId },
          data: { followerCount: { decrement: 1 } },
        });
      }
    }

    if (adoptable.length > 0) {
      await tx.franchiseFollow.updateMany({
        where: { id: { in: adoptable.map((row) => row.id) } },
        data: { commentAuthorId: authorId },
      });
    }
  });
}
