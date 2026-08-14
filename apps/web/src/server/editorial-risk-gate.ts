/**
 * =============================================================================
 * O PORTÃO DE RISCO EDITORIAL — uma regra, os dois caminhos de publicação
 * =============================================================================
 *
 * ⚠ SEM `import 'server-only'`, AO CONTRÁRIO DE `article-input.ts` — e a
 * ausência é uma escolha, não um esquecimento. Este arquivo não toca em banco,
 * segredo nem sistema de arquivos: ele é uma DECISÃO (ver a mesma separação em
 * `upload-rules.ts` × `uploads.ts`). Com `server-only`, o módulo não carrega no
 * runner de testes do Node — e este é justamente o pedaço que precisa de teste,
 * porque nele mora a regra de que a PRIMEIRA tentativa nunca passa. O custo é
 * perder a rede de proteção contra alguém importá-lo num componente de cliente;
 * na prática, o `next/server` que ele importa denunciaria isso na hora.
 *
 * Existe pelo mesmo motivo de `article-input.ts`: CRIAR
 * (`POST /api/admin/topics/[id]`, ação `create-article`) e EDITAR
 * (`PATCH /api/admin/articles/[id]`) são dois arquivos diferentes que fazem a
 * mesma coisa. Uma regra duplicada nos dois envelhece pela metade — e aqui isso
 * teria um formato específico e desagradável: alguém apertaria a checagem na
 * criação, e a EDIÇÃO de uma matéria já no ar continuaria aceitando o texto
 * recusado. Como toda matéria publicada pode ser editada depois, o caminho
 * frouxo anularia o caminho apertado.
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTE PORTÃO FAZ — E O QUE ELE DELIBERADAMENTE NÃO FAZ
 * -----------------------------------------------------------------------------
 * FAZ: interrompe a PRIMEIRA tentativa de publicar um texto com trecho
 * sinalizado, devolvendo os achados para a tela mostrar.
 *
 * NÃO FAZ: impedir a publicação. A segunda tentativa, com
 * `acknowledgeEditorialRisk: true`, passa — e é registrada. O verificador é
 * heurístico (ver o cabeçalho de `core/editorial-risk.ts`); dar poder de veto a
 * uma lista de palavras seria pôr um editor-chefe cego na porta da redação.
 *
 * POR QUE O RECONHECIMENTO É UM SEGUNDO ENVIO, E NÃO UM CAMPO QUE VEM SEMPRE:
 * porque um campo que vem sempre é preenchido sempre. Se o formulário mandasse
 * `acknowledge: true` de saída, o aviso nunca apareceria e a auditoria diria que
 * todo mundo reconheceu tudo — que é o mesmo que não registrar nada. A tela só
 * pode mandar essa bandeira DEPOIS de ter mostrado os achados a um humano.
 *
 * -----------------------------------------------------------------------------
 * PERMISSÃO: NENHUMA CAPACIDADE NOVA. FOI UMA DECISÃO, NÃO UM ESQUECIMENTO.
 * -----------------------------------------------------------------------------
 * A pergunta óbvia é se "publicar apesar do aviso" deveria ser privativo de
 * administrador. A resposta é não, e o motivo é a coerência do resto do painel:
 * um redator JÁ pode publicar sozinho a matéria que assina (ver
 * `canEditArticleOf`). Uma trava aqui não protegeria nada — bastaria ele
 * escrever a mesma acusação com outras palavras, que a lista não pega — e teria
 * um custo real: pauta quente parada às 23h esperando um admin acordar por causa
 * de um falso positivo em "o protagonista é um ladrão".
 *
 * O que de fato protege a empresa não é a trava, são as três coisas que este
 * portão garante: o redator VÊ o trecho, PRECISA justificar quando o risco é
 * alto, e o reconhecimento fica gravado com nome e IP em `AuditLog`. Assumir
 * conscientemente é diferente de deixar passar sem ver — e essa diferença agora
 * é um fato registrado, não uma suposição.
 */

import { NextResponse } from 'next/server';

