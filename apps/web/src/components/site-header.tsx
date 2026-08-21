import Link from 'next/link';

import { routes, type CategoryDefinition } from '@subcarioca/core';

import { HeaderNav } from './header-nav';
import { NavDrawer } from './nav-drawer';
import { PersonIcon } from './nav-icons';
import { SearchForm } from './search-form';
import { SearchShortcut } from './search-shortcut';

/**
 * Cabeçalho do site.
 *
 * A ordem das editorias no menu NÃO é alfabética: segue a prioridade de
 * negócio (Games > Cinema & Séries > Anime > HQs > Tech > Eventos), que é a
 * mesma ordem de `monitoringPriority` na taxonomia. Como as categorias já vêm
 * ordenadas de `CATEGORIES`, o menu se mantém alinhado à estratégia sozinho —
 * sem ninguém precisar lembrar de atualizar dois lugares.
 *
 * RE-SKIN v0.3 — duas mudanças de vocabulário:
 *
 *  - O logo do HEADER usa a marca curta `O.<b>Pixel</b>` (rebranding visual —
 *    o nome do site continua "Ortus Pixel" em toda parte que não é o wordmark:
 *    `SITE_NAME`, meta tags, JSON-LD, e-mails). O rodapé mantém o nome por
 *    extenso (ver site-footer.tsx) para não perder o "Ortus" de vista.
 *
 * RE-SKIN 2026-08 — A MARCA INVERTEU O VERMELHO (pedido do dono do produto):
 *
 *    antes:  O.<b>Pixel</b>     → "O" em texto comum, "Pixel" em carmim
 *    agora:  ●.<b>Pixel</b>     → "O" é um símbolo vermelho, "Pixel" em preto
 *
 *    O "O" de Ortus virou o único elemento colorido da marca. O `<b>` continua
 *    ali, mas com o papel trocado: `.logo--px b` pinta o texto de `--ink`.
 *    (Este parágrafo descreve a v0.3; a cor do `<b>` mudou de novo na terceira
 *    rodada, logo abaixo.)
 *
 * AJUSTE 2026-08 (segunda rodada) — O SÍMBOLO VIROU "GRAVANDO":
 *
 *    O "O" passou por duas formas em dois dias, e as duas foram pedido do dono:
 *    primeiro um "O" em pixel art (um anel de células quadradas), depois o
 *    SINAL DE GRAVAÇÃO — o disco vermelho cheio de "algo está sendo gravado",
 *    com um halo que pulsa devagar.
 *
 *    A troca faz sentido para este produto: o site cobre notícia em tempo real,
 *    e o símbolo de gravação diz "estamos no ar AGORA" toda vez que a página
 *    carrega. É a mesma ideia do ponto pulsante que existia antes do redesenho
 *    (`.logo__dot`), agora promovida a letra da marca em vez de enfeite ao lado
 *    dela — por isso o `.logo__dot` não voltou: seriam dois carmins pulsando no
 *    mesmo canto da tela.
 *
 * AJUSTE 2026-08 (terceira rodada) — O SÍMBOLO VIROU LETRA DE NOVO, SEM DEIXAR
 * DE SER O SINAL DE GRAVAÇÃO:
 *
 *    agora:  ◎.<b>Pixel</b>   → anel carmim com ponto pulsante  +  "Pixel" em
 *                               pixel art (Press Start 2P) verde-fósforo
 *
 *    O disco CHEIO da rodada anterior não lia como letra — e o pedido desta
 *    rodada foi manter o significado sem perder o "O". A solução não escolhe um
 *    dos dois: o botão de gravação de verdade (o de qualquer app de câmera) É
 *    um anel com um ponto dentro, e anel é a forma do "O". O vazio interno, que
 *    o disco tinha eliminado, é justamente o que faz o olho reconhecer a letra.
 *
 *    O "Pixel" saiu de `--ink` e foi para o verde-fósforo de CRT
 *    (`--brand-pixel`), em fonte bitmap. A marca passa a ter duas cores com
 *    papéis distintos: carmim = "no ar agora", verde 8-bit = "nerd/games".
 *
 *    O símbolo é um `<span>` vazio, não um SVG: anel, ponto e halo são
 *    `border-radius: 50%` e mais nada, e como elemento de CSS ele herda o
 *    tamanho do wordmark e ganha a animação de graça. Ver `.logo__rec` e o
 *    racional completo dos três desenhos testados em ortuspixel.css §19.1.
 *  - Os links do menu deixaram de usar `.cat cat--{slug}`. `.cat` é o RÓTULO
 *    de editoria (filete colorido + caixa-alta 10px), pensado para aparecer
 *    dentro de um card, subordinado ao badge de temperatura. Aplicá-lo ao menu
 *    principal dava seis filetes coloridos competindo no topo — exatamente a
 *    hierarquia que o design §2 evita. O protótipo usa `<a>` puro, estilizado
 *    por `.header__nav a`, com o filete de marca só na página atual.
 */
