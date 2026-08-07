/**
 * =============================================================================
 * POLÍTICA DE AFILIADOS E PUBLICIDADE
 * =============================================================================
 *
 * Página estática, linkada do rodapé de TODAS as páginas e de cada selo de
 * disclosure. Não é burocracia jurídica: é a página que responde à única
 * pergunta que o leitor faz quando vê um link de compra — "vocês ganham com
 * isso, e isso muda o que vocês escrevem?".
 *
 * Ter esta página é exigência prática de três lados:
 *   - CDC (art. 36) e Código do CONAR: a publicidade precisa ser identificável;
 *   - políticas do Google (conteúdo com links de afiliado deve divulgar);
 *   - a maioria das redes de afiliados exige uma política pública no site como
 *     condição de aprovação do cadastro.
 *
 * O TEXTO evita juridiquês de propósito. Um aviso que ninguém entende cumpre a
 * letra da regra e falha no objetivo dela.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { PRICE_FRESHNESS_HOURS, routes } from '@canalnerd/core';

/** Conteúdo institucional: muda uma ou duas vezes por ano. */
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Política de afiliados e publicidade',
  description:
    'Como a Ortus Pixel ganha dinheiro, o que é link de afiliado, o que é anúncio e por que nada disso influencia o que publicamos.',
  alternates: { canonical: '/politica-de-afiliados' },
};

export default function AffiliatePolicyPage() {
  return (
    // Só `.container`: página de texto corrido, sem sidebar. Ver a nota sobre
    // `.article-layout` em app/[categoria]/[slug]/page.tsx.
    <div className="container">
      <article className="article">
        <h1 className="article__title">Política de afiliados e publicidade</h1>
        <p className="article__dek">
          Como a Ortus Pixel ganha dinheiro e por que isso não muda o que a gente publica.
        </p>

        <div className="prose">
          <h2>Links de afiliado</h2>
          <p>
            Em alguns textos — principalmente reviews, comparativos e guias de compra —
            existem links para lojas. Se você comprar por eles, recebemos uma comissão
            da loja. <strong>O preço para você é exatamente o mesmo.</strong>
          </p>
          <p>
            Todo texto com esse tipo de link traz um aviso no topo, e cada link vem com
            a etiqueta "afiliado" ao lado. Esse aviso é colocado automaticamente pelo
            sistema, a partir do próprio vínculo do produto — não depende de alguém da
            redação lembrar de marcar uma caixinha.
          </p>

          <h2>Como escolhemos os produtos</h2>
          <p>
            A escolha é editorial. Testamos, comparamos e recomendamos o que julgamos
            melhor — nenhuma loja paga para aparecer, e a ordem em que os produtos
            aparecem é decidida pela redação, nunca pelo tamanho da comissão.
          </p>
          <p>
            Quando um produto é ruim, dizemos que é ruim, mesmo que ele tenha link de
            afiliado. Um site em que tudo é ótimo não serve para nada.
          </p>

          <h2>Preços</h2>
          <p>
            Preço de loja muda o tempo todo. Nós conferimos e registramos a data de cada
            conferência: se um preço estiver há mais de {PRICE_FRESHNESS_HOURS} horas sem
            confirmação, <strong>paramos de exibi-lo</strong> e mostramos apenas o botão
            para ver o valor na loja. É preferível não mostrar número a mostrar um número
            que já não vale.
          </p>

          <h2>Anúncios</h2>
          <p>
            Exibimos anúncios do Google AdSense. Eles são sempre identificados com o
            rótulo "Publicidade" e nunca aparecem antes do conteúdo principal. Em notícia
            urgente, o site exibe um único anúncio, no fim do texto — e nenhum link de
            compra.
          </p>

          <h2>O que a monetização NÃO influencia</h2>
          <p>
            A Ortus Pixel ordena as notícias por um{' '}
            <Link href={routes.methodology()}>score de popularidade</Link> calculado a
            partir de sinais de interesse do público: velocidade de busca, repercussão em
            redes, autoridade da fonte e outros.
          </p>
          <p>
            <strong>
              Nenhum sinal de receita entra nessa conta.
            </strong>{' '}
            Um assunto não sobe no ranking por render mais dinheiro, e um produto não
            ganha destaque por pagar comissão maior. Essa separação é uma regra técnica
            do sistema, verificada automaticamente a cada alteração de código — e não
            apenas uma promessa nesta página.
          </p>

          <h2>Conteúdo patrocinado</h2>
          <p>
            Hoje a Ortus Pixel <strong>não publica</strong> conteúdo patrocinado (matéria
            paga por anunciante). Se um dia isso mudar, ele virá com identificação
            destacada de "Patrocinado", diferente do aviso de afiliado, e nunca aparecerá
            no ranking de <Link href={routes.trending()}>Em alta</Link>.
          </p>

          <h2>Dúvidas</h2>
          <p>
            Se um preço estiver errado, um link quebrado ou um aviso faltando, fale com a
            gente: é falha nossa e queremos corrigir.
          </p>
        </div>
      </article>
    </div>
  );
}
