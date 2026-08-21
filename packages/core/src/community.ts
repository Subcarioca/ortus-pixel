/**
 * =============================================================================
 * COMUNIDADE — conta do leitor com identidade social
 * =============================================================================
 *
 * DECISÃO DE PRODUTO: comentário (e qualquer ação que exija identidade — seguir,
 * curtir/descurtir) exige login social. Não existe comentário anônimo nem por
 * e-mail.
 *
 * O motivo é operacional, não ideológico. O README já registrava que "moderação
 * é custo operacional real". Com comentário anônimo, o custo é ILIMITADO: um
 * único script posta mil mensagens em uma hora e alguém da redação precisa
 * limpar isso à mão. Com login social:
 *   - o atacante precisa de contas reais nos provedores (caras de fabricar em
 *     escala, e todos já pagam o custo do antiabuso por nós);
 *   - banir uma conta é uma ação com efeito duradouro, não um jogo de gato e
 *     rato com IP;
 *   - o leitor não precisa criar mais uma senha — atrito menor que o de um
 *     cadastro próprio, com moderação muito mais barata.
 *
 * POR QUE CINCO PROVEDORES, e não só um: cada um cobre um pedaço do público que
 * os outros não cobrem — Discord é onde o fandom nerd já vive; boa parte do
 * público mobile brasileiro não usa Discord no celular e tem sessão do Google
 * sempre aberta; Facebook e Instagram seguem sendo, isoladamente, as redes com
 * maior penetração no Brasil (inclusive fora do público jovem); X é onde a
 * conversa em tempo real sobre cultura pop/geek acontece. Oferecer só um ou
 * dois é escolher, por omissão, qual fatia do público comenta.
 *
 * ⚠ INSTAGRAM É UM CASO À PARTE — leia antes de mexer em `oauth.ts`: a "Instagram
 * Basic Display API" (o caminho óbvio para login simples) foi DESCONTINUADA pela
 * Meta em dezembro de 2024. O caminho atual ("Instagram API with Instagram
 * Login") é desenhado para contas Business/Creator vinculadas a uma Página do
 * Facebook — um leitor com conta pessoal comum de Instagram pode não conseguir
 * completar o login. Isto é uma limitação REAL da plataforma, não uma escolha
 * deste projeto: mantemos o provedor porque parte do público (inclusive da
 * própria redação) já usa conta Business/Creator, mas ele não substitui os
 * demais como porta de entrada universal.
 *
 * LGPD — MINIMIZAÇÃO DE DADOS (o princípio que rege todo este arquivo):
 * guardamos o MÍNIMO necessário para a funcionalidade existir. A regra vale
 * IGUAL para os cinco provedores — nenhum pede e-mail, nenhum guarda token.
 *
 *   Dado do provedor      | Guardamos?          | Por quê
 *   ----------------------|---------------------|------------------------------
 *   ID da conta           | Só o HASH           | Só precisamos RECONHECER que é
 *                         |                     | a mesma pessoa. O valor bruto
 *                         |                     | permitiria cruzar o leitor com
 *                         |                     | outras bases — não precisamos
 *                         |                     | disso, então não guardamos.
 *   Nome de exibição      | Sim, em claro       | Aparece publicamente no
 *                         |                     | comentário. É a finalidade.
 *   Avatar (URL)          | Sim, opcional       | Idem. Nunca baixamos a imagem.
 *   E-mail                | Só o HASH           | Serve só para bloquear
 *                         |                     | reincidente que cria conta
 *                         |                     | nova no outro provedor.
 *   Token de acesso OAuth | NÃO                 | Usamos uma vez, para ler o
 *                         |                     | perfil, e descartamos. Guardar
 *                         |                     | token é guardar acesso à conta
 *                         |                     | alheia — risco enorme, valor
 *                         |                     | zero para nós.
 */

/** Provedores de identidade aceitos. Lista fechada: valida entrada de URL. */
export const COMMENT_PROVIDERS = ['discord', 'google', 'facebook', 'x', 'instagram'] as const;

export type CommentProvider = (typeof COMMENT_PROVIDERS)[number];

export function isCommentProvider(value: unknown): value is CommentProvider {
  return typeof value === 'string' && COMMENT_PROVIDERS.includes(value as CommentProvider);
}

export const COMMENT_PROVIDER_LABELS: Record<CommentProvider, string> = {
  discord: 'Discord',
  google: 'Google',
  facebook: 'Facebook',
  x: 'X',
  instagram: 'Instagram',
};

