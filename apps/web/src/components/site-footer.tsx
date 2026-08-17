import Link from 'next/link';

import { routes, type CategoryDefinition } from '@subcarioca/core';

import { SITE_NAME, SITE_TAGLINE, SOCIAL_HANDLE } from '@/lib/site';
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
            {/*
              O MESMO SÍMBOLO DE GRAVAÇÃO DO HEADER, aqui substituindo a
              primeira letra do nome por extenso: ◎RTUS **PIXEL**.

              `aria-label` no link é OBRIGATÓRIO, e não um capricho: o texto que
              sobrou no HTML é "rtus" + "Pixel", então sem o rótulo um leitor de
              tela anunciaria o link do rodapé como "rtus Pixel". O "O" existe
              visualmente para quem enxerga e precisa existir textualmente para
              quem não enxerga (WCAG 2.4.4 e 1.1.1).

              O RODAPÉ É O PIOR CASO DO SÍMBOLO, e por isso ele mandou na
              terceira rodada do redesenho: aqui o "O" encosta em "rtus", então
              se ele não ler como letra a marca lê "rtus Pixel". O disco cheio
              que esteve aqui falhava nesse teste; o anel com ponto (§19.1 do
              CSS) volta a fechar a palavra ORTUS sem perder o sinal de "no ar".
            */}
            <Link
              href={routes.home()}
              className="logo logo--px"
              aria-label="Ortus Pixel — página inicial"
            >
              <span className="logo__rec" aria-hidden="true" />
              <span className="logo__word">
                rtus <b>Pixel</b>
              </span>
            </Link>
            {/*
              A TAGLINE abre a descrição, em negrito, como no protótipo: é a
              única linha do site em que a marca se explica em cinco palavras.
              O `<strong>` não é ênfase decorativa — ele separa a promessa (o
              que somos) do detalhamento (o que fazemos), e é o que o leitor de
              tela anuncia com destaque.
            */}
            <p className="note">
              <strong>{SITE_TAGLINE}</strong> Cobertura em tempo real: o que está em
              alta, primeiro.
            </p>
            {/*
              Handle das redes em TEXTO, sem os botões de ícone do protótipo.
              Motivo: o `.icon-btn` do design depende do sprite SVG de
              `design/assets/ortuspixel.js`, que ainda não foi portado para o
              app — renderizar os botões agora daria quatro quadrados vazios.
              O handle sozinho já entrega a informação; os ícones entram junto
              com o sprite, sem precisar mexer nesta cópia.
            */}
            <p className="note">
              Em todas as redes: <b>{SOCIAL_HANDLE}</b>
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
            <h4>A {SITE_NAME}</h4>
            <ul>
              <li>
                <Link href={routes.newsroom()}>Nossa redação</Link>
              </li>
              {/*
                Página institucional de processo editorial: reforça E-E-A-T
                (mostra que existe critério) sem expor mecanismo interno de
                pontuação — a curadoria deve ler como julgamento humano.
              */}
              <li>
                <Link href={routes.methodology()}>Como escolhemos o que publicar</Link>
              </li>
              {/*
                ÚNICO PONTO DE ENTRADA VISÍVEL PARA O PAINEL DA REDAÇÃO.
                Por design, nada no header ou no bottom-nav aponta para /admin —
                aquela área é do leitor (routes.account()), e misturar os dois
                convidaria o leitor a tentar "entrar" achando que é a mesma coisa
                (ver o comentário em site-header.tsx). Mas quem opera o site no
                dia a dia também precisa de um caminho, e "decorar a URL" não é
                esse caminho. O rodapé resolve os dois lados: aparece em toda
                página, em ambos os breakpoints, e fica na coluna institucional —
                discreto o bastante para não competir com a manchete, visível o
                bastante para quem sabe o que procura.
              */}
              <li>
                <Link href={routes.admin()}>Acesso da redação</Link>
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
            <strong>Transparência:</strong> a {SITE_NAME} usa publicidade e links de
            afiliado. Nenhum dos dois influencia a posição de uma notícia no ranking
            de temperatura.{' '}
            <Link href="/politica-de-afiliados">Política de afiliados e publicidade</Link>
          </p>
        </div>

        {/*
          O ano continua sendo calculado em tempo de renderização, e não fixado
          em "2026" como no protótipo estático: um rodapé com ano velho é o
          sinal clássico de site abandonado, e a página é revalidada com
          frequência suficiente para a conta nunca ficar desatualizada.
        */}
        <p className="footer__legal">
          © {new Date().getFullYear()} {SITE_NAME} · Todos os direitos reservados ·
          Marcas e imagens pertencem aos seus respectivos detentores.
        </p>
      </div>
    </footer>
  );
}
