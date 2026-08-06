import 'server-only';

/**
 * =============================================================================
 * ADAPTADOR DE E-MAIL TRANSACIONAL
 * =============================================================================
 *
 * O sistema não conhece Resend, SendGrid nem Postmark: conhece a interface
 * `EmailProvider`. Trocar de provedor (por preço, por entregabilidade ou porque
 * o atual teve o IP bloqueado) é escrever um adaptador novo e mudar uma
 * variável de ambiente — sem tocar na lógica de newsletter.
 *
 * O provedor padrão é 'console', para que o fluxo completo de double opt-in
 * funcione em desenvolvimento sem nenhuma chave de API. Mesma filosofia do
 * seed e dos conectores em modo mock.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Corpo em texto puro. SEMPRE presente — ver comentário sobre HTML abaixo. */
  text: string;
  html?: string;
  /**
   * Cabeçalhos extras. Usado para `List-Unsubscribe`, que é exigência prática
   * de entregabilidade: Gmail e Outlook penalizam remetentes em massa sem ele.
   */
  headers?: Record<string, string>;
}

interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<{ ok: boolean; error?: string }>;
}

/** Provedor de desenvolvimento: imprime no terminal. */
const consoleProvider: EmailProvider = {
  name: 'console',
  isConfigured: () => true,
  async send(message) {
    console.log(
      [
        '',
        '-'.repeat(70),
        `  E-MAIL (modo console — nada foi enviado de verdade)`,
        '-'.repeat(70),
        `  Para:     ${message.to}`,
        `  Assunto:  ${message.subject}`,
        '',
        message.text,
        '-'.repeat(70),
        '',
      ].join('\n'),
    );
    return { ok: true };
  },
};

/** Provedor Resend (HTTP puro, sem SDK — menos dependência e menos supply chain). */
const resendProvider: EmailProvider = {
  name: 'resend',
  isConfigured: () => Boolean(process.env.RESEND_API_KEY),
  async send(message) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, error: 'RESEND_API_KEY ausente' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.NEWSLETTER_FROM ?? 'CanalNerd <noticias@canalnerd.com.br>',
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Registramos o status, NUNCA o corpo completo: a resposta de erro
        // pode ecoar dados do destinatário para o agregador de logs.
        return { ok: false, error: `Provedor respondeu ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha de rede',
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

const PROVIDERS: EmailProvider[] = [resendProvider, consoleProvider];

function resolveProvider(): EmailProvider {
  const configured = process.env.EMAIL_PROVIDER?.toLowerCase();
  const match = PROVIDERS.find((p) => p.name === configured && p.isConfigured());
  // Fallback para console: preferimos "e-mail apareceu no log" a "o cadastro
  // explodiu porque a chave não estava configurada".
  return match ?? consoleProvider;
}

export async function sendEmail(message: EmailMessage): Promise<{ ok: boolean; error?: string }> {
  return resolveProvider().send(message);
}

/**
 * E-mail de confirmação do DOUBLE OPT-IN.
 *
 * SEGURANÇA — por que a URL é montada a partir de variável de ambiente e nunca
 * do cabeçalho `Host` da requisição: se confiássemos no `Host`, um atacante
 * enviaria `Host: site-falso.com`, o link de confirmação apontaria para o
 * domínio dele e o nosso sistema viraria uma máquina de phishing assinada com
 * o nosso remetente e a nossa reputação. Ver `absoluteUrl` em core/routes.ts.
 */
export function buildConfirmationEmail(email: string, token: string): EmailMessage {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const confirmUrl = `${siteUrl}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;

  return {
    to: email,
    subject: 'Confirme sua inscrição na newsletter do CanalNerd',
    text: [
      'Falta só um passo!',
      '',
      'Clique no link abaixo para confirmar sua inscrição na newsletter do CanalNerd:',
      '',
      confirmUrl,
      '',
      'O link expira em 48 horas.',
      '',
      'Se você não pediu esta inscrição, apenas ignore este e-mail — nada será enviado.',
      '',
      '— Equipe CanalNerd',
    ].join('\n'),
  };
}

/**
 * E-mail de boas-vindas, enviado APÓS a confirmação.
 *
 * O cabeçalho `List-Unsubscribe` com `One-Click` implementa a RFC 8058. Não é
 * opcional na prática: desde 2024, Gmail e Yahoo exigem descadastro de um
 * clique de remetentes em massa, sob pena de bloqueio. Além disso, oferecer uma
 * saída fácil reduz marcações de spam — que doem muito mais que um cancelamento.
 */
export function buildWelcomeEmail(email: string, unsubscribeToken: string): EmailMessage {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const unsubscribeUrl = `${siteUrl}/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  return {
    to: email,
    subject: 'Inscrição confirmada — bem-vindo ao CanalNerd',
    text: [
      'Pronto! Sua inscrição está confirmada.',
      '',
      'A partir de agora você recebe o resumo do que realmente importou no',
      'universo nerd — games, cinema, séries, anime e tecnologia.',
      '',
      `Para cancelar quando quiser: ${unsubscribeUrl}`,
      '',
      '— Equipe CanalNerd',
    ].join('\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
