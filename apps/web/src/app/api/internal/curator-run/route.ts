/**
 * =============================================================================
 * POST /api/internal/curator-run — dispara um ciclo de curadoria sob demanda
 * =============================================================================
 *
 * POR QUE ESTA ROTA EXISTE
 * -----------------------------------------------------------------------------
 * O ciclo era agendado pelo cron da hospedagem. Ficou estabelecido, depois de um
 * dia inteiro de depuração, que o cron desta conta NÃO dispara — nem pelo hPanel,
 * nem por `crontab` direto via SSH (chamado aberto com o suporte; a suspeita é
 * limite de execução do plano). Sem ciclo, a fila de pautas para de receber
 * assunto novo, e o painel não consegue distinguir "não há notícia hoje" de "o
 * agendador está morto há três dias".
 *
 * A saída é tirar o agendamento de dentro daquele servidor. O processo do Next
 * roda continuamente (é o próprio site, a única coisa que comprovadamente fica de
 * pé ali) e passa a ser ele quem executa o bundle do curator, como processo
 * filho, quando esta rota é chamada. Ver `server/curator-runner.ts` para o porquê
 * de processo filho e para as duas armadilhas do ambiente.
 *
 * =============================================================================
 * DOIS CHAMADORES LEGÍTIMOS, DUAS AUTENTICAÇÕES DIFERENTES
 * =============================================================================
 * É o MESMO desenho de `/api/internal/viral-alerts`, e a repetição é
 * intencional: o problema é o mesmo (rota chamada por máquina, também operável
 * por um humano com sessão) e inventar um segundo mecanismo significaria mais
 * uma forma de autenticação para revisar em auditoria — que é como se perde
 * autenticação.
 *
 *   1. UM AGENDADOR EXTERNO (o caso normal, hoje o GitHub Actions de 15 em 15
 *      min). Autentica por SEGREDO em cabeçalho. Como o agendador vive FORA
 *      desta hospedagem, ele não depende do cron quebrado — que é o ponto todo.
 *
 *   2. UM ADMINISTRADOR, pelo botão do painel. Autentica por SESSÃO, com a
 *      capacidade `curarFilaDePautas`. É a mesma que já protege sobrepor score e
 *      descartar tópico, e é a certa aqui pelo mesmo motivo: descobrir pautas
 *      reordena a fila que alimenta a home e o /em-alta — mexe no que o SITE
 *      INTEIRO exibe. Redator NÃO passa (ver core/staff.ts).
 *
 * ⚠ AS DUAS PORTAS SÃO INDEPENDENTES E NENHUMA ENFRAQUECE A OUTRA. Um redator
 * logado não passa pela porta 1 (não tem o segredo, que só existe no servidor) e
 * não passa pela porta 2 (não tem a capacidade). Sem segredo configurado, a
 * porta 1 fica FECHADA — falha fechada, nunca "aberto por padrão".
 *
 * POR QUE `internal/` E NÃO `admin/`: o caso normal é uma máquina chamando; o
 * painel é o caso secundário. O prefixo também sinaliza, para quem configurar
 * proxy reverso, que este caminho merece restrição por origem.
 *
 * -----------------------------------------------------------------------------
 * ⚠ NOTA DE SEGURANÇA SOBRE O FALLBACK PARA `REVALIDATE_SECRET`
 * -----------------------------------------------------------------------------
 * O fallback existe para manter a paridade com `viral-alerts` (foi pedido
 * explicitamente), e ele tem um custo que precisa estar escrito: quando
 * `CURATOR_RUN_SECRET` não está definida, o segredo de REVALIDAÇÃO passa a
 * também autorizar a EXECUÇÃO DE UM PROCESSO no servidor. São privilégios de
 * gravidade bem diferente compartilhando uma credencial.
 *
 * RECOMENDAÇÃO: defina `CURATOR_RUN_SECRET` com um valor PRÓPRIO em produção
 * (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
 * O fallback é rede de segurança para não deixar a rota inoperante num deploy
 * incompleto — não é a configuração recomendada.
 */

import { NextResponse } from 'next/server';

