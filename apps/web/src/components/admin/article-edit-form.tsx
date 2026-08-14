'use client';

/**
 * =============================================================================
 * FORMULÁRIO DE EDIÇÃO DE MATÉRIA
 * =============================================================================
 *
 * Irmão do `ArticleCreateForm`, e NÃO uma generalização dele. A tentação de
 * fundir os dois num só componente com `mode="create" | "edit"` foi recusada de
 * propósito: os dois divergem em pontos que não são cosméticos —
 *
 *   CRIAR  → nasce de um TÓPICO (`/api/admin/topics/[id]`, ação
 *            `create-article`), marca o tópico como coberto e gera o slug.
 *   EDITAR → age sobre a MATÉRIA (`/api/admin/articles/[id]`, PATCH), nunca
 *            toca no slug e sabe despublicar.
 *
 * Fundir os dois exigiria condicionais em cada um desses pontos, e o resultado
 * seria um componente em que ninguém consegue ler o que acontece em cada caso.
 * O que os dois de fato compartilham (a lista de formatos) está extraído em
 * `article-format-options.ts`.
 *
 * RESPONSIVIDADE: mesmo padrão do resto do painel — `.admin-form--cols` (1
 * coluna até 768px, 2 a partir daí) e `.admin-form__full` nos campos que
 * precisam da largura toda.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { toContentSensitivity, type ArticleBlock, type ContentSensitivity } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';
import {
  ArticleClassificationFields,
  type ArticleClassification,
  type FranchiseOption,
} from './article-classification-fields';
import { FORMAT_OPTIONS, formatRequiresTldr } from './article-format-options';
import { BlockEditor, toEditorBlocks } from './block-editor';
import { ImageUrlField } from './image-url-field';

export interface EditableArticle {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  /** Coluna `Json` do banco — normalizada por `toEditorBlocks`. */
  blocks: unknown;
  categorySlug: string;
  authorId: string;
  format: string;
  tldr: string[];
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  isBreaking: boolean;
  hasSpoiler: boolean;
  status: string;
  /** Classificação de conteúdo salva hoje. Ver core/content-sensitivity.ts. */
  contentSensitivity: ContentSensitivity;
  subcategorySlug: string | null;
  franchiseIds: string[];
  /** Nomes das tags já vinculadas, para reabrir o campo com o que está salvo. */
  tagNames: string[];
}

interface ArticleEditFormProps {
  article: EditableArticle;
  categories: { slug: string; name: string }[];
  authors: { id: string; name: string }[];
  franchises: FranchiseOption[];
  canLowerSensitivity: boolean;
  onDone: () => void;
}

