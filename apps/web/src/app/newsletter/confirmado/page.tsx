/**
 * Página de resultado da confirmação de newsletter.
 *
 * `noindex`: página transacional sem valor de busca, e cuja URL carrega estado
 * do fluxo. Indexá-la só geraria ruído no Search Console.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { routes } from '@subcarioca/core';

export const metadata: Metadata = {
  title: 'Inscrição confirmada',
  robots: { index: false, follow: false },
};

const MESSAGES = {
  sucesso: {
    title: 'Inscrição confirmada!',
    body: 'Pronto. A partir de agora você recebe o resumo do que realmente importou no universo nerd.',
  },
  expirado: {
    title: 'Link expirado',
    body: 'Este link de confirmação tinha validade de 48 horas. Faça a inscrição novamente para receber um link novo.',
  },
  invalido: {
    title: 'Link inválido',
    body: 'Não conseguimos validar este link. Ele pode já ter sido usado. Se precisar, inscreva-se novamente.',
  },
} as const;

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  // Valida contra a lista fechada. Sem isso, `?status=<script>` chegaria ao
  // template — e mesmo com o React escapando, aceitar entrada arbitrária para
  // escolher conteúdo é um mau hábito que uma hora vira vulnerabilidade.
  const key = status === 'sucesso' || status === 'expirado' ? status : 'invalido';
  const message = MESSAGES[key];

  return (
    <div className="container empty-state">
      <h1 className="article__title">{message.title}</h1>
      <p>{message.body}</p>
      <p>
        <Link href={routes.home()} className="btn btn--primary">
          Voltar para a home
        </Link>
      </p>
    </div>
  );
}
