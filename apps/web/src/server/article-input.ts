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
  isCategorySlug,
  validateTldrRequirement,
  type ContentFormat,
} from '@subcarioca/core';

import { ALLOWED_IMAGE_HOSTS_LABEL } from '@/lib/image-hosts';
import { safeImageUrl } from '@/lib/safe-url';

export interface ArticleInput {
  title: string;
  excerpt: string;
  content: string;
  format: ContentFormat;
  tldr: string[];
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  isBreaking: boolean;
  hasSpoiler: boolean;
  category: { id: string; slug: string };
  authorId: string;
  publish: boolean;
}

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
): Promise<ArticleInputResult> {
  const title = boundedText(payload.title, 8, 180);
  if ('error' in title) return fail(`O título ${title.error}`);

  const excerpt = boundedText(payload.excerpt, 20, 300);
  if ('error' in excerpt) return fail(`O resumo ${excerpt.error}`);

  const content = boundedText(payload.content, 40, 20_000);
  if ('error' in content) return fail(`O corpo da matéria ${content.error}`);

  const categorySlug = typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
  if (!isCategorySlug(categorySlug)) {
    return fail('Categoria inválida.');
  }

  const authorId =
    typeof payload.authorId === 'string' && /^[a-z0-9]{10,40}$/i.test(payload.authorId)
      ? payload.authorId
      : null;
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

  const [category, author] = await Promise.all([
    prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true, slug: true } }),
    prisma.author.findUnique({ where: { id: authorId }, select: { id: true } }),
  ]);

  if (!category) return fail('Categoria não encontrada. Recarregue a página e escolha outra.');
  if (!author) return fail('Autor não encontrado. Recarregue a página e escolha outro.');

  return {
    ok: true,
    data: {
      title: title.value,
      excerpt: excerpt.value,
      content: content.value,
      format,
      tldr,
      coverImageUrl,
      coverImageAlt,
      isBreaking: payload.isBreaking === true,
      hasSpoiler: payload.hasSpoiler === true,
      category,
      authorId: author.id,
      publish: payload.publish === true,
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
