'use client';

/**
 * =============================================================================
 * "NOVA PAUTA" — a redação propondo assunto, em vez de só receber
 * =============================================================================
 *
 * FICA NO TOPO DA FILA DE PAUTAS, E RECOLHIDO POR PADRÃO.
 *
 * As duas coisas importam. No topo, porque é ali que a pergunta "o que eu
 * escrevo agora?" é feita — uma tela separada só para criar pauta seria um
 * clique a mais no momento em que a pessoa já decidiu o que quer, e telas assim
 * são as primeiras a cair em desuso. Recolhido, porque o uso DOMINANTE desta
 * página continua sendo ler a fila: um formulário sempre aberto empurraria a
 * fila para baixo da dobra todos os dias, para servir ao caso minoritário.
 *
 * O QUE ESTE FORMULÁRIO NÃO TEM, e por quê:
 *   - SCORE. Pauta manual não passou por conector nenhum; inventar uma nota
 *     seria mentira com aparência de medição (ver a rota, `api/admin/topics`).
 *   - CORPO DA MATÉRIA. Pauta é o assunto, não o texto. Escrever vem depois, no
 *     mesmo botão "Criar matéria" que os tópicos do pipeline já usam — de
 *     propósito: um caminho só até a matéria, e não dois.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { readAdminResponse } from './admin-response';
import type { FranchiseOption } from './article-classification-fields';

interface TopicCreateFormProps {
  categories: { slug: string; name: string }[];
  franchises: FranchiseOption[];
}

export function TopicCreateForm({ categories, franchises }: TopicCreateFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [categorySlug, setCategorySlug] = useState(categories[0]?.slug ?? '');
  const [franchiseIds, setFranchiseIds] = useState<string[]>([]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, summary, categorySlug, franchiseIds }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        // Limpa e fecha só no sucesso. Em qualquer falha — inclusive "já existe
        // uma pauta com esse título" — o que foi digitado continua na tela.
        setTitle('');
        setSummary('');
        setFranchiseIds([]);
        setOpen(false);
        router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. A pauta não foi criada.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="admin-actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
          + Nova pauta da redação
        </button>
        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      className="admin-form admin-form--cols"
      aria-label="Criar pauta da redação"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="admin-form__full">
        Título da pauta
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          minLength={8}
          maxLength={200}
          placeholder="O que precisa ser apurado ou escrito"
        />
      </label>

      <label>
        Editoria
        <select value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)}>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="form-hint">
          Obrigatória: é o que faz a pauta aparecer filtrada e a matéria nascer já classificada.
        </span>
      </label>

      <label>
        Franquias
        <select
          multiple
          size={5}
          value={franchiseIds}
          onChange={(event) =>
            setFranchiseIds([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>
              {franchise.name}
            </option>
          ))}
        </select>
        <span className="form-hint">Opcional. Segure Ctrl (ou Cmd) para escolher mais de uma.</span>
      </label>

      <label className="admin-form__full">
        Do que se trata
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="O ângulo, o que já se sabe, o que falta apurar. Quem for escrever lê isto."
        />
      </label>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Criando…' : 'Criar pauta'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
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
