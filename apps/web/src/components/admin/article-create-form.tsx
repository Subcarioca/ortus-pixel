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
 *
 * -----------------------------------------------------------------------------
 * ESTE MESMO FORMULÁRIO É O DA SUGESTÃO POR IA
 * -----------------------------------------------------------------------------
 * Quando `aiDraft` chega preenchido, os campos nascem com o texto gerado e o
 * resto é idêntico: os mesmos campos editáveis, os mesmos botões, a mesma
 * validação, o mesmo fluxo de publicação. Não existe "tela da IA".
 *
 * A decisão é do dono do produto e vale a pena entender por quê: uma segunda
 * tela para revisar texto gerado viraria, na prática, uma tela de aprovar —
 * onde se clica em "ok" sem ler. Entregando o rascunho DENTRO do formulário de
 * sempre, o gesto seguinte do redator é o de sempre (escrever, ajustar,
 * publicar), e a revisão acontece porque ele já está com as mãos no texto.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ArticleBlock } from '@subcarioca/core';

import { readAdminResponse } from './admin-response';
import {
  EditorialRiskPanel,
  readEditorialRiskReview,
  type EditorialRiskReview,
} from './editorial-risk-panel';
import {
  ArticleClassificationFields,
  type ArticleClassification,
  type FranchiseOption,
} from './article-classification-fields';
import { FORMAT_OPTIONS, formatRequiresTldr } from './article-format-options';
import { BlockEditor } from './block-editor';
import { CoverImageFitField, type CoverImageFitValue } from './cover-image-fit-field';
import { ImageUrlField } from './image-url-field';

/**
 * O tipo vem do módulo de servidor — mas só o TIPO.
 *
 * `import type` é apagado na compilação: nenhuma linha de `ai-draft.ts` (que lê
 * a chave da API) entra no pacote do navegador. Importar o tipo de lá, em vez de
 * redeclarar a mesma forma aqui, é o que garante que uma mudança no rascunho
 * gerado quebre o build em vez de silenciosamente deixar um campo para trás.
 */
