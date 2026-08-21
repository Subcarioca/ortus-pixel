import 'server-only';

/**
 * =============================================================================
 * VALIDAÇÃO DO FORMULÁRIO DE MATÉRIA — uma implementação, dois endpoints
 * =============================================================================
 *
 * CRIAR (`POST /api/admin/topics/[id]`, ação `create-article`) e EDITAR
 * (`PATCH /api/admin/articles/[id]`) recebem exatamente o mesmo formulário e
 * gravam exatamente os mesmos campos. As regras estavam duplicadas linha a
 * linha nos dois arquivos.
 *
 * POR QUE ISSO PRECISAVA VIRAR UM MÓDULO SÓ: uma regra de validação duplicada
 * envelhece pela metade. Basta apertar o limite de um campo em um dos lados
 * para abrir um caminho em que o editor NÃO consegue criar a matéria mas
 * CONSEGUE editá-la para o mesmo estado recusado — e ninguém percebe, porque os
 * dois caminhos são testados em momentos diferentes.
 *
 * Note que os FORMULÁRIOS continuam sendo dois componentes separados (ver o
 * cabeçalho de `article-edit-form.tsx`): o que se unifica aqui é a REGRA, não a
 * interface. Regra igual, tela diferente.
 *
 * As mensagens dizem qual campo reprovou e por quê. A mensagem única anterior
 * ("título (8-180), resumo (20-300) e corpo (mín. 40) são obrigatórios")
 * aparecia até para um corpo LONGO DEMAIS — o editor lia "mínimo 40" depois de
 * escrever três mil palavras e não tinha como adivinhar o que fazer.
 */

import { prisma } from '@subcarioca/db';
import {
  CONTENT_FORMATS,
  blocksToPlainText,
  can,
  isCategorySlug,
  isValidSubcategoryPath,
  scanArticleForRisk,
  slugify,
  toContentSensitivity,
  validateTldrRequirement,
  type ArticleBlock,
  type ContentFormat,
  type ContentSensitivity,
  type EditorialRiskFinding,
} from '@subcarioca/core';

import { ALLOWED_IMAGE_HOSTS_LABEL } from '@/lib/image-hosts';
import { safeImageUrl } from '@/lib/safe-url';
import { parseBlocksInput } from './blocks-input';
import type { StaffUser } from './staff-auth';

export interface ArticleInput {
  title: string;
  excerpt: string;
  /**
   * Corpo em texto. Quando há blocos, é a PROJEÇÃO deles em texto puro, montada
   * aqui pelo servidor — nunca o que o cliente mandou. Ver o comentário da
   * coluna `content` no schema para o motivo de ela continuar existindo.
   */
  content: string;
  /** Corpo em blocos. Vazio = matéria em Markdown (acervo antigo ou escolha). */
  blocks: ArticleBlock[];
  format: ContentFormat;
  tldr: string[];
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  isBreaking: boolean;
  hasSpoiler: boolean;
  /**
   * Classificação de sensibilidade. Ver `core/content-sensitivity.ts` — e a
   * regra de PERMISSÃO para baixá-la, que NÃO é aplicada aqui: ela depende do
   * valor anterior da linha, que só a rota de edição conhece.
   */
  contentSensitivity: ContentSensitivity;
  category: { id: string; slug: string };
  /**
   * Sub-categoria já resolvida (id do banco). `null` é o caso normal: a maioria
   * das matérias vive direto na editoria.
   */
  subcategoryId: string | null;
  /**
   * Franquias vinculadas, já conferidas contra o banco. É a etiquetagem que
   * alimenta os hubs de fandom — o motor de retenção do produto.
   */
  franchiseIds: string[];
  /**
   * Tags como par (slug, nome). Ainda NÃO existem no banco necessariamente: a
   * criação da linha em `Tag` acontece na transação de quem grava a matéria.
   */
  tags: { slug: string; name: string }[];
  authorId: string;
  publish: boolean;
  /**
   * Trechos de risco jurídico/reputacional encontrados no texto FINAL.
   *
   * Note que isto NÃO reprova o formulário: `parseArticleInput` continua
   * respondendo `ok: true` com a lista preenchida. A separação é proposital —
   * validar é dizer "este dado não pode ser gravado"; aqui a resposta é "este
   * texto merece um segundo olhar", que é decisão editorial, não de esquema.
   *
   * Quem decide o que fazer com a lista é o portão (`editorial-risk-gate.ts`),
   * chamado pelas rotas: só elas sabem se a operação é publicar ou rascunhar, e
   * só elas escrevem em `AuditLog`.
   */
  riskFindings: EditorialRiskFinding[];
}

