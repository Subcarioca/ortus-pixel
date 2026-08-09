'use client';

/**
 * =============================================================================
 * AÇÕES DA CONTA — sair e apagar
 * =============================================================================
 *
 * As duas operações são POST/DELETE via `fetch`, e não links: têm efeito
 * colateral, e ação com efeito colateral não vai em GET (o mesmo raciocínio já
 * documentado em /api/auth/logout).
 *
 * A CONFIRMAÇÃO DE EXCLUSÃO É EM DOIS PASSOS, DENTRO DA PRÓPRIA PÁGINA, e não
 * um `window.confirm()`. Três razões:
 *
 *  1. `confirm()` é um diálogo do navegador que muita gente fecha no reflexo,
 *     sem ler — exatamente o oposto do que uma ação irreversível precisa.
 *  2. Ele não permite explicar O QUE será apagado e o que permanece. Aqui essa
 *     explicação é o principal conteúdo do passo de confirmação.
 *  3. É bloqueante e não estilizável, então destoa do resto do site.
 *
 * (Nielsen #5: prevenção de erros — e, quando o erro é irreversível, a
 * prevenção precisa custar um clique a mais de propósito.)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AccountActions() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // `refresh` e não `push`: a pessoa continua em /minha-conta, que agora
      // renderiza o estado deslogado. Mandá-la para a home esconderia o
      // resultado da própria ação que ela acabou de tomar.
      router.refresh();
    } catch {
      setError('Não foi possível sair agora. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  async function deleteAccount() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/account', { method: 'DELETE' });
      if (!response.ok) {
        setError('Não foi possível apagar a conta agora. Tente novamente.');
        return;
      }
      router.refresh();
    } catch {
      setError('Não foi possível apagar a conta agora. Tente novamente.');
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section className="section" aria-labelledby="conta-acoes">
      <div className="section-head">
        <h2 id="conta-acoes" className="section-title">
          Conta
        </h2>
      </div>

      <div className="side-box">
        <button type="button" className="btn btn--ghost" onClick={logout} disabled={pending}>
          Sair
        </button>

        {!confirming ? (
          <>
            <p className="form-hint">
              Apagar a conta remove sua identidade e tudo o que você segue. Seus comentários já
              publicados continuam no ar, sem ligação com a conta.
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Apagar minha conta
            </button>
          </>
        ) : (
          <>
            {/* `role="alert"` faz o leitor de tela anunciar o aviso assim que
                ele aparece — sem isso, quem não enxerga clicaria em "Apagar"
                sem nunca tomar conhecimento da confirmação. */}
            <p className="form-hint form-hint--error" role="alert">
              Isso não pode ser desfeito. Sua identidade e a lista de universos seguidos serão
              apagadas agora.
            </p>
            <div className="auth-grid">
              {/* `.btn--hot` usa o vermelho de sinal, que o design reserva à
                  temperatura do conteúdo. O uso aqui é o previsto na exceção
                  escrita na própria regra ("botão que não seja de alerta" é o
                  proibido): exclusão irreversível é alerta. Nenhum outro botão
                  desta página pode usá-lo. */}
              <button
                type="button"
                className="btn btn--hot"
                onClick={deleteAccount}
                disabled={pending}
              >
                Apagar definitivamente
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="form-hint form-hint--error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