import type { AiDraft } from '@/server/ai-draft';

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
  /**
   * Rascunho gerado por modelo de linguagem, quando houver.
   *
   * `null`/ausente é o caso normal: o botão "Criar matéria" de sempre abre o
   * formulário vazio. Preenchido, ele SEMEIA os campos — e nada mais. Não trava
   * botão, não muda validação, não muda o que é enviado ao servidor (além da
   * marca de procedência). Ver o cabeçalho deste arquivo.
   */
  aiDraft?: AiDraft | null;
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
  aiDraft = null,
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
  /**
   * O TL;DR gerado entra completando as três linhas de sempre.
   *
   * Nunca MENOS de três: o formato 'breaking' (o padrão deste formulário) exige
   * de 3 a 5 pontos, e um formulário que nasce com duas linhas preenchidas e
   * nenhuma vazia esconde do redator o campo que vai reprovar o salvamento.
   */
  const [tldr, setTldr] = useState<string[]>(() => seedTldr(aiDraft?.tldr));
  const [blocks, setBlocks] = useState<ArticleBlock[]>(aiDraft?.blocks ?? []);
  /**
   * A CAPA NÃO É GERADA — e isso é decisão do dono do produto, não limitação.
   *
   * A funcionalidade de sugestão é só de TEXTO: a imagem continua sendo escolha
   * humana, por upload ou URL, nos campos logo abaixo. Nada aqui preenche capa,
   * e nenhum bloco de imagem vem do modelo (ver `parseDraftPayload`).
   */
  const [coverImageUrl, setCoverImageUrl] = useState('');
  /**
   * ENQUADRAMENTO DA CAPA — 'cover' é o padrão, igual ao que a matéria sempre
   * teve (ver `@/lib/cover-image`). Uma matéria NOVA não tem "aparência de
   * sempre" para preservar, mas o padrão continua sendo o mesmo por
   * consistência: o `<select>` de formato, de sensibilidade e este aqui
   * abrem todos no valor mais comum, não no mais "completo".
   */
  const [coverImageFit, setCoverImageFit] = useState<CoverImageFitValue>({
    fit: 'cover',
    focalX: null,
    focalY: null,
  });

  /**
   * REVISÃO DE RISCO EDITORIAL — o mesmo painel da edição
   * (`editorial-risk-panel.tsx`), pela mesma razão pela qual a regra é uma só no
   * servidor.
   *
   * Aqui só existe o modo BLOQUEANTE, e não o aviso passivo de rascunho que o
   * formulário de edição tem. O motivo é do fluxo desta tela: salvar rascunho
   * aqui já CRIA a matéria e marca o tópico como coberto, então o formulário
   * precisa fechar — reenviá-lo bateria em "este tópico já virou matéria". Os
   * avisos reaparecem na edição, que é onde o texto continua a ser trabalhado.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const [riskReview, setRiskReview] = useState<EditorialRiskReview | null>(null);
  const [riskReason, setRiskReason] = useState('');

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
  //
  // Com rascunho gerado, ele nasce com a MESMA matéria em texto corrido que está
  // nos blocos. Parece redundante e não é: se o redator apagar todos os blocos,
  // este campo reaparece na tela — e reaparecer vazio jogaria fora o texto
  // gerado. O servidor ignora este valor enquanto houver blocos.
  const [content, setContent] = useState(aiDraft?.content ?? '');

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

  /** Ver o mesmo parâmetro em `article-edit-form.tsx`: só vem `true` no clique
   *  de "Publicar mesmo assim", depois de o painel ter mostrado os trechos. */
  async function submit(formEl: HTMLFormElement, publish: boolean, acknowledgeRisk = false) {
    if (busy) return;

    const form = new FormData(formEl);

    setBusy(publish ? 'publish' : 'draft');
    setMessage(null);
    // Não limpa quando o reenvio É o reconhecimento — ver o comentário
    // equivalente, mais longo, em `article-edit-form.tsx`.
    if (!acknowledgeRisk) setRiskReview(null);

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
          coverImageFit: coverImageFit.fit,
          coverImageFocalX: coverImageFit.focalX,
          coverImageFocalY: coverImageFit.focalY,
          isBreaking: form.get('isBreaking') === 'on',
          hasSpoiler: form.get('hasSpoiler') === 'on',
          // --- Classificação (ver `article-classification-fields.tsx`) ---
          subcategorySlug: classification.subcategorySlug || null,
          franchiseIds: classification.franchiseIds,
          tags: classification.tags,
          contentSensitivity: classification.contentSensitivity,
          /**
           * PROCEDÊNCIA DO TEXTO INICIAL.
           *
           * Vai no envio (e não é deduzida no servidor) porque só esta tela sabe
           * de onde o texto veio: a rota recebe um formulário igual nos dois
           * casos. A marca acompanha a matéria mesmo que o redator reescreva
           * tudo — a pergunta que ela responde é "como este texto NASCEU?".
           */
          contentOrigin: aiDraft ? 'ai-assisted' : 'human',
          publish,
          acknowledgeEditorialRisk: acknowledgeRisk,
          editorialRiskReason: acknowledgeRisk ? riskReason : undefined,
        }),
      });

      const data = await readAdminResponse(response);
      setMessage(data.message);

      // Publicação interrompida para revisão — não é erro, e o tópico continua
      // na fila: o portão roda ANTES de a matéria ser criada (ver a rota).
      const review = readEditorialRiskReview(data);
      if (review) {
        setRiskReview(review);
        return;
      }

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
      ref={formRef}
      className="admin-form admin-form--cols"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget, false);
      }}
      aria-label="Transformar tópico em matéria"
    >
      {/* ---------- AVISO DE PROCEDÊNCIA ---------- */}
      {/* Fica no TOPO do formulário, e não como uma etiqueta discreta ao lado do
          botão: quem abre esta tela precisa saber, antes de ler a primeira
          linha, que o texto abaixo não foi apurado por ninguém. A lista de
          pendências vem junto porque é a informação mais acionável da tela —
          é literalmente a pauta de apuração daquela matéria. */}
      {aiDraft && (
        <div className="admin-form__full admin-row__warning" role="status">
          <strong>Rascunho gerado por IA a partir dos dados da pauta.</strong> Revise tudo antes de
          publicar: confira os fatos na fonte, ajuste o texto e escolha a imagem — a geração não
          apura nada e não busca imagem. Modelo: {aiDraft.model}.
          {aiDraft.pendencias.length > 0 && (
            <>
              <p className="form-hint">O próprio gerador apontou o que falta confirmar:</p>
              <ul className="side-list">
                {aiDraft.pendencias.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <label className="admin-form__full">
        Título
        <input
          name="title"
          required
          minLength={8}
          maxLength={180}
          // O título gerado vence o do tópico quando existe. Continua sendo um
          // `defaultValue` (campo não controlado): o redator digita por cima sem
          // nenhuma interferência de estado.
          defaultValue={aiDraft?.title ?? defaultTitle}
        />
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

      <CoverImageFitField
        imageUrl={coverImageUrl}
        value={coverImageFit}
        onChange={setCoverImageFit}
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
          defaultValue={aiDraft?.excerpt ?? defaultExcerpt}
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

      {/* Junto dos botões, e não no topo — ver o comentário equivalente em
          `article-edit-form.tsx`. */}
      {riskReview && (
        <EditorialRiskPanel
          findings={riskReview.findings}
          mode="decisao"
          requiresReason={riskReview.requiresReason}
          reason={riskReason}
          onReasonChange={setRiskReason}
          busy={busy !== null}
          onBackToEdit={() => {
            setRiskReview(null);
            setMessage(null);
          }}
          onPublishAnyway={() => {
            if (formRef.current) void submit(formRef.current, true, true);
          }}
        />
      )}

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

/**
 * Estado inicial do TL;DR: o que o gerador trouxe, completado até três linhas.
 *
 * As linhas vazias importam. O campo é uma lista de `<input>`s renderizada a
 * partir do estado — sem as vazias, um rascunho que veio com dois pontos
 * mostraria dois campos, e o redator só descobriria a exigência de três ao ver
 * o salvamento reprovar. Completar a lista transforma a regra em algo visível
 * antes do erro.
 */
function seedTldr(generated?: string[]): string[] {
  const pontos = (generated ?? []).filter((item) => item.trim().length > 0).slice(0, 5);
  while (pontos.length < 3) pontos.push('');
  return pontos;
}
