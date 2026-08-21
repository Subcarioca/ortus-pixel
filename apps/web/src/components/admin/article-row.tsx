'use client';

/**
 * =============================================================================
 * LINHA DE MATÉRIA NO PAINEL — editar e apagar
 * =============================================================================
 *
 * A EXCLUSÃO PEDE CONFIRMAÇÃO EM DOIS PASSOS, NA PRÓPRIA LINHA.
 *
 * Não é `window.confirm()`: aquele diálogo é fechado no reflexo, não explica o
 * que será perdido e não pode ser estilizado. Aqui, o segundo passo diz
 * exatamente o que vai embora junto (os comentários da matéria) — informação
 * que o editor não tem como adivinhar e que muda a decisão.
 *
 * O botão de apagar só ganha a cor de alerta NO PASSO DA CONFIRMAÇÃO. Na linha
 * em repouso ele é neutro: uma lista com um botão vermelho por item transforma
 * "apagar" no elemento mais chamativo da tela, que é o oposto do que se quer de
 * uma ação destrutiva.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { routes, type ContentOrigin } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';
import type { FranchiseOption } from './article-classification-fields';
import { ArticleEditForm, type EditableArticle } from './article-edit-form';
import { ArticleReviewActions } from './article-review-actions';

export interface AdminArticleRowData extends EditableArticle {
  slug: string;
  /**
   * De onde veio o TEXTO INICIAL: 'human' | 'ai-assisted'.
   *
   * Fica nesta interface, e não em `EditableArticle`, porque não é um campo do
   * formulário: é informação de leitura da linha. `EditableArticle` descreve o
   * que a edição ENVIA de volta ao servidor — e a procedência não pode ser
   * reescrita por uma edição (ver o comentário da coluna no schema).
   */
  contentOrigin: ContentOrigin;
  categoryName: string;
  authorName: string;
  publishedAt: string | null;
  updatedAt: string;
  commentCount: number;
  /** URL pública. Só existe de fato quando a matéria está publicada. */
  url: string;
  /**
   * Motivo da última DEVOLUÇÃO desta matéria pela aprovação de conteúdo
   * sensível, quando houve uma.
   *
   * Vem do `AuditLog` (ação `article.review_rejected`), e não de uma coluna nova
   * em `Article`. A decisão é deliberada: o motivo é um FATO DA TRILHA — "em tal
   * dia, tal administrador devolveu por isto" —, e uma coluna guardaria só o
   * último, apagando o histórico a cada nova devolução. Como a trilha já existe,
   * já é gravada em transação e já sobrevive à exclusão da matéria, ler dela
   * custa uma consulta e não custa uma migração.
   */
  reviewRejection: { reason: string; at: string } | null;
}

interface ArticleRowProps {
  article: AdminArticleRowData;
  categories: { slug: string; name: string }[];
  authors: { id: string; name: string }[];
  /** Franquias cadastradas, para o campo de etiquetagem do formulário. */
  franchises: FranchiseOption[];
  /**
   * A conta logada pode AFROUXAR a classificação de conteúdo?
   *
   * Cortesia de interface, não segurança: quem recusa é a rota PATCH, via
   * `canLowerSensitivity` (core/staff.ts).
   */
  canLowerSensitivity: boolean;
  /**
   * A conta logada pode APROVAR conteúdo sensível?
   *
   * Cortesia de interface, como a de cima: quem recusa é a rota de review, via
   * `requireStaffApi('aprovarConteudoSensivel')`. Aqui ela decide apenas se os
   * botões da fila aparecem — o redator vê a mesma linha, com o rótulo "EM
   * APROVAÇÃO" e sem botão nenhum, que é a informação que ele precisa.
   */
  canApproveReview?: boolean;
}

