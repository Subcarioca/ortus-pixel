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

  /**
   * Criar uma pauta do ZERO, sem esperar o pipeline achar o assunto.
   *
   * É trabalho de redação, não de curadoria: quem escreve precisa poder propor o
   * que vai escrever. Note a diferença para `curarFilaDePautas`, logo acima —
   * ACRESCENTAR uma pauta à fila é somar uma opção; SOBREPOR score e DESCARTAR
   * mexem no que o site inteiro exibe. Só o segundo grupo é privativo.
   */
  criarPauta: boolean;

  /**
   * Cadastrar uma FRANQUIA nova no catálogo (GTA, Zelda, Marvel...).
   *
   * POR QUE UMA CHAVE PRÓPRIA E NÃO O REAPROVEITAMENTO DE `criarPauta`:
   * as duas são "acrescentar uma linha", mas a semelhança para aí. Pauta é um
   * item de FILA INTERNA — nasce, é assumida, vira matéria e some. Franquia é
   * item de CATÁLOGO: ela ganha uma página pública permanente (`/franquia/gta`),
   * entra no sitemap, aparece em "Seus universos" na home e passa a ser
   * seguível. Escondê-la atrás do nome "criarPauta" faria a resposta à pergunta
   * "quem pode criar página nova no site?" depender de alguém lembrar que aquela
   * chave também servia para outra coisa — que é exatamente o que esta tabela
   * existe para evitar (ver o cabeçalho de `StaffCapabilities`).
   *
   * POR QUE É `true` PARA OS DOIS NÍVEIS, mesmo criando página pública: pelo
   * mesmo critério que já vale em `criarPauta` — ACRESCENTAR não tira nada de
   * ninguém. Uma franquia nova não reordena a home, não despublica nada e não
   * altera o que já existe; ela só passa a existir. E o custo de NÃO dar isso ao
   * redator é concreto: hoje não há tela nenhuma de criação de franquia no
   * produto, e etiquetar uma matéria com uma franquia inexistente exige abrir o
   * banco — que é onde acontecem os acidentes que ninguém audita (o mesmo
   * argumento que justificou a tela de matérias).
   *
   * ⚠ O QUE ESTA CHAVE **NÃO** AUTORIZA: editar ou apagar franquia existente.
   * Isso é uma ação de consequência oposta — mudar o slug quebra toda URL já
   * indexada e todo link compartilhado; apagar leva junto os seguidores e as
   * relações com matérias publicadas. Quando existir, é outra capacidade, e a
   * decisão de quem pode precisa ser tomada em separado, não herdada desta.
   */
  criarFranquia: boolean;

  /**
   * Ver a aba de audiência (visualizações, cliques).
   *
   * O RECORTE muda por nível e NÃO está aqui: esta chave responde "a tela
   * existe para esta pessoa?". "Quais matérias ela vê nela?" é uma comparação de
   * dono, resolvida na consulta com a mesma regra de `canEditArticleOf` — é a
   * mesma separação já feita em `verMaterias`.
   */
  verAnalytics: boolean;

  /**
   * Ver os números do SITE INTEIRO — o agregado que soma matéria de todo mundo.
   *
   * Privativo de administrador, e o motivo é específico: o agregado do site é
   * exatamente o que um redator NÃO deveria conseguir reconstruir. Com o total
   * do site e o total dele, uma subtração entrega o desempenho dos colegas —
   * que é informação de gestão de pessoas, não de redação. A regra "só o que é
   * meu" seria contornável por aritmética se esta chave fosse `true` para todos.
   */
  verAnalyticsDoSite: boolean;

  /**
   * REDUZIR a classificação de sensibilidade de uma matéria (por exemplo, de
   * 'adult' para 'none').
   *
   * A escada sobe para qualquer um e desce só para administrador — ver
   * `canLowerSensitivity`, logo abaixo, e o cabeçalho de content-sensitivity.ts.
   */
  reduzirRestricaoDeConteudo: boolean;

  /**
   * Disparar à mão o alerta de pauta com potencial de viralizar.
   *
   * Manda e-mail para TODA a redação. Uma ação que escreve na caixa de entrada
   * de outras pessoas é, por definição, de coordenação — e um botão de "avisar
   * todo mundo" sem dono vira, em poucas semanas, um botão que todo mundo
   * ignora. O disparo AUTOMÁTICO (o normal) não passa por aqui: ele é feito pelo
   * job, com segredo próprio.
   */
  dispararAlertaViral: boolean;

  /**
   * APROVAR (ou devolver) a matéria de conteúdo sensível que um redator mandou
   * publicar — a fila de `status: 'in-review'`.
   *
   * É a outra metade da regra de `reduzirRestricaoDeConteudo`, e não uma
   * repetição dela. Aquela responde "quem pode AFROUXAR a marca?"; esta
   * responde "quem decide que uma matéria JÁ marcada pode ir ao ar?". São dois
   * momentos distintos do mesmo problema: a primeira protege a conta de
   * anúncios de uma classificação errada, a segunda protege a HOME de um tema
   * pesado subir sem ninguém da chefia ter lido.
   *
   * Privativa de administrador pelo mesmo motivo de `moderarComentarios`: o que
   * está em jogo aqui é responsabilidade editorial pelo que o site publica, e
   * responsabilidade editorial não se delega para quem escreveu o texto — se o
   * autor pudesse aprovar a si mesmo, a aprovação não existiria.
   */
  aprovarConteudoSensivel: boolean;
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
    criarPauta: true,
    criarFranquia: true,
    verAnalytics: true,
    verAnalyticsDoSite: true,
    reduzirRestricaoDeConteudo: true,
    dispararAlertaViral: true,
    aprovarConteudoSensivel: true,
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

    // Propor pauta É o trabalho. Acrescentar uma linha à fila não tira nada de
    // ninguém — ao contrário de descartar ou repontuar, que reordenam o site.
    criarPauta: true,

    // Mesmo critério: cadastrar a franquia que ele acabou de cobrir é
    // acrescentar, não alterar. A alternativa real não era "só o admin cria" —
    // era "ninguém cria pelo painel, edita-se o banco na mão". Ver o comentário
    // longo da chave em `StaffCapabilities`, inclusive o que ela NÃO autoriza
    // (editar e apagar continuam fora do alcance de todo mundo, por ora).
    criarFranquia: true,

    // A tela existe; o que ela mostra é só o que ele assina (recorte na consulta).
    verAnalytics: true,
    // Ver o total do site permitiria deduzir o desempenho dos colegas por
    // subtração. Ver o comentário da chave em `StaffCapabilities`.
    verAnalyticsDoSite: false,

    // Ele PODE marcar como sensível/adulto (a escada sobe para todos); não pode
    // desmarcar. Ver `canLowerSensitivity`.
    reduzirRestricaoDeConteudo: false,

    // Escrever na caixa de entrada da redação inteira é ação de coordenação.
    dispararAlertaViral: false,

    // Ele é quem PEDE a aprovação; aprovar a si mesmo anularia o passo. Ver
    // `requiresSensitiveApproval`, no fim do arquivo.
    aprovarConteudoSensivel: false,
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

