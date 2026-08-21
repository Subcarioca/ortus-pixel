import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { COMMENT_PROVIDERS, sanitizeDisplayName, type CommentProvider } from '@subcarioca/core';

/**
 * =============================================================================
 * CLIENTE OAUTH 2.0 — login social da conta do leitor (Discord, Google,
 * Facebook, X e Instagram)
 * =============================================================================
 *
 * DECISÃO DE ARQUITETURA — POR QUE NÃO AUTH.JS (ADR 0011 no README)
 *
 * Auth.js (NextAuth) é a escolha natural num projeto Next.js e foi seriamente
 * considerada. Três fatos concretos pesaram contra, e o terceiro é decisivo:
 *
 * 1. A v5, que é a versão com suporte de verdade ao App Router, continua em
 *    BETA (5.0.0-beta.32 em ago/2026). A v4 estável foi desenhada para o Pages
 *    Router. Colocar a autenticação do produto sobre um beta de dois anos, ou
 *    sobre uma versão em modo de compatibilidade, é uma dívida com data marcada.
 *
 * 2. O adaptador de banco do Auth.js cria e popula tabelas próprias
 *    (User/Account/Session) com nome, e-mail e imagem EM CLARO, além de guardar
 *    access e refresh tokens. É o oposto da política de minimização deste
 *    projeto — teríamos de lutar contra o padrão da biblioteca para guardar
 *    menos dado pessoal do que ela quer guardar.
 *
 * 3. SESSÃO REVOGÁVEL. O caso de uso central da moderação é "bane esse sujeito
 *    agora". Com sessão em JWT (o modo do Auth.js sem adaptador), o token
 *    continua valendo até expirar; revogar exige manter uma lista de bloqueio —
 *    que é um banco de sessões, só que pior. Com sessão opaca no banco, apagar
 *    a linha encerra o acesso no clique seguinte.
 *
 * O QUE ESTAMOS IMPLEMENTANDO À MÃO, e por que isso NÃO é "rolar a própria
 * criptografia": somos o CLIENTE (relying party) de um fluxo padronizado. Não
 * inventamos protocolo, não validamos assinatura de token, não guardamos senha.
 * O fluxo é: redireciona → recebe `code` → troca por `access_token` no servidor
 * → lê o perfil → cria sessão nossa. As partes sensíveis são `state` (CSRF) e
 * PKCE, ambas construídas com `randomBytes` + SHA-256, primitivas que este
 * projeto já usa em tokens de newsletter.
 *
 * SE ISSO ENVELHECER MAL (mais provedores, SSO da redação, refresh de token),
 * a migração para Auth.js é local: só este arquivo e o de sessão mudam. As
 * tabelas `CommentAuthor`/`CommentSession` continuam válidas.
 *
 * -----------------------------------------------------------------------------
 * MINIMIZAÇÃO DE ESCOPO — a decisão de LGPD mais importante do arquivo
 * -----------------------------------------------------------------------------
 * Pedimos o MENOR escopo que faz o recurso existir:
 *   Discord   → `identify`                    (id, nome público, avatar).
 *   Google    → `openid profile`               (sub, nome, foto).
 *   Facebook  → `public_profile`                (id, nome).
 *   X         → `tweet.read users.read`        (id, nome, @usuário) — é o
 *               mínimo que a API do X exige para ler o perfil básico; não dá
 *               para pedir só `users.read` sozinho (a API recusa o token).
 *   Instagram → `instagram_business_basic`     (id, @usuário).
 * NENHUM dos cinco pede `email`.
 *
 * Não pedir o e-mail resolve três problemas de uma vez: a tela de consentimento
 * fica menos assustadora (converte melhor), não guardamos um dado que não
 * usaríamos, e um vazamento do nosso banco não expõe endereço de ninguém.
 * A coluna `emailHash` existe no schema e permanece NULA — se um dia o produto
 * precisar dela, será uma decisão consciente com escopo novo, não um dado que
 * já estava lá "por via das dúvidas".
 *
 * -----------------------------------------------------------------------------
 * ⚠ INSTAGRAM: LIMITAÇÃO REAL DA PLATAFORMA, NÃO DESTE CÓDIGO
 * -----------------------------------------------------------------------------
 * A "Instagram Basic Display API" (o caminho de login simples para qualquer
 * conta pessoal) foi DESCONTINUADA pela Meta em dezembro de 2024. O caminho
 * atual — "Instagram API with Instagram Login", implementado abaixo — é
 * desenhado para contas Business/Creator (mesmo que sem Página do Facebook
 * vinculada, a conta do Instagram precisa estar configurada como profissional).
 * Um leitor com conta PESSOAL comum pode simplesmente não conseguir concluir o
 * login. Ver o alerta completo no cabeçalho de `core/community.ts`.
 */

