/**
 * =============================================================================
 * POST /api/comments/[id]/report — o leitor denuncia um comentário
 * =============================================================================
 *
 * O FLUXO INTEIRO, EM UMA FRASE: a denúncia é registrada, o bot lê o texto
 * denunciado e, se ele CONFIRMA que aquilo é ataque, o comentário sai do ar na
 * hora; se não confirma, a denúncia fica esperando o olho humano na fila de
 * moderação.
 *
 * -----------------------------------------------------------------------------
 * POR QUE A DENÚNCIA EXIGE LOGIN
 * -----------------------------------------------------------------------------
 * Pela mesma razão pela qual comentar exige (ver core/community.ts), só que com
 * mais força: aqui a ação de um leitor pode APAGAR o texto de outro. Sem conta,
 * o limite de volume teria de ser por IP — e IP é trocado em segundos num
 * celular, o que transformaria o botão de denúncia numa ferramenta de silenciar
 * desafeto. Com conta, cada denúncia tem dono, o limite é por dono, e o banco
 * garante uma denúncia por conta e por comentário (`@@unique` em
 * `CommentReport`).
 *
 * -----------------------------------------------------------------------------
 * POR QUE O BOT PODE REMOVER SOZINHO, MAS SÓ EM DOIS CASOS
 * -----------------------------------------------------------------------------
 * A remoção automática é uma decisão sem revisão humana, então ela só acontece
 * quando o veredito é 'insult' ou 'hate' — nunca por palavrão de ênfase. Toda a
 * justificativa (e a lista de termos que ficaram DE FORA de propósito) está no
 * cabeçalho de `packages/core/src/comment-moderation-bot.ts`. Aqui só se
 * consulta `screening.offensive`: reimplementar a comparação de severidade
 * nesta rota criaria a segunda fonte de verdade que aquele módulo existe para
 * evitar.
 *
 * -----------------------------------------------------------------------------
 * O QUE A RESPOSTA NÃO DIZ
 * -----------------------------------------------------------------------------
 * Nunca devolvemos QUAIS termos o bot encontrou. Devolvê-los seria publicar a
 * denylist em parcelas: bastaria denunciar os próprios comentários de teste para
 * descobrir, palavra a palavra, o que evitar. Os termos vão para
 * `moderationNote`, que é lida no painel — onde a informação serve para auditar
 * a remoção, e não para contorná-la.
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { screenComment } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

import { getReaderSession } from '@/server/reader-session';
import { CACHE_TAGS } from '@/server/queries';
import { checkRateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

const ID_PATTERN = /^[a-z0-9-]{10,60}$/i;

/** Tamanho máximo do motivo. O mesmo do `VarChar(200)` da coluna — o corte
 *  acontece aqui para o banco nunca precisar recusar a gravação. */
const REASON_MAX = 200;

/**
 * MARCADOR DE AUTORIA DA REMOÇÃO.
 *
 * `moderatedBy` guarda o id de um `Author` quando quem agiu foi gente. Aqui não
 * foi: o prefixo `auto:` torna essa diferença EXPLÍCITA e consultável — "quantos
 * comentários o bot removeu neste mês?" vira um `startsWith`, e nenhuma tela de
 * auditoria pode confundir uma remoção automática com uma decisão da redação.
 *
 * Deixar `null` era a alternativa, e é pior: `null` já significa "moderado sem
 * autor registrado" nos comentários legados, e as duas coisas passariam a se
 * parecer.
 */