export function ArticleEditForm({
  article,
  categories,
  authors,
  franchises,
  canLowerSensitivity,
  onDone,
}: ArticleEditFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [format, setFormat] = useState(article.format);
  const [categorySlug, setCategorySlug] = useState(article.categorySlug);
  const [coverImageUrl, setCoverImageUrl] = useState(article.coverImageUrl ?? '');

  const [classification, setClassification] = useState<ArticleClassification>({
    subcategorySlug: article.subcategorySlug ?? '',
    franchiseIds: article.franchiseIds,
    // As tags voltam para o campo como texto — a mesma forma em que foram
    // digitadas. Reabrir o formulário e ver o campo vazio faria o editor achar
    // que a matéria não tem tag e, ao salvar, ele APAGARIA as que existiam (a
    // gravação é por substituição, ver server/article-taxonomy.ts).
    tags: article.tagNames.join(', '),
    contentSensitivity: toContentSensitivity(article.contentSensitivity),
  });

  // Começa com o que já está salvo; se a matéria não tiver TL;DR, abre com três
  // linhas vazias — o mesmo ponto de partida do formulário de criação.
  const [tldr, setTldr] = useState<string[]>(
    article.tldr.length > 0 ? article.tldr : ['', '', ''],
  );

  // O corpo em blocos é estado do formulário, não campo de `FormData`: ele é uma
  // estrutura, e `FormData` só transporta texto.
  const [blocks, setBlocks] = useState<ArticleBlock[]>(() => toEditorBlocks(article.blocks));

  const requiresTldr = formatRequiresTldr(format);
  const usaBlocos = blocks.length > 0;

  function updateTldr(index: number, value: string) {
    setTldr((prev) => prev.map((item, i) => (i === index ? value : item)));
  }

  async function submit(formEl: HTMLFormElement, publish: boolean) {
    if (busy) return;

    const form = new FormData(formEl);
    setBusy(publish ? 'publish' : 'draft');
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          excerpt: form.get('excerpt'),
          content: form.get('content'),
          // Com blocos, o servidor IGNORA `content` e o deriva deles. Mandamos
          // os dois assim mesmo: o campo de texto continua sendo o corpo real
          // enquanto ninguém converte a matéria, e é ele que o botão de
          // conversão usa como origem.
          blocks,
          categorySlug,
          authorId: form.get('authorId'),
          format,
          tldr: tldr.filter((t) => t.trim().length > 0),
          coverImageUrl: coverImageUrl || null,
          coverImageAlt: form.get('coverImageAlt') || null,
          isBreaking: form.get('isBreaking') === 'on',
          hasSpoiler: form.get('hasSpoiler') === 'on',
          subcategorySlug: classification.subcategorySlug || null,
          franchiseIds: classification.franchiseIds,
          tags: classification.tags,
          contentSensitivity: classification.contentSensitivity,
          publish,
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      // Fecha só no sucesso: se a matéria foi apagada em outra aba, ou a sessão
      // caiu, o texto editado continua na tela para ser copiado ou reenviado.
      if (data.ok) {
        router.refresh();
        onDone();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. Nada foi salvo; o texto continua aqui.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="admin-form admin-form--cols"
      onSubmit={(event) => {
        event.preventDefault();
        // O submit padrão (Enter no campo) salva como RASCUNHO, nunca publica.
        // Publicar é a ação irreversível aos olhos do leitor: ela exige um
        // clique deliberado no botão certo.
        void submit(event.currentTarget, false);
      }}
      aria-label={`Editar matéria: ${article.title}`}
    >
      <label className="admin-form__full">
        Título
        <input name="title" required minLength={8} maxLength={180} defaultValue={article.title} />
      </label>

      {/* O editor precisa saber que corrigir o título NÃO muda o endereço da
          matéria — senão ele evita corrigir, com medo de quebrar links. */}
      <p className="admin-form__full form-hint">
        O endereço (URL) da matéria não muda ao editar o título: links já
        compartilhados continuam funcionando.
      </p>

      <label>
        Categoria
        <select value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)}>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Formato
        <select name="format" value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMAT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Autor
        <select name="authorId" defaultValue={article.authorId}>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <ArticleClassificationFields
        categorySlug={categorySlug}
        value={classification}
        onChange={setClassification}
        franchises={franchises}
        savedSensitivity={toContentSensitivity(article.contentSensitivity)}
        canLowerSensitivity={canLowerSensitivity}
      />

      <ImageUrlField
        label="Imagem de capa"
        value={coverImageUrl}
        onChange={setCoverImageUrl}
        className="admin-form__full"
      />

      <label className="admin-form__full">
        Texto alternativo da imagem
        <input name="coverImageAlt" maxLength={200} defaultValue={article.coverImageAlt ?? ''} />
      </label>

      <label className="admin-form__full">
        Resumo (aparece na home e nos cards)
        <textarea
          name="excerpt"
          required
          minLength={20}
          maxLength={300}
          rows={2}
          defaultValue={article.excerpt}
        />
      </label>

      {/*
        O CAMPO DE TEXTO SÓ APARECE ENQUANTO NÃO HÁ BLOCOS.

        Mostrar os dois ao mesmo tempo criaria a pergunta que nenhum editor
        deveria ter de responder: "qual dos dois é o que vai para o ar?". Com
        blocos, eles são o corpo — e o texto vira uma projeção que o servidor
        reescreve sozinho. O `required` acompanha a visibilidade: um campo
        obrigatório escondido impede o envio do formulário sem dizer por quê.
      */}
      {!usaBlocos && (
        <label className="admin-form__full">
          Corpo da matéria
          <textarea
            name="content"
            required
            minLength={40}
            rows={10}
            defaultValue={article.content}
          />
        </label>
      )}

      <div className="admin-form__full">
        <span className="form-hint">Corpo em blocos</span>
        <BlockEditor blocks={blocks} onChange={setBlocks} legacyMarkdown={article.content} />
      </div>

      <div className="admin-form__full admin-tldr">
        <span className="form-hint">
          Resumo em 3 a 5 pontos (TL;DR)
          {requiresTldr ? ' — obrigatório para este formato' : ' (opcional)'}
        </span>
        {tldr.map((value, index) => (
          <div className="admin-tldr__row" key={index}>
            <input
              value={value}
              onChange={(e) => updateTldr(index, e.target.value)}
              maxLength={160}
              placeholder={`Ponto ${index + 1}`}
            />
            {tldr.length > 3 && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setTldr((prev) => prev.filter((_, i) => i !== index))}
              >
                Remover
              </button>
            )}
          </div>
        ))}
        {tldr.length < 5 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setTldr((prev) => [...prev, ''])}
          >
            + Adicionar ponto
          </button>
        )}
      </div>

      <label className="form-inline">
        <input type="checkbox" name="isBreaking" defaultChecked={article.isBreaking} />
        É notícia quente agora
      </label>

      <label className="form-inline">
        <input type="checkbox" name="hasSpoiler" defaultChecked={article.hasSpoiler} />
        Contém spoiler
      </label>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--ghost" disabled={busy !== null}>
          {busy === 'draft'
            ? 'Salvando…'
            : article.status === 'published'
              ? 'Despublicar e salvar rascunho'
              : 'Salvar rascunho'}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy !== null}
          onClick={(e) => {
            const formEl = e.currentTarget.closest('form');
            if (formEl) void submit(formEl, true);
          }}
        >
          {busy === 'publish'
            ? 'Salvando…'
            : article.status === 'published'
              ? 'Salvar alterações'
              : 'Publicar agora'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone} disabled={busy !== null}>
          Cancelar
        </button>
        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