export interface OAuthProviderConfig {
  id: CommentProvider;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  /**
   * Como o `client_secret` é apresentado na troca de código por token.
   *
   * `undefined` (padrão) → o segredo vai no CORPO do POST, junto de `client_id`
   * e `code` — é o que Discord, Google, Facebook e Instagram aceitam.
   *
   * `'basic'` → o segredo vai no cabeçalho `Authorization: Basic
   * base64(client_id:client_secret)`, e SAI do corpo. Hoje só o X exige isto:
   * é a forma de autenticação de "cliente confidencial" da RFC 6749 §2.3.1, e a
   * API do X trata o client_secret no corpo como formato inválido para esse
   * tipo de cliente. Campo por provedor (em vez de um `if (provider === 'x')`
   * dentro de `exchangeCodeForProfile`) para o próximo provedor com a mesma
   * exigência não precisar tocar na função de troca — só declarar a config.
   */
  tokenAuthStyle?: 'basic';
}

/**
 * Configuração dos provedores, lida do ambiente.
 *
 * Sem credencial, o provedor simplesmente NÃO é oferecido — nada de "modo
 * simulado" aqui. O projeto usa simulação nos conectores de sinal porque lá o
 * risco é um score impreciso; em autenticação, um "modo de desenvolvimento que
 * loga sem verificar" é a porta dos fundos que alguém esquece aberta em
 * produção. Se não há credencial, os comentários ficam em modo leitura.
 */