const BOT_MODERATOR = 'auto:bot-denuncia';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // 1) IDENTIDADE. Sem sessão não há denúncia — ver o cabeçalho.
  const session = await getReaderSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, message: 'Entre com Discord ou Google para denunciar um comentário.' },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ ok: false, message: 'Comentário inválido.' }, { status: 400 });
  }

  /**
   * 2) LIMITE POR CONTA — 10 denúncias por hora.
   *
   * Esta é a defesa que impede a denúncia de virar arma. Sem ela, uma conta
   * varreria a página inteira denunciando tudo: os comentários que o bot
   * confirmasse sairiam do ar imediatamente, e os demais entupiriam a fila da
   * moderação — que é o mesmo efeito prático de derrubar a área de comentários.
   *
   * A chave é a CONTA e não o IP, pela mesma razão da rota de publicar
   * comentário: a redação inteira (ou uma escola) pode compartilhar um IP.
   *
   * 10/hora é generoso para uso honesto — quem lê uma matéria e encontra três
   * comentários horríveis está longe do teto — e baixo o bastante para nenhuma
   * conta sozinha conseguir varrer uma discussão grande. A limitação do contador
   * em memória (uma cópia por instância, ver `security.ts`) vale aqui como em
   * todo o projeto: o teto real vira N×10, o que continua sendo um teto, e o
   * `@@unique` do banco continua impedindo denúncia repetida no mesmo alvo.
   */
  const rateLimit = checkRateLimit(`comment-report:${session.authorId}`, {
    maxRequests: 10,
    windowSeconds: 3_600,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'Você já denunciou vários comentários agora há pouco. Se ainda há algo grave, espere alguns minutos e tente de novo.',
      },
      { status: 429, headers: { 'Retry-After': String(rateLimit.resetInSeconds) } },
    );
  }

  // O corpo é OPCIONAL: o botão da página envia um POST sem nada. Um JSON
  // malformado não pode derrubar a denúncia — a intenção principal ("isto aqui
  // está errado") já chegou na URL.
  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === 'string' && body.reason.trim().length > 0) {
      reason = body.reason.trim().slice(0, REASON_MAX);
    }
  } catch {
    reason = null;
  }

  const comment = await prisma.comment.findUnique({
    where: { id },
    select: {
      id: true,
      content: true,
      status: true,
      authorAccountId: true,
      article: { select: { slug: true } },
    },
  });

  if (!comment) {
    return NextResponse.json({ ok: false, message: 'Comentário não encontrado.' }, { status: 404 });
  }

  // Já removido: nada a fazer, e a resposta é de SUCESSO. Do ponto de vista de
  // quem clicou, o resultado desejado já é o estado do mundo — devolver erro
  // aqui só produziria a impressão de que a denúncia falhou.
  if (comment.status === 'rejected' || comment.status === 'spam') {
    return NextResponse.json({
      ok: true,
      removed: true,
      message: 'Este comentário já tinha sido removido.',
    });
  }

  /**
   * 3) REGISTRA A DENÚNCIA.
   *
   * O `create` vem ANTES do bot de propósito: mesmo que o bot não confirme nada,
   * a denúncia precisa existir — é ela que leva o comentário para a fila humana.
   * Se a ordem fosse inversa, uma falha na gravação depois de uma remoção
   * deixaria um comentário fora do ar sem nenhum registro de por quê.
   *
   * P2002 é a chave única `[commentId, reporterAccountId]` fazendo seu trabalho:
   * esta conta já tinha denunciado este comentário. Resposta de sucesso, de
   * novo, e sem rodar o bot — o veredito dele é determinístico sobre o mesmo
   * texto, então repetir a análise daria exatamente o mesmo resultado que já foi
   * aplicado da primeira vez.
   */
  try {
    await prisma.commentReport.create({
      data: {
        commentId: comment.id,
        reporterAccountId: session.authorId,
        reason,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json({
        ok: true,
        removed: false,
        message: 'Você já tinha denunciado este comentário. A moderação vai avaliar.',
      });
    }
    throw error;
  }

  // 4) O BOT LÊ O TEXTO DENUNCIADO.
  const screening = screenComment(comment.content);

  if (!screening.offensive) {
    // Nada confirmado. A denúncia fica registrada e o comentário continua no ar
    // até um humano decidir — que é o resultado certo: o bot conhece palavras,
    // não conhece contexto, e a maioria das denúncias legítimas é justamente
    // sobre o que ele não sabe ver (ameaça velada, assédio, spoiler cruel).
    return NextResponse.json({
      ok: true,
      removed: false,
      message: 'Denúncia registrada. A moderação vai avaliar este comentário.',
    });
  }

  /**
   * 5) REMOÇÃO AUTOMÁTICA.
   *
   * `updateMany` com o status no `where`, e não `update`: duas denúncias
   * simultâneas ao mesmo comentário (o caso NORMAL num comentário realmente
   * ofensivo — várias pessoas clicam ao mesmo tempo) fariam duas remoções, e a
   * segunda reescreveria `moderatedAt` com um instante que não foi o da decisão.
   * Filtrando por "ainda não moderado", a segunda encontra zero linhas e não
   * escreve nada.
   *
   * A LINHA NÃO É APAGADA — é a mesma decisão estrutural da moderação humana
   * (ver o cabeçalho de /api/admin/comments): sem o conteúdo original, uma
   * remoção contestada vira palavra contra palavra, e uma remoção automática
   * contestada seria pior ainda, porque não há nem quem explicar.
   */
  const note =
    `Removido automaticamente após denúncia (bot, gravidade: ${screening.severity}). ` +
    `Termos: ${screening.matches.join(', ')}.`;

  await prisma.$transaction(async (tx) => {
    const removed = await tx.comment.updateMany({
      where: { id: comment.id, status: { in: ['pending', 'approved'] } },
      data: {
        status: 'rejected',
        moderatedAt: new Date(),
        moderatedBy: BOT_MODERATOR,
        // Os termos entram na NOTA, e não na resposta HTTP. É o que torna a
        // remoção conferível por quem modera sem entregar a denylist a quem
        // quisesse contorná-la.
        moderationNote: note,
      },
    });

    // Corrida perdida: outra denúncia simultânea já removeu. A trilha não pode
    // registrar duas remoções do mesmo comentário — seria inventar um evento.
    if (removed.count === 0) return;

    /**
     * TRILHA DE AUDITORIA — com `actorId` VAZIO, e isso é a informação.
     *
     * Toda ação da moderação humana grava uma linha em `AuditLog` (ver
     * /api/admin/comments). Esta grava também, com ação própria
     * (`comment.auto_rejected`) e sem ator: não houve conta de redação por trás.
     * É o par do `moderatedBy: 'auto:bot-denuncia'` na tabela de comentários —
     * um mostra na FICHA do comentário quem removeu, o outro coloca o evento na
     * LINHA DO TEMPO das decisões editoriais.
     *
     * `ipHash` fica de fora de propósito: o IP aqui seria o de quem DENUNCIOU, e
     * não o de quem tomou a decisão (que foi o servidor). Guardá-lo seria dado
     * pessoal respondendo à pergunta errada.
     */
    await tx.auditLog.create({
      data: {
        action: 'comment.auto_rejected',
        entityType: 'Comment',
        entityId: comment.id,
        before: { status: comment.status },
        after: { status: 'rejected', severity: screening.severity, by: BOT_MODERATOR },
        reason: note,
      },
    });
  });

  // O comentário estava visível na página cacheada. Sem invalidar, ele
  // continuaria sendo servido a todo mundo — que é exatamente o resultado que a
  // remoção existe para evitar.
  revalidateTag(CACHE_TAGS.article(comment.article.slug));

  return NextResponse.json({
    ok: true,
    removed: true,
    message: 'Obrigado. Este comentário foi removido.',
  });
}
