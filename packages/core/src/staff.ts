/**
 * =============================================================================
 * REDAÇÃO — vocabulário de nível de acesso ao painel
 * =============================================================================
 *
 * Vive no `core` (e não em `apps/web`) pelo mesmo motivo de `CONTENT_FORMATS` e
 * `ScoreBand`: é vocabulário de DOMÍNIO, consultado tanto pelo front quanto pela
 * camada de dados quanto pelo script de criação de conta. Cada um com sua cópia
 * seria a receita para "o painel diz que ela é redatora, o script gravou
 * 'REDATOR' e a comparação falha".
 *
 * DOIS NÍVEIS, E NÃO CINCO. A tentação de já prever "editor-chefe", "revisor",
 * "estagiário" é forte e é errada aqui: cada nível a mais multiplica as
 * combinações que precisam ser testadas em CADA rota administrativa, e o produto
 * tem hoje uma pergunta só a responder — "isto é meu ou é de outra pessoa?".
 * Quando um terceiro nível tiver um caso de uso concreto, ele entra nesta lista
 * e o compilador aponta todos os lugares que precisam decidir o que fazer com
 * ele (é o efeito de usar `Record<AccessLevel, …>` em vez de `if` soltos).
 */

/** Níveis de acesso ao painel editorial. Lista fechada. */
export const ACCESS_LEVELS = ['admin', 'redator'] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * Converte a string do banco em `AccessLevel`.
 *
 * Valor desconhecido cai em 'redator' — o MENOS privilegiado. A assimetria entre
 * os dois erros define a direção do padrão: errar para 'redator' faz alguém ver
 * um botão a menos e pedir ajuda; errar para 'admin' entrega o site inteiro a
 * quem não deveria tê-lo. Este é o mesmo raciocínio de `toArticleStatus`, que
 * cai em 'draft' e não em 'published'.
 */
export function toAccessLevel(value: unknown): AccessLevel {
  return value === 'admin' ? 'admin' : 'redator';
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/** Rótulo para a interface do painel. */
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  admin: 'Administrador',
  redator: 'Redator',
};

/**
 * O que cada nível pode fazer, escrito UMA vez.
 *
 * Cada chave é uma pergunta que alguma rota faz. Manter isso como uma tabela, e
 * não como `if (nivel === 'admin')` espalhado por doze arquivos, tem um efeito
 * prático: para responder "o que exatamente um redator alcança?" — pergunta que
 * o dono do produto vai fazer, e que uma auditoria de segurança vai fazer — basta
 * ler esta tabela, em vez de reler o projeto inteiro torcendo para não ter
 * pulado um arquivo.
 *
 * O QUE NÃO ESTÁ AQUI: "editar a matéria X". Essa não é uma permissão de nível,
 * é uma comparação de DONO (autor da matéria × conta logada) e depende da linha,
 * não do papel — ela vive em `canEditArticleOf`, logo abaixo, justamente para não
 * se disfarçar de permissão estática.
 */
export interface StaffCapabilities {
  /** Fila de pautas: ver os tópicos e assumir um. */
  verFilaDePautas: boolean;
  /** Sobrepor score e descartar tópico: mexem no ranking do site inteiro. */
  curarFilaDePautas: boolean;
  /** Listar matérias no painel (o RECORTE muda por nível — ver a página). */
  verMaterias: boolean;
  /** Moderar comentários. */
  moderarComentarios: boolean;
  /** Cadastrar ofertas de afiliado e vinculá-las a matérias. */
  gerenciarComercial: boolean;
  /** Relatório de precisão do score. */
  verRelatorios: boolean;
  /** Criar, promover e desativar contas da redação. */
  gerenciarContas: boolean;
  /** Escolher OUTRA pessoa como autor da matéria. */
  atribuirOutroAutor: boolean;
}

export const STAFF_CAPABILITIES: Record<AccessLevel, StaffCapabilities> = {
  admin: {
    verFilaDePautas: true,
    curarFilaDePautas: true,
    verMaterias: true,
    moderarComentarios: true,
    gerenciarComercial: true,
    verRelatorios: true,
    gerenciarContas: true,
    atribuirOutroAutor: true,
  },
  redator: {
    verFilaDePautas: true,
    // Descartar tópico e sobrepor score alteram o que o SITE INTEIRO exibe (a
    // fila alimenta a home e o /em-alta). É curadoria, não redação.
    curarFilaDePautas: false,
    verMaterias: true,
    // Moderação e comercial são responsabilidades editoriais da chefia, com
    // consequência jurídica (§7 do README, CDC art. 36) — não de quem escreve.
    moderarComentarios: false,
    gerenciarComercial: false,
    verRelatorios: false,
    gerenciarContas: false,
    // Um redator que pudesse escolher o autor conseguiria criar matéria em nome
    // de outra pessoa — e, de quebra, contornar a própria regra de propriedade,
    // já que bastaria assinar como si mesmo depois. A assinatura dele é ele.
    atribuirOutroAutor: false,
  },
};

export function can(level: AccessLevel, capability: keyof StaffCapabilities): boolean {
  return STAFF_CAPABILITIES[level][capability];
}

/**
 * A REGRA CENTRAL DA PARTE DE PERMISSÃO: quem pode mexer nesta matéria?
 *
 * Admin mexe em tudo; redator mexe apenas onde ele é o autor. É uma função pura
 * de duas strings de propósito — assim ela é chamada igual na página (para
 * esconder o botão) e na rota de API (para recusar a requisição), sem que a
 * segunda dependa de a primeira ter feito seu trabalho.
 *
 * ESCONDER O BOTÃO NÃO É PROTEÇÃO. A verificação que vale é a da API; a da tela
 * existe só para não oferecer uma ação que vai falhar.
 */
export function canEditArticleOf(
  viewer: { id: string; accessLevel: AccessLevel },
  articleAuthorId: string,
): boolean {
  return viewer.accessLevel === 'admin' || viewer.id === articleAuthorId;
}