/**
 * Estados de moderação.
 *
 * 'pending'  — aguardando aprovação (só o autor vê o próprio comentário).
 * 'approved' — público.
 * 'rejected' — removido pela moderação. A LINHA É MANTIDA, com o conteúdo
 *              preservado: sem ela, não há como auditar uma remoção contestada
 *              nem identificar reincidência. Simplesmente não é renderizada.
 * 'spam'     — separado de 'rejected' de propósito: são decisões diferentes
 *              ("isso é lixo automatizado" x "isso viola a regra da casa") e
 *              medi-las juntas esconderia um ataque de spam em andamento.
 */
export const COMMENT_STATUSES = ['pending', 'approved', 'rejected', 'spam'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export function toCommentStatus(value: unknown): CommentStatus {
  // FALHA SEGURA: valor desconhecido nunca vira 'approved'. Errar para
  // 'pending' esconde um comentário legítimo (recuperável em um clique); errar
  // para 'approved' publica algo não revisado (irrecuperável — já foi lido).
  return COMMENT_STATUSES.includes(value as CommentStatus) ? (value as CommentStatus) : 'pending';
}

/** Autor de comentário — projeção pública, sem nenhum identificador do provedor. */
export interface CommentAuthorView {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  provider: CommentProvider;
}

export interface CommentView {
  id: string;
  content: string;
  createdAt: Date;
  author: CommentAuthorView;
  status: CommentStatus;
}

// =============================================================================
// VALIDAÇÃO DE CONTEÚDO
// =============================================================================

export const COMMENT_MIN_LENGTH = 2;
/**
 * 1500 caracteres ≈ 250 palavras. Comentário mais longo que isso vira texto
 * paralelo: ninguém lê e a página fica pesada. O limite também é a primeira
 * barreira contra payload gigante consumindo banco e banda.
 */
export const COMMENT_MAX_LENGTH = 1500;

/**
 * Valida e normaliza o texto de um comentário.
 *
 * SEGURANÇA: esta função NÃO tenta "limpar HTML". Ela nem precisa — o
 * comentário é renderizado como TEXTO em JSX, e o React escapa tudo. Tentar
 * sanitizar HTML aqui daria uma falsa sensação de segurança e criaria a
 * tentação de, um dia, renderizar o resultado como HTML.
 *
 * O que fazemos: limitar tamanho, exigir conteúdo real e normalizar quebras de
 * linha excessivas (que são usadas para "empurrar" o resto da thread para fora
 * da tela — um abuso de layout, não de segurança).
 */
export function validateCommentContent(input: unknown): {
  valid: boolean;
  content: string;
  error?: string;
} {
  if (typeof input !== 'string') {
    return { valid: false, content: '', error: 'Comentário inválido.' };
  }

  // Corta ANTES de qualquer processamento: uma string de 10 MB não deve chegar
  // às regex abaixo.
  const raw = input.slice(0, COMMENT_MAX_LENGTH + 1);

  if (raw.length > COMMENT_MAX_LENGTH) {
    return {
      valid: false,
      content: '',
      error: `O comentário deve ter no máximo ${COMMENT_MAX_LENGTH} caracteres.`,
    };
  }

  const content = raw
    // Normaliza \r\n do Windows.
    .replace(/\r\n/g, '\n')
    // No máximo duas quebras seguidas: impede o "muro de linhas em branco".
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (content.length < COMMENT_MIN_LENGTH) {
    return { valid: false, content: '', error: 'Escreva alguma coisa antes de enviar.' };
  }

  return { valid: true, content };
}

/**
 * Nome de exibição vindo do provedor OAuth.
 *
 * É dado CONTROLADO PELO USUÁRIO (qualquer um edita o próprio nome no Discord),
 * portanto entrada hostil como qualquer outra. Limitamos o tamanho e removemos
 * caracteres de controle e marcas bidirecionais — estas últimas permitem
 * inverter visualmente o texto ao redor (ataque de "Trojan Source"/spoofing de
 * UI), truque usado para fazer um nome parecer outro na lista de comentários.
 */
export function sanitizeDisplayName(input: unknown): string {
  if (typeof input !== 'string') return 'Leitor';

  const cleaned = input
    // Caracteres de controle C0 e C1 (invisíveis; quebram log, layout e CSV).
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // Zero-width, marcas de direção (LRM/RLM/LRO/RLO/PDF), isolates e BOM.
    // Escritos como escapes \uXXXX e nunca como o caractere literal: um
    // caractere invisível dentro do código-fonte é impossível de revisar num
    // pull request — e é exatamente assim que um "Trojan Source" passa.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .slice(0, 40);

  return cleaned.length > 0 ? cleaned : 'Leitor';
}
