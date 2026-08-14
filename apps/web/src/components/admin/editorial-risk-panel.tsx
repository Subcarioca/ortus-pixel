'use client';

/**
 * =============================================================================
 * PAINEL DE REVISÃO DE RISCO EDITORIAL
 * =============================================================================
 *
 * A superfície que o pedido do dono do site descreve: "faça alerta para serem
 * trocadas ou avise antes de qualquer publicação potencialmente perigosa".
 *
 * Compartilhado pelos formulários de CRIAR e de EDITAR — pelo mesmo motivo que
 * a regra é compartilhada no servidor: um aviso que aparece só na criação
 * deixaria de aparecer justamente na hora mais perigosa, que é alguém mexendo
 * numa matéria já no ar. (Os formulários em si continuam sendo dois componentes
 * separados; ver o cabeçalho de `article-edit-form.tsx`. O que se unifica é a
 * peça, não a tela.)
 *
 * -----------------------------------------------------------------------------
 * TRÊS DECISÕES DE INTERFACE QUE NÃO SÃO COSMÉTICAS
 * -----------------------------------------------------------------------------
 *
 * 1. O TRECHO APARECE, NÃO SÓ A REGRA. "Linguagem potencialmente difamatória"
 *    manda o redator caçar o problema em três mil palavras — e quem está com
 *    pressa não caça: clica em publicar. Mostrar a frase com o pedaço destacado
 *    transforma o aviso em algo que se resolve em dez segundos.
 *
 * 2. "VOLTAR E EDITAR" É O BOTÃO PRIMÁRIO; "PUBLICAR MESMO ASSIM" É O DISCRETO.
 *    Os dois caminhos existem e nenhum é escondido, mas o desenho tem opinião
 *    sobre qual é o esperado. Fosse o contrário, a hierarquia visual estaria
 *    dizendo "ignore isto" — e a tela venceria o texto, como sempre vence.
 *
 * 3. O AVISO DE FALIBILIDADE FICA VISÍVEL, SEMPRE. Sem ele, o efeito colateral
 *    previsível é a redação passar a confiar no silêncio do robô ("não apitou,
 *    então está seguro"). Um verificador de palavras-chave não sabe nada sobre
 *    o que ele não conhece, e a tela precisa dizer isso toda vez.
 */

import {
  EDITORIAL_RISK_CATEGORY_LABELS,
  EDITORIAL_RISK_DISCLAIMER,
  EDITORIAL_RISK_FIELD_LABELS,
  RISK_JUSTIFICATION_MAX,
  RISK_JUSTIFICATION_MIN,
  type EditorialRiskFinding,
} from '@subcarioca/core';

import type { AdminResponse } from './admin-response';

export interface EditorialRiskReview {
  findings: EditorialRiskFinding[];
  /** Há trecho de alto risco? Então a justificativa é obrigatória. */
  requiresReason: boolean;
}

/**
 * A publicação parou para revisão?
 *
 * Devolve `null` quando a resposta não é sobre risco — o que inclui todos os
 * outros erros possíveis (sessão expirada, matéria apagada, campo inválido).
 * Assim o formulário trata "precisa de decisão" e "deu errado" como coisas
 * diferentes, que é o que elas são.
 */
export function readEditorialRiskReview(data: AdminResponse): EditorialRiskReview | null {
  if (data.needsEditorialRiskAck !== true) return null;
  return {
    findings: parseFindings(data.findings),
    requiresReason: data.requiresReason === true,
  };
}

/**
 * Achados que vieram junto de um SUCESSO (o caso do rascunho salvo).
 *
 * Aviso passivo: nada foi barrado, mas é melhor descobrir agora do que na hora
 * de publicar, com a pauta esfriando.
 */
export function readEditorialRiskHint(data: AdminResponse): EditorialRiskFinding[] {
  return parseFindings(data.riskFindings);
}

/**
 * Confere a forma do que veio pela rede antes de renderizar.
 *
 * O dado vem do nosso próprio servidor, e o React já escapa texto — não há aqui
 * risco de XSS. A validação existe por outro motivo: uma resposta de formato
 * inesperado (versão antiga em cache, proxy que reescreve JSON) quebraria a tela
 * do painel inteiro com um `undefined.toUpperCase()`. Filtrar é mais barato do
 * que descobrir isso às 23h.
 */
function parseFindings(value: unknown): EditorialRiskFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EditorialRiskFinding => {
    const f = item as Partial<EditorialRiskFinding> | null;
    return (
      !!f &&
      typeof f.match === 'string' &&
      typeof f.reason === 'string' &&
      typeof f.category === 'string' &&
      typeof f.field === 'string' &&
      (f.severity === 'alto' || f.severity === 'atencao')
    );
  });
}