import {
  RISK_JUSTIFICATION_MAX,
  RISK_JUSTIFICATION_MIN,
  requiresJustification,
  summarizeRisk,
  type EditorialRiskFinding,
} from '@subcarioca/core';

/** O que a rota precisa gravar quando alguém publica apesar do aviso. */
export interface EditorialRiskAcknowledgement {
  findings: EditorialRiskFinding[];
  /** Justificativa digitada. `null` quando não havia risco alto e ninguém escreveu. */
  reason: string | null;
}

export type EditorialRiskGateResult =
  | { ok: true; acknowledgement: EditorialRiskAcknowledgement | null }
  | { ok: false; response: NextResponse };

/**
 * Decide se esta publicação segue em frente.
 *
 * Recebe o payload cru (é dele que vêm o reconhecimento e a justificativa) e o
 * resultado da varredura, que `parseArticleInput` já calculou a partir do texto
 * NORMALIZADO — nunca do que o cliente disse que era o texto.
 */
export function editorialRiskGate(
  payload: Record<string, unknown>,
  input: { publish: boolean; riskFindings: EditorialRiskFinding[] },
): EditorialRiskGateResult {
  const { publish, riskFindings } = input;

  /**
   * RASCUNHO NÃO PASSA PELO PORTÃO.
   *
   * Rascunho não é publicação: ninguém de fora lê, nada é indexado, não há
   * risco a correr ainda. Interromper o salvamento de um texto em construção
   * ensinaria a redação a rascunhar fora do painel — que é o pior desfecho
   * possível, porque tira o texto do lugar onde ele seria verificado.
   *
   * Os achados ainda assim VOLTAM na resposta de sucesso (ver as rotas), como
   * aviso passivo: melhor descobrir o problema enquanto se escreve.
   */
  if (!publish || riskFindings.length === 0) {
    return { ok: true, acknowledgement: null };
  }

  const acknowledged = payload.acknowledgeEditorialRisk === true;
  const reason =
    typeof payload.editorialRiskReason === 'string' ? payload.editorialRiskReason.trim() : '';

  if (!acknowledged) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          /**
           * A BANDEIRA QUE A TELA LÊ. Sem ela, o formulário mostraria esta
           * resposta como um erro qualquer ("não foi possível salvar") e o
           * redator não teria como saber que existe um caminho adiante.
           */
          needsEditorialRiskAck: true,
          requiresReason: requiresJustification(riskFindings),
          findings: riskFindings,
          message: `Revisão de risco editorial: ${summarizeRisk(riskFindings)}. Nada foi publicado ainda.`,
        },
        /**
         * 409, e não 400.
         *
         * 400 diria "seu formulário está malformado", e não está: todos os
         * campos são válidos. O que existe é um CONFLITO entre o pedido e o
         * estado em que a matéria se encontra — exatamente o que o 409
         * descreve. A distinção importa porque o cliente reage diferente aos
         * dois: 400 pede correção de campo, 409 pede uma decisão.
         */
        { status: 409 },
      ),
    };
  }

  /**
   * JUSTIFICATIVA — obrigatória só quando há trecho de ALTO risco.
   *
   * Os limites (5 a 200) são os mesmos do override de score em
   * `/api/admin/topics/[id]`: duas justificativas com regras diferentes no mesmo
   * painel seria uma diferença sem razão, que alguém teria de decorar.
   */
  if (requiresJustification(riskFindings)) {
    if (reason.length < RISK_JUSTIFICATION_MIN || reason.length > RISK_JUSTIFICATION_MAX) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            ok: false,
            needsEditorialRiskAck: true,
            requiresReason: true,
            findings: riskFindings,
            message: `Para publicar mesmo assim, escreva por quê (de ${RISK_JUSTIFICATION_MIN} a ${RISK_JUSTIFICATION_MAX} caracteres). ` +
              'Ex.: "falso positivo, é fala de personagem" ou "acusação confirmada pelo processo nº X".',
          },
          { status: 400 },
        ),
      };
    }
  }

  return {
    ok: true,
    acknowledgement: { findings: riskFindings, reason: reason.length > 0 ? reason : null },
  };
}
