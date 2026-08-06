import Link from 'next/link';

import { routes, type CategoryDefinition } from '@canalnerd/core';

import { ThemeToggle } from './theme-toggle';

/**
 * Rodapé do site.
 *
 * RE-SKIN v0.3 — a estrutura agora é a do protótipo, e as três correções não
 * são cosméticas:
 *
 *  1. `.container` deixou de ser fundido com `.footer__grid`. Eram duas
 *     responsabilidades num elemento só (largura máxima × grade de 4 colunas),
 *     e o `display:grid` do segundo anulava o comportamento do primeiro. Com a
 *     separação, o rodapé finalmente vira 4 colunas a partir de 700px.
 *  2. Os títulos de coluna voltaram a ser `<h4>`. O design os estiliza por
 *     elemento (`.footer h4`); a classe `.footer__title` que estava aqui não
 *     existe na folha de estilo. O nível 4 também é o correto no sumário: são
 *     subtítulos de navegação, não seções de conteúdo.
 *  3. O bloco de baixo virou `.footer__bottom` (flex, tema à esquerda e
 *     transparência à direita) + `.footer__legal` como parágrafo — que é o que
 *     a classe estiliza. Antes, `.footer__legal` embrulhava tudo e aplicava
 *     `font-size: xs` e cinza ao controle de tema inteiro.
 */
export function SiteFooter({ categories }: { categories: readonly CategoryDefinition[] }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link href={routes.home()} className="logo">
              <span className="logo__dot" aria-hidden="true" />
              Canal<b>Nerd</b>
            </Link>
            <p className="note">
              Cobertura em tempo real do universo nerd. O que está em alta, primeiro.
            </p>
          </div>

          <nav aria-label="Editorias">
            <h4>Editorias</h4>
            <ul>
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link href={routes.category(c.slug)}>{c.name}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Explorar">
            <h4>Explorar</h4>
            <ul>
              <li>
                <Link href={routes.trending()}>Em alta agora</Link>
              </li>
              <li>
                <Link href={routes.newsletter()}>Newsletter</Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Institucional">
            <h4>O CanalNerd</h4>
            <ul>
              <li>
                <Link href={routes.newsroom()}>Nossa redação</Link>
              </li>
              {/*
                A página de metodologia é diferencial editorial E de SEO:
                explicar publicamente como o score é calculado reforça E-E-A-T
                (transparência é sinal de confiabilidade) e diferencia o produto.
              */}
              <li>
                <Link href={routes.methodology()}>Como calculamos o score</Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="footer__bottom">
          {/*
            Controle de tema no RODAPÉ, e não no cabeçalho (posição escolhida no
            design v0.2): é um ajuste que a pessoa faz uma vez na vida. No topo,
            ocuparia espaço permanente de uma área que precisa ser de conteúdo e
            navegação — num portal de notícias, cada pixel acima da dobra vale
            mais do que um botão de preferência.
          */}
          <ThemeToggle />

          {/*
            Divulgação de afiliados no rodapé, em TODAS as páginas.
            O selo por artigo (injetado automaticamente quando há link comercial)
            cobre o caso concreto; este link cobre a exigência de ter uma política
            permanente e acessível de qualquer página — que é o que o CDC, o
            Código do CONAR e as próprias redes de afiliados esperam.
          */}
          <p className="note">
            <strong>Transparência:</strong> o CanalNerd usa publicidade e links de
            afiliado. Nenhum dos dois influencia a posição de uma notícia no ranking
            de temperatura.{' '}
            <Link href="/politica-de-afiliados">Política de afiliados e publicidade</Link>
          </p>
        </div>

        <p className="footer__legal">
          © {new Date().getFullYear()} CanalNerd. Todos os direitos reservados. Marcas e
          imagens pertencem aos seus respectivos detentores.
        </p>
      </div>
    </footer>
  );
}
