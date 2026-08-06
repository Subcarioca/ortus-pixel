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
 * RE-SKIN v0.3 — o `compact` mudou de implementação, não de intenção.
 *
 * Antes ele produzia `.cta-news--compact`, um modificador que só existia aqui:
 * na prática o bloco continuava com o cartão inteiro (fundo, borda, raio,
 * padding de 32px) e ficava pesado dentro de um artigo ou de uma sidebar de
 * 320px. O design já resolve esse caso com um COMPONENTE diferente,
 * `.cta-inline`: sem cartão, só dois filetes horizontais delimitando o bloco —
 * "não interrompe, não cobre texto, não muda o layout" (design §3).
 *
 * Ou seja: `compact` deixou de ser uma variante visual do cartão e passou a
 * escolher entre os dois componentes que o design system já tinha.
 */

import { useState } from 'react';

interface NewsletterFormProps {
  title: string;
  description: string;
  /** De onde veio a inscrição — usado para medir o que converte melhor. */
  source: string;
  compact?: boolean;
}

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function NewsletterForm({ title, description, source, compact = false }: NewsletterFormProps) {
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

  // `.cta-inline` na versão compacta (artigo/sidebar), `.cta-news` no bloco
  // de destaque da home. Ver o comentário no topo do arquivo.
  const blockClass = compact ? 'cta-inline' : 'cta-news';

  // Sucesso substitui o formulário no mesmo lugar.
  if (status === 'success') {
    return (
      <div className={blockClass} role="status">
        <p className="cta-news__kicker">Quase lá!</p>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <section className={blockClass}>
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

      <form onSubmit={handleSubmit} className="form-inline">
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
        <button type="submit" className="btn btn--primary" disabled={status === 'submitting'}>
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
    </section>
  );
}
