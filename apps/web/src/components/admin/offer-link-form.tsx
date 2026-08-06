'use client';

/**
 * =============================================================================
 * VINCULAR OFERTA A UM ARTIGO
 * =============================================================================
 *
 * Um `<select>` com os artigos publicados recentes e um botão. Simples de
 * propósito: vincular é uma ação de dois segundos, e qualquer coisa mais
 * elaborada (busca com autocomplete, arrastar e soltar) seria trabalho de
 * interface sem retorno para uma tela usada por três pessoas.
 *
 * O SELECT MOSTRA O FORMATO DE CADA ARTIGO, e isso não é enfeite: a política
 * comercial só exibe bloco de afiliado em review, comparativo, guia e listicle
 * (design §7.1). Vincular uma oferta a um "breaking" é permitido no banco e
 * NÃO vai aparecer no site — sem essa informação à vista, o editor concluiria
 * que o sistema está quebrado.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface OfferLinkFormProps {
  offerId: string;
  articles: {
    id: string;
    title: string;
    slug: string;
    format: string;
    hasAffiliateLinks: boolean;
  }[];
}

/** Formatos em que o bloco comercial de fato aparece (espelha lib/ads.ts). */
const COMMERCIAL_FORMATS = new Set(['review', 'comparison', 'guide', 'listicle']);

export function OfferLinkForm({ offerId, articles }: OfferLinkFormProps) {
  const router = useRouter();
  const [articleId, setArticleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = articles.find((article) => article.id === articleId);
  const willRender = selected ? COMMERCIAL_FORMATS.has(selected.format) : true;

  async function link() {
    if (!articleId || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', offerId, articleId }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };

      setMessage(data.message ?? 'Falhou.');
      if (data.ok) {
        setArticleId('');
        router.refresh();
      }
    } catch {
      setMessage('Erro de rede.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form">
      <label>
        Vincular a um artigo
        <select value={articleId} onChange={(event) => setArticleId(event.target.value)}>
          <option value="">selecione…</option>
          {articles.map((article) => (
            <option key={article.id} value={article.id}>
              [{article.format}] {article.title.slice(0, 60)}
            </option>
          ))}
        </select>
      </label>

      {/* Aviso ANTES da ação, não depois. Ver o comentário no topo. */}
      {selected && !willRender && (
        <p className="form-hint" role="status">
          Atenção: o formato "{selected.format}" não exibe bloco de afiliado no site
          (regra de densidade). O vínculo será salvo, mas nada aparecerá para o leitor.
        </p>
      )}

      <div className="admin-actions">
        <button type="button" className="btn btn--ghost" onClick={link} disabled={!articleId || busy}>
          {busy ? '…' : 'Vincular'}
        </button>
        {message && (
          <span className="form-hint" role="status">
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
