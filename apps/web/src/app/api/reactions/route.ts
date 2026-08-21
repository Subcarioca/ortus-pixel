/**
 * =============================================================================
 * POST /api/reactions — curtir / descurtir matéria
 * =============================================================================
 *
 * FLAT, e não `/api/articles/[id]/react` — segue a MESMA convenção de
 * `/api/comments`: o identificador da matéria vai no CORPO (`articleId`), não
 * no segmento de URL. Duas rotas de escrita do leitor com convenções
 * diferentes (uma no corpo, outra na URL) seria inconsistência sem ganho —
 * aqui não há nada de RESTful a preservar (não existe um recurso
 * "/reactions/{id}" que se leia sozinho), então a rota acompanha a vizinha
 * mais parecida.
 *
 * TOGGLE/REPLACE — ver o cabeçalho de `server/reactions.ts` para a regra
 * completa. Por isso só existe `POST`, nunca `DELETE`: "clicar de novo no
 * mesmo botão" já É a forma de desfazer.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { isReactionType, setReaction } from '@/server/reactions';
import { CACHE_TAGS } from '@/server/queries';
import { getReaderSession } from '@/server/reader-session';
import { checkRateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // IDENTIDADE PRIMEIRO — mesma ordem de `/api/comments`: sem sessão, nem vale
  // a pena validar o resto do corpo. A sessão também é o que dá um
  // identificador ESTÁVEL para o rate limit (ver abaixo); `setReaction` lê a
  // sessão de novo internamente (mesmo padrão de `followFranchise` em
  // `server/follows.ts`, que também relê a sessão dentro da função de
  // escrita) — duas leituras de um cookie já parseado custam bem menos do que
  // a complexidade de passar a sessão como parâmetro entre camadas.
  const session = await getReaderSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, message: 'Entre com uma conta para curtir ou descurtir.' },
      { status: 401 },
    );
  }

  // LIMITE POR CONTA, não por IP — mesmo raciocínio de `/api/comments`: toda
  // reação já exige login, então limitar por autor é mais justo (não pune uma
  // rede inteira) e mais difícil de contornar (exige conta nova a cada rodada
  // de abuso). Teto mais largo que o de comentário: reagir não grava texto e
  // não aciona fila de moderação, então o risco por ação é menor.
  const rateLimit = checkRateLimit(`reaction:${session.authorId}`, {
    maxRequests: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Muitas ações seguidas. Tente de novo em instantes.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Requisição inválida.' }, { status: 400 });
  }

  const payload = body as { articleId?: unknown; type?: unknown };

  // Mesmo padrão de validação de id do `/api/comments`: formato de `cuid`,
  // barrado ANTES de tocar no banco.
  if (typeof payload.articleId !== 'string' || !/^[a-z0-9-]{10,60}$/i.test(payload.articleId)) {
    return NextResponse.json({ ok: false, message: 'Artigo inválido.' }, { status: 400 });
  }

  if (!isReactionType(payload.type)) {
    return NextResponse.json({ ok: false, message: 'Reação inválida.' }, { status: 400 });
  }

  const result = await setReaction(payload.articleId, payload.type);

  if (!result.ok) {
    // `unauthenticated` não deveria ser alcançável aqui (já barramos acima),
    // mas o tipo de retorno de `setReaction` cobre o caso por ser uma função
    // de uso geral — tratado por completude, não porque o caminho seja
    // esperado.
    if (result.reason === 'unauthenticated') {
      return NextResponse.json(
        { ok: false, message: 'Entre com uma conta para curtir ou descurtir.' },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: false, message: 'Artigo não encontrado.' }, { status: 404 });
  }

  // Invalida o cache da PÁGINA do artigo (o contador aparece nela) e da HOME
  // (a seção "mais popular da semana" da Tarefa D lê `reactionCount`). Sem
  // isso, o número só atualizaria na próxima revalidação natural (1h/60s) —
  // aceitável, mas pior experiência logo depois do próprio clique da pessoa.
  revalidateTag(CACHE_TAGS.article(result.slug));
  revalidateTag(CACHE_TAGS.home);

  return NextResponse.json(
    { ok: true, current: result.current, reactionCount: result.reactionCount },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