export function SiteHeader({ categories }: { categories: readonly CategoryDefinition[] }) {
  return (
    <header className="header">
      <div className="container header__bar">
        {/*
          BOTÃO HAMBÚRGUER — só existe visualmente abaixo de 1024px (CSS
          `.nav-toggle`, ver §4 do design). Cobre o tablet: `.bottom-nav`
          (mobile) já sumiu em 768px e `.header__nav` (abaixo) só aparece em
          1024px — sem este botão, de 768 a 1023px não havia como trocar de
          editoria. Vem ANTES da logo, na mesma posição do protótipo.
          Ver `nav-drawer.tsx` para o painel que ele abre.
        */}
        <NavDrawer categories={categories} />

        {/*
          `.logo--px` (e não só `.logo`): o modificador zera o `gap` do flex e
          troca a fonte e a cor do `<b>` (pixel art verde). Ele existe para que
          a marca antiga continue
          válida nos protótipos de `design/*.html`, que ainda usam `.logo` com o
          ponto pulsante — mudar a regra base quebraria todos eles de uma vez.

          O texto vive num `<span>` ÚNICO porque `.logo` é `display:flex`: solto,
          cada trecho viraria um item de flex independente e o espaço entre
          "rtus" e "Pixel" (no rodapé) seria descartado pelo layout. Dentro do
          span, o texto volta a ser texto.

          O `<span>` do símbolo é VAZIO e `aria-hidden`: ele é uma letra
          desenhada, e quem anuncia a marca é o `aria-label` do link. Sem isso,
          um leitor de tela leria o cabeçalho como ".Pixel".
        */}
        <Link
          href={routes.home()}
          className="logo logo--px"
          aria-label="Ortus Pixel — página inicial"
        >
          <span className="logo__rec" aria-hidden="true" />
          <span className="logo__word">
            .<b>Pixel</b>
          </span>
        </Link>

        {/*
          Marca `aria-current="page"` na editoria atual (CSS já pronto:
          `.header__nav a[aria-current="page"]`). Precisa saber o pathname,
          por isso é o único pedaço deste cabeçalho que é Client Component —
          ver o comentário de `header-nav.tsx`.
        */}
        <HeaderNav categories={categories} />

        <div className="header__actions">
          {/* Não renderiza nada — só liga o listener do atalho "/". Ver o
              cabeçalho de search-shortcut.tsx para por que não vive dentro
              de SearchForm (que continua zero JavaScript). */}
          <SearchShortcut />
          <SearchForm variant="header" />

          {/* Abaixo de 768px não cabe campo de busca no cabeçalho (ver
              `.header__search` no CSS): sobra este atalho para a página, onde o
              campo ocupa a largura inteira. */}
          <Link
            href={routes.search()}
            className="icon-btn header__search-link"
            aria-label="Buscar no site"
          >
            <span className="ico" aria-hidden="true" />
          </Link>

          {/*
            "Em alta" recebe tratamento de destaque no header porque é a
            página-manifesto do produto: é ela que comunica o diferencial de
            "sabemos o que está bombando agora".
          */}
          <Link href={routes.trending()} className="btn-hot-nav">
            <span className="live-dot" aria-hidden="true" />
            Em alta
          </Link>

          {/*
            ENTRADA DA CONTA DO LEITOR — aba visível, e o motivo de ela ser
            NEUTRA (não colorida, ao contrário de "Em alta" logo acima):

            ler o Ortus Pixel não exige conta, e um convite de login competindo
            visualmente com a manchete comunicaria o contrário. A rodada
            anterior desta decisão tinha ido longe demais na direção oposta,
            porém: `.icon-btn .ico` sozinho é só uma caixa (ver `.ico` em
            ortuspixel.css — sem `background`/`content`, não desenha nada), e
            o SPAN vazio que este link continha não tinha NENHUM símbolo, só o
            `aria-label`. Ou seja: quem enxerga não via ícone nem texto nenhum
            aqui — o mesmo bug que a barra inferior mobile tinha antes de
            ganhar os 5 traçados (ver `bottom-nav.tsx`). Pedido explícito do
            dono do produto: uma aba de conta no desktop igual à que já existe
            no mobile — ícone + rótulo "Conta", não mais um alvo de clique
            invisível. `PersonIcon` é o MESMO símbolo da aba "Conta" da barra
            inferior (`./nav-icons`), então as duas telas mostram a mesma
            pessoa para o mesmo conceito.

            O rótulo é o mesmo nos dois estados (logado ou não) porque o header
            é CACHEADO junto do resto do HTML — descobrir aqui se há sessão
            tornaria todas as páginas do site dinâmicas. A página /minha-conta,
            essa sim, é dinâmica e mostra o estado real.

            SEM `aria-label` agora: antes era obrigatório porque o link não
            tinha nenhum texto visível para nomeá-lo. Com "Conta" na tela,
            adicionar `aria-label="Minha conta"` por cima criaria um NOME
            ACESSÍVEL diferente do texto visível — quem usa comando de voz e
            tenta "clicar em Conta" (o que está na tela) não acharia o alvo,
            porque para a árvore de acessibilidade o link se chama "Minha
            conta". O `<Link>` já tem nome próprio: o texto que ele contém.
          */}
          <Link href={routes.account()} className="btn-account-nav">
            <PersonIcon className="ico" />
            Conta
          </Link>
        </div>
      </div>
    </header>
  );
}
