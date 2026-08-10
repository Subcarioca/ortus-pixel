/**
 * =============================================================================
 * CRIAÇÃO DA PRIMEIRA CONTA DE ADMINISTRADOR (e resgate de acesso)
 * =============================================================================
 *
 *   npm run staff:create -- --email=voce@ortuspixel.com --nome="Seu Nome" --nivel=admin
 *   npm run staff:create -- --email=voce@ortuspixel.com --senha            (troca a senha)
 *   npm run staff:create -- --listar                                       (quem tem acesso)
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM SCRIPT DE LINHA DE COMANDO, E NÃO UMA "ROTA DE SETUP"
 * -----------------------------------------------------------------------------
 * A alternativa óbvia era uma página `/admin/setup` que só funcionasse enquanto
 * não existisse nenhum admin. Ela foi descartada, e vale registrar o motivo
 * porque a ideia volta sempre:
 *
 *   1. É um endpoint de ESCRITA SEM AUTENTICAÇÃO exposto na internet pública. A
 *      segurança dele inteira depende de uma única condição ("não existe admin")
 *      ser avaliada corretamente para sempre, inclusive depois de refatorações
 *      feitas por quem não conhece essa história. Um `count()` que passe a
 *      contar contas inativas, ou uma condição invertida numa correção
 *      apressada, entrega o site inteiro para o primeiro visitante.
 *   2. Existe uma janela real entre subir a aplicação e criar a conta. Quem
 *      chegar primeiro nessa janela vira o administrador — e num deploy que
 *      falhou no meio, essa janela pode durar horas sem ninguém perceber.
 *   3. O modo de resgate (o painel trancou, ninguém entra) precisa funcionar
 *      QUANDO existe admin, e aí a rota de setup, por construção, está desligada.
 *
 * Este script exige acesso ao servidor e à `DATABASE_URL` — ou seja, quem pode
 * rodá-lo já poderia editar o banco diretamente de qualquer forma. Ele não
 * adiciona nenhuma superfície de ataque nova; só torna a operação segura e
 * auditável em vez de um UPDATE escrito à mão.
 *
 * -----------------------------------------------------------------------------
 * A SENHA NÃO É PASSADA POR ARGUMENTO
 * -----------------------------------------------------------------------------
 * Argumento de linha de comando aparece no histórico do shell, na lista de
 * processos (`ps`) e frequentemente em log de auditoria do sistema. A senha é
 * lida do terminal, sem eco.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';

import { PrismaClient } from '@prisma/client';

import { hashPassword, validateStaffPassword } from '../src/password.js';

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const found = argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
}

function hasFlag(name: string): boolean {
  return argv.includes(`--${name}`);
}

/**
 * Lê as duas senhas (a nova e a confirmação).
 *
 * DOIS MODOS, e a existência do segundo é uma correção de um jeito de falhar
 * ruim: a primeira versão deste script só funcionava com terminal de verdade e,
 * quando alguém canalizava a entrada (`printf ... | npm run staff:create`),
 * imprimia os dois prompts e MORRIA EM SILÊNCIO, sem criar a conta e sem dizer
 * que não criou. Um script de resgate que falha sem avisar é pior do que não
 * existir — quem o usa está, por definição, num momento em que nada mais
 * funciona.
 *
 *   TTY   → pergunta interativamente, sem ecoar as teclas. Senha visível na tela
 *           é senha visível para quem passa atrás, para a gravação de tela e
 *           para o print colado num chat.
 *   PIPE  → lê duas linhas da entrada. É o modo usado em automação de deploy, e
 *           tem uma vantagem sobre passar a senha por argumento: o que vem pelo
 *           stdin não aparece no histórico do shell nem em `ps`.
 */
async function readPasswordTwice(): Promise<{ password: string; confirm: string }> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    const [first = '', second = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);

    if (!first) {
      console.error(
        'Entrada vazia. Em modo não interativo, mande a senha duas vezes pelo stdin:\n' +
          '  printf \'sua-senha\\nsua-senha\\n\' | npm run staff:create -- --email=...\n',
      );
      exit(1);
    }

    return { password: first, confirm: second };
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  const ask = async (question: string): Promise<string> => {
    const originalWrite = stdout.write.bind(stdout);
    const promise = rl.question(question);

    // A partir daqui o eco das teclas é engolido; a pergunta em si continua
    // sendo impressa.
    (stdout as unknown as { write: typeof originalWrite }).write = ((
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ) => {
      const text = typeof chunk === 'string' ? chunk : '';
      if (text.includes(question)) return originalWrite(chunk as string, ...(rest as []));
      return true;
    }) as typeof originalWrite;

    const answer = await promise;
    (stdout as unknown as { write: typeof originalWrite }).write = originalWrite;
    originalWrite('\n');
    return answer;
  };

  const password = await ask('Senha (mínimo 12 caracteres, não aparece na tela): ');
  const confirm = await ask('Repita a senha: ');
  rl.close();

  return { password, confirm };
}

