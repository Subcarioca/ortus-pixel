import 'server-only';

import { cookies } from 'next/headers';

import { prisma } from '@subcarioca/db';
import { isCommentProvider, type CommentProvider } from '@subcarioca/core';

import { generateToken, hashPersonalData, hashToken } from './security';

/**
 * =============================================================================
 * SESSÃO DO LEITOR — identidade de quem comenta
 * =============================================================================
 *
 * "Leitor" e não "usuário": esta sessão NÃO dá acesso a nada além de escrever e
 * apagar os próprios comentários. O painel editorial tem autenticação separada
 * (`server/staff-auth.ts`: conta individual, cookie próprio, tabela própria), e
 * essa separação é proposital — um bug aqui não pode, em nenhuma hipótese, abrir
 * a porta da redação.
 *
 * FORMATO DA SESSÃO: TOKEN OPACO + HASH NO BANCO.
 *
 * O cookie carrega 256 bits aleatórios; o banco guarda o SHA-256 desse valor.
 * É exatamente o padrão já usado nos tokens de newsletter deste projeto, e traz
 * duas propriedades que um JWT não tem:
 *
 *  1. REVOGAÇÃO IMEDIATA. Banir alguém é apagar linhas — o acesso morre no
 *     clique seguinte. Com JWT, o token vale até expirar, e "revogar" exige uma
 *     lista de bloqueio consultada a cada requisição, que é um banco de sessões
 *     pior do que este.
 *  2. VAZAMENTO CONTIDO. Se o banco vazar, o atacante tem hashes — inúteis para
 *     se passar por alguém, porque a comparação é feita sobre o hash do valor
 *     apresentado.
 *
 * O custo é uma consulta por requisição autenticada. Numa página de artigo isso
 * é irrelevante: a página é cacheada, e a leitura de sessão só acontece no
 * caminho não cacheado (escrever comentário, ver o próprio pendente).
 */

const SESSION_COOKIE = 'ortuspixel_reader';

/**
 * 30 dias. Comentar é atividade esporádica: sessão curta obrigaria a pessoa a
 * relogar toda vez, e o atrito do relogin é onde o comentário morre. O risco é
 * baixo — a sessão não dá acesso a dado sensível nenhum.
 */
const SESSION_DAYS = 30;

export interface ReaderSession {
  sessionId: string;
  authorId: string;
  displayName: string;
  provider: CommentProvider;
  isBlocked: boolean;
  approvedCount: number;
}

/**
 * Cria (ou reencontra) a identidade e abre uma sessão.
 *
 * A identidade é a dupla (provedor, hash do ID da conta). O ID BRUTO do
 * provedor entra nesta função e não sai dela: gravamos apenas o hash com sal da
 * aplicação. Precisamos RECONHECER a mesma pessoa entre visitas — não
 * identificá-la fora do nosso site.
 */
export async function createReaderSession(params: {
  provider: CommentProvider;
  providerAccountId: string;
  displayName: string;
  userAgent: string | null;
  ip: string;
}): Promise<{ token: string; blocked: boolean; authorId: string }> {
  const providerAccountHash = hashPersonalData(`${params.provider}:${params.providerAccountId}`);

  const author = await prisma.commentAuthor.upsert({
    where: {
      provider_providerAccountHash: {
        provider: params.provider,
        providerAccountHash,
      },
    },
    // No retorno, só atualizamos o nome (a pessoa pode tê-lo mudado no
    // provedor) e a data de última visita. Nada mais é reescrito.
    update: { displayName: params.displayName, lastSeenAt: new Date() },
    create: {
      provider: params.provider,
      providerAccountHash,
      displayName: params.displayName,
      // `avatarUrl` fica NULO de propósito, mesmo tendo o provedor devolvido a
      // URL. Dois motivos:
      //  1. Minimização: não guardamos dado pessoal que não usamos.
      //  2. Privacidade do LEITOR: renderizar avatares hospedados no CDN do
      //     Discord/Google faria o navegador de TODO leitor da página fazer uma
      //     requisição a esses domínios, entregando o IP dele a terceiros só
      //     por ler os comentários. Enquanto não houver proxy de imagem nosso,
      //     exibimos iniciais.
    },
  });

  const token = generateToken();

  await prisma.commentSession.create({
    data: {
      tokenHash: hashToken(token),
      authorId: author.id,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
      userAgent: params.userAgent?.slice(0, 200) ?? null,
      // IP em hash: serve para antiabuso e auditoria sem guardar o dado pessoal
      // em claro (mesma política do cadastro de newsletter).
      ipHash: hashPersonalData(params.ip),
    },
  });

  // `authorId` sai daqui porque o chamador precisa dele para vincular à conta
  // os follows feitos antes do login (ver `reconcileFollowsOnLogin`).
  return { token, blocked: author.isBlocked, authorId: author.id };
}

/** Grava o cookie de sessão. */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    // `httpOnly`: JavaScript da página não lê o cookie. Se um XSS escapar por
    // qualquer brecha, ele ainda não consegue roubar a sessão.
    httpOnly: true,
    // `secure` só em produção: em desenvolvimento o site roda em http e o
    // cookie seria descartado pelo navegador.
    secure: process.env.NODE_ENV === 'production',
    // `lax` e não `strict`: o retorno do provedor OAuth é uma navegação
    // cross-site, e com `strict` o cookie não seria enviado — a pessoa voltaria
    // do login deslogada. `lax` envia em navegação de topo (GET) e continua
    // barrando envio em requisição cross-site de escrita, que é o que importa
    // contra CSRF.
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

/**
 * Lê a sessão atual.
 *
 * Devolve `null` para sessão inexistente, expirada ou de autor bloqueado —
 * quem foi bloqueado simplesmente volta a ser um leitor anônimo, sem tela de
 * erro. Explicar o bloqueio na interface só ensinaria o abusador a contornar.
 */
export async function getReaderSession(): Promise<ReaderSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Buscamos pelo HASH: o valor em claro nunca é comparado com nada no banco.
  const session = await prisma.commentSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { author: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Limpeza oportunista: a sessão expirada some no primeiro uso, sem precisar
    // de um job periódico só para isso.
    await prisma.commentSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (session.author.isBlocked) return null;

  return {
    sessionId: session.id,
    authorId: session.author.id,
    displayName: session.author.displayName,
    provider: isCommentProvider(session.author.provider) ? session.author.provider : 'discord',
    isBlocked: session.author.isBlocked,
    approvedCount: session.author.approvedCount,
  };
}

/** Encerra a sessão: apaga a linha E o cookie. */
export async function destroyReaderSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    // `deleteMany` em vez de `delete` para não estourar quando a linha já não
    // existe (duplo clique em "sair", sessão já revogada pela moderação).
    await prisma.commentSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Revoga TODAS as sessões de um autor. Usado pela moderação ao bloquear.
 *
 * Sem isso, o banimento só valeria no próximo login — e o abusador, já logado,
 * continuaria postando. É a operação que justifica a escolha de sessão opaca.
 */
export async function revokeAllSessions(authorId: string): Promise<number> {
  const { count } = await prisma.commentSession.deleteMany({ where: { authorId } });
  return count;
}
