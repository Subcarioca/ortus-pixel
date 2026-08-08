import type { Metadata } from 'next';
import Link from 'next/link';

import { routes } from '@subcarioca/core';

import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Inscrição cancelada',
  robots: { index: false, follow: false },
};

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const ok = status === 'sucesso';

  return (
    <div className="container empty-state">
      <h1 className="article__title">
        {ok ? 'Inscrição cancelada' : 'Não conseguimos cancelar'}
      </h1>
      <p>
        {ok
          ? 'Você não receberá mais nossos e-mails. Sentiremos sua falta — se mudar de ideia, a porta fica aberta.'
          : `O link pode estar incorreto. Escreva para ${CONTACT_EMAIL} que resolvemos manualmente.`}
      </p>
      <p>
        <Link href={routes.home()} className="btn btn--ghost">
          Voltar para a home
        </Link>
      </p>
    </div>
  );
}
