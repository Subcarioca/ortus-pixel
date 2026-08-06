/**
 * =============================================================================
 * PAINEL › AFILIADOS — cadastro de ofertas e vínculo com artigos
 * =============================================================================
 *
 * A TELA É ORGANIZADA POR UMA PERGUNTA SÓ: "qual preço está velho?"
 *
 * Não é a organização óbvia (que seria por data de cadastro ou por loja). É a
 * organização ÚTIL, porque o único trabalho recorrente desta tela é conferir
 * preço — o cadastro acontece uma vez por produto, e a conferência, todo dia.
 *
 * Por isso a fila é ordenada por `priceUpdatedAt` ASCENDENTE: o preço mais
 * velho aparece primeiro. O editor abre a página, resolve o topo da lista e
 * fecha. Se a ordenação fosse por data de criação, ele teria de caçar o que
 * está vencido no meio de ofertas que estão em dia.
 *
 * O ESTADO DO PREÇO É VISÍVEL, NUNCA SILENCIOSO (requisito explícito):
 *   fresco (< 12h)   → discreto
 *   a conferir (12h+)→ âmbar, ainda exibido no site
 *   VENCIDO (24h+)   → contornado em vermelho E com aviso de que o número já
 *                      NÃO está sendo exibido para o leitor
 *
 * A terceira linha é a que importa: sem ela, o editor não tem como saber que a
 * página pública está mostrando "ver na loja" em vez do preço.
 */

import Link from 'next/link';

import {
  AFFILIATE_PROGRAM_LABELS,
  PRICE_FRESHNESS_HOURS,
  formatPrice,
  priceFreshness,
  routes,
  toAffiliateProgramCategory,
} from '@canalnerd/core';
import { prisma } from '@canalnerd/db';

import { AdminLogin } from '@/components/admin/admin-login';
import { AdminActionButton } from '@/components/admin/admin-action-button';
import { OfferCreateForm } from '@/components/admin/offer-create-form';
import { OfferLinkForm } from '@/components/admin/offer-link-form';
import { isAdminAuthenticated } from '@/server/admin-auth';

/** Painel nunca é cacheado: mostra o estado ao vivo. */
export const dynamic = 'force-dynamic';

export default async function AdminAffiliatesPage() {
  if (!(await isAdminAuthenticated())) {
    return <AdminLogin />;
  }

  const [offers, articles] = await Promise.all([
    prisma.affiliateOffer.findMany({
      // Preço mais velho primeiro — ver o comentário no topo.
      // `nulls: 'first'`: oferta sem preço nenhum é o caso mais urgente de todos.
      orderBy: [{ isActive: 'desc' }, { priceUpdatedAt: { sort: 'asc', nulls: 'first' } }],
      take: 100,
      include: {
        articles: {
          select: {
            position: true,
            article: { select: { id: true, slug: true, title: true } },
          },
        },
      },
    }),
    // Só artigos publicados podem receber vínculo: pendurar oferta em rascunho
    // criaria link comercial que ninguém revisou entrando no ar junto com a
    // publicação.
    prisma.article.findMany({
      where: { status: 'published' },
      orderBy: { publishedAt: 'desc' },
      take: 60,
      select: { id: true, title: true, slug: true, format: true, hasAffiliateLinks: true },
    }),
  ]);

  const now = new Date();
  const staleCount = offers.filter(
    (offer) => offer.isActive && priceFreshness(offer.priceUpdatedAt, now) === 'stale',
  ).length;

  return (
    <div className="container admin">
      <header className="admin__head">
        <h1 className="article__title">Afiliados</h1>
        <p className="section-sub">
          Cadastro manual de ofertas e vínculo com artigos. Esta tela é de ação HUMANA:
          o pipeline de curadoria não vincula link comercial a matéria nenhuma.
        </p>
        <nav className="admin-actions">
          <Link href={routes.admin()} className="link-more">
            ← Fila de pautas
          </Link>
          <Link href={routes.adminComments()} className="link-more">
            Comentários
          </Link>
        </nav>
      </header>

      {/* ---------- ALERTA DE PREÇO VENCIDO ---------- */}
      {staleCount > 0 && (
        <section className="side-box" role="status">
          <h2>
            {staleCount} oferta(s) com preço vencido
          </h2>
          <p className="form-hint">
            Passadas {PRICE_FRESHNESS_HOURS}h sem conferência, o site PARA de exibir o
            número e mostra apenas "ver na loja". Confirme ou atualize os preços abaixo
            para que voltem ao ar.
          </p>
        </section>
      )}

      {/* ---------- CADASTRO ---------- */}
      <section aria-labelledby="nova-oferta">
        <h2 id="nova-oferta" className="section-title">
          Nova oferta
        </h2>
        <OfferCreateForm />
      </section>

      {/* ---------- LISTA ---------- */}
      <section aria-labelledby="ofertas-cadastradas">
        <h2 id="ofertas-cadastradas" className="section-title">
          Ofertas cadastradas ({offers.length})
        </h2>

        {offers.length === 0 ? (
          <p className="empty-state">Nenhuma oferta cadastrada ainda.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Preço</th>
                <th scope="col">Conferido</th>
                <th scope="col">Artigos</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => {
                const freshness = priceFreshness(offer.priceUpdatedAt, now);

                return (
                  <tr key={offer.id}>
                    <td>
                      <strong>{offer.productName}</strong>
                      <br />
                      <span className="form-hint">
                        {offer.retailerName} ·{' '}
                        {AFFILIATE_PROGRAM_LABELS[toAffiliateProgramCategory(offer.programCategory)]}
                        {!offer.isActive && ' · DESATIVADA'}
                      </span>
                    </td>

                    <td>
                      {offer.priceCents !== null
                        ? formatPrice(offer.priceCents, offer.currency)
                        : '—'}
                    </td>

                    <td>
                      <span className={`price-age price-age--${freshness}`}>
                        {offer.priceUpdatedAt
                          ? `há ${hoursSince(offer.priceUpdatedAt, now)}h`
                          : 'nunca'}
                      </span>
                      {freshness === 'stale' && (
                        <>
                          <br />
                          <span className="form-hint">preço oculto no site</span>
                        </>
                      )}
                    </td>

                    <td>
                      {offer.articles.length === 0 ? (
                        <span className="form-hint">nenhum</span>
                      ) : (
                        <ul>
                          {offer.articles.map((link) => (
                            <li key={link.article.id}>
                              <Link href={`/admin/afiliados#${link.article.slug}`}>
                                {link.article.title.slice(0, 40)}…
                              </Link>{' '}
                              <AdminActionButton
                                endpoint="/api/admin/offers"
                                payload={{
                                  action: 'unlink',
                                  offerId: offer.id,
                                  articleId: link.article.id,
                                }}
                                label="desvincular"
                                confirmMessage="Remover esta oferta do artigo?"
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>

                    <td>
                      <div className="admin-actions">
                        <AdminActionButton
                          endpoint="/api/admin/offers"
                          payload={{ action: 'confirm-price', offerId: offer.id }}
                          label="Preço confere"
                          variant="primary"
                        />
                        <AdminActionButton
                          endpoint="/api/admin/offers"
                          payload={{
                            action: 'toggle-active',
                            offerId: offer.id,
                            isActive: !offer.isActive,
                          }}
                          label={offer.isActive ? 'Desativar' : 'Reativar'}
                          confirmMessage={
                            offer.isActive
                              ? 'Desativar remove a oferta de todos os artigos que a exibem. Continuar?'
                              : undefined
                          }
                        />
                      </div>

                      <OfferLinkForm offerId={offer.id} articles={articles} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function hoursSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000));
}
