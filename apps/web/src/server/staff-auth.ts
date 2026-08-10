import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { prisma, verifyPassword } from '@subcarioca/db';
import {
  type AccessLevel,
  type StaffCapabilities,
  can,
  toAccessLevel,
} from '@subcarioca/core';

import { generateToken, hashPersonalData, hashToken } from './security';

/**
 * =============================================================================
 * AUTENTICAÇÃO DA REDAÇÃO — conta individual, e não mais segredo compartilhado
 * =============================================================================
 *
 * O QUE ISTO SUBSTITUIU, E POR QUE PRECISAVA SER SUBSTITUÍDO
 * ----------------------------------------------------------
 * Até aqui o painel inteiro era protegido por `ADMIN_ACCESS_TOKEN`: uma senha
 * única, igual para todo mundo, gravada no cookie em CLARO. Três consequências,
 * todas concretas:
 *
 *   1. A trilha de auditoria registrava "alguém". `AuditLog` guarda quem
 *      sobrepôs um score e quem apagou uma matéria — e com segredo compartilhado
 *      a resposta era sempre a mesma pessoa fictícia. Isso anula o valor de
 *      distinguir "o algoritmo errou" de "o editor discordou", que é a razão de
 *      a tabela existir.
 *   2. Não existia "só as minhas matérias": sem identidade, todo mundo era todo
 *      mundo.
 *   3. Revogar o acesso de uma pessoa exigia trocar a senha de TODAS — o que na
 *      prática significa que ninguém revoga.
 *
 * A ESCOLHA: e-mail + senha própria, com sessão OPACA no banco.
 *
 * É o mesmo mecanismo que a sessão de leitor (`server/reader-session.ts`) já usa
 * e pelo qual o projeto já optou conscientemente: token de 256 bits aleatórios no
 * cookie, SHA-256 dele no banco. Duas propriedades que um JWT não tem:
 *
 *   REVOGAÇÃO IMEDIATA. Desativar uma conta apaga as sessões dela, e o acesso
 *   morre no clique seguinte. Com JWT, o token vale até expirar — e "revogar"
 *   passa a exigir uma lista de bloqueio consultada a cada requisição, que é um
 *   banco de sessões pior do que este.
 *
 *   VAZAMENTO CONTIDO. Se o banco vazar, o atacante tem hashes, inúteis para se
 *   passar por alguém: a comparação é feita sobre o hash do valor apresentado.
 *
 * SEPARAÇÃO DAS DUAS SESSÕES — cookie diferente, tabela diferente, módulo
 * diferente. Um bug no login social dos comentários não pode, em hipótese
 * alguma, abrir a porta da redação. É a mesma separação que já existia; o que
 * mudou é que agora os dois lados são autenticação de verdade.
 *
 * -----------------------------------------------------------------------------
 * POR QUE NÃO EXISTE UM `middleware.ts` PROTEGENDO `/admin/*`
 * -----------------------------------------------------------------------------
 * É a primeira ideia de todo mundo, e ela não funciona aqui: o middleware do
 * Next roda no runtime Edge, onde o Prisma não roda — logo, ele não conseguiria
 * consultar a sessão nem o nível de acesso. O que sobraria seria checar a
 * PRESENÇA do cookie, que não é verificação nenhuma (qualquer pessoa escreve um
 * cookie com qualquer valor) e que criaria a pior das ilusões: uma camada que
 * parece proteger e não protege, convidando quem vier depois a esquecer o guard
 * de verdade.
 *
 * A verificação real acontece em CADA página e CADA rota, via `requireStaffPage`
 * e `requireStaffApi`. É uma linha por arquivo, ela é obrigatória, e ela é a
 * única — não há duas fontes de verdade competindo.
 */

/**
 * Nome do cookie do painel.
 *
 * MUDOU de `ortuspixel_admin` para `ortuspixel_staff` de propósito. O cookie
 * antigo carregava o segredo compartilhado em claro; nenhum valor gravado por
 * ele pode continuar valendo. Trocando o nome, toda sessão do modelo anterior
 * deixa de existir no primeiro acesso, sem precisar de nenhuma rotina de
 * expurgo — e sem a chance de um valor antigo ser interpretado como token novo.
 */
export const STAFF_SESSION_COOKIE = 'ortuspixel_staff';

/**
 * 12 horas.
 *
 * Mais curta que a do leitor (30 dias) porque o que está do outro lado é
 * diferente: a sessão de leitor não dá acesso a nada além dos próprios
 * comentários; esta publica no site. 12h cobre um turno inteiro com folga — o
 * atrito de reentrar uma vez por dia é baixo, e a janela de uma sessão esquecida
 * num computador compartilhado fecha sozinha antes do dia seguinte.
 */