import { can } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { getStaffUser } from '@/server/staff-auth';
import { checkRateLimit, getClientIp, hashPersonalData, safeCompare } from '@/server/security';
import { cicloEmAndamento, runCuratorOnce } from '@/server/curator-runner';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  /**
   * CAMADA 1 — LIMITE POR IP, ANTES DE QUALQUER AUTENTICAÇÃO.
   *
   * Mesma ordem de `viral-alerts`, e pela mesma razão: o que vem depois custa
   * uma consulta ao banco (a sessão) e, no fim do caminho, a partida de um
   * PROCESSO. Nada disso pode ser acionado em laço por quem nem se identificou.
   *
   * 12 por minuto é muito acima de qualquer uso real (o agendador usa 1 a cada
   * 15 min; um humano, alguns cliques) e fecha o cenário de laço.
   */
  const flood = checkRateLimit(`curator-run:ip:${ip}`, { maxRequests: 12, windowSeconds: 60 });
  if (!flood.allowed) {
    return NextResponse.json({ ok: false, message: 'Muitas chamadas seguidas.' }, { status: 429 });
  }

  // ---------------------------------------------------------------------------
  // AUTENTICAÇÃO
  // ---------------------------------------------------------------------------
  const configuredSecret = process.env.CURATOR_RUN_SECRET ?? process.env.REVALIDATE_SECRET;
  const providedSecret = request.headers.get('x-internal-secret');

  // `safeCompare` (tempo constante) e não `===`: ver o porquê em security.ts.
  // A exigência de `configuredSecret` ser não-vazia é o que faz a porta FALHAR
  // FECHADA — sem ela, um servidor sem a variável aceitaria qualquer cabeçalho
  // vazio comparado com `undefined`.
  const bySecret = Boolean(
    configuredSecret && providedSecret && safeCompare(providedSecret, configuredSecret),
  );

  // A sessão só é consultada quando o segredo NÃO resolveu: no caminho do
  // agendador (o dominante, 96 chamadas por dia) isso economiza uma ida ao banco
  // por chamada.
  const user = bySecret ? null : await getStaffUser();
  const bySession = Boolean(user && can(user.accessLevel, 'curarFilaDePautas'));

  if (!bySecret && !bySession) {
    /**
     * 401 SECO para o chamador anônimo ou sem permissão.
     *
     * Não dizemos qual das duas portas falhou nem se existe segredo configurado:
     * distinguir os casos ajudaria a mapear a instalação. A exceção é a pessoa
     * LOGADA sem a capacidade — para ela a mensagem é específica, porque a ação
     * dela não é "tentar de novo", é "pedir a um administrador", e um 401 mudo
     * a mandaria refazer o login inutilmente.
     */
    if (user) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'Sua conta não tem permissão para disparar a busca de pautas. ' +
            'Buscar pautas reordena a fila que alimenta a home — é ação de curadoria.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  /**
   * CAMADA 2 — LIMITE POR IDENTIDADE.
   *
   * A camada 1 protege o servidor de quem não se identificou. Esta protege o
   * ORÇAMENTO DE API de quem se identificou: o ciclo aciona conectores pagos, e
   * cada disparo custa dinheiro de verdade.
   *
   * A chave separa os dois chamadores de propósito. Fossem a mesma, o agendador
   * externo e o administrador dividiriam a cota, e uma rajada do primeiro
   * bloquearia o botão do segundo justamente quando ele está tentando entender
   * por que o pipeline parou.
   *
   * NÚMEROS: 3 em 5 min para uma pessoa (bem acima do trabalho real — o ciclo
   * leva ~15s — e o suficiente para tornar o clique repetido acidental inofensivo)
   * e 6 em 5 min para o agendador (que usa 1 a cada 15 min; a folga cobre
   * reexecução manual do workflow e retentativa, e ainda barra um laço).
   *
   * ⚠ LIMITAÇÃO CONHECIDA E HERDADA: o contador vive na MEMÓRIA do processo (ver
   * security.ts). Aqui isso é mais relevante que no resto do projeto, porque esta
   * hospedagem sobe até 6 processos-filho do LiteSpeed (`LSAPI_CHILDREN`): o teto
   * real vira até 6× o configurado. Continua sendo um teto, e — o que importa —
   * NÃO é ele que impede duas execuções simultâneas. Quem impede isso é a trava
   * logo abaixo, que vive no BANCO e portanto é compartilhada por todos os
   * processos.
   */
  const cota = bySecret
    ? checkRateLimit('curator-run:agendador', { maxRequests: 6, windowSeconds: 300 })
    : checkRateLimit(`curator-run:conta:${user!.id}`, { maxRequests: 3, windowSeconds: 300 });

  if (!cota.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message:
          `Você já disparou a busca várias vezes seguidas. Espere ${Math.ceil(cota.resetInSeconds / 60)} ` +
          'minuto(s). Cada ciclo consome chamadas pagas de API.',
      },
      { status: 429 },
    );
  }

  /**
   * TRAVA CONTRA EXECUÇÃO CONCORRENTE — a proteção que de fato importa.
   *
   * O modo `--once` do curator não tem defesa própria contra sobreposição (só o
   * modo contínuo tem, via `setTimeout` encadeado — está documentado no
   * `main.ts` dele). Isso nunca foi problema porque havia um único chamador, de
   * 15 em 15 minutos. Agora há dois, e eles não se conhecem: o agendador externo
   * pode cair exatamente em cima de um clique no painel.
   *
   * Diferente do limitador acima, esta trava vive no BANCO — logo vale entre os
   * até 6 processos do LiteSpeed E entre os dois chamadores. Ver
   * `cicloEmAndamento` para a janela, o custo da consulta e a honestidade sobre
   * ela ser consultiva (verifica-e-age).
   */
  const emAndamento = await cicloEmAndamento();
  if (emAndamento) {
    const hMin = Math.max(0, Math.round((Date.now() - emAndamento.startedAt.getTime()) / 60_000));
    return NextResponse.json(
      {
        ok: false,
        message:
          `Já tem uma busca em andamento (iniciada há ${hMin} min). Aguarde ela terminar — ` +
          'o ciclo normal leva menos de um minuto. Recarregue a fila em instantes.',
      },
      // 409 e não 429: não é excesso de chamadas, é conflito com o estado atual
      // do recurso. A tela usa a diferença para escolher o texto.
      { status: 409 },
    );
  }

  // ---------------------------------------------------------------------------
  // EXECUÇÃO
  // ---------------------------------------------------------------------------
  const resultado = await runCuratorOnce();

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, message: resultado.message },
      { status: resultado.status },
    );
  }

  /**
   * AUDITORIA — só o disparo HUMANO é registrado. Não é esquecimento.
   *
   * A pergunta que o `AuditLog` responde é "QUEM mandou fazer isso?", e ela só
   * tem conteúdo quando há um quem. O disparo da máquina já tem registro
   * canônico e mais rico: a própria linha de `PipelineRun`, com contadores,
   * duração e erro. Gravar também um `AuditLog` a cada 15 minutos somaria ~35
   * mil linhas por ano de "a máquina fez o que a máquina faz" — e uma trilha de
   * auditoria em que 99,9% das linhas são ruído é uma trilha que ninguém lê.
   */
  if (bySession && user) {
    await prisma.auditLog.create({
      data: {
        action: 'curator.run_manual',
        entityType: 'PipelineRun',
        // Não há uma entidade prévia: o alvo da ação é o pipeline como um todo.
        entityId: 'manual-trigger',
        actorId: user.id,
        after: {
          descobertas: resultado.resumo?.topicsDiscovered ?? null,
          pontuadas: resultado.resumo?.topicsScored ?? null,
          conectoresComFalha: resultado.resumo?.connectorsFailed ?? null,
          status: resultado.resumo?.status ?? 'desconhecido',
        },
        ipHash: hashPersonalData(ip),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    message: resultado.message,
    // O resumo estruturado vai junto da frase pronta: a frase é para a tela, os
    // números são para quem consumir a rota por máquina (o log do workflow do
    // GitHub Actions mostra o corpo da resposta, e é lá que se vê que o ciclo
    // está trazendo pautas de verdade, e não rodando em vazio).
    resumo: resultado.resumo,
  });
}