export function ArticleRow({
  article,
  categories,
  authors,
  franchises,
  canLowerSensitivity,
  canApproveReview = false,
}: ArticleRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isPublished = article.status === 'published';
  const isInReview = article.status === 'in-review';

  async function remove() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/articles/${article.id}`, { method: 'DELETE' });
      const data = await readAdminResponse(response);

      if (data.ok) {
        // A linha some da lista quando o servidor recarregar os dados. Não
        // removemos nada do estado local: a fonte da verdade é o banco, e uma
        // remoção "otimista" mostraria a lista certa por acaso e a errada
        // sempre que a exclusão falhasse.
        router.refresh();
      } else {
        setMessage(data.message);
        setConfirmingDelete(false);
        // Se a matéria já não existe (outra aba apagou), esta linha virou um
        // fantasma: recarregar a lista a remove em vez de deixar na tela um
        // botão que só repetiria o mesmo erro.
        //
        // Só nesses dois casos, e de propósito. Numa sessão expirada (401) o
        // recarregamento traria a tela de login por cima da mensagem que acabou
        // de explicar o que aconteceu — trocando a explicação por um susto.
        if (response.status === 404 || response.status === 409) router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. A matéria não foi apagada.');
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="admin-row">
      <div className="admin-row__main">
        <div className="admin-row__body">
          <h3 className="admin-row__title">{article.title}</h3>

          <div className="admin-row__meta">
            {/* Rascunho recebe destaque textual, não colorido: a paleta de
                temperatura é do conteúdo, não do estado editorial. */}
            <span className="admin-override">
              {isPublished ? 'PUBLICADA' : isInReview ? 'EM APROVAÇÃO' : 'RASCUNHO'}
            </span>
            {/* PROCEDÊNCIA — só aparece quando é IA, pelo mesmo motivo da
                etiqueta de "pauta da redação" na fila: marcar o normal faz a
                etiqueta desaparecer de tanto se repetir. O que precisa saltar é
                a exceção — aqui, "este texto começou automático, leia com mais
                desconfiança". Ver core/topic-origin.ts e core/content-origin.ts. */}
            {article.contentOrigin === 'ai-assisted' && (
              <span className="chip chip--sm" title="O texto inicial desta matéria foi gerado por IA e revisado pela redação.">
                rascunho de IA
              </span>
            )}
            <span className="admin-row__detail">{article.categoryName}</span>
            <span className="admin-row__detail">{article.authorName}</span>
            {article.commentCount > 0 && (
              <span className="admin-row__detail">
                {article.commentCount} comentário{article.commentCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="admin-row__timer">
              {article.publishedAt
                ? `publicada em ${formatDate(article.publishedAt)}`
                : `editada em ${formatDate(article.updatedAt)}`}
            </span>
          </div>

          <p className="admin-row__summary">{article.excerpt}</p>

          {/*
            O MOTIVO DA DEVOLUÇÃO, na linha da matéria devolvida.

            Fica aqui, e não numa tela de "notificações", porque é aqui que a
            pessoa está quando vai corrigir. `role="status"` (e não `alert`) por
            ser informação que já estava na tela quando ela chegou — `alert`
            interromperia a leitura de quem usa leitor de tela sem urgência
            nenhuma para justificar isso.

            Some sozinho quando a matéria é reenviada e aprovada: a consulta só
            traz a devolução mais recente das matérias que estão em rascunho.
          */}
          {article.reviewRejection && (
            <p className="form-hint" role="status">
              <strong>Devolvida pela aprovação</strong> em{' '}
              {formatDate(article.reviewRejection.at)}: {article.reviewRejection.reason}
            </p>
          )}
        </div>
      </div>

      <div className="admin-row__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setEditing((value) => !value)}
          // `aria-expanded` conta a quem usa leitor de tela que este botão abre
          // e fecha um formulário logo abaixo — sem isso, o campo que aparece
          // não tem relação anunciada com o botão que o abriu.
          aria-expanded={editing}
        >
          {editing ? 'Fechar edição' : 'Editar'}
        </button>

        {/*
          PRÉ-VISUALIZAR — em TODA linha, publicada ou não.

          É o botão que fechou o buraco do fluxo editorial: até aqui, a primeira
          vez que alguém via a própria matéria renderizada era depois de publicar.
          Ele vem ANTES de "Ver no site" na ordem de leitura porque é o que se usa
          antes de publicar; "Ver no site" só existe depois.

          Em matéria publicada ele continua útil e não é redundante com "Ver no
          site": a página pública é servida de um cache de 1 hora, enquanto o
          preview lê o banco na hora — é onde se confere uma correção que acabou
          de ser salva e ainda não apareceu para o leitor.

          `target="_blank"`: o redator perderia o formulário aberto (e o que
          digitou nele) se a pré-visualização substituísse esta aba. O
          `rel="noopener"` é obrigatório com `_blank` — sem ele, a página aberta
          recebe acesso a `window.opener`.

          A URL é montada aqui, e não recebida por prop como `article.url`,
          porque ela precisa só do `id`, que já está nesta linha. `article.url`
          vem do servidor porque depende do slug da CATEGORIA, que não vem.
        */}
        <a
          className="btn btn--ghost btn--sm"
          href={routes.adminPreview(article.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Pré-visualizar
        </a>

        {isPublished && (
          <a
            className="btn btn--ghost btn--sm"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver no site
          </a>
        )}

        {!confirmingDelete ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            Apagar
          </button>
        ) : (
          <>
            <span className="admin-row__warning" role="alert">
              Apagar “{article.title}”?
              {article.commentCount === 1
                ? ' Isso também remove o único comentário da matéria.'
                : article.commentCount > 1
                  ? ` Isso também remove os ${article.commentCount} comentários da matéria.`
                  : ''}{' '}
              Não pode ser desfeito.
            </span>
            <button type="button" className="btn btn--hot btn--sm" onClick={remove} disabled={busy}>
              {busy ? 'Apagando…' : 'Apagar definitivamente'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
            >
              Cancelar
            </button>
          </>
        )}

        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>

      {/*
        FILA DE CONTEÚDO SENSÍVEL — os botões vêm DEPOIS das ações normais e num
        bloco próprio, e não misturados a "Editar"/"Apagar", porque são de outra
        natureza: as de cima são de manutenção do próprio texto; estas duas
        decidem se o site publica aquilo. Empilhá-las na mesma fileira faria
        "Aprovar e publicar" competir por atenção com "Pré-visualizar".
      */}
      {isInReview && canApproveReview && (
        <div className="admin-row__detail">
          <ArticleReviewActions articleId={article.id} articleTitle={article.title} />
        </div>
      )}

      {editing && (
        <div className="admin-row__detail">
          <ArticleEditForm
            article={article}
            categories={categories}
            authors={authors}
            franchises={franchises}
            canLowerSensitivity={canLowerSensitivity}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Data formatada no fuso do NAVEGADOR, a partir do ISO gerado no servidor.
 *
 * O componente recebe string e não `Date` de propósito: props de componente de
 * cliente atravessam a fronteira servidor→cliente serializadas, e uma data
 * formatada no servidor sairia no fuso do servidor — que não é o do editor.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
