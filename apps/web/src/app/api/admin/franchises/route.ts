/**
 * =============================================================================
 * POST /api/admin/franchises — cadastrar uma FRANQUIA no catálogo
 * =============================================================================
 *
 * O BURACO QUE ESTA ROTA FECHA
 * -----------------------------------------------------------------------------
 * `Franchise` é um dos modelos mais visíveis do produto: cada linha vira uma
 * página pública permanente (`/franquia/gta`), um chip no rodapé das matérias,
 * uma pílula em "Seus universos" na home, uma entrada no sitemap e um botão de
 * "seguir" que alimenta a notificação por fandom.
 *
 * E, até aqui, NÃO EXISTIA NENHUM CAMINHO PARA CRIAR UMA. O painel só sabia
 * LISTAR o que já estava lá (o `<select multiple>` de `/admin/materias` e o da
 * fila de pautas); o catálogo inteiro vinha do seed. Na prática: cobrir uma
 * franquia que o seed não previu — um jogo anunciado ontem, um anime da
 * temporada — exigia abrir o banco à mão, ou publicar a matéria sem etiqueta
 * nenhuma (perdendo o hub, as relacionadas por franquia e o "seguir").
 *
 * -----------------------------------------------------------------------------
 * QUEM PODE: `criarFranquia` — administrador E redator
 * -----------------------------------------------------------------------------
 * A capacidade é NOVA e não um reaproveitamento de `criarPauta`. O racional
 * completo está na declaração da chave em `packages/core/src/staff.ts`; o
 * resumo é que pauta é item de fila interna e franquia é item de CATÁLOGO
 * PÚBLICO, e misturar as duas numa chave só faria a pergunta "quem pode criar
 * página nova no site?" depender de alguém lembrar do apelido errado.
 *
 * É `true` para os dois níveis pelo mesmo critério que já valia em
 * `criarPauta`: acrescentar não tira nada de ninguém. Esta rota só CRIA — não
 * edita, não renomeia e não apaga. A distinção não é burocracia: trocar o slug
 * de uma franquia quebra toda URL indexada e todo link já compartilhado, e
 * apagar leva junto seguidores e vínculos com matérias publicadas. Essas duas
 * ações continuam não existindo no produto, e quando existirem terão a própria
 * capacidade e a própria decisão.
 *
 * -----------------------------------------------------------------------------
 * SEGURANÇA (OWASP)
 * -----------------------------------------------------------------------------
 *   A01 — sessão da redação obrigatória, via `requireStaffApi`, com capacidade
 *         explícita. Sem sessão, 401; com sessão sem a capacidade, 403.
 *   A03 — nada do corpo vira SQL: o Prisma parametriza tudo. O SLUG é gerado
 *         por `slugify` (lista branca `a-z0-9-`) mesmo quando a pessoa o digita,
 *         então não existe caminho para um slug com barra, ponto ou caractere de
 *         controle entrar numa URL do site.
 *   A04 — todo campo tem teto de tamanho ANTES de tocar no banco. O MySQL desta
 *         hospedagem NÃO está em `sql_mode` estrito e TRUNCA em silêncio (ver o
 *         cabeçalho do schema): sem os tetos, um nome longo demais viraria um
 *         nome cortado pela metade, sem erro nenhum.
 *   A05 — `isReservedSlug` recusa os nomes que colidiriam com rotas do site.
 *         Sem isso, uma franquia "newsletter" ou "busca" sequestraria a página
 *         correspondente no dia em que as URLs curtas entrarem (ver
 *         `RESERVED_SLUGS` em core/routes.ts).
 *   A09 — `AuditLog` registra quem criou o quê, com IP em hash. Catálogo
 *         público é justamente o tipo de dado em que "quem colocou isso aqui?"
 *         é perguntado semanas depois.
 *
 * O LIMITE DE TAXA existe mesmo com a rota autenticada, pela mesma razão da
 * rota de upload: a sessão prova QUEM é, não prova que o cliente não está com
 * defeito. Um laço acidental na tela (ou uma conta comprometida) encheria o
 * catálogo — e catálogo poluído é sujeira PÚBLICA, com página indexável para
 * cada linha. 20 franquias em 10 minutos é folgado para o trabalho real de uma
 * redação e fecha o cenário de laço. A chave é a CONTA e não o IP: a redação
 * inteira pode estar atrás do mesmo IP de escritório.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';
import { isCategorySlug, isReservedSlug, slugify } from '@subcarioca/core';

import { requireStaffApi } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, hashPersonalData } from '@/server/security';

export const dynamic = 'force-dynamic';

/**
 * Tetos alinhados às colunas do schema, com folga.
 *
 * `name` e `slug` são `String` sem anotação no Prisma, o que no MySQL vira
 * `VARCHAR(191)`. Os números aqui ficam bem abaixo disso de propósito: o
 * objetivo não é "caber", é recusar entrada absurda antes de ela chegar perto
 * do limite físico. `slugify` já corta em 80 por conta própria.
 */