const SESSION_HOURS = 12;

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  /** Nível de PERMISSÃO ('admin' | 'redator') — vem de `Author.systemRole`. */
  accessLevel: AccessLevel;
  /** Título EDITORIAL em texto livre ("Editora-chefe") — vem de `Author.role`. */
  editorialRole: string;
}

// =============================================================================
// LOGIN
// =============================================================================

/**
 * Confere e-mail e senha e abre uma sessão.
 *
 * Devolve `null` para QUALQUER falha — e-mail inexistente, conta sem senha,
 * conta desativada, senha errada. A tela mostra uma frase só ("E-mail ou senha
 * incorretos") porque distinguir os casos é enumeração de contas: "esta conta
 * não existe" confirma ao atacante quais e-mails existem, e "esta conta está
 * desativada" confirma que existiu.
 *
 * -----------------------------------------------------------------------------
 * O `verifyPassword` CONTRA UM HASH FALSO QUANDO A CONTA NÃO EXISTE
 * -----------------------------------------------------------------------------
 * Sem isso, o e-mail inexistente responde em ~1ms (só a consulta) e o e-mail
 * existente responde em ~100ms (a consulta MAIS o scrypt). Um atacante mede a
 * diferença e descobre quais endereços têm conta sem nunca acertar uma senha —
 * a enumeração de contas que a mensagem genérica existe para impedir, vazando
 * pelo relógio. Gastar o mesmo tempo nos dois caminhos fecha o canal.
 */
