/**
 * =============================================================================
 * LEITURA DA RESPOSTA DAS AÇÕES DO PAINEL
 * =============================================================================
 *
 * As telas do painel faziam `await response.json()` direto dentro de um
 * `try/catch` cujo `catch` dizia "Erro de conexão.". O problema: `json()`
 * também lança quando a conexão está ótima e o servidor respondeu — só que com
 * um 500 sem corpo JSON. O editor via "Erro de conexão." depois de uma falha
 * que não tinha nada a ver com a rede, tentava de novo e falhava de novo.
 *
 * Mentir sobre a causa é pior do que não explicar: manda a pessoa para o
 * caminho errado (checar o Wi-Fi) em vez do certo (recarregar a lista, refazer
 * o login, avisar alguém).
 *
 * Este módulo concentra essa tradução num lugar só. Ele NÃO faz o fetch: quem
 * chama continua dono da requisição, do corpo e do que fazer no sucesso.
 */

export interface AdminResponse {
  ok: boolean;
  /** Sempre preenchida: é o texto que vai para a tela. */
  message: string;
  /** Demais campos devolvidos pela rota (slug, categorySlug...). */
  [key: string]: unknown;
}

/**
 * Traduz a resposta HTTP em `{ ok, message }` — nunca lança.
 *
 * O 401 ganha texto próprio porque é o único caso em que o editor precisa fazer
 * algo FORA desta tela (entrar de novo) e voltar. E o aviso de que o texto
 * digitado continua ali não é gentileza: sem ele, a reação natural diante de um
 * erro é fechar o formulário — que é justamente o que faz o trabalho se perder.
 */
export async function readAdminResponse(response: Response): Promise<AdminResponse> {
  // O 401 é tratado ANTES de olhar o corpo: a rota responde "Não autorizado.",
  // que descreve o que aconteceu no servidor e não o que fazer na tela.
  if (response.status === 401) {
    return {
      ok: false,
      message:
        'Sua sessão do painel expirou. Entre de novo em outra aba e repita a ação aqui — o que estava preenchido nesta tela continua aí.',
    };
  }

  const data = (await response.json().catch(() => null)) as Partial<AdminResponse> | null;

  if (data && typeof data.message === 'string') {
    return { ...data, ok: data.ok === true, message: data.message };
  }

  return {
    ok: false,
    message: `O servidor respondeu com erro ${response.status} e nada foi alterado. O que estava preenchido nesta tela continua aí; se repetir, avise o responsável técnico.`,
  };
}
