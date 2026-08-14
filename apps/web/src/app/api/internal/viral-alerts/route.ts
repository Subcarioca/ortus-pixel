/**
 * =============================================================================
 * POST /api/internal/viral-alerts — dispara os alertas de pauta quente
 * =============================================================================
 *
 * DOIS CHAMADORES LEGÍTIMOS, DUAS AUTENTICAÇÕES DIFERENTES:
 *
 *   1. UM JOB (o normal). Autentica por SEGREDO em cabeçalho, exatamente como
 *      `/api/revalidate` — que é o padrão que o `services/curator` já usa para
 *      falar com o site. Reusar o padrão importa: quem for configurar o cron
 *      amanhã não precisa aprender um segundo mecanismo, e não existe uma
 *      segunda forma de autenticação para revisar em auditoria.
 *
 *   2. UM ADMINISTRADOR, à mão, pelo painel. Autentica por SESSÃO, com a
 *      capacidade `dispararAlertaViral` — que é de administrador. Redator NÃO
 *      passa: escrever na caixa de entrada da redação inteira é ação de
 *      coordenação (ver o comentário da capacidade em core/staff.ts).
 *
 * ⚠ AS DUAS PORTAS SÃO INDEPENDENTES E NENHUMA ENFRAQUECE A OUTRA. Um redator
 * logado não passa pela porta 1 (não tem o segredo, que só existe no servidor) e
 * não passa pela porta 2 (não tem a capacidade). Sem segredo configurado, a
 * porta 1 fica FECHADA — falha fechada, nunca "aberto por padrão".
 *
 * POR QUE ESTA ROTA NÃO FICA EM `/api/admin/`: ela não é operada pela interface
 * do painel no caso normal; o caso normal é uma máquina chamando. O prefixo
 * `internal` também é o que sinaliza, para quem configurar o Nginx, que este
 * caminho pode (e deve) ser restrito por origem quando o cron rodar no próprio
 * servidor.
 */

import { NextResponse } from 'next/server';

import { can } from '@subcarioca/core';

import { getStaffUser } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, safeCompare } from '@/server/security';
import { runViralAlerts } from '@/server/viral-alert';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  /**
   * RATE LIMIT ANTES DE QUALQUER AUTENTICAÇÃO.
   *
   * Esta rota manda e-mail. Um laço aqui não derruba só o site: queima a
   * reputação de envio do domínio, que é lenta e cara de recuperar e que a
   * newsletter inteira depende. 10 chamadas por minuto é muito acima do uso
   * real (o cron roda a cada poucos minutos) e fecha o cenário de laço.
   */
  const limit = checkRateLimit(`viral-alerts:${ip}`, { maxRequests: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const configuredSecret = process.env.VIRAL_ALERT_SECRET ?? process.env.REVALIDATE_SECRET;
  const providedSecret = request.headers.get('x-internal-secret');

  const bySecret = Boolean(
    configuredSecret && providedSecret && safeCompare(providedSecret, configuredSecret),
  );

  let bySession = false;
  if (!bySecret) {
    // A sessão só é consultada quando o segredo NÃO resolveu: no caminho do
    // cron (o dominante) isso economiza uma ida ao banco por chamada.
    const user = await getStaffUser();
    bySession = Boolean(user && can(user.accessLevel, 'dispararAlertaViral'));
  }

  if (!bySecret && !bySession) {
    // 401 seco, sem dizer qual das duas portas falhou nem se o segredo existe.
    // Distinguir os casos ajudaria a mapear a instalação.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await runViralAlerts();

  console.log(
    `[viral-alert] ${result.alerted.length} pauta(s) alertada(s) para ${result.recipients} conta(s).` +
      (result.note ? ` ${result.note}` : ''),
  );

  return NextResponse.json({
    ok: true,
    alerted: result.alerted.length,
    recipients: result.recipients,
    ...(result.note ? { note: result.note } : {}),
  });
}
