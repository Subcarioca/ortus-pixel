'use client';

/**
 * =============================================================================
 * CLASSIFICAÇÃO DA MATÉRIA — sub-editoria, franquias, tags e sensibilidade
 * =============================================================================
 *
 * Este bloco de campos é IDÊNTICO em criar e editar, então ele é um componente
 * só — ao contrário dos formulários inteiros, que são dois de propósito (ver o
 * cabeçalho de `article-edit-form.tsx`). A régua que separa os dois casos: o que
 * diverge em COMPORTAMENTO fica separado; o que é literalmente o mesmo conjunto
 * de campos com as mesmas regras vira componente compartilhado.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ESTES QUATRO CAMPOS ESTAVAM FALTANDO, E O QUE ISSO CUSTAVA
 * -----------------------------------------------------------------------------
 * O formulário só perguntava a EDITORIA. Consequência silenciosa: toda matéria
 * criada pelo painel nascia sem franquia e sem tag, e o hub de franquia — que o
 * próprio schema chama de "motor de retenção do produto" — ficava vazio sem
 * ninguém perceber, porque hub vazio não dá erro.
 *
 * -----------------------------------------------------------------------------
 * DECISÕES DE INTERFACE
 * -----------------------------------------------------------------------------
 * 1. FRANQUIA É `<select multiple>`, e não uma lista de caixas de seleção. A
 *    lista de caixas fica melhor com 5 opções e insuportável com 60 — e a lista
 *    de franquias cresce com o site. O `multiple` nativo tem busca por digitação,
 *    rolagem e suporte a teclado de graça, sem nenhum JavaScript nosso.
 *
 * 2. TAG É TEXTO SEPARADO POR VÍRGULA, e não um seletor do que já existe. Tag é
 *    vocabulário de cauda longa ("Nintendo Direct", "vazamento"); um seletor
 *    exigiria cadastrar antes de usar, e o efeito conhecido disso é ninguém
 *    etiquetar nada. A normalização (o que impede "Vazamento" e "vazamento" de
 *    virarem duas tags) acontece no SERVIDOR, por `slugify` — ver
 *    `server/article-input.ts`.
 *
 * 3. A SENSIBILIDADE MOSTRA A CONSEQUÊNCIA, não só o nome do nível. Um
 *    `<select>` com três palavras faz escolher no chute; o que a pessoa precisa
 *    saber para acertar é o que acontece com a matéria depois.
 */

import {
  CONTENT_SENSITIVITY_HINTS,
  CONTENT_SENSITIVITY_LABELS,
  CONTENT_SENSITIVITY_LEVELS,
  SUBCATEGORIES,
  sensitivityRank,
  toContentSensitivity,
  type ContentSensitivity,
} from '@subcarioca/core';

export interface ArticleClassification {
  /** Slug da sub-editoria, ou string vazia para "nenhuma". */
  subcategorySlug: string;
  franchiseIds: string[];
  /** O texto cru do campo, como a pessoa digitou. Quem separa é o servidor. */
  tags: string;
  contentSensitivity: ContentSensitivity;
}

export interface FranchiseOption {
  id: string;
  name: string;
}

interface Props {
  /** Editoria escolhida no formulário-pai: filtra as sub-editorias possíveis. */
  categorySlug: string;
  value: ArticleClassification;
  onChange: (next: ArticleClassification) => void;
  franchises: FranchiseOption[];
  /**
   * Nível salvo hoje no banco. Só existe na EDIÇÃO — na criação não há valor
   * anterior, e portanto não há o que "reduzir".
   */
  savedSensitivity?: ContentSensitivity;
  /**
   * A conta logada pode AFROUXAR a classificação de conteúdo?
   *
   * Isto aqui é conforto, não proteção: quem recusa de verdade é a rota PATCH
   * (`canLowerSensitivity`, em core/staff.ts). Desabilitar a opção existe para
   * não oferecer uma ação que vai falhar — o mesmo princípio do `AdminNav`.
   */
  canLowerSensitivity: boolean;
}

export function ArticleClassificationFields({
  categorySlug,
  value,
  onChange,
  franchises,
  savedSensitivity = 'none',
  canLowerSensitivity,
}: Props) {
  const subcategories = SUBCATEGORIES.filter((s) => s.parent === categorySlug);
  const savedRank = sensitivityRank(savedSensitivity);

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Sub-editoria: só aparece quando a editoria escolhida tem alguma.  */}
      {/* Um `<select>` com a única opção "nenhuma" é ruído puro na tela.   */}
      {subcategories.length > 0 && (
        <label>
          Sub-editoria
          <select
            value={value.subcategorySlug}
            onChange={(event) => onChange({ ...value, subcategorySlug: event.target.value })}
          >
            <option value="">— nenhuma —</option>
            {subcategories.map((sub) => (
              <option key={sub.slug} value={sub.slug}>
                {sub.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* ---------------------------------------------------------------- */}
      <label>
        Franquias
        <select
          multiple
          size={5}
          value={value.franchiseIds}
          onChange={(event) =>
            onChange({
              ...value,
              // `selectedOptions` é a forma correta de ler um `multiple`; ler
              // `event.target.value` devolveria só a última opção clicada — o
              // bug clássico deste elemento.
              franchiseIds: [...event.target.selectedOptions].map((option) => option.value),
            })
          }
        >
          {franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>
              {franchise.name}
            </option>
          ))}
        </select>
        <span className="form-hint">
          Segure Ctrl (ou Cmd) para escolher mais de uma. É o que faz a matéria aparecer no
          hub da franquia — sem isso, ela só existe na editoria.
        </span>
      </label>

      {/* ---------------------------------------------------------------- */}
      <label className="admin-form__full">
        Tags
        <input
          value={value.tags}
          onChange={(event) => onChange({ ...value, tags: event.target.value })}
          maxLength={300}
          placeholder="Nintendo Direct, vazamento, Kojima"
        />
        <span className="form-hint">
          Separadas por vírgula, até 8. Acentos e maiúsculas não criam tag repetida —
          &ldquo;Vazamento&rdquo; e &ldquo;vazamento&rdquo; são a mesma.
        </span>
      </label>

      {/* ---------------------------------------------------------------- */}
      <label className="admin-form__full">
        Classificação do conteúdo
        <select
          value={value.contentSensitivity}
          onChange={(event) =>
            onChange({ ...value, contentSensitivity: toContentSensitivity(event.target.value) })
          }
        >
          {CONTENT_SENSITIVITY_LEVELS.map((level) => {
            // Sem permissão para afrouxar, os níveis ABAIXO do salvo ficam
            // desabilitados — e não escondidos. Escondidos, o campo pareceria
            // quebrado ("cadê a opção que eu vi ontem?"); desabilitados, a
            // pessoa vê que existe e entende que não é para ela.
            const bloqueado = !canLowerSensitivity && sensitivityRank(level) < savedRank;
            return (
              <option key={level} value={level} disabled={bloqueado}>
                {CONTENT_SENSITIVITY_LABELS[level]}
                {bloqueado ? ' — só administrador' : ''}
              </option>
            );
          })}
        </select>
        <span className="form-hint">{CONTENT_SENSITIVITY_HINTS[value.contentSensitivity]}</span>
      </label>
    </>
  );
}