/**
 * A SEGUNDA REGRA POR LINHA (e não por papel): esta pessoa pode AFROUXAR a
 * classificação de sensibilidade desta matéria?
 *
 * A escada de `contentSensitivity` (none → sensitive → adult) sobe para
 * qualquer conta e desce só para administrador. Por que a assimetria, sendo que
 * o redator já pode editar tudo na matéria dele:
 *
 *   ERRAR PARA MAIS custa alguns centavos de receita e é reversível em dez
 *   segundos por um admin. ERRAR PARA MENOS coloca AdSense numa página adulta —
 *   e a punição do programa não é a página, é a CONTA, com todo o histórico de
 *   receita junto. Não são dois erros do mesmo tamanho, então não podem ter a
 *   mesma trava.
 *
 * Note que ela NÃO é uma capacidade estática: depende do valor ANTERIOR da
 * linha. Um redator que abre uma matéria 'none', não mexe no campo e salva não
 * pode ser bloqueado — e seria, se a regra fosse "redator não mexe neste campo".
 * É a mesma razão pela qual `canEditArticleOf` vive aqui embaixo, e não na
 * tabela de capacidades.
 *
 * Recebe os `rank`s (e não os níveis) para não importar nada de
 * content-sensitivity.ts: `staff.ts` é o módulo de PERMISSÃO, e mantê-lo sem
 * dependência de vocabulário editorial é o que impede os dois assuntos de se
 * misturarem com o tempo.
 */
