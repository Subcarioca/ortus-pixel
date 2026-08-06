'use client';

/**
 * =============================================================================
 * FORMULÁRIO DE CADASTRO DE OFERTA
 * =============================================================================
 *
 * DECISÃO DE INTERFACE: o preço é digitado em REAIS, com vírgula, e convertido
 * para centavos aqui. O banco guarda centavos inteiros (ver o schema para o
 * motivo — dinheiro em ponto flutuante acumula erro), mas exigir que o editor
 * digite "429900" seria pedir para alguém, algum dia, cadastrar uma placa de
 * vídeo por R$ 4.299,00 quando queria R$ 4.299,00... com um zero a mais.
 *
 * A conversão acontece uma vez, aqui, na borda — o mesmo princípio dos mappers
 * do banco: traduzir formatos na fronteira, não espalhar a tradução.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AFFILIATE_PROGRAM_CATEGORIES, AFFILIATE_PROGRAM_LABELS } from '@canalnerd/core';

export function OfferCreateForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    const priceCents = toCents(String(form.get('price') ?? ''));

    if (priceCents === undefined) {
      setMessage('Preço inválido. Use o formato 4299,00 (ou deixe em branco).');
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          productName: form.get('productName'),
          retailerName: form.get('retailerName'),
          brand: form.get('brand'),
          offerUrl: form.get('offerUrl'),
          programCategory: form.get('programCategory'),
          priceCents,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; message?: string };
      setMessage(data.message ?? 'Falhou.');

      if (data.ok) {
        (event.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch {
      setMessage('Erro de rede.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form admin-form--cols" onSubmit={handleSubmit}>
      <label>
        Produto
        <input name="productName" required maxLength={160} placeholder="Placa de Vídeo RTX 5070 12GB" />
      </label>

      <label>
        Loja / varejista
        <input name="retailerName" required maxLength={80} placeholder="Nome da loja" />
      </label>

      <label>
        Marca (opcional)
        <input name="brand" maxLength={60} placeholder="NVIDIA" />
      </label>

      <label>
        Categoria do programa
        <select name="programCategory" defaultValue="hardware">
          {AFFILIATE_PROGRAM_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {AFFILIATE_PROGRAM_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <label>
        Link de afiliado (https)
        <input
          name="offerUrl"
          required
          type="url"
          // `type="url"` ajuda no teclado do celular e dá validação básica de
          // graça. A validação que VALE continua sendo a do servidor, que exige
          // https e usa a mesma função que sanitiza links do corpo do artigo.
          placeholder="https://..."
        />
      </label>

      <label>
        Preço em reais (opcional)
        <input name="price" inputMode="decimal" placeholder="4299,00" />
      </label>

      <div className="admin-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Cadastrar oferta'}
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

/**
 * "4299,00" ou "4299.00" ou "4299" → 429900 centavos.
 * Vazio → `null` (oferta sem preço é estado legítimo).
 * Inválido → `undefined` (erro do editor, precisa de mensagem).
 */
function toCents(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Aceita os dois separadores decimais: brasileiro digita vírgula, quem copia
  // de site gringo cola ponto. Rejeitar um dos dois só geraria retrabalho.
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);

  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return undefined;

  // `Math.round` evita o clássico 4299.99 * 100 = 429998.99999999994.
  return Math.round(value * 100);
}