export function getProviderConfig(provider: CommentProvider): OAuthProviderConfig | null {
  const configs: Record<CommentProvider, OAuthProviderConfig> = {
    discord: {
      id: 'discord',
      label: 'Discord',
      authorizeUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      userInfoUrl: 'https://discord.com/api/users/@me',
      scope: 'identify',
      clientId: process.env.DISCORD_CLIENT_ID ?? '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    },
    google: {
      id: 'google',
      label: 'Google',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid profile',
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    facebook: {
      id: 'facebook',
      label: 'Facebook',
      // v21.0: versão estável mais recente do Graph API em ago/2026. O número
      // da versão precisa ser revisado periodicamente — a Meta aposenta versões
      // antigas com aviso de ~2 anos.
      authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
      // `fields=id,name`: só o suficiente para reconhecer a conta e assinar o
      // comentário. Sem `email` — mesmo princípio dos outros provedores.
      userInfoUrl: 'https://graph.facebook.com/me?fields=id,name',
      // `public_profile` é o escopo PADRÃO (nem precisa ser pedido explicitamente
      // pela maioria dos apps, mas declarado aqui por clareza) e não exige
      // revisão do app pela Meta, ao contrário de `email`.
      scope: 'public_profile',
      clientId: process.env.FACEBOOK_CLIENT_ID ?? '',
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? '',
    },
    x: {
      id: 'x',
      label: 'X',
      authorizeUrl: 'https://x.com/i/oauth2/authorize',
      tokenUrl: 'https://api.x.com/2/oauth2/token',
      userInfoUrl: 'https://api.x.com/2/users/me',
      // `users.read` sozinho não é aceito pela API do X para ler o perfil
      // básico — `tweet.read` precisa acompanhar, mesmo sem lermos post nenhum.
      scope: 'tweet.read users.read',
      clientId: process.env.X_CLIENT_ID ?? '',
      clientSecret: process.env.X_CLIENT_SECRET ?? '',
      // ⚠ Único provedor com PKCE OBRIGATÓRIO pela própria API (os outros já
      // recebem PKCE deste cliente por padrão, mas o X é quem o EXIGE) e com
      // troca de token via Basic Auth — ver `tokenAuthStyle` na interface.
      tokenAuthStyle: 'basic',
    },
    instagram: {
      id: 'instagram',
      label: 'Instagram',
      // "Instagram API with Instagram Login" — ver o alerta no cabeçalho deste
      // arquivo e em core/community.ts: só funciona para conta Business/Creator.
      authorizeUrl: 'https://www.instagram.com/oauth/authorize',
      tokenUrl: 'https://api.instagram.com/oauth/access_token',
      // `graph.instagram.com` (não `graph.facebook.com`): é o host do Graph
      // API específico da Instagram Platform. Pedimos `username` e não `name`:
      // a resposta deste endpoint para conta comum não traz nome de exibição,
      // só o @usuário — é o único dado de identificação visual disponível.
      userInfoUrl: 'https://graph.instagram.com/me?fields=id,username',
      // Escopo mínimo pós-migração de nomenclatura (os antigos `basic`/
      // `business_basic`, sem o prefixo `instagram_`, foram desativados pela
      // Meta em 27/jan/2025).
      scope: 'instagram_business_basic',
      clientId: process.env.INSTAGRAM_CLIENT_ID ?? '',
      clientSecret: process.env.INSTAGRAM_CLIENT_SECRET ?? '',
    },
  };

  const config = configs[provider];
  if (!config.clientId || !config.clientSecret) return null;
  return config;
}

/** Provedores efetivamente disponíveis — o front só mostra botão para estes. */
export function availableProviders(): CommentProvider[] {
  return COMMENT_PROVIDERS.filter((provider) => getProviderConfig(provider) !== null);
}

/**
 * URL de retorno registrada no provedor.
 *
 * Vem de variável de ambiente e NUNCA do cabeçalho `Host`. Confiar no `Host`
 * abre host header injection: o atacante manda `Host: evil.com`, o provedor
 * devolve o código de autorização para lá e a conta do leitor é comprometida.
 * (É o mesmo cuidado já aplicado nos links de e-mail — ver core/routes.ts.)
 */
export function redirectUriFor(provider: CommentProvider): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/auth/${provider}/callback`;
}

// =============================================================================
// PKCE + STATE
// =============================================================================

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

/**
 * Monta a URL de autorização com `state` e PKCE.
 *
 * `state` (CSRF): 256 bits aleatórios, guardados num cookie de vida curta e
 * conferidos no retorno. Sem ele, um atacante inicia o fluxo com a PRÓPRIA
 * conta e faz a vítima completá-lo — a vítima acaba logada como o atacante e
 * passa a comentar na conta dele, achando que é a sua ("login CSRF").
 *
 * PKCE (`code_challenge`): protege a troca do código. O código de autorização
 * volta pela URL do navegador e pode vazar (histórico, extensão, log de proxy,
 * `Referer`). Com PKCE, quem intercepta o código não consegue trocá-lo por um
 * token sem o `code_verifier`, que nunca saiu do nosso servidor.
 *
 * PKCE foi criado para apps públicos (mobile/SPA) e é opcional para um cliente
 * confidencial como o nosso. Usamos assim mesmo: custa 4 linhas, e a RFC 9700
 * (Security BCP de 2025) já recomenda para todos os tipos de cliente.
 */
export function buildAuthorizationRequest(config: OAuthProviderConfig): AuthorizationRequest {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');

  // S256: enviamos o HASH do verifier; o segredo só aparece na troca, servidor
  // a servidor. `plain` seria inútil (o desafio SERIA o segredo).
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriFor(config.id),
    response_type: 'code',
    scope: config.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // `prompt=consent` não é usado de propósito: forçar a tela de consentimento
    // a cada login irrita quem só quer comentar. O provedor decide quando
    // reapresentá-la.
  });

  return {
    url: `${config.authorizeUrl}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

// =============================================================================
// TROCA DE CÓDIGO E LEITURA DE PERFIL
// =============================================================================

export interface OAuthProfile {
  /** ID da conta no provedor. É consumido e descartado — só o hash é gravado. */
  providerAccountId: string;
  displayName: string;
}

/**
 * Troca o `code` por um `access_token` e lê o perfil.
 *
 * Devolve `null` em QUALQUER falha, em vez de lançar. Motivo: a rota de
 * callback precisa responder com um redirecionamento amigável ("não deu certo,
 * tente de novo") e jamais com uma stack trace — que revelaria detalhes da
 * integração e assustaria o leitor.
 *
 * O erro é sempre registrado no servidor, sem o corpo da resposta: mensagens de
 * erro de OAuth costumam ecoar parâmetros da requisição, e um `client_secret`
 * em log é um vazamento com prazo indeterminado.
 */
export async function exchangeCodeForProfile(
  config: OAuthProviderConfig,
  code: string,
  codeVerifier: string,
): Promise<OAuthProfile | null> {
  try {
    // TROCA DE CÓDIGO — dois formatos de autenticação do cliente.
    //
    // Padrão (Discord, Google, Facebook, Instagram): `client_secret` viaja no
    // CORPO do POST, junto de `client_id`.
    //
    // `tokenAuthStyle: 'basic'` (hoje só o X): o segredo viaja no cabeçalho
    // `Authorization: Basic base64(client_id:client_secret)` e SAI do corpo —
    // mandar os dois ao mesmo tempo é rejeitado pela API do X como cliente mal
    // configurado. `client_id` continua no corpo: o X exige isso mesmo com
    // Basic Auth, porque é também o valor conferido contra o PKCE da sessão.
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    const bodyParams: Record<string, string> = {
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUriFor(config.id),
      code_verifier: codeVerifier,
    };

    if (config.tokenAuthStyle === 'basic') {
      headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
    } else {
      bodyParams.client_secret = config.clientSecret;
    }

    const tokenResponse = await fetchWithTimeout(config.tokenUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams(bodyParams),
    });

    if (!tokenResponse.ok) {
      console.error(`[oauth] ${config.id}: troca de código falhou (${tokenResponse.status})`);
      return null;
    }

    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      console.error(`[oauth] ${config.id}: resposta sem access_token`);
      return null;
    }

    const profileResponse = await fetchWithTimeout(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!profileResponse.ok) {
      console.error(`[oauth] ${config.id}: perfil falhou (${profileResponse.status})`);
      return null;
    }

    const raw: unknown = await profileResponse.json();

    // O token de acesso morre aqui. Não é gravado, não é devolvido, não vai
    // para cookie nenhum. Ele serviu para uma leitura e cumpriu o papel.
    return normalizeProfile(config.id, raw);
  } catch (error) {
    console.error(
      `[oauth] ${config.id}: erro de rede`,
      error instanceof Error ? error.message : 'desconhecido',
    );
    return null;
  }
}