export function canLowerSensitivity(
  viewer: { accessLevel: AccessLevel },
  previousRank: number,
  nextRank: number,
): boolean {
  // Manter ou subir é permitido a todos. Só a descida passa pela permissão.
  if (nextRank >= previousRank) return true;
  return can(viewer.accessLevel, 'reduzirRestricaoDeConteudo');
}

/**
 * =============================================================================
 * A TERCEIRA REGRA POR LINHA: esta publicação precisa parar em `'in-review'`?
 * =============================================================================
 *
 * O PROBLEMA QUE ELA RESOLVE. `canLowerSensitivity` já impede o redator de
 * AFROUXAR a marca de sensibilidade. O que faltava era o outro lado: marcar
 * corretamente como 'sensitive'/'adult' e publicar assim mesmo, direto, sem
 * ninguém da chefia ter lido. A marca protegia a conta de anúncios (o dinheiro)
 * e não protegia a decisão EDITORIAL de subir um tema pesado na home.
 *
 * A resposta é um pedágio, não um bloqueio: quando esta função devolve `true`, a
 * matéria é gravada com `status: 'in-review'` — fora do ar (nenhuma consulta
 * pública lê algo que não seja 'published'), com o texto intacto, esperando um
 * clique do administrador. Nada se perde e nada vai ao ar sozinho.
 *
 * -----------------------------------------------------------------------------
 * AS QUATRO CONDIÇÕES, E POR QUE CADA UMA PRECISA ESTAR AQUI
 * -----------------------------------------------------------------------------
 *
 *  1. `publishing` — salvar RASCUNHO nunca para na fila. Rascunho já não está no
 *     ar; mandá-lo para revisão só encheria a fila do administrador de trabalho
 *     inacabado que o próprio autor ainda vai mudar.
 *
 *  2. `nextRank > 0` (ou seja, acima de 'none') — matéria comum publica como
 *     sempre publicou. O pedágio é para o conteúdo sensível, e só.
 *
 *  3. quem publica NÃO aprova — administrador vai direto ao ar. Ele é
 *     exatamente a pessoa que aprovaria; obrigá-lo a aprovar a si mesmo em dois
 *     cliques seria cerimônia sem revisão nenhuma no meio.
 *
 *  4. `liveRank` — a matéria JÁ ESTÁ NO AR com sensibilidade igual ou maior?
 *     Então alguém já aprovou aquilo, e uma correção de vírgula não pode
 *     derrubá-la do ar. Sem esta condição, todo save do redator numa matéria
 *     sensível já publicada a despublicaria — quebrando link compartilhado e
 *     posição no Google por causa de uma edição de texto.
 *
 *     A ESCALADA, POR OUTRO LADO, VOLTA PARA A FILA: 'none' publicado que vira
 *     'sensitive', ou 'sensitive' que vira 'adult'. Duas razões, e a segunda é
 *     a que importa: (a) se a classificação subiu, o conteúdo mudou de natureza
 *     e é justamente o caso que a chefia precisa ver; (b) sem isso, a regra
 *     inteira teria uma porta dos fundos de dois passos — publicar como 'none' e
 *     editar para 'adult' em seguida.
 *
 * -----------------------------------------------------------------------------
 * POR QUE ELA RECEBE `rank`s, e não `ContentSensitivity`
 * -----------------------------------------------------------------------------
 * Mesma razão de `canLowerSensitivity`, logo acima: `staff.ts` é o módulo de
 * PERMISSÃO e não importa vocabulário editorial. Quem chama traduz o nível em
 * rank com `sensitivityRank` (content-sensitivity.ts) e passa o número.
 */
export function requiresSensitiveApproval(params: {
  viewer: { accessLevel: AccessLevel };
  /** A intenção é ir AO AR agora? (`publish: true` do formulário.) */
  publishing: boolean;
  /** Rank da classificação que está sendo gravada. 0 = 'none'. */
  nextRank: number;
  /**
   * Rank da versão que está NO AR neste momento, ou `null` quando a matéria não
   * está publicada (rascunho, criação, matéria devolvida para ajuste).
   */
  liveRank: number | null;
}): boolean {
  const { viewer, publishing, nextRank, liveRank } = params;

  if (!publishing) return false;
  if (nextRank <= 0) return false;
  if (can(viewer.accessLevel, 'aprovarConteudoSensivel')) return false;
  if (liveRank !== null && nextRank <= liveRank) return false;

  return true;
}
