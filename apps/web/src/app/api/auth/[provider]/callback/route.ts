/**
 * =============================================================================
 * GET /api/auth/[provider]/callback — retorno do provedor OAuth
 * =============================================================================
 *
 * É a rota mais sensível do fluxo de comentários. A ordem das verificações
 * abaixo não é estética: cada uma barra um ataque conhecido, e todas acontecem
 * ANTES de qualquer escrita no banco.
 *
 *   1. provedor na lista fechada        → evita rota fantasma
 *   2. `error` do provedor              → usuário recusou; não é falha nossa
 *   3. `state` do cookie == `state` da  → CSRF de login (o ataque em que a
 *      URL, comparado em tempo constante   vítima acaba logada na conta do
 *                                          atacante e comenta por ele)
 *   4. `code_verifier` presente         → PKCE: sem ele, um código vazado na
 *                                          URL poderia ser trocado por token
 *   5. troca servidor-a-servidor        → o `client_secret` nunca vai ao
 *                                          navegador
 *
 * Os cookies do fluxo são apagados em TODOS os caminhos de saída, inclusive nos
 * de erro. Segredo de uso único que sobrevive ao uso deixa de ser de uso único.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { isCommentProvider } from '@subcarioca/core';

import { reconcileFollowsOnLogin } from '@/server/follows';
import { exchangeCodeForProfile, getProviderConfig, safeReturnTo } from '@/server/oauth';
import { createReaderSession, setSessionCookie } from '@/server/reader-session';
import { getClientIp, safeCompare } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!isCommentProvider(provider)) {
    return NextResponse.json({ ok: false, message: 'Provedor inválido.' }, { status: 400 });
  }

  const config = getProviderConfig(provider);
  if (!config) {
    return NextResponse.json({ ok: false, message: 'Não encontrado.' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(`oauth_state_${provider}`)?.value;
  const codeVerifier = cookieStore.get(`oauth_verifier_${provider}`)?.value;
  const returnTo = safeReturnTo(cookieStore.get(`oauth_return_${provider}`)?.value);

  // Limpeza dos cookies do fluxo. Definida uma vez e chamada em todas as
  // saídas — inclusive nas de erro.
  const clearFlowCookies = () => {
    cookieStore.delete(`oauth_state_${provider}`);
    cookieStore.delete(`oauth_verifier_${provider}`);
    cookieStore.delete(`oauth_return_${provider}`);
  };

  const url = new URL(request.url);

  // O usuário clicou em "cancelar" na tela do provedor. Não é erro: é uma
  // decisão dele. Volta para a página de origem, em silêncio.
  if (url.searchParams.get('error')) {
    clearFlowCookies();
    return NextResponse.redirect(absolute(`${returnTo}?login=cancelado`));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state || !expectedState || !codeVerifier) {
    clearFlowCookies();
    return NextResponse.redirect(absolute(`${returnTo}?login=falhou`));
  }

  // Comparação em TEMPO CONSTANTE, e não `===`. O `state` é um segredo de
  // sessão; comparar com `===` vaza informação por tempo, do mesmo jeito que
  // vazaria numa comparação de token de admin. Custa a mesma linha.
  if (!safeCompare(state, expectedState)) {
    console.warn(`[oauth] ${provider}: state divergente — possível CSRF de login`);
    clearFlowCookies();
    return NextResponse.redirect(absolute(`${returnTo}?login=falhou`));
  }

  const profile = await exchangeCodeForProfile(config, code, codeVerifier);
  clearFlowCookies();

  if (!profile) {
    return NextResponse.redirect(absolute(`${returnTo}?login=falhou`));
  }

  const { token, blocked, authorId } = await createReaderSession({
    provider,
    providerAccountId: profile.providerAccountId,
    displayName: profile.displayName,
    userAgent: request.headers.get('user-agent'),
    ip: getClientIp(request.headers),
  });

  // Conta bloqueada pela moderação: NÃO gravamos o cookie. A pessoa volta como
  // leitor anônimo, sem mensagem de banimento — explicar o bloqueio só ensina o
  // abusador a contornar (criar conta nova, mudar de provedor).
  if (blocked) {
    return NextResponse.redirect(absolute(returnTo));
  }

  await setSessionCookie(token);

  // Adota os follows feitos ANTES do login neste navegador.
  //
  // Roda depois de a sessão estar gravada e nunca antes: se falhar, o login em
  // si já está completo. Por isso o erro é registrado e engolido — perder a
  // vinculação de alguns follows é ruim, mas derrubar a autenticação inteira
  // por causa dela seria muito pior. A pessoa reencontra o botão "Seguir" e
  // clica de novo; já um login que falha não tem contorno.
  try {
    await reconcileFollowsOnLogin(authorId);
  } catch (error) {
    console.error(
      '[oauth] follows anônimos não puderam ser vinculados à conta:',
      error instanceof Error ? error.message : error,
    );
  }

  // A ÂNCORA VEM DE QUEM INICIOU O LOGIN, não daqui.
  //
  // Antes esta rota concatenava `#comentarios` fixo, porque comentar era o
  // único motivo de existir login. Agora o leitor também entra pelo botão
  // "Seguir" e pelo cabeçalho — e mandá-lo para uma âncora de comentários que
  // talvez nem exista na página seria um salto sem explicação. O convite de
  // login do bloco de comentários passou a incluir a própria âncora no
  // `returnTo` (ver comment-section.tsx).
  return NextResponse.redirect(absolute(returnTo));
}

/**
 * Monta a URL absoluta do redirecionamento a partir da variável de ambiente.
 *
 * Nunca a partir do cabeçalho `Host` — mesmo cuidado de host header injection
 * aplicado em `core/routes.ts` e no início do fluxo.
 */
function absolute(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
