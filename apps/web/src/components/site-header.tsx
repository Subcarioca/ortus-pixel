import Link from 'next/link';

import { routes, type CategoryDefinition } from '@subcarioca/core';

import { HeaderNav } from './header-nav';
import { NavDrawer } from './nav-drawer';
import { SearchForm } from './search-form';

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
 *
 * AJUSTE 2026-08 (segunda rodada) — O SÍMBOLO VIROU "GRAVANDO":
 *
 *    O "O" passou por duas formas em dois dias, e as duas foram pedido do dono:
 *    primeiro um "O" em pixel art (um anel de células quadradas), agora o SINAL
 *    DE GRAVAÇÃO — o disco vermelho cheio de "algo está sendo gravado", com um
 *    halo que pulsa devagar.
 *
 *    A troca faz sentido para este produto: o site cobre notícia em tempo real,
 *    e o disco de gravação diz "estamos no ar AGORA" toda vez que a página
 *    carrega. É a mesma ideia do ponto pulsante que existia antes do redesenho
 *    (`.logo__dot`), agora promovida a letra da marca em vez de enfeite ao lado
 *    dela — por isso o `.logo__dot` não voltou: seriam dois discos carmim
 *    pulsando no mesmo canto da tela.
 *
 *    O símbolo é um `<span>` vazio, não um SVG: um círculo é `border-radius:
 *    50%` e mais nada, e como elemento de CSS ele herda tamanho do wordmark e
 *    ganha a animação de graça. Ver `.logo__rec` em ortuspixel.css §19.1.
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
          pinta o `<b>` de `--ink`. Ele existe para que a marca antiga continue
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
            ENTRADA DA CONTA DO LEITOR — e o motivo de ela ser um ÍCONE NEUTRO,
            e não um botão "Entrar" em destaque:

            ler o Ortus Pixel não exige conta, e um convite de login competindo
            com a manchete comunicaria o contrário. Quem nunca vai logar não
            precisa ser lembrado disso em toda página; quem já logou encontra a
            própria área onde ela sempre esteve.

            O rótulo é o mesmo nos dois estados (logado ou não) porque o header
            é CACHEADO junto do resto do HTML — descobrir aqui se há sessão
            tornaria todas as páginas do site dinâmicas. A página /minha-conta,
            essa sim, é dinâmica e mostra o estado real.
          */}
          <Link href={routes.account()} className="icon-btn" aria-label="Minha conta">
            <span className="ico" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