async function main(): Promise<void> {
  if (hasFlag('listar')) {
    const authors = await prisma.author.findMany({
      orderBy: [{ systemRole: 'asc' }, { name: 'asc' }],
      select: {
        name: true,
        email: true,
        systemRole: true,
        isActive: true,
        passwordHash: true,
        lastLoginAt: true,
      },
    });

    console.log('\nContas da redação\n');
    for (const a of authors) {
      const acesso = a.passwordHash ? a.systemRole : 'sem senha (não entra)';
      const estado = a.isActive ? 'ativa' : 'DESATIVADA';
      const ultimo = a.lastLoginAt ? a.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : 'nunca';
      console.log(`  ${a.name.padEnd(22)} ${a.email.padEnd(34)} ${acesso.padEnd(24)} ${estado.padEnd(11)} último acesso: ${ultimo}`);
    }
    console.log('');
    return;
  }

  const email = arg('email')?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error(
      'Uso:\n' +
        '  npm run staff:create -- --email=voce@dominio.com --nome="Seu Nome" [--nivel=admin|redator] [--titulo="Editor-chefe"]\n' +
        '  npm run staff:create -- --email=voce@dominio.com --senha\n' +
        '  npm run staff:create -- --listar\n',
    );
    exit(1);
  }

  const { password: senha, confirm } = await readPasswordTwice();

  const validated = validateStaffPassword(senha);
  if (!validated.ok) {
    console.error(`\n${validated.message}`);
    exit(1);
  }

  if (confirm !== validated.password) {
    console.error('\nAs senhas não conferem. Nada foi alterado.');
    exit(1);
  }

  const passwordHash = await hashPassword(validated.password);
  const existing = await prisma.author.findUnique({ where: { email }, select: { id: true, name: true } });

  if (existing) {
    // Conta já existe: o script só troca a senha (e, se pedido, o nível). NUNCA
    // renomeia nem reescreve o título editorial em silêncio — quem digitou o
    // e-mail de alguém por engano deve receber um efeito colateral pequeno e
    // reversível, não a identidade pública de outra pessoa sobrescrita.
    const nivel = arg('nivel');
    await prisma.$transaction([
      prisma.author.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          isActive: true,
          ...(nivel === 'admin' || nivel === 'redator' ? { systemRole: nivel } : {}),
        },
      }),
      // Trocar a senha derruba as sessões abertas — mesma regra da troca pelo
      // painel. Se o motivo do resgate for acesso indevido, deixar as sessões
      // vivas anularia o resgate.
      prisma.staffSession.deleteMany({ where: { authorId: existing.id } }),
      prisma.auditLog.create({
        data: {
          action: 'staff.password_reset_cli',
          entityType: 'Author',
          entityId: existing.id,
          // Sem `actorId`: quem roda o script é o operador do servidor, que não
          // tem linha em `Author`. Registrar isso como "ninguém" é mais honesto
          // do que atribuir a ação a uma conta que não a executou.
          after: { via: 'cli' },
        },
      }),
    ]);

    console.log(`\nSenha de ${existing.name} (${email}) atualizada. Sessões abertas encerradas.`);
    return;
  }

  const nome = arg('nome')?.trim();
  if (!nome || nome.length < 3) {
    console.error('\nConta nova precisa de --nome="Nome Completo".');
    exit(1);
  }

  const nivelArg = arg('nivel');
  const systemRole = nivelArg === 'redator' ? 'redator' : 'admin';
  const titulo = arg('titulo')?.trim() || (systemRole === 'admin' ? 'Editor-chefe' : 'Redator');

  const baseSlug =
    nome
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'redacao';

  let slug = baseSlug;
  for (let attempt = 2; attempt <= 20; attempt += 1) {
    const taken = await prisma.author.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const created = await prisma.author.create({
    data: { name: nome, slug, email, role: titulo, systemRole, passwordHash },
    select: { id: true, name: true },
  });

  await prisma.auditLog.create({
    data: {
      action: 'staff.account_created_cli',
      entityType: 'Author',
      entityId: created.id,
      after: { name: nome, email, accessLevel: systemRole, via: 'cli' },
    },
  });

  console.log(
    `\nConta criada: ${created.name} <${email}> como ${systemRole}.\n` +
      `Entre em /admin com esse e-mail e essa senha.\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFalhou:', error instanceof Error ? error.message : error);
    exit(1);
  })
  .finally(() => prisma.$disconnect());
