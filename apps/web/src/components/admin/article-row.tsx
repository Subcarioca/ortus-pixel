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

import { ArticleEditForm, type EditableArticle } from './article-edit-form';

export interface AdminArticleRowData extends EditableArticle {
  slug: string;
  categoryName: string;
  authorName: string;
  publishedAt: string | null;
  updatedAt: string;
  commentCount: number;
  /** URL pública. Só existe de fato quando a matéria está publicada. */
  url: string;
}

interface ArticleRowProps {
  article: AdminArticleRowData;
  categories: { slug: string; name: string }[];
  authors: { id: string; name: string }[];
}

export function ArticleRow({ article, categories, authors }: ArticleRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isPublished = article.status === 'published';

  async function remove() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/articles/${article.id}`, { method: 'DELETE' });
      const data = (await response.json()) as { ok: boolean; message?: string };

      if (data.ok) {
        // A linha some da lista quando o servidor recarregar os dados. Não
        // removemos nada do estado local: a fonte da verdade é o banco, e uma
        // remoção "otimista" mostraria a lista certa por acaso e a errada
        // sempre que a exclusão falhasse.
        router.refresh();
      } else {
        setMessage(data.message ?? 'Não foi possível apagar.');
        setConfirmingDelete(false);
      }
    } catch {
      setMessage('Erro de conexão.');
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
              {isPublished ? 'PUBLICADA' : 'RASCUNHO'}
            </span>
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
              {article.commentCount > 0
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

      {editing && (
        <div className="admin-row__detail">
          <ArticleEditForm
            article={article}
            categories={categories}
            authors={authors}
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
