/**
 * =============================================================================
 * /minha-conta — a área do LEITOR
 * =============================================================================
 *
 * ESTA PÁGINA NÃO TEM NADA A VER COM /admin, e a separação é intencional.
 *
 * São dois públicos e dois sistemas de autenticação distintos: a redação entra
 * com o segredo compartilhado do painel (`ADMIN_ACCESS_TOKEN`), o leitor entra
 * com Discord ou Google. Nenhum caminho de navegação liga um ao outro, e um bug
 * aqui não pode, em hipótese alguma, abrir a porta da redação — por isso esta
 * página não importa uma linha sequer do módulo de admin.
 *
 * DINÂMICA POR NATUREZA: lê cookie de sessão, então não é cacheável. É o
 * oposto do resto do site, e está certo assim — aqui o conteúdo é de uma
 * pessoa só.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { COMMENT_PROVIDER_LABELS, isCommentProvider, routes } from '@subcarioca/core';

import { AccountActions } from '@/components/account-actions';
import { getFollowedFranchises } from '@/server/follows';
import { availableProviders } from '@/server/oauth';
import { getReaderSession } from '@/server/reader-session';

export const metadata: Metadata = {
  title: 'Minha conta',
  // Página pessoal: não há o que indexar, e indexá-la só gastaria rastreamento.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  // As duas leituras não dependem uma da outra — em série, a página esperaria a
  // soma dos tempos por nada.
  const [session, follows] = await Promise.all([getReaderSession(), getFollowedFranchises()]);

  const providers = availableProviders();

  return (
    <div className="container">
      <header className="hub-hero">
        <h1 className="article__title">Minha conta</h1>
        <p className="hub-hero__desc">
          {session
            ? 'Aqui ficam os universos que você segue.'
            : 'Você não precisa de conta para ler o site. Ela serve para guardar o que você segue e para comentar.'}
        </p>
      </header>

      {session ? (
        <section className="section" aria-labelledby="conta-identidade">
          <div className="section-head">
            <h2 id="conta-identidade" className="section-title">
              Identidade
            </h2>
          </div>

          <div className="side-box">
            <p>
              <b>{session.displayName}</b>
              {isCommentProvider(session.provider) && (
                <> · entrou com {COMMENT_PROVIDER_LABELS[session.provider]}</>
              )}
            </p>
            {/*
              Transparência sobre o que guardamos, na própria tela da pessoa —
              e não escondido numa política que ninguém abre. É a mesma frase do
              convite de login, agora como prestação de contas.
            */}
            <p className="auth-note">
              Guardamos apenas o seu nome público, um identificador embaralhado da conta e a
              lista de universos que você segue. Não temos o seu e-mail.
            </p>
          </div>
        </section>
      ) : (
        <section className="section" aria-labelledby="conta-entrar">
          <div className="section-head">
            <h2 id="conta-entrar" className="section-title">
              Entrar
            </h2>
          </div>

          {providers.length === 0 ? (
            <p className="empty-state">O login está indisponível no momento.</p>
          ) : (
            <div className="side-box">
              <p className="form-hint">
                Use a conta que você já tem. Não criamos senha nova e não pedimos seu e-mail.
              </p>
              <div className="auth-grid">
                {providers.map((provider) => (
                  <a
                    key={provider}
                    className={`btn btn--${provider}`}
                    href={`/api/auth/${provider}?returnTo=${encodeURIComponent(routes.account())}`}
                    rel="nofollow"
                  >
                    Entrar com {COMMENT_PROVIDER_LABELS[provider]}
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="section" aria-labelledby="conta-seguindo">
        <div className="section-head">
          <h2 id="conta-seguindo" className="section-title">
            Universos que você segue
            {follows.length > 0 && <span className="cmt__time"> · {follows.length}</span>}
          </h2>
        </div>

        {follows.length === 0 ? (
          <p className="empty-state">
            Você ainda não segue nenhum universo. Abra um{' '}
            <Link href={routes.franchise('gta')}>hub de franquia</Link> e toque em “Seguir”.
          </p>
        ) : (
          <div className="filters">
            {follows.map((follow) => (
              <Link key={follow.slug} href={routes.franchise(follow.slug)} className="chip">
                {follow.name}
              </Link>
            ))}
          </div>
        )}

        {/*
          O aviso só aparece para quem NÃO está logado e já segue alguma coisa.
          É a explicação de um comportamento que, sem ela, pareceria um bug:
          "por que sumiu o que eu seguia?" depois de trocar de aparelho.
        */}
        {!session && follows.length > 0 && (
          <p className="form-hint">
            Esses universos estão salvos apenas neste navegador. Entre com Discord ou Google
            para levá-los com você em qualquer aparelho.
          </p>
        )}
      </section>

      {session && <AccountActions />}
    </div>
  );
}
