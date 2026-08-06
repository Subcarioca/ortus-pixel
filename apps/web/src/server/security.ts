import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * =============================================================================
 * UTILITÁRIOS DE SEGURANÇA
 * =============================================================================
 *
 * Centraliza as primitivas usadas pelas rotas públicas (newsletter, push,
 * revalidação). Concentrar isso num módulo só tem um motivo prático: segurança
 * implementada "quase certo" em cinco lugares diferentes é pior do que
 * implementada uma vez e revisada com cuidado.
 *
 * Cobre itens do OWASP Top 10 que se aplicam a este projeto:
 *   A01 Broken Access Control  -> comparação de segredo em tempo constante
 *   A02 Cryptographic Failures -> tokens aleatórios reais + armazenamento em hash
 *   A03 Injection              -> validação estrita de entrada
 *   A04 Insecure Design        -> rate limiting, double opt-in
 *   A07 Auth Failures          -> tokens com expiração e de uso único
 */

// =============================================================================
// TOKENS
// =============================================================================

/**
 * Gera um token de uso único (confirmação de newsletter, descadastro).
 *
 * `randomBytes` é um gerador CRIPTOGRÁFICO. `Math.random()` NÃO é: seu estado
 * interno pode ser reconstruído a partir de algumas saídas, o que permitiria a
 * um atacante prever tokens futuros e confirmar inscrições de terceiros.
 *
 * 32 bytes = 256 bits de entropia. Força bruta é inviável.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Deriva o hash do token para armazenamento.
 *
 * MESMO PRINCÍPIO DE SENHA: guardamos o hash, nunca o token em claro. Se o
 * banco vazar, o atacante tem apenas hashes — inúteis para confirmar
 * inscrições, porque o sistema compara o hash do token apresentado.
 *
 * Aqui SHA-256 puro é suficiente (diferente de senha, que exige bcrypt/argon2):
 * o token tem 256 bits de entropia aleatória, então não existe "dicionário" de
 * tokens prováveis a testar. O custo alto do bcrypt existe para compensar a
 * baixa entropia de senhas humanas — problema que não temos aqui.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compara dois segredos em TEMPO CONSTANTE.
 *
 * POR QUE NÃO USAR `===`: a comparação de strings do JavaScript retorna assim
 * que encontra o primeiro caractere diferente. Isso vaza informação por tempo —
 * um atacante mede a latência e descobre o segredo caractere por caractere
 * (timing attack). Com 32 bytes, isso reduz a busca de 2^256 para ~256*64
 * tentativas.
 *
 * `timingSafeEqual` sempre percorre todos os bytes.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // `timingSafeEqual` lança exceção se os tamanhos diferirem — e o próprio
  // tamanho já é informação. Comparamos os tamanhos primeiro (o que vaza
  // apenas o comprimento, não o conteúdo) e devolvemos falso.
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Hash de dado pessoal (IP, e-mail) para fins de antiabuso e auditoria.
 *
 * LGPD: endereço IP é dado pessoal. Precisamos dele para limitar abuso e para
 * comprovar consentimento, mas não precisamos dele em claro. O hash com sal
 * fixo da aplicação permite comparar ("este IP já se inscreveu 10 vezes?") sem
 * armazenar o valor original.
 *
 * O sal impede um ataque de dicionário sobre o espaço de endereços IPv4, que
 * tem apenas ~4 bilhões de valores — trivial de percorrer sem sal.
 */
