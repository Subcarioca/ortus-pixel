'use client';

/**
 * =============================================================================
 * FORMULÁRIO DE NEWSLETTER
 * =============================================================================
 *
 * Um dos poucos Client Components do projeto — precisa de estado para o
 * feedback imediato. Mantido pequeno de propósito: cada Client Component é
 * JavaScript enviado ao navegador.
 *
 * DECISÕES DE CONVERSÃO (design/README.md §4):
 *  - SÓ O E-MAIL. "Cada campo extra derruba conversão, e não há nada que o nome
 *    resolva que a segmentação por fandom não resolva melhor."
 *  - Feedback de sucesso NO LUGAR do formulário, não em outra página. Redirect
 *    quebra o contexto de leitura e é a principal fonte de abandono.
 *
 * RE-SKIN v0.3 — de `compact: boolean` para `variant`, e por quê.
 *
 * A versão anterior tinha `compact`, que produzia `.cta-news--compact` — um
 * modificador que só existia neste arquivo. Depois virou `.cta-inline`, o que
 * já era uma melhora, mas ainda escondia um problema: `compact` era usado em
 * DOIS lugares com necessidades opostas.
 *
 *   1. No meio do corpo do artigo, onde a largura é confortável e o design pede
 *      `.cta-inline` (dois filetes horizontais, sem cartão, texto à esquerda e
 *      formulário à direita a partir de 700px).
 *   2. Na sidebar de 320px, onde `.cta-inline` vira duas colunas espremidas e
 *      o campo de e-mail encolhe para caber ao lado do botão.
 *
 * A causa é sutil e vale registrar, porque vai acontecer de novo: as media
 * queries do design (`.cta-inline` em 700px, `.form-inline` em 560px) medem a
 * JANELA, não o contêiner. Um bloco de 320px dentro de uma tela de 1280px
 * recebe o layout "largo" e quebra. O protótipo evita isso usando um markup
 * diferente na sidebar (`.side-box` + `.stack-sm` + `.btn--block`) — e é
 * exatamente esse markup que a variante `sidebar` passou a produzir.
 *
 * Um booleano não conseguia expressar três casos. `variant` consegue, e o nome
 * de cada valor diz ONDE o bloco vive, que é o que de fato determina a forma.
 */

import { useState } from 'react';

/**
 * `feature`  bloco de destaque (home): `.cta-news`, o cartão inteiro.
 * `inline`   dentro do corpo do artigo: `.cta-inline`, sem cartão.
 * `sidebar`  coluna de 320px: `.side-box`, com o formulário empilhado.
 */
export type NewsletterVariant = 'feature' | 'inline' | 'sidebar';

interface NewsletterFormProps {
  title: string;
  description: string;
  /** De onde veio a inscrição — usado para medir o que converte melhor. */
  source: string;
  variant?: NewsletterVariant;
}

const BLOCK_CLASS: Record<NewsletterVariant, string> = {
  feature: 'cta-news',
  inline: 'cta-inline',
  sidebar: 'side-box',
};

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function NewsletterForm({
  title,
  description,
  source,
  variant = 'feature',
}: NewsletterFormProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');

    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });

      const data = (await response.json()) as { ok: boolean; message: string };

      if (response.ok && data.ok) {
        setStatus('success');
        setMessage(data.message);
        setEmail('');
      } else {
        setStatus('error');
        // Exibimos a mensagem do servidor, que é redigida para NÃO revelar se o
        // e-mail já existe na base (ver a rota da API). Enumerar assinantes é
        // vazamento de dado pessoal.
        setMessage(data.message ?? 'Não foi possível concluir. Tente novamente.');
      }
    } catch {
      setStatus('error');
      setMessage('Falha de conexão. Verifique sua internet e tente de novo.');
    }
  }

  const blockClass = BLOCK_CLASS[variant];
  const isSidebar = variant === 'sidebar';

  // Sucesso substitui o formulário no mesmo lugar.
  //
  // O `<div>` interno não é enfeite: ele mantém a mesma regra dos dois filhos
  // explicada logo abaixo. Sem ele, na variante `inline` a grade de duas
  // colunas jogaria o "Quase lá!" numa coluna e a mensagem na outra — e a
  // confirmação, que é o momento mais importante do fluxo, sairia partida.
  if (status === 'success') {
    return (
      <div className={blockClass} role="status">
        <div>
          <p className="cta-news__kicker">Quase lá!</p>
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return (
    /*
      DOIS FILHOS, SEMPRE — texto e formulário.

      `.cta-inline` é uma grade de duas colunas a partir de 700px. Quem decide
      o que vai em cada coluna é a ORDEM dos filhos diretos, então o bloco
      precisa ter exatamente dois. A versão anterior emitia cinco elementos
      soltos (kicker, título, descrição, formulário, dica) e a grade os
      distribuía em zigue-zague: kicker | título, descrição | formulário…
      Agrupar em dois `<div>` não muda nada em `.cta-news` nem em `.side-box`
      (que são blocos comuns) e conserta o `.cta-inline`.
    */
    <section className={blockClass}>
      <div>
        <p className="cta-news__kicker">Newsletter</p>
        {/*
          `<h2>` porque o bloco é uma seção da página, e o design estiliza o
          título do CTA por elemento (`.cta-news h3`, `.cta-inline h4`). A ponte
          de heading na seção 17 do CSS reaplica o tamanho certo ao nível que a
          semântica do documento exige — o nível não pode ser escolhido pelo
          tamanho da fonte (WCAG 1.3.1).
        */}
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div>
        {/* Na sidebar o formulário empilha (`.stack-sm`) e o botão ocupa a
            largura toda (`.btn--block`). É o markup do protótipo para este ponto
            — e não uma exceção nossa: `.form-inline` só funciona onde a JANELA
            passa de 560px E o bloco é largo, e a segunda condição o CSS não tem
            como verificar. */}
        <form onSubmit={handleSubmit} className={isSidebar ? 'stack-sm' : 'form-inline'}>
          <label htmlFor={`email-${source}`} className="sr-only">
            Seu e-mail
          </label>
          <input
            id={`email-${source}`}
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="seu@email.com"
            required
            // `type="email"` + `required` dão validação nativa do navegador, sem
            // JavaScript. A validação de verdade acontece no servidor — validação
            // de cliente é conveniência de UX, nunca uma barreira de segurança.
            autoComplete="email"
            className="input"
            disabled={status === 'submitting'}
            aria-describedby={status === 'error' ? `erro-${source}` : undefined}
            aria-invalid={status === 'error'}
          />
          <button
            type="submit"
            className={`btn btn--primary${isSidebar ? ' btn--block' : ''}`}
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Enviando...' : 'Quero receber'}
          </button>
        </form>

        {status === 'error' && (
          // `role="alert"` faz o leitor de tela anunciar o erro imediatamente.
          <p id={`erro-${source}`} className="form-hint form-hint--error" role="alert">
            {message}
          </p>
        )}

        <p className="form-hint">
          Enviamos um e-mail de confirmação. Você pode cancelar quando quiser.
        </p>
      </div>
    </section>
  );
}