/**
 * TETOS DA ETIQUETAGEM.
 *
 * Não são números redondos por acaso, e o motivo de existirem é editorial antes
 * de ser técnico: uma matéria etiquetada com quinze franquias não está
 * etiquetada — ela está pedindo para aparecer em quinze hubs, o que esvazia o
 * significado de aparecer em qualquer um. O limite obriga a escolher, e escolher
 * é o trabalho.
 *
 * (O teto técnico também importa: cada vínculo é uma linha em tabela de junção
 * reescrita a cada salvamento.)
 */
const MAX_FRANCHISES = 6;
const MAX_TAGS = 8;

export type ArticleInputResult =
  | { ok: true; data: ArticleInput }
  | { ok: false; message: string };

/**
 * Valida o payload e resolve categoria e autor no banco.
 *
 * Assíncrona porque as duas últimas checagens dependem de consulta: o formulário
 * é montado com as opções existentes no momento em que a tela abriu, e uma
 * categoria ou autor podem ter sumido entre abrir e salvar. Sem essas consultas,
 * o erro só apareceria como violação de chave estrangeira — que vira 500 e não
 * diz nada a quem está do outro lado da tela.
 */
export async function parseArticleInput(
  payload: Record<string, unknown>,
  viewer: StaffUser,
): Promise<ArticleInputResult> {
  const title = boundedText(payload.title, 8, 180);
  if ('error' in title) return fail(`O título ${title.error}`);

  const excerpt = boundedText(payload.excerpt, 20, 300);
  if ('error' in excerpt) return fail(`O resumo ${excerpt.error}`);

  /**
   * O CORPO PODE VIR DE DOIS LUGARES, E SÓ UM DELES É A FONTE DA VERDADE.
   *
   * Com blocos, `content` é DERIVADO deles (`blocksToPlainText`) e o que o
   * cliente mandou nesse campo é ignorado. Não é excesso de zelo: aceitar os
   * dois independentes criaria matérias em que o texto indexado pela busca não é
   * o texto que está na tela — e ninguém descobriria, porque as duas coisas
   * nunca são vistas juntas.
   */
  const parsedBlocks = parseBlocksInput(payload.blocks);
  if (!parsedBlocks.ok) return fail(parsedBlocks.message);
  const blocks = parsedBlocks.blocks;

  const rawContent = blocks.length > 0 ? blocksToPlainText(blocks) : payload.content;

  const content = boundedText(rawContent, 40, 20_000);
  if ('error' in content) {
    return fail(
      blocks.length > 0
        ? // Com blocos, o limite mínimo não é sobre um campo que a pessoa vê —
          // dizer "o corpo precisa de 40 caracteres" mandaria o redator procurar
          // um campo que não existe mais na tela.
          'A matéria está curta demais. Escreva ao menos um parágrafo de verdade antes de salvar.'
        : `O corpo da matéria ${content.error}`,
    );
  }

  const categorySlug = typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
  if (!isCategorySlug(categorySlug)) {
    return fail('Categoria inválida.');
  }

  /**
   * QUEM ASSINA A MATÉRIA.
   *
   * Um redator NÃO escolhe: ele assina o que escreve, e o campo do formulário
   * dele vem travado. A imposição acontece AQUI, no servidor, e não no `<select>`
   * — porque o `<select>` é do navegador dele, e um navegador não é um lugar
   * onde se aplica regra de permissão. Sem esta linha, bastaria trocar o valor
   * no devtools para publicar em nome de outra pessoa.
   */
  const requestedAuthorId =
    typeof payload.authorId === 'string' && /^[a-z0-9]{10,40}$/i.test(payload.authorId)
      ? payload.authorId
      : null;

  const authorId = can(viewer.accessLevel, 'atribuirOutroAutor')
    ? requestedAuthorId
    : viewer.id;

  if (!authorId) return fail('Selecione um autor.');

  // O formato vem de um `<select>` fechado; um valor fora da lista só chega por
  // requisição forjada, e cair no padrão é resposta suficiente para isso.
  const format: ContentFormat = CONTENT_FORMATS.includes(payload.format as ContentFormat)
    ? (payload.format as ContentFormat)
    : 'breaking';

  const tldr = Array.isArray(payload.tldr)
    ? payload.tldr
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
    : [];

  const tldrCheck = validateTldrRequirement(format, tldr);
  // `message` é opcional na assinatura (só existe quando reprova), então o
  // fallback é uma exigência do tipo, não um caso esperado.
  if (!tldrCheck.valid) return fail(tldrCheck.message ?? 'TL;DR inválido para este formato.');

  // Capa: campo opcional. Vazio é ausência de imagem, não erro.
  let coverImageUrl: string | null = null;
  if (typeof payload.coverImageUrl === 'string' && payload.coverImageUrl.trim().length > 0) {
    const image = safeImageUrl(payload.coverImageUrl);
    if (!image.href) {
      return fail(
        image.reason === 'host'
          ? `A imagem de capa precisa estar hospedada em um domínio autorizado (${ALLOWED_IMAGE_HOSTS_LABEL}). ` +
              'Publicar com outro domínio derruba a página da matéria e a home. ' +
              'Suba a imagem para o nosso servidor de imagens e cole a URL de lá.'
          : 'A URL da imagem de capa é inválida. Ela precisa começar com https://.',
      );
    }
    coverImageUrl = image.href;
  }

  const coverImageAlt =
    typeof payload.coverImageAlt === 'string' && payload.coverImageAlt.trim().length > 0
      ? payload.coverImageAlt.trim().slice(0, 200)
      : null;

  /**
   * SUB-CATEGORIA — validada como PAR, nunca sozinha.
   *
   * `isValidSubcategoryPath` recusa "hardware dentro de games" mesmo sendo
   * 'hardware' um slug real. Sem essa checagem, a matéria seria gravada com uma
   * sub-categoria de outra editoria e a URL /categoria/games/hardware passaria a
   * existir com conteúdo — exatamente o caso de conteúdo duplicado que
   * `isValidSubcategoryPath` foi escrito para impedir na leitura.
   */
  const rawSubcategory =
    typeof payload.subcategorySlug === 'string' && payload.subcategorySlug.trim().length > 0
      ? payload.subcategorySlug.trim()
      : null;

  if (rawSubcategory && !isValidSubcategoryPath(categorySlug, rawSubcategory)) {
    return fail('A sub-editoria escolhida não pertence a esta editoria. Escolha outra.');
  }

  /**
   * FRANQUIAS. Ids vindos de `<select multiple>` — ou seja, do navegador, ou
   * seja, hostis. Filtramos pelo formato antes de consultar e conferimos a
   * EXISTÊNCIA no banco depois: um id inventado que passasse daqui viraria
   * violação de chave estrangeira, que chega à tela como 500 sem explicação.
   */
  const franchiseIds = Array.isArray(payload.franchiseIds)
    ? [
        ...new Set(
          payload.franchiseIds.filter(
            (v): v is string => typeof v === 'string' && /^[a-z0-9]{10,40}$/i.test(v),
          ),
        ),
      ].slice(0, MAX_FRANCHISES)
    : [];

  /**
   * TAGS — texto livre digitado pelo redator, separado por vírgula.
   *
   * POR QUE TEXTO LIVRE, e não um seletor do que já existe: tag é vocabulário
   * de cauda longa ("Nintendo Direct", "vazamento", "Kojima"). Um seletor
   * obrigaria a cadastrar antes de usar, e o efeito prático conhecido disso é
   * ninguém etiquetar nada. O custo é o risco de "vazamento" e "Vazamentos"
   * virarem duas tags — que é justamente o que o `slugify` resolve: a
   * IDENTIDADE da tag é o slug, e o nome digitado é só a apresentação da
   * primeira vez que ela aparece.
   */
  const rawTags = Array.isArray(payload.tags)
    ? payload.tags
    : typeof payload.tags === 'string'
      ? payload.tags.split(',')
      : [];

  const tagMap = new Map<string, string>();
  for (const raw of rawTags) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().slice(0, 40);
    if (name.length < 2) continue;
    const slug = slugify(name);
    // Um nome só de emoji ou pontuação vira slug vazio: descartado em silêncio,
    // porque recusar a matéria inteira por causa de uma tag esquisita seria uma
    // reação desproporcional a um campo opcional.
    if (slug.length === 0) continue;
    if (!tagMap.has(slug)) tagMap.set(slug, name);
    if (tagMap.size >= MAX_TAGS) break;
  }

  const tags = [...tagMap].map(([slug, name]) => ({ slug, name }));

  const [category, author, subcategory, existingFranchises] = await Promise.all([
    prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true, slug: true } }),
    prisma.author.findUnique({ where: { id: authorId }, select: { id: true } }),
    rawSubcategory
      ? prisma.subcategory.findFirst({ where: { slug: rawSubcategory }, select: { id: true } })
      : Promise.resolve(null),
    franchiseIds.length > 0
      ? prisma.franchise.findMany({ where: { id: { in: franchiseIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  if (!category) return fail('Categoria não encontrada. Recarregue a página e escolha outra.');
  if (!author) return fail('Autor não encontrado. Recarregue a página e escolha outro.');

  // A sub-categoria existe na taxonomia do código mas não no banco: é o sintoma
  // de um seed desatualizado, e o remédio é uma mensagem que diga isso a quem
  // está do outro lado — não uma FK estourando na gravação.
  if (rawSubcategory && !subcategory) {
    return fail(
      'Esta sub-editoria ainda não existe no banco. Rode o seed das editorias ou escolha outra.',
    );
  }

  // Franquia que sumiu entre abrir o formulário e salvar é DESCARTADA em
  // silêncio, e não motivo de recusa: perder um vínculo é menos grave do que
  // recusar uma matéria pronta às 23h por causa de uma etiqueta.
  const validFranchiseIds = existingFranchises.map((f) => f.id);

  return {
    ok: true,
    data: {
      title: title.value,
      excerpt: excerpt.value,
      content: content.value,
      blocks,
      format,
      tldr,
      coverImageUrl,
      coverImageAlt,
      isBreaking: payload.isBreaking === true,
      hasSpoiler: payload.hasSpoiler === true,
      // Valor fora do vocabulário cai em 'none' (ver `toContentSensitivity`). A
      // trava que importa aqui NÃO é esta: é `canLowerSensitivity`, aplicada na
      // rota de edição, que é a única que conhece o valor anterior.
      contentSensitivity: toContentSensitivity(payload.contentSensitivity),
      category,
      subcategoryId: subcategory?.id ?? null,
      franchiseIds: validFranchiseIds,
      tags,
      authorId: author.id,
      publish: payload.publish === true,
      /**
       * A VARREDURA ACONTECE AQUI, e o lugar não é acidental.
       *
       * Este é o ponto em que o texto já passou por todas as normalizações e é
       * exatamente o que vai para o banco: o título aparado, o resumo aparado e
       * o corpo que, havendo blocos, foi DERIVADO deles pelo servidor — nunca o
       * `content` que o cliente mandou. Varrer antes disso examinaria um texto
       * que não é o publicado; varrer na rota exigiria repetir a montagem nos
       * dois endpoints, com o risco de um deles esquecer os blocos.
       *
       * Consequência prática e desejada: legenda de imagem e citação, que só
       * existem dentro dos blocos, entram na varredura sem que este módulo
       * precise saber o que é um bloco.
       */
      riskFindings: scanArticleForRisk({
        title: title.value,
        excerpt: excerpt.value,
        content: content.value,
      }),
    },
  };
}

function fail(message: string): ArticleInputResult {
  return { ok: false, message };
}

/**
 * Texto obrigatório com limites. Devolve o motivo exato da reprovação —
 * "faltou", "curto demais" e "longo demais" pedem reações diferentes de quem
 * está escrevendo.
 */
function boundedText(
  value: unknown,
  min: number,
  max: number,
): { value: string } | { error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { error: 'é obrigatório.' };
  }

  const trimmed = value.trim();
  if (trimmed.length < min) {
    return { error: `precisa ter pelo menos ${min} caracteres (tem ${trimmed.length}).` };
  }
  if (trimmed.length > max) {
    return {
      error: `passa do limite de ${max.toLocaleString('pt-BR')} caracteres (tem ${trimmed.length.toLocaleString('pt-BR')}).`,
    };
  }

  return { value: trimmed };
}