export async function authenticateStaff(params: {
  email: string;
  password: string;
  userAgent: string | null;
  ip: string;
}): Promise<{ token: string; user: StaffUser } | null> {
  const author = await prisma.author.findUnique({
    where: { email: params.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      systemRole: true,
      passwordHash: true,
      isActive: true,
    },
  });

  const storedHash = author?.isActive ? author.passwordHash : null;

  // Hash descartável, no formato correto, para consumir o mesmo tempo de CPU do
  // caminho de sucesso. A senha derivada dele nunca confere com nada.
  const passwordOk = await verifyPassword(
    params.password,
    storedHash ?? DUMMY_HASH,
  );

  if (!author || !storedHash || !passwordOk) return null;

  const token = generateToken();

  await prisma.$transaction([
    prisma.staffSession.create({
      data: {
        tokenHash: hashToken(token),
        authorId: author.id,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
        userAgent: params.userAgent?.slice(0, 200) ?? null,
        // IP em hash: serve à auditoria de acesso sem guardar dado pessoal em
        // claro (mesma política do cadastro de newsletter e dos comentários).
        ipHash: hashPersonalData(params.ip),
      },
    }),
    prisma.author.update({
      where: { id: author.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  return {
    token,
    user: {
      id: author.id,
      name: author.name,
      email: author.email,
      accessLevel: toAccessLevel(author.systemRole),
      editorialRole: author.role,
    },
  };
}

/**
 * Hash de uma senha aleatória, gerado uma vez na carga do módulo.
 *
 * É literalmente inútil como credencial (ninguém conhece a senha de origem) e é
 * exatamente esse o ponto: ele existe só para dar ao `verifyPassword` algo com o
 * formato certo para mastigar quando a conta não existe.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$YWJjZGVmZ2hpamtsbW5vcA==$' +
  'ZHVtbXktaGFzaC1xdWUtbnVuY2EtY29uZmVyZS1jb20tc2VuaGEtbmVuaHVtYS1kZS12ZXJkYWRlLg==';

/** Grava o cookie de sessão numa resposta de rota de API. */
export function setStaffSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(STAFF_SESSION_COOKIE, token, {
    // JavaScript da página não lê o cookie: se um XSS escapar por qualquer
    // brecha, a sessão do painel não é roubada.
    httpOnly: true,
    // Só por HTTPS em produção. Desligado em dev, onde não há TLS.
    secure: process.env.NODE_ENV === 'production',
    // `strict` (e não `lax`, como na sessão de leitor): aqui não existe retorno
    // de provedor OAuth para acomodar, e o cookie nunca precisa ser enviado numa
    // navegação vinda de outro site. É a defesa de CSRF das ações do painel.
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 3_600,
  });
}

// =============================================================================
// LEITURA DA SESSÃO
// =============================================================================

/**
 * Quem está logado no painel agora? `null` se não houver ninguém válido.
 *
 * A conta é relida a CADA chamada, e é isso que faz a desativação valer na hora:
 * um admin desliga a conta de alguém e, na próxima navegação dessa pessoa, ela
 * está do lado de fora — sem esperar a sessão expirar.
 */
export async function getStaffUser(): Promise<StaffUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;

  // A busca é pelo HASH: o valor em claro nunca é comparado com nada no banco.
  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      author: {
        select: { id: true, name: true, email: true, role: true, systemRole: true, isActive: true },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Limpeza oportunista: a sessão expirada some no primeiro uso, sem precisar
    // de um job periódico só para isso.
    await prisma.staffSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (!session.author.isActive) {
    // Conta desativada com sessão aberta: encerramos AQUI, e não só no momento
    // da desativação. É a rede de segurança para o caso de a revogação em massa
    // ter falhado por qualquer motivo — a porta fecha de qualquer forma.
    await prisma.staffSession.deleteMany({ where: { authorId: session.author.id } }).catch(() => {});
    return null;
  }

  return {
    id: session.author.id,
    name: session.author.name,
    email: session.author.email,
    accessLevel: toAccessLevel(session.author.systemRole),
    editorialRole: session.author.role,
  };
}

/** Encerra a sessão atual: apaga a linha E o cookie. */
export async function destroyStaffSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE)?.value;

  if (token) {
    // `deleteMany` em vez de `delete` para não estourar quando a linha já não
    // existe (duplo clique em "sair", sessão já revogada por um admin).
    await prisma.staffSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  cookieStore.delete(STAFF_SESSION_COOKIE);
}

/**
 * Revoga TODAS as sessões de uma conta.
 *
 * Chamada ao desativar uma conta e ao trocar a senha de alguém. Sem isso, a
 * desativação só valeria na expiração — e a pessoa, já logada, continuaria
 * publicando. É a operação que justifica a escolha de sessão opaca.
 */
export async function revokeStaffSessions(authorId: string): Promise<number> {
  const { count } = await prisma.staffSession.deleteMany({ where: { authorId } });
  return count;
}

// =============================================================================
// GUARDAS
// =============================================================================

/**
 * Guarda de PÁGINA. Devolve a pessoa logada ou `null` (a página renderiza o
 * formulário de acesso).
 *
 * `capability` opcional: quando informada, uma pessoa logada SEM aquela
 * permissão também recebe `null`... e é aí que estaria o erro. Ver o retorno:
 * distinguimos "não logado" de "logado sem permissão", porque as duas situações
 * pedem telas diferentes. Mostrar o formulário de login para quem já está logado
 * é a mensagem mais confusa possível — a pessoa digita a senha certa, entra, e
 * volta para a mesma tela de login.
 */
export type StaffPageGuard =
  | { state: 'anonymous' }
  | { state: 'forbidden'; user: StaffUser }
  | { state: 'ok'; user: StaffUser };

export async function requireStaffPage(
  capability?: keyof StaffCapabilities,
): Promise<StaffPageGuard> {
  const user = await getStaffUser();
  if (!user) return { state: 'anonymous' };
  if (capability && !can(user.accessLevel, capability)) return { state: 'forbidden', user };
  return { state: 'ok', user };
}

/**
 * Guarda de rota de API. Devolve a pessoa OU a resposta pronta para ser
 * retornada pela rota.
 *
 * O formato `{ ok: false, response }` (em vez de lançar uma exceção) é
 * deliberado: com exceção, esquecer o `try/catch` transforma "não autorizado"
 * num 500 sem corpo, e a tela do painel traduz isso como "Erro de conexão." —
 * a pior mensagem possível, porque sugere tentar de novo. Aqui, o TypeScript
 * obriga a tratar os dois casos antes de usar `user`.
 *
 * 401 × 403, e a diferença importa para a tela: 401 é "sua sessão acabou,
 * entre de novo"; 403 é "você está logado, mas isto não é seu". A primeira pede
 * relogin; a segunda, não — e o painel usa exatamente essa distinção para
 * decidir se recarrega a página ou apenas mostra a mensagem.
 */
export type StaffApiGuard =
  | { ok: true; user: StaffUser }
  | { ok: false; response: NextResponse };

export async function requireStaffApi(
  capability?: keyof StaffCapabilities,
): Promise<StaffApiGuard> {
  const user = await getStaffUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: 'Sua sessão expirou. Entre de novo para continuar.' },
        { status: 401 },
      ),
    };
  }

  if (capability && !can(user.accessLevel, capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: 'Sua conta não tem permissão para esta ação.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}

/** Resposta padrão de "esta matéria não é sua". */
export function forbiddenArticleResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      message:
        'Esta matéria é de outra pessoa da redação. Só quem assina a matéria (ou um administrador) pode editá-la.',
    },
    { status: 403 },
  );
}