interface EditorialRiskPanelProps {
  findings: EditorialRiskFinding[];
  /**
   * 'decisao' — a publicação parou aqui e espera uma escolha humana.
   * 'aviso'   — nada foi barrado (rascunho); é só para a pessoa saber.
   */
  mode: 'decisao' | 'aviso';
  requiresReason?: boolean;
  reason?: string;
  onReasonChange?: (value: string) => void;
  onPublishAnyway?: () => void;
  onBackToEdit?: () => void;
  busy?: boolean;
}

export function EditorialRiskPanel({
  findings,
  mode,
  requiresReason = false,
  reason = '',
  onReasonChange,
  onPublishAnyway,
  onBackToEdit,
  busy = false,
}: EditorialRiskPanelProps) {
  if (findings.length === 0) return null;

  const decisao = mode === 'decisao';
  const altos = findings.filter((f) => f.severity === 'alto').length;
  const reasonOk =
    !requiresReason ||
    (reason.trim().length >= RISK_JUSTIFICATION_MIN &&
      reason.trim().length <= RISK_JUSTIFICATION_MAX);

  return (
    <section
      className={`risk-panel${decisao ? ' risk-panel--decisao' : ''} admin-form__full`}
      /**
       * `alert` só no modo de decisão: ele interrompe o leitor de tela na hora,
       * o que é certo quando a publicação parou e errado quando é só um aviso de
       * rascunho salvo. Usar `alert` para os dois casos ensinaria a ignorar.
       */
      role={decisao ? 'alert' : 'status'}
      aria-label="Revisão de risco editorial"
    >
      <h3 className="risk-panel__title">
        {decisao ? 'Revisão antes de publicar' : 'Pontos de atenção neste texto'}
        <span className="risk-panel__count">
          {findings.length} {findings.length === 1 ? 'trecho' : 'trechos'}
          {altos > 0 ? ` · ${altos} de alto risco` : ''}
        </span>
      </h3>

      {decisao && (
        <p className="risk-panel__lead">
          Nada foi publicado ainda. Confira os trechos abaixo: eles podem expor o site a
          processo por difamação, injúria ou violação da LGPD. Corrigir agora custa um minuto.
        </p>
      )}

      <ul className="risk-list">
        {findings.map((f, index) => (
          <li
            key={`${f.field}-${f.category}-${f.match}-${index}`}
            className={`risk-item risk-item--${f.severity}`}
          >
            <p className="risk-item__head">
              <span className="risk-item__badge">
                {f.severity === 'alto' ? 'Alto risco' : 'Atenção'}
              </span>
              <span className="risk-item__cat">
                {EDITORIAL_RISK_CATEGORY_LABELS[f.category] ?? f.category}
              </span>
              <span className="risk-item__field">
                em {EDITORIAL_RISK_FIELD_LABELS[f.field] ?? f.field}
              </span>
            </p>

            {/* O trecho, com o pedaço exato destacado. `<mark>` é o elemento
                semântico para "relevante no contexto atual" — e não um <span>
                colorido, que não diria nada a quem usa leitor de tela. */}
            <p className="risk-item__quote">
              {f.before}
              <mark>{f.match}</mark>
              {f.after}
            </p>

            <p className="risk-item__reason">{f.reason}</p>

            {f.suggestion && (
              <p className="risk-item__fix">
                <strong>Troque por:</strong> {f.suggestion}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="risk-panel__disclaimer">{EDITORIAL_RISK_DISCLAIMER}</p>

      {decisao && (
        <div className="risk-panel__foot">
          {requiresReason && (
            <label className="risk-panel__reason">
              Por que publicar mesmo assim? (fica registrado com o seu nome)
              <textarea
                value={reason}
                onChange={(e) => onReasonChange?.(e.target.value)}
                minLength={RISK_JUSTIFICATION_MIN}
                maxLength={RISK_JUSTIFICATION_MAX}
                rows={2}
                placeholder='Ex.: "falso positivo, é fala de personagem" ou "acusação confirmada pelo processo nº 000123-45"'
              />
            </label>
          )}

          <div className="admin-actions">
            {/* O primário é VOLTAR. Ver a decisão 2 no cabeçalho. */}
            <button type="button" className="btn btn--primary" onClick={onBackToEdit} disabled={busy}>
              Voltar e editar o texto
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onPublishAnyway}
              disabled={busy || !reasonOk}
              /**
               * Desabilitar sem explicar é a forma mais rápida de irritar quem
               * está do outro lado: o `title` diz o que falta.
               */
              title={reasonOk ? undefined : `Escreva ao menos ${RISK_JUSTIFICATION_MIN} caracteres.`}
            >
              {busy ? 'Publicando…' : 'Publicar mesmo assim'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
