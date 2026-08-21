'use client';

/**
 * =============================================================================
 * "NOVA FRANQUIA" — o cadastro que não existia em lugar nenhum do produto
 * =============================================================================
 *
 * Antes desta tela, o catálogo de franquias vinha inteiro do seed. Cobrir um
 * jogo, um anime ou um universo que o seed não previu significava publicar a
 * matéria sem etiqueta (perdendo o hub `/franquia/x`, as relacionadas por
 * franquia e o botão de seguir) ou abrir o banco à mão.
 *
 * -----------------------------------------------------------------------------
 * FICA ABERTO POR PADRÃO, AO CONTRÁRIO DO "NOVA PAUTA"
 * -----------------------------------------------------------------------------
 * A escolha é oposta à de `topic-create-form.tsx`, e de propósito. Lá, o
 * formulário fica recolhido porque o uso DOMINANTE daquela página é ler a fila,
 * e um formulário sempre aberto empurraria a fila para baixo da dobra todo dia.
 * Aqui é o contrário: ninguém abre `/admin/franquias` para "ler o catálogo" —
 * abre para acrescentar uma franquia. Esconder atrás de um clique o único
 * motivo de a tela existir seria cerimônia pura.
 *
 * -----------------------------------------------------------------------------
 * O QUE ESTE FORMULÁRIO NÃO TEM, E POR QUÊ
 * -----------------------------------------------------------------------------
 *  - EDITAR E APAGAR. Não é esquecimento: mudar o slug de uma franquia quebra
 *    toda URL já indexada e todo link compartilhado; apagar leva junto os
 *    seguidores e o vínculo com matérias publicadas. São ações de consequência
 *    oposta à de criar, e merecem decisão própria (ver o comentário da
 *    capacidade `criarFranquia` em core/staff.ts).
 *  - IMAGEM DE CAPA E LOGO DO HUB. As colunas existem no schema
 *    (`heroImageUrl`, `logoUrl`) e são decisão de DESIGN sobre a página de hub,
 *    não de cadastro. Deixá-las nulas é o estado que o hub já sabe renderizar
 *    hoje; acrescentá-las aqui, sem o tratamento visual definido, produziria
 *    campo preenchido que a página ignora.
 *  - ÍNDICE DE AFINIDADE (`audienceAffinityIndex`). É calculado por job a partir
 *    de audiência real. Um campo de digitação para ele convidaria a inventar o
 *    número — o mesmo erro que a rota de pautas evita ao não inventar score.
 *
 * -----------------------------------------------------------------------------
 * A PRÉVIA DO ENDEREÇO NÃO É ENFEITE
 * -----------------------------------------------------------------------------
 * O slug entra na URL pública e é PERMANENTE na prática (ver acima). Mostrar
 * `/franquia/...` já resolvido enquanto a pessoa digita é o que transforma uma
 * decisão irreversível numa que ela consegue conferir ANTES de clicar. A
 * `slugify` usada aqui é literalmente a mesma função do servidor (`core`), o que
 * garante que a prévia não possa divergir do que será gravado.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { routes, slugify } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';

interface FranchiseCreateFormProps {
  categories: { slug: string; name: string }[];
}

export function FranchiseCreateForm({ categories }: FranchiseCreateFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [primaryCategorySlug, setPrimaryCategorySlug] = useState(categories[0]?.slug ?? '');
  const [aliases, setAliases] = useState('');
  const [description, setDescription] = useState('');

  /**
   * O slug efetivo: o digitado, quando existe; o derivado do nome, quando não.
   *
   * A MESMA regra da rota — e é por isso que ela está escrita assim, e não como
   * "preencher o campo automaticamente ao digitar o nome". Preenchimento
   * automático cria um terceiro estado ("o usuário mexeu no campo?") que o
   * servidor não conhece, e é dele que nascem as divergências entre o que a
   * tela mostra e o que o banco grava.
   */
  const effectiveSlug = slugify(slug.trim() || name);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/franchises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          primaryCategorySlug,
          // A rota aceita string com vírgulas OU array; mandamos a string crua
          // e deixamos a normalização (recorte, vazio, repetido, teto) num lugar
          // só — o servidor, que é quem precisa garanti-la de qualquer forma.
          aliases,
          description,
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      if (data.ok) {
        // Limpa só no sucesso. Em qualquer falha — inclusive "já existe uma
        // franquia com esse endereço" — o que foi digitado continua na tela.
        setName('');
        setSlug('');
        setAliases('');
        setDescription('');
        router.refresh();
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. A franquia não foi criada.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="admin-form admin-form--cols"
      aria-label="Cadastrar franquia"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        Nome da franquia
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={120}
          placeholder="The Legend of Zelda"
        />
        <span className="form-hint">É o nome que aparece no chip da matéria e no hub.</span>
      </label>

      <label>
        Endereço (slug)
        <input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          maxLength={80}
          placeholder="zelda"
        />
        <span className="form-hint">
          {effectiveSlug.length >= 2 ? (
            <>
              Vai responder em <code>{routes.franchise(effectiveSlug)}</code>. Deixe em branco
              para usar o nome. ⚠ O endereço não pode ser trocado depois — links compartilhados
              e a posição no Google dependem dele.
            </>
          ) : (
            'Deixe em branco para derivar do nome. Só letras sem acento, números e hífen.'
          )}
        </span>
      </label>

      <label>
        Editoria principal
        <select
          value={primaryCategorySlug}
          onChange={(event) => setPrimaryCategorySlug(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <span className="form-hint">
          Obrigatória. Franquia que atravessa mídias (Star Wars em Cinema e em Games) escolhe a
          editoria de ORIGEM — a matéria continua podendo sair em qualquer editoria.
        </span>
      </label>

      <label>
        Outros nomes (aliases)
        <input
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          placeholder="Zelda, TLOZ, Breath of the Wild"
        />
        <span className="form-hint">
          Separados por vírgula. É por eles que o pipeline reconhece a franquia quando a notícia
          usa a abreviação em vez do nome completo.
        </span>
      </label>

      <label className="admin-form__full">
        Descrição (opcional)
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={600}
          placeholder="Uma ou duas frases sobre o universo. Aparece no hub da franquia."
        />
      </label>

      <div className="admin-form__full admin-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Cadastrando…' : 'Cadastrar franquia'}
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
