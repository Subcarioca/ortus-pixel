/**
 * =============================================================================
 * SELO DE DISCLOSURE — injetado automaticamente, nunca marcado à mão
 * =============================================================================
 *
 * Server Component: texto puro, sem imagem, sem requisição. Entra no primeiro
 * byte do HTML, não afeta LCP nem CLS (design §7.2).
 *
 * A PROPRIEDADE MAIS IMPORTANTE DESTE COMPONENTE NÃO ESTÁ NELE, e sim em quem
 * o chama: a página de artigo o renderiza a partir de `article.hasAffiliateLinks`,
 * que é DERIVADO da relação artigo↔oferta (ver packages/db/src/mappers.ts).
 *
 * Ou seja: não existe caminho de código em que um link de afiliado seja
 * renderizado e o selo não. Os dois vêm do mesmo fato.
 *
 * POR QUE ISSO PRECISOU SER ESTRUTURAL, E NÃO UM CAMPO NO CMS:
 *
 * A alternativa natural — um checkbox "este artigo tem link de afiliado" —
 * falha da pior forma possível: em silêncio. Ninguém marca a caixa às 23h,
 * publicando um comparativo em cima da hora. Nenhum teste quebra, nenhum alerta
 * dispara, e o site passa a veicular link comercial sem aviso.
 *
 * As consequências são reais:
 *   - CDC art. 36: a publicidade deve ser veiculada de forma que o consumidor
 *     a identifique IMEDIATAMENTE como tal;
 *   - Código do CONAR (art. 28): identificação de publicidade;
 *   - políticas do Google e das próprias redes de afiliados, que suspendem
 *     contas por divulgação ausente.
 *
 * O TEXTO diz as duas coisas que o leitor precisa saber (e que quase nenhum
 * site diz direito): que ganhamos comissão, e que o preço para ele não muda.
 * Sem a segunda, muita gente assume que o link encarece a compra e desvia para
 * a loja na mão — a divulgação honesta converte melhor que a omissão.
 */

import Link from 'next/link';

import { DISCLOSURE_TEXT, type DisclosureKind } from '@canalnerd/core';

interface AffiliateDisclosureProps {
  kind: DisclosureKind;
  /**
   * `mini` é a variante usada dentro de um bloco ou ao lado de um link
   * contextual, onde o aviso completo já apareceu antes na página. Nunca use
   * `mini` como ÚNICO aviso de uma página.
   */
  variant?: 'full' | 'mini';
}

export function AffiliateDisclosure({ kind, variant = 'full' }: AffiliateDisclosureProps) {
  const text = DISCLOSURE_TEXT[kind];

  if (variant === 'mini') {
    return (
      <p className="disclosure disclosure--mini">
        {kind === 'sponsored' ? 'Conteúdo patrocinado.' : 'Link de afiliado — o CanalNerd pode receber comissão.'}
      </p>
    );
  }

  return (
    <aside
      className={`disclosure${kind === 'sponsored' ? ' disclosure--sponsored' : ''}`}
      // `role="note"` comunica a leitores de tela que é informação de contexto
      // sobre o conteúdo, e não parte do texto da matéria.
      role="note"
      aria-label={text.label}
    >
      <p>
        {kind === 'sponsored' && <span className="disclosure__tag">Patrocinado</span>}
        <b>{text.label}.</b> {text.body}{' '}
        <Link href="/politica-de-afiliados">Como isso funciona</Link>.
      </p>
    </aside>
  );
}