export function hashPersonalData(value: string): string {
  const salt = process.env.NEWSLETTER_TOKEN_SECRET ?? 'sal-de-desenvolvimento-inseguro';
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

// =============================================================================
// VALIDAÇÃO DE ENTRADA
// =============================================================================

/**
 * Valida e normaliza um endereço de e-mail.
 *
 * A regex é DELIBERADAMENTE SIMPLES. Validar e-mail de forma completa segundo a
 * RFC 5322 exige uma expressão de milhares de caracteres, e regex complexa em
 * entrada não confiável é vetor de ReDoS (negação de serviço por retrocesso
 * catastrófico). A validação definitiva é o double opt-in: se o e-mail não
 * existir, a confirmação nunca chega e o registro nunca é ativado.
 *
 * O limite de tamanho vem antes da regex, justamente para que uma entrada
 * gigante não chegue ao motor de expressões regulares.
 */
export function validateEmail(input: unknown): { valid: boolean; email: string; error?: string } {
  if (typeof input !== 'string') {
    return { valid: false, email: '', error: 'E-mail inválido.' };
  }

  const email = input.trim().toLowerCase();

  // 254 é o limite da RFC 5321 para o endereço completo.
  if (email.length === 0 || email.length > 254) {
    return { valid: false, email: '', error: 'E-mail inválido.' };
  }

  // Sem quantificadores aninhados: não há risco de retrocesso catastrófico.
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!pattern.test(email)) {
    return { valid: false, email: '', error: 'E-mail inválido.' };
  }

  return { valid: true, email };
}

/**
 * Valida a origem declarada da inscrição.
 *
 * Vem do cliente e portanto é hostil. Como é gravada e depois exibida em
 * relatórios, restringimos a uma lista de caracteres seguros e a um tamanho
 * pequeno — impede tanto poluição de dados quanto injeção em planilhas
 * (CSV injection, quando alguém exporta o relatório e abre no Excel).
 */
export function sanitizeSource(input: unknown): string {
  if (typeof input !== 'string') return 'desconhecido';
  const cleaned = input.trim().slice(0, 40);
  return /^[a-z0-9_-]+$/i.test(cleaned) ? cleaned : 'desconhecido';
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Limitador de taxa em memória.
 *
 * PROPÓSITO: impedir que um bot cadastre milhares de e-mails de terceiros.
 * Sem isso, além do abuso em si, os bounces destruiriam a reputação de envio do
 * domínio e TODA a newsletter passaria a cair em spam — um dano difícil e lento
 * de reverter.
 *
 * LIMITAÇÃO CONHECIDA E ACEITA PARA O MVP: o estado vive na memória do
 * processo. Com múltiplas instâncias, cada uma tem seu próprio contador, e o
 * limite real vira N x o configurado. Para produção com escala, isto deve
 * migrar para o Redis (`INCR` + `EXPIRE`), que já está previsto na stack. A
 * interface abaixo foi desenhada para que a troca seja de uma função só.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/** Remove entradas expiradas para o Map não crescer sem limite (vazamento). */
function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

export function checkRateLimit(
  identifier: string,
  options: { maxRequests: number; windowSeconds: number },
): RateLimitResult {
  // Limpeza probabilística: 1% das chamadas. Evita percorrer o Map inteiro a
  // cada requisição, mas garante que o espaço seja recuperado com o tempo.
  if (Math.random() < 0.01) cleanupExpired();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + options.windowSeconds * 1000,
    });
    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetInSeconds: options.windowSeconds,
    };
  }

  entry.count++;
  const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count <= options.maxRequests,
    remaining: Math.max(0, options.maxRequests - entry.count),
    resetInSeconds,
  };
}

/**
 * Extrai o IP do cliente a partir dos cabeçalhos de proxy.
 *
 * ATENÇÃO DE SEGURANÇA: `x-forwarded-for` é FORJÁVEL pelo cliente. Só é
 * confiável quando a aplicação está atrás de um proxy reverso que SOBRESCREVE
 * o cabeçalho (Vercel, Cloudflare, ALB corretamente configurado). Em produção,
 * confirme que o proxy sobrescreve — caso contrário, o atacante contorna o
 * rate limit apenas mandando um IP diferente a cada requisição.
 *
 * Pegamos o PRIMEIRO valor da lista, que é o cliente original; os demais são
 * os proxies do caminho.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'desconhecido';
}