/**
 * Normaliza a resposta de cada provedor para o nosso formato.
 *
 * Cada campo é validado antes de ser usado: a resposta vem de fora e, embora o
 * provedor seja confiável, `displayName` é um texto que o PRÓPRIO USUÁRIO
 * escolheu — e vai ser renderizado ao lado do comentário dele. Ver
 * `sanitizeDisplayName` em core/community.ts (remove controles e marcas
 * bidirecionais usadas para falsificar visualmente um nome).
 */
function normalizeProfile(provider: CommentProvider, raw: unknown): OAuthProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;

  if (provider === 'discord') {
    const id = data.id;
    if (typeof id !== 'string' || id.length === 0) return null;

    // `global_name` é o nome de exibição moderno; `username` é o antigo. O
    // Discord devolve os dois durante a transição de nomenclatura.
    const name =
      typeof data.global_name === 'string' && data.global_name.length > 0
        ? data.global_name
        : data.username;

    return { providerAccountId: id, displayName: sanitizeDisplayName(name) };
  }

  if (provider === 'google') {
    // Google (OpenID Connect): `sub` é o identificador estável da conta. Nunca
    // usar `email` como identidade — e-mail pode mudar de dono; `sub`, não.
    const sub = data.sub;
    if (typeof sub !== 'string' || sub.length === 0) return null;

    return { providerAccountId: sub, displayName: sanitizeDisplayName(data.name) };
  }

  if (provider === 'facebook') {
    // Graph API: `{ id, name }` direto no corpo, sem aninhamento — diferente
    // do X logo abaixo, que aninha tudo sob `data`.
    const id = data.id;
    if (typeof id !== 'string' || id.length === 0) return null;

    return { providerAccountId: id, displayName: sanitizeDisplayName(data.name) };
  }

  if (provider === 'x') {
    // API v2 do X: a resposta vem ANINHADA sob `data` — `{ data: { id, name,
    // username } }`. É o único dos cinco provedores com esse formato; um
    // `data.id` direto (como nos outros) sempre daria `undefined` aqui.
    const nested = data.data;
    if (typeof nested !== 'object' || nested === null) return null;
    const profile = nested as Record<string, unknown>;

    const id = profile.id;
    if (typeof id !== 'string' || id.length === 0) return null;

    // `name` é o nome de exibição escolhido pela pessoa; `username` (o
    // `@handle`) é o retrocesso para quando `name` vier vazio.
    const name =
      typeof profile.name === 'string' && profile.name.length > 0
        ? profile.name
        : profile.username;

    return { providerAccountId: id, displayName: sanitizeDisplayName(name) };
  }

  // Instagram ("Instagram API with Instagram Login"): `graph.instagram.com/me`
  // devolve `{ id, username }` — SEM nome de exibição para a maioria das contas
  // (é uma API pensada para conta profissional, não para perfil social comum).
  // `username` é o único dado de identificação visual que a API garante, então
  // é ele que vira o nome exibido junto do comentário.
  const id = data.id;
  if (typeof id !== 'string' || id.length === 0) return null;

  return { providerAccountId: id, displayName: sanitizeDisplayName(data.username) };
}

/**
 * `fetch` com timeout.
 *
 * Sem timeout, um provedor lento segura um worker do servidor indefinidamente.
 * É o mesmo cuidado que o pipeline de curadoria aplica a cada conector — aqui o
 * impacto é ainda mais direto, porque o usuário está esperando na frente da
 * tela. 8 segundos: generoso para uma API saudável, curto para uma travada.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Valida o destino de retorno pós-login.
 *
 * SEGURANÇA (open redirect): `returnTo` vem da URL e é hostil. Sem validação,
 * `/api/auth/discord?returnTo=https://evil.com` transformaria o nosso domínio
 * em trampolim de phishing — o link começa em ortuspixel.com, o que é
 * exatamente o que dá credibilidade ao golpe.
 *
 * Só aceitamos caminho relativo. A rejeição de `//` é essencial e sutil:
 * `//evil.com` é uma URL absoluta de protocolo relativo, e passaria numa
 * checagem ingênua de "começa com barra".
 */
export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // `\` é normalizado para `/` por alguns navegadores: `/\evil.com` viraria
  // `//evil.com`. Barramos o caractere.
  if (value.includes('\\')) return fallback;
  if (value.length > 512) return fallback;
  return value;
}
