'use client';

/**
 * =============================================================================
 * FORMULÁRIO "TRANSFORMAR TÓPICO EM MATÉRIA"
 * =============================================================================
 *
 * Peça que faltava entre "o pipeline descobriu e pontuou o tópico" e "o leitor
 * consegue ler a matéria": até aqui, esse passo só existia manualmente, direto
 * no banco. Este formulário fecha essa lacuna dentro do próprio painel.
 *
 * RESPONSIVO POR CSS, NÃO POR JS: usa `.admin-form--cols` (1 coluna até
 * 768px, 2 colunas a partir daí — ver ortuspixel.css). Título, corpo e TL;DR
 * usam `.admin-form__full` pra ocupar a largura toda mesmo no grid desktop,
 * porque são os campos que mais precisam de espaço horizontal pra digitar.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ArticleBlock } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';
import {
  ArticleClassificationFields,
  type ArticleClassification,
  type FranchiseOption,
} from './article-classification-fields';
import { FORMAT_OPTIONS, formatRequiresTldr } from './article-format-options';
import { BlockEditor } from './block-editor';
import { ImageUrlField } from './image-url-field';

interface ArticleCreateFormProps {
  topicId: string;
  defaultTitle: string;
  defaultExcerpt: string;
  defaultCategorySlug: string | null;
  /**
   * Franquias JÁ vinculadas ao tópico, herdadas como sugestão.
   *
   * Não é economia de cliques: é o que impede a matéria de sair menos
   * classificada do que a pauta que a originou. O pipeline já sabia que aquele
   * assunto era de Zelda; obrigar o redator a redizer isso é o tipo de trabalho
   * repetido que, em dia de correria, simplesmente não é feito.
   */
  defaultFranchiseIds?: string[];
  categories: { slug: string; name: string }[];
  authors: { id: string; name: string }[];
  franchises: FranchiseOption[];
  canLowerSensitivity: boolean;
  onDone: () => void;
}

export function ArticleCreateForm({
  topicId,
  defaultTitle,
  defaultExcerpt,
  defaultCategorySlug,
  defaultFranchiseIds = [],
  categories,
  authors,
  franchises,
  canLowerSensitivity,
  onDone,
}: ArticleCreateFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [format, setFormat] = useState('breaking');
  const [tldr, setTldr] = useState<string[]>(['', '', '']);
  const [blocks, setBlocks] = useState<ArticleBlock[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState('');

  /**
   * A editoria vira ESTADO (e não `defaultValue`) porque agora ela comanda
   * outro campo: as sub-editorias oferecidas dependem dela. Sem estado, trocar
   * de Tech para Games deixaria "Hardware" selecionado — e o servidor recusaria
   * o par, com razão.
   */
  const [categorySlug, setCategorySlug] = useState(
    defaultCategorySlug ?? categories[0]?.slug ?? '',
  );

  const [classification, setClassification] = useState<ArticleClassification>({
    subcategorySlug: '',
    franchiseIds: defaultFranchiseIds,
    tags: '',
    contentSensitivity: 'none',
  });
  // O texto vive num `useState` (e não só no `defaultValue`) porque o editor de
  // blocos precisa dele para o botão "converter o texto atual em blocos": numa
  // matéria nova, o redator pode começar escrevendo corrido e converter depois.
  const [content, setContent] = useState('');

  const requiresTldr = formatRequiresTldr(format);
  const usaBlocos = blocks.length > 0;

  function updateTldr(index: number, value: string) {
    setTldr((prev) => prev.map((item, i) => (i === index ? value : item)));
  }

  function addTldrRow() {
    setTldr((prev) => (prev.length >= 5 ? prev : [...prev, '']));
  }

  function removeTldrRow(index: number) {
    setTldr((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(formEl: HTMLFormElement, publish: boolean) {
    if (busy) return;

    const form = new FormData(formEl);

    setBusy(publish ? 'publish' : 'draft');
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/topics/${topicId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-article',
          title: form.get('title'),
          excerpt: form.get('excerpt'),
          content,
          blocks,
          categorySlug,
          authorId: form.get('authorId'),
          format,
          tldr: tldr.filter((t) => t.trim().length > 0),
          coverImageUrl: coverImageUrl || null,
          coverImageAlt: form.get('coverImageAlt') || null,
          isBreaking: form.get('isBreaking') === 'on',
          hasSpoiler: form.get('hasSpoiler') === 'on',
          // --- Classificação (ver `article-classification-fields.tsx`) ---
          subcategorySlug: classification.subcategorySlug || null,
          franchiseIds: classification.franchiseIds,
          tags: classification.tags,
          contentSensitivity: classification.contentSensitivity,
          publish,
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      // O formulário só fecha quando deu certo. Em qualquer falha ele
      // permanece aberto com tudo preenchido — inclusive quando a sessão
      // expirou no meio: basta reentrar em outra aba e clicar de novo.
      if (data.ok) {
        router.refresh();
        onDone();
      }
    } catch {
      // Só chega aqui quando o `fetch` sequer completou: rede caída, servidor
      // fora do ar. Qualquer resposta HTTP, mesmo 500, é tratada acima.
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
        void submit(event.currentTarget, false);
      }}
      aria-label="Transformar tópico em matéria"
    >
      <label className="admin-form__full">
        Título
        <input name="title" required minLength={8} maxLength={180} defaultValue={defaultTitle} />
      </label>

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
        <select name="authorId">
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
        <input name="coverImageAlt" maxLength={200} placeholder="Descrição da imagem para leitor de tela" />
      </label>

      <label className="admin-form__full">
        Resumo (aparece na home e nos cards)
        <textarea
          name="excerpt"
          required
          minLength={20}
          maxLength={300}
          rows={2}
          defaultValue={defaultExcerpt}
        />
      </label>

      {/* Some quando há blocos: eles passam a ser o corpo. Ver o comentário
          equivalente em `article-edit-form.tsx`. */}
      {!usaBlocos && (
        <label className="admin-form__full">
          Corpo da matéria
          <textarea
            name="content"
            required
            minLength={40}
            rows={10}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Escreva o texto completo aqui..."
          />
        </label>
      )}

      <div className="admin-form__full">
        <span className="form-hint">Corpo em blocos</span>
        <BlockEditor blocks={blocks} onChange={setBlocks} legacyMarkdown={content} />
      </div>

      <div className="admin-form__full admin-tldr">
        <span className="form-hint">
          Resumo em 3 a 5 pontos (TL;DR){requiresTldr ? ' — obrigatório para este formato' : ' (opcional)'}
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
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeTldrRow(index)}>
                Remover
              </button>
            )}
          </div>
        ))}
        {tldr.length < 5 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={addTldrRow}>
            + Adicionar ponto
          </button>
        )}
      </div>

      <label className="form-inline">
        <input type="checkbox" name="isBreaking" />
        É notícia quente agora
      </label>

      <label className="form-inline">
        <input type="checkbox" name="hasSpoiler" />
        Contém spoiler
      </label>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--ghost" disabled={busy !== null}>
          {busy === 'draft' ? 'Salvando…' : 'Salvar rascunho'}
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
          {busy === 'publish' ? 'Publicando…' : 'Publicar agora'}
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