const MAX_NAME = 120;
const MAX_DESCRIPTION = 600;
const MAX_ALIASES = 12;
const MAX_ALIAS_LENGTH = 80;

export async function POST(request: Request) {
  const guard = await requireStaffApi('criarFranquia');
  if (!guard.ok) return guard.response;

  const limit = checkRateLimit(`franchise:${guard.user.id}`, {
    maxRequests: 20,
    windowSeconds: 600,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Muitos cadastros seguidos. Tente de novo em ${limit.resetInSeconds}s.`,
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'JSON inválido.' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  // ---------------------------------------------------------------------------
  // NOME
  // ---------------------------------------------------------------------------
  const name = typeof payload.name === 'string' ? payload.name.trim().replace(/\s+/g, ' ') : '';

  if (name.length < 2 || name.length > MAX_NAME) {
    return NextResponse.json(
      {
        ok: false,
        message: `O nome da franquia precisa ter entre 2 e ${MAX_NAME} caracteres (tem ${name.length}).`,
      },
      { status: 400 },
    );
  }

  /**
   * SLUG — SEMPRE passado por `slugify`, inclusive quando digitado à mão.
   *
   * O campo do formulário existe porque a derivação automática nem sempre
   * acerta o que o público procura ("The Legend of Zelda" → `zelda` é melhor
   * URL que `the-legend-of-zelda`). Mas o valor digitado NUNCA é usado cru: ele
   * passa pela mesma lista branca do automático. Assim não existe um segundo
   * caminho, mais frouxo, para um slug chegar à URL — e este é exatamente o
   * tipo de "campo avançado" por onde um caractere estranho entraria.
   *
   * Vazio depois do slugify (alguém digitou só emoji, ou o nome é todo em
   * caracteres não latinos) é recusado com mensagem específica, e não com a
   * genérica: o problema está num campo que a pessoa talvez nem tenha
   * preenchido, e "nome inválido" mandaria ela mexer no lugar errado.
   */
  const slugSource = typeof payload.slug === 'string' && payload.slug.trim() ? payload.slug : name;
  const slug = slugify(slugSource);

  if (slug.length < 2) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'Não foi possível montar um endereço (slug) a partir deste nome. ' +
          'Escreva o slug à mão, com letras sem acento, números e hífen — por exemplo: gta.',
      },
      { status: 400 },
    );
  }

  if (isReservedSlug(slug)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          `"${slug}" é um endereço reservado do site (ele já é usado por uma página nossa). ` +
          'Escolha outro slug para esta franquia.',
      },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // EDITORIA PRIMÁRIA — obrigatória no schema (`primaryCategoryId` não é nulável)
  // ---------------------------------------------------------------------------
  const categorySlug = typeof payload.primaryCategorySlug === 'string' ? payload.primaryCategorySlug : '';

  if (!isCategorySlug(categorySlug)) {
    return NextResponse.json(
      { ok: false, message: 'Escolha a editoria principal da franquia.' },
      { status: 400 },
    );
  }

  /**
   * ALIASES — os nomes alternativos que os conectores usam para casar menções.
   *
   * Aceitamos array (o que a tela manda) OU uma string com vírgulas (o que um
   * script ou um `curl` de manutenção manda naturalmente). Suportar as duas
   * formas aqui custa três linhas e evita que alguém precise descobrir o
   * formato exato numa madrugada.
   *
   * Normalização: recorta, descarta vazio, corta no comprimento máximo e tira
   * repetido SEM diferenciar maiúsculas — "GTA" e "gta" na mesma lista não
   * ajudam o casamento de menção e só engordam a coluna. O primeiro escrito
   * vence, para preservar a grafia que a pessoa escolheu.
   */
  const rawAliases = Array.isArray(payload.aliases)
    ? payload.aliases
    : typeof payload.aliases === 'string'
      ? payload.aliases.split(',')
      : [];

  const aliases: string[] = [];
  const seenAliases = new Set<string>();

  for (const value of rawAliases) {
    if (typeof value !== 'string') continue;
    const alias = value.trim().replace(/\s+/g, ' ').slice(0, MAX_ALIAS_LENGTH);
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seenAliases.has(key)) continue;
    seenAliases.add(key);
    aliases.push(alias);
    if (aliases.length >= MAX_ALIASES) break;
  }

  const description =
    typeof payload.description === 'string' ? payload.description.trim().slice(0, MAX_DESCRIPTION) : '';

  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  });

  if (!category) {
    return NextResponse.json(
      { ok: false, message: 'Editoria não encontrada no banco. Recarregue a página.' },
      { status: 400 },
    );
  }

  /**
   * A UNICIDADE DO SLUG É GARANTIDA PELO ÍNDICE DO BANCO, e não por uma consulta
   * prévia — pelo mesmo motivo registrado na rota de pautas: entre "consultei e
   * não achei" e "gravei" existe uma janela, e duas pessoas cadastrando "Zelda"
   * ao mesmo tempo cairiam nela. O `P2002` é o caminho CORRETO aqui, não o
   * caminho de exceção.
   */
  try {
    const franchise = await prisma.$transaction(async (tx) => {
      const created = await tx.franchise.create({
        data: {
          slug,
          name,
          description,
          // Coluna `Json` (o MySQL não tem array nativo). O Prisma Client
          // entrega e recebe um array de strings normalmente — ver o comentário
          // do campo no schema. O valor é passado EXPLICITAMENTE mesmo com
          // `@default("[]")` declarado, porque o padrão não chega ao banco no
          // conector MySQL (prisma#23250).
          aliases,
          primaryCategoryId: category.id,
        },
        select: { id: true, slug: true, name: true },
      });

      await tx.auditLog.create({
        data: {
          action: 'franchise.created',
          entityType: 'Franchise',
          entityId: created.id,
          actorId: guard.user.id,
          after: { slug, name, categorySlug, aliases: aliases.length },
          ipHash: hashPersonalData(getClientIp(request.headers)),
        },
      });

      return created;
    });

    return NextResponse.json({
      ok: true,
      id: franchise.id,
      slug: franchise.slug,
      message: `Franquia "${franchise.name}" criada. O hub dela já responde em /franquia/${franchise.slug}.`,
    });
  } catch (error) {
    if (isDuplicate(error)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            `Já existe uma franquia com o endereço "${slug}". ` +
            'Confira a lista abaixo: provavelmente ela já está cadastrada com outro nome, ' +
            'ou alguém acabou de criá-la.',
        },
        { status: 409 },
      );
    }
    throw error;
  }
}

/** P2002 = violação de índice único. Aqui, só `slug` é único no model. */
function isDuplicate(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}
