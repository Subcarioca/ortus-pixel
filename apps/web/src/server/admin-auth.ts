import 'server-only';

import { cookies } from 'next/headers';

import { safeCompare } from './security';

/**
 * Nome do cookie de sessão do painel.
 *
 * EXPORTADO e usado por todo mundo que lê ou escreve este cookie. O nome estava
 * repetido como literal em quatro arquivos, e o reposicionamento de marca
 * mostrou o risco na prática: renomear três dos quatro deixaria o login
 * gravando um cookie que a verificação não lê — ou seja, um painel que aceita a
 * senha e devolve a tela de login, sem erro nenhum no log.
 *
 * O prefixo é o da marca (`ortuspixel_`) para não colidir com cookies de outras
 * aplicações que venham a rodar no mesmo domínio.
 */
export const ADMIN_SESSION_COOKIE = 'ortuspixel_admin';

/**
 * =============================================================================
 * AUTENTICAÇÃO DO PAINEL — extraída para um módulo único
 * =============================================================================
 *
 * Esta checagem estava duplicada na página do painel e na rota de ações de
 * tópico. Com a chegada de mais quatro superfícies administrativas (afiliados,
 * comentários e suas APIs), duplicá-la seria garantir que uma das seis cópias
 * ficasse para trás numa correção futura — e uma verificação de acesso
 * desatualizada é uma porta aberta que ninguém sabe que existe.
 *
 * AVISO QUE CONTINUA VALENDO: o MVP protege o painel com um SEGREDO
 * COMPARTILHADO. É adequado para desenvolvimento e piloto, e NÃO para produção
 * com uma redação real — sem identidade individual, o `AuditLog` registra
 * "alguém" em vez de "a Marina", o que anula boa parte do valor da auditoria.
 * A migração para Auth.js + SSO da redação segue nas pendências do README.
 *
 * Note que esta sessão é COMPLETAMENTE separada da sessão de leitor
 * (server/reader-session.ts). Cookies diferentes, mecanismos diferentes,
 * verificações diferentes. Um bug no login social de comentários não pode, em
 * hipótese alguma, abrir a porta do painel.
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const expected = process.env.ADMIN_ACCESS_TOKEN;

  // Sem token configurado, o painel fica FECHADO (falha segura). O contrário —
  // "sem senha configurada, entra todo mundo" — é como sistemas internos vazam.
  if (!expected) return false;

  const cookieStore = await cookies();
  const provided = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!provided) return false;

  // Comparação em tempo constante — ver server/security.ts.
  return safeCompare(provided, expected);
}
