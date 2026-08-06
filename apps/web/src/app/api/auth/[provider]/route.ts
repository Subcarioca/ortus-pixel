/**
 * =============================================================================
 * GET /api/auth/[provider] — início do login social
 * =============================================================================
 *
 * Redireciona para o Discord ou o Google, guardando `state` e `code_verifier`
 * em cookies de vida curta que serão conferidos no retorno.
 *
 * POR QUE OS SEGREDOS DO FLUXO VÃO PARA COOKIE, e não para o banco: eles vivem
 * 10 minutos e pertencem a UM navegador. Uma tabela para isso significaria
 * escrever e apagar linhas a cada clique em "entrar" — inclusive dos cliques
 * que nunca completam o fluxo, que são muitos. O cookie `httpOnly` guarda o
 * dado no lugar certo, expira sozinho e não deixa lixo.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { isCommentProvider } from '@canalnerd/core';

import { buildAuthorizationRequest, getProviderConfig, safeReturnTo } from '@/server/oauth';
import { checkRateLimit, getClientIp } from '@/server/security';

/** Nunca cacheado: cada início de fluxo gera segredos novos. */
export const dynamic = 'force-dynamic';

/** 10 minutos: tempo de sobra para logar, curto para um segredo esquecido. */
const FLOW_COOKIE_MAX_AGE = 600;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  // Lista fechada antes de qualquer coisa: o segmento vem da URL.
  if (!isCommentProvider(provider)) {
    return NextResponse.json({ ok: false, message: 'Provedor inválido.' }, { status: 400 });
  }

  const config = getProviderConfig(provider);
  if (!config) {
    // Sem credencial configurada, o recurso não existe. Respondemos 404 (e não
    // "provedor desabilitado") para não descrever a configuração do servidor a
    // quem estiver sondando.
    return NextResponse.json({ ok: false, message: 'Não encontrado.' }, { status: 404 });
  }

  // Rate limit no INÍCIO do fluxo: sem ele, um script dispara milhares de
  // redirecionamentos e nos queima a cota de OAuth do provedor — que responde
  // bloqueando a nossa aplicação, não o atacante.
  const ip = getClientIp(request.headers);
  const rateLimit = checkRateLimit(`auth-start:${ip}`, { maxRequests: 10, windowSeconds: 600 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Muitas tentativas. Aguarde alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  const url = new URL(request.url);
  // Para onde voltar depois do login. Validado contra open redirect.
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));

  const { url: authorizeUrl, state, codeVerifier } = buildAuthorizationRequest(config);

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax` é obrigatório aqui: o retorno do provedor é uma navegação
    // cross-site e, com `strict`, estes cookies não seriam enviados de volta —
    // o fluxo falharia sempre.
    sameSite: 'lax' as const,
    path: '/',
    maxAge: FLOW_COOKIE_MAX_AGE,
  };

  cookieStore.set(`oauth_state_${provider}`, state, cookieOptions);
  cookieStore.set(`oauth_verifier_${provider}`, codeVerifier, cookieOptions);
  cookieStore.set(`oauth_return_${provider}`, returnTo, cookieOptions);

  return NextResponse.redirect(authorizeUrl);
}
