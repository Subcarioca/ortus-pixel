/**
 * =============================================================================
 * CONVITE DE LOGIN — Discord ou Google, com o mesmo peso visual
 * =============================================================================
 *
 * Server Component: são dois links. Nenhum JavaScript.
 *
 * DECISÕES DE UX (design v0.2 + heurísticas de Nielsen):
 *
 *  1. OS DOIS BOTÕES TÊM O MESMO TAMANHO E A MESMA ORDEM VISUAL. Dar destaque a
 *     um dos provedores empurraria parte do público para um login que ele não
 *     quer e reduziria a conversão total. (Nielsen #3: liberdade do usuário.)
 *
 *  2. O TEXTO EXPLICA O QUE SERÁ COLETADO, ANTES DO CLIQUE. "Pegamos só o seu
 *     nome público" é informação que quase nenhum site dá — e é exatamente a
 *     dúvida que faz alguém desistir de logar. Transparência aqui é conversão,
 *     além de ser exigência de transparência da LGPD (art. 9º).
 *
 *  3. O BOTÃO DO DISCORD AQUI NÃO É CONVITE PARA O SERVIDOR. O bloco de
 *     comunidade (que leva ao canal do fandom) é outro, com outra aparência,
 *     em outro ponto da página. Misturar os dois faz a pessoa clicar achando
 *     que vai comentar e cair num convite de servidor. (Nielsen #5: prevenção
 *     de erros.)
 */

import { COMMENT_PROVIDER_LABELS, isCommentProvider } from '@subcarioca/core';

interface CommentLoginProps {
  providers: string[];
  returnTo: string;
}

export function CommentLogin({ providers, returnTo }: CommentLoginProps) {
  // Sem provedor configurado, os comentários existem em modo LEITURA. Preferimos
  // isso a exibir um botão que leva a um erro — e a inventar um "login de
  // desenvolvimento", que é a porta dos fundos que alguém esquece aberta.
  if (providers.length === 0) {
    return (
      <p className="form-hint">
        Os comentários estão em modo leitura no momento.
      </p>
    );
  }

  return (
    /* RE-SKIN v0.3: `.side-box`, a caixa neutra do design (superfície + borda
       fina + raio médio). `.cd-box`, que estava aqui, é a caixinha da contagem
       regressiva do hub de franquia — 56px de largura mínima e texto mono
       centralizado. Os dois botões de login ficavam espremidos dentro dela. */
    <div className="side-box">
      <h3>Entre para comentar</h3>
      <p className="form-hint">
        Use a conta que você já tem. Não criamos senha nova e não pedimos seu e-mail.
      </p>

      <div className="auth-grid">
        {providers.filter(isCommentProvider).map((provider) => (
          <a
            key={provider}
            className={`btn btn--${provider}`}
            // Link comum (GET): iniciar um login é navegação, e o `state` +
            // PKCE gerados no servidor é que protegem o fluxo — não o método.
            href={`/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`}
            // `rel="nofollow"`: não há nada para um buscador indexar atrás de um
            // login, e rastrear esta URL só gastaria orçamento de rastreamento.
            rel="nofollow"
          >
            Comentar com {COMMENT_PROVIDER_LABELS[provider]}
          </a>
        ))}
      </div>

      <p className="auth-note">
        Guardamos apenas o seu nome público e um identificador embaralhado da conta.
        Não pedimos e-mail, não guardamos sua foto e não temos acesso a nada além disso.
      </p>
    </div>
  );
}
