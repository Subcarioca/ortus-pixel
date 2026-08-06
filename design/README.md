# Ortus Pixel — UI/UX v0.2

> **Marca:** Ortus Pixel · **Tagline oficial:** "Sempre antenado no universo nerd."
> Wordmark: `Ortus` em tinta neutra + `Pixel` em `--brand` (é o `<b>` dentro de `.logo`), precedido do `.logo__dot`.
> Artigo gramatical em texto corrido: **a** Ortus Pixel (como "a Omelete", "a IGN"). Handle em redes: **@ortuspixel**.
> Sem subtítulo fixo do tipo "Ortus Pixel News" — só o wordmark e, quando houver espaço, a tagline.

Protótipo navegável de alta fidelidade (HTML/CSS estático) + arquitetura de informação.
Documento de referência para o time que está construindo o backend/pipeline e o front-end final.

**Abra `index.html` no navegador** e navegue pela barra do topo ("Protótipo Ortus Pixel").
Teste em 360px de largura primeiro — o design é mobile-first de verdade, não um desktop encolhido.
Troque o tema pelo botão de sol/lua no header (ou pelo controle de 3 estados no rodapé).

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Home |
| `em-alta.html` | Página "Em Alta" (ranking ao vivo por temperatura) |
| `categoria.html` | Página de categoria (exemplo: Games) |
| `categoria-hardware.html` | **Novo** · Tech › **Hardware** — sub-seção dedicada, maior densidade de afiliado do site |
| `hub-franquia.html` | Hub de franquia/fandom (exemplo: GTA VI) + bloco "Loja GTA VI" |
| `artigo.html` | Artigo **quente** (breaking + live blog): densidade comercial mínima |
| `artigo-review.html` | **Novo** · Review de hardware: veredito + "Onde comprar" + comparativo com preço + produtos citados |
| `sistema.html` | Design system: tokens, temas, temperatura, formatos, conversão e **monetização** |
| `assets/ortuspixel.css` | Todos os tokens e componentes (fonte da verdade do visual) |
| `assets/ortuspixel.js` | Sprite de ícones, micro-interações e persistência opcional do tema |

---

## 0. O que mudou da v0.1 para a v0.2

Cinco decisões do dono do site + uma camada nova. Resumo do que o front-end precisa saber:

| # | Decisão | Efeito no design |
|---|---|---|
| 1 | **Paleta:** preto + cinza + vermelho, "um pouco mais clara". Violeta descartado. | Marca virou **carmim escuro**; os neutros perderam o tom azulado e ficaram mais claros. Ver §2 (regra dos dois vermelhos). |
| 2 | **Dark mode não é mais forçado.** | Tema **claro é o padrão**, escuro é opção. Toggle em CSS puro com `light-dark()` + `color-scheme`. Ver §3. |
| 3 | **Score 0–100 não aparece em público.** | Badges perderam o número; entrou o termômetro de 4 blocos e a tendência qualitativa ("Subindo", "Esfriando"). O número segue no `/admin`. Ver §4. |
| 4 | **Tipografia Archivo + Inter** mantida. | Nenhuma mudança. |
| 5 | **Comentários com Discord *e* Google.** | Novo componente `.auth-grid`, separado do bloco de comunidade do Discord. Ver §6. |
| + | **Monetização (AdSense + afiliados, hardware prioritário).** | Seção inteira nova: §7. Regras codificadas no CSS, não na boa vontade de quem escreve o HTML. |

---

## 1. Arquitetura de informação (mapa de páginas)

```
/                                  Home
├── /em-alta                       Ranking ao vivo por temperatura  ← página-manifesto
├── /games                         Categoria (+ /cinema-e-series, /anime-e-manga,
│   ├── /games/analises              /hqs, /tech, /eventos)
│   ├── /games/trailers            Sub-abas por formato (filtro, não nova IA)
│   └── /games/guias
├── /tech
│   └── /tech/hardware             ← NOVO: sub-seção dedicada (não se mistura ao fluxo)
├── /f/{franquia}                  Hub de fandom: /f/gta-6, /f/marvel, /f/star-wars…
│   ├── #ultimas / #linha-do-tempo / #essencial   (#essencial hospeda a "Loja [Franquia]")
├── /evento/{slug}                 Página de evento (CCXP, Gamescom)
├── /{categoria}/{slug}            Artigo
├── /newsletter · /redacao · /metodologia
└── /politica-comercial            ← NOVO: como ganhamos dinheiro (linkada de toda disclosure)
```

**Três eixos de navegação:** temperatura (o que é urgente agora) · editoria (o que eu gosto) ·
fandom (a franquia que eu sigo). O eixo 3 é o que traz o leitor de volta.

**Por que Hardware é sub-seção e não uma tag solta:** o contrato com o leitor muda. Em Games ou
Cinema ele lê para se informar; em Hardware ele lê para decidir uma compra. Misturar os dois no
mesmo fluxo obrigaria a diluir link comercial por todo o site. Isolando, a densidade alta fica
confinada a uma área em que ela é esperada — e o resto do site continua limpo.

**Navegação mobile:** barra inferior fixa de 5 itens (Home / Em alta / Editorias / Meus hubs / Conta).
Ela é **intocável**: nenhum elemento de monetização pode cobri-la, competir com ela ou ocupar sua faixa.

---

## 2. Paleta: a regra dos dois vermelhos

O vermelho agora é **cor de marca** *e* continua sendo o **sinal de urgência**. Se os dois usarem
o mesmo tom no mesmo formato, em duas semanas nenhum leitor sente mais nada ao ver "URGENTE".
A separação é feita em **três dimensões ao mesmo tempo** — não só no tom:

| | **Carmim de marca** `--brand` | **Vermelho de sinal** `--heat-hot` |
|---|---|---|
| Valor **(v0.3)** | `#A81729` (claro) / `#CA414F` (escuro) | `#DE0E2D` (claro) / `#E51733` (escuro) |
| Contraste | 6.8:1 texto · 7.5:1 como botão | 5.0:1 (claro) / 4.7:1 (escuro) com texto branco |
| Tom | escuro, dessaturado, quase vinho | vivo, saturado, quase rosa |
| Forma | **acento**: filete, borda, sublinhado, botão primário, logo | **pílula preenchida**, mono, caixa-alta, com ícone de chama |
| Movimento | estático (única exceção: o ponto do logo) | ponto pulsante |
| Onde aparece | logo, nav ativa, botão primário, foco, `.tldr`, blockquote, progresso de leitura | badge Urgente, ticker, live dot, `.btn--hot` de alerta, timeline "novo" |
| **Proibido** | qualquer pílula/badge/selo; qualquer coisa que sugira "isso está bombando" | **anúncio, bloco de afiliado, selo comercial**, botão que não seja de alerta |

**Teste rápido para o coder:** *se o elemento pode existir em uma página sem nenhuma notícia quente,
ele não pode ser vermelho vivo.* Foi por esse teste que migraram para o carmim, na v0.2: o botão
"Compartilhar" do header, o ponto de notificação, o ponto do logo e a barra de progresso de leitura.

Na **v0.3** os dois tons foram recalibrados contra o CSS de produção de 17 portais do nicho — a
*regra* não mudou, só os valores. A separação medida (ΔE76) é de 22,8 no tema claro e 25,6 no
escuro, acima dos 19,2 que o design system da Valnet (CBR, Polygon, Collider, ScreenRant) usa em
produção para separar marca de sinal. Detalhes e fontes na **§10**.

Complementos da escala de temperatura (laranja, cinza, verde) continuam existindo: eles são um
**sistema de sinalização**, como semáforo, e não fazem parte da identidade de marca. Só mudaram de
luminância para passar em contraste também no tema claro.

---

## 3. Tema claro e escuro

**Claro é o padrão. Escuro é escolha.** Quem nunca tocou no controle recebe o tema do sistema
operacional (`prefers-color-scheme`). Quem escolheu, tem a escolha respeitada em qualquer situação.

### Como está implementado (sem framework, sem duplicar paleta)

```css
:root {
  color-scheme: light dark;                       /* padrão: segue o SO */
  --bg: light-dark(#F5F5F7, #131317);             /* cada token traz os 2 valores */
  --ink: light-dark(#16161A, #F4F4F6);
}
:root[data-theme="light"], :root:has(#th-light:checked) { color-scheme: light; }
:root[data-theme="dark"],  :root:has(#th-dark:checked)  { color-scheme: dark;  }
```

- **Trocar de tema muda uma única propriedade:** `color-scheme`. Nenhum componente tem classe de tema.
- `data-theme` é o caminho do produto: um script inline de 5 linhas no `<head>` lê o `localStorage`
  e grava o atributo **antes da primeira pintura** (sem flash branco).
- `:has(#th-*)` é o caminho do protótipo: rádio + CSS, funciona com JavaScript desligado.
- O JS de `ortuspixel.js` só faz a escolha sobreviver à troca de página — não é requisito.
- Se precisar suportar navegador sem `light-dark()`: compilar os tokens em dois blocos
  (`:root` e `[data-theme=dark]`). A arquitetura não muda, só a saída.

### Onde fica o controle (Nielsen #1 visibilidade e #3 controle do usuário)

- **Header:** um botão de 40px que mostra sempre **a ação** ("ativar tema escuro"), nunca o estado —
  o estado já ocupa a tela inteira. Ele é um `<label for>` apontando para os rádios do rodapé.
- **Rodapé:** controle completo de 3 estados (Sistema / Claro / Escuro). É o único lugar da página
  com os `<input type="radio">`; assim o estado é único e não há dois controles brigando.

### O que **não** muda com o tema

Fotos e thumbs (foto não tem tema), a lógica de hierarquia (o hero é o hero nos dois) e a paleta
comercial, que é cinza nos dois temas. As cores de temperatura só ajustam luminância para manter
contraste ≥ 4.5:1 — o laranja "Em alta", por exemplo, usa texto escuro nos dois temas, porque
laranja com texto branco não passa em nenhum dos dois.

---

## 4. Hierarquia por temperatura (sem número visível)

A faixa muda **quatro variáveis ao mesmo tempo**, e é a combinação que faz o leitor "sentir" a
urgência sem ler legenda nenhuma:

| Faixa (interna) | Rótulo público | Posição | Tamanho | Cor + selo | Comportamento |
|---|---|---|---|---|---|
| 80–100 | **URGENTE** | Hero acima da dobra + ticker | Gigante (4:3 mobile, 21:9 desktop) | Vermelho vivo, badge com ponto pulsante, glow | Candidato a push; **zero comercial acima da dobra** |
| 60–79 | **EM ALTA** | Seção "Em alta agora" | Médio | Laranja, seta + tendência qualitativa | Sem animação |
| 40–59 | **RELEVANTE** | Grade cronológica | Padrão | Cinza, badge discreto | Nenhum destaque |
| < 40 | **GUIA** | "Guias", "Essencial", "Leia também" | Card sem imagem grande, filete verde | Verde | Mostra tempo de leitura em vez de horário |

### O número saiu da tela (decisão 3)

- Nenhuma página pública mostra `97/100`, `+38` ou `score 74`.
- No lugar entraram: **rótulo textual** + **cor** + **ícone** + **`.heatbar`** (termômetro de 4
  blocos, com `aria-label`) + **tendência qualitativa** ("Disparando", "Subindo", "Esfriando", "Novo").
- Ganhos colaterais: para de expor a metodologia, e "Disparando" comunica movimento melhor que "+38"
  para quem não conhece a escala. (Nielsen #2: linguagem do usuário, não do sistema.)
- O número continua existindo no contrato de dados, no ranqueamento e na tela da redação (`/admin`),
  onde `.score__num` e `.score--admin` seguem no CSS.
- **Cuidado:** a página `/metodologia` explica os critérios **sem** publicar pesos e cortes.

### Regras que o front-end precisa respeitar

- **Exclusividade cromática:** vermelho vivo e laranja pertencem à temperatura. Nem botão, nem aviso,
  nem banner, nem **anúncio ou afiliado** podem usá-los.
- **Cor nunca sozinha:** todo badge tem ícone + rótulo textual (WCAG 1.4.1).
- **Teto de 3 "quentes" simultâneos na home.** Página inteira vermelha = nada é urgente.
- **O evergreen não compete.** Calmo de propósito.
- **A temperatura muda o peso, não a ordem cronológica** dentro das grades de categoria.
- **A temperatura nunca é influenciada por monetização.** Regra de produto, com consequência de
  design: nenhum elemento comercial pode se parecer com um sinal de popularidade (§7).

### Contrato de dados esperado do pipeline

```jsonc
{
  "score": 97,                        // 0-100 — INTERNO. Não renderizar em página pública.
  "heat": "hot",                      // hot | rise | base | ever  (derivado no backend)
  "heat_level": 4,                    // 1-4 → alimenta o .heatbar (nunca o número)
  "trend": "surging",                 // surging | up | down | flat | new  → rótulo qualitativo
  "score_updated_at": "2026-08-06T09:42:00Z",
  "category": { "slug": "tech", "label": "Tech" },
  "subsection": "hardware",           // NOVO: liga o template de sub-seção comercial
  "franchises": [{ "slug": "gta-6", "label": "GTA VI" }],
  "format": "review",                 // breaking | live | trailer | review | listicle | theory |
                                      //   comparison | guide
  "is_live": true, "updates_count": 8, "has_spoiler": true,
  "tldr": ["...", "..."],
  "review": { "score": 8.9, "pros": [], "cons": [] },
  "commerce": {                       // NOVO — ver §7
    "has_affiliate": true,            // liga a disclosure completa
    "disclosure_level": "affiliate",  // affiliate | sponsored (sponsored desligado hoje)
    "offers": [
      { "store_label": "Loja A", "price": 219900, "currency": "BRL",
        "url": "...", "checked_at": "2026-08-06T09:10:00Z", "best_value": true }
    ]
  },
  "ads": { "allowed": true, "max_body_slots": 2, "anchor_allowed": true },
  "reading_time_min": 9,
  "push_eligible": true
}
```

Três observações para o backend:

1. **`heat` e `heat_level` são calculados no servidor.** O front só mapeia string → classe CSS.
2. **`tldr` não é opcional em conteúdo quente.**
3. **`ads` e `commerce` são derivados de `format` + `heat`, não escolhidos à mão pelo redator.**
   Se `heat == "hot"`, o backend já devolve `has_affiliate:false` e `max_body_slots:1`. A regra de
   densidade (§7.1) vira dado, não disciplina.

---

## 5. Decisões por página

### Home (`index.html`)
Hero na dobra inteira do mobile · ticker vermelho só com score ≥ 90 · "Em alta agora" como lista
ranqueada com termômetro · ordem das editorias = ordem das personas · "Seus universos" antes da
newsletter · evergreen no fim. **Comercial:** nenhum slot antes do ranking; 1 leaderboard depois
dele e 1 retângulo no fim da grade. O hero nunca desce por causa de anúncio.

### Em Alta (`em-alta.html`)
Contadores no topo ("2 urgentes agora", "9 em alta" — sem faixas numéricas) · pódio visual · degrau
explícito entre "em alta" e o fluxo normal · caixa "Como calculamos a temperatura" com a frase que
mais importa: *o que não entra na conta é anúncio, afiliado e parceria comercial*.
**Comercial: o fluxo do ranking é zona livre de anúncio.** Um bloco comercial entre as posições
seria lido como posição comprada. Só existe 1 slot, no fim da sidebar do desktop.

### Categoria (`categoria.html`)
Filete de 3px na cor da editoria · filtro de temperatura em chips · sidebar "Em alta em Games" ·
newsletter segmentada · sub-abas por formato. **Comercial:** in-feed a cada 6 cards (máx. 2) +
1 sticky na sidebar.

### Tech › Hardware (`categoria-hardware.html`) — **novo**
Aba dedicada dentro das sub-abas de Tech (única com ícone, porque muda o contrato com o leitor).
Ordem da página: **disclosure completa → ofertas verificadas → anúncio → conteúdo editorial →
guias de compra**. A caixa "Como testamos" na sidebar existe para sustentar E-E-A-T em uma página
assumidamente comercial: compramos ou devolvemos as unidades, mesma bancada, nota antes do preço,
nada disso entra no ranking.

### Hub de franquia (`hub-franquia.html`)
Cabeçalho de identidade com countdown · Últimas · Linha do tempo · Essencial. As três ações de
retenção (Seguir / Alertar / Discord) continuam no topo, sozinhas. **A "Loja GTA VI" fica no fim da
seção "Essencial"** — o fã precisa terminar de se relacionar com o hub antes de ver algo à venda.
O stat "score atual" virou o badge de temperatura.

### Artigo quente (`artigo.html`)
Ordem: badge → editoria → fandom → manchete → linha fina → assinatura → compartilhar → mídia →
**TL;DR** → cobertura ao vivo → corpo. **Comercial mínimo:** 1 slot depois do último parágrafo,
1 na sidebar (que no desktop já começa abaixo da dobra), **zero afiliado** — nem na tabela de edições,
que num breaking viraria suspeita de motivação editorial. A sticky bar de newsletter está nesta
página, então o anúncio ancorado está desligado automaticamente.

### Review (`artigo-review.html`) — **novo**
Disclosure completa antes de qualquer link → veredito (nota, prós, contras) → **"Onde comprar"** →
anúncio → índice → corpo com links contextuais → comparativo com coluna de preço → resumo dos
produtos citados → comentários. A regra editorial está escrita na própria disclosure: *a nota foi
fechada antes de qualquer link entrar*.

---

## 6. Funil de conversão e comentários

| Etapa | Componente | Regra de exibição |
|---|---|---|
| Anônimo → Leitor engajado | TL;DR, relacionadas por franquia, chips de fandom, hub | Sempre |
| Leitor → Inscrito (newsletter) | CTA no meio do corpo | Após 3º parágrafo ou 45% de rolagem |
| Leitor → Inscrito (newsletter) | Sticky bar mobile / exit-intent desktop | Máx. 1x a cada 7 dias; nunca para inscrito; nunca em sessão vinda de push |
| Leitor → Inscrito (push) | Prompt de push | Só após 60% de leitura de conteúdo urgente/em alta; nunca no 1º pageview |
| Leitor → Participante | **Comentários: Discord ou Google** | Sempre, no fim do artigo |
| Inscrito → Comunidade | Bloco Discord por fandom | Canal escolhido pela tag de franquia |
| Comunidade → Advocate | Share nativo + contador | WhatsApp primeiro |

### Comentários: dois logins, um componente (decisão 5)

- `.auth-grid` com **dois botões de peso idêntico** — mesma largura, mesma altura, mesmo raio, cada
  um com o ícone do seu provedor. Nenhum é "o recomendado": quem tem Discord usa Discord, quem tem
  Google usa Google. (Nielsen #4 consistência, #7 flexibilidade.)
- **Discord de login ≠ Discord de comunidade.** São dois componentes, em dois pontos diferentes da
  página, com dois verbos diferentes: *"Comentar com Discord"* (`.auth-grid`) e *"Entrar no canal
  #gta-6"* (`.community`). Sem essa separação, o leitor clica achando que vai comentar e cai num
  convite de servidor — erro de expectativa clássico. (Nielsen #5 prevenção de erros.)
- Escopo mínimo (nome público + foto), apelido editável, exclusão dos próprios comentários e link
  para a política de dados abaixo dos botões, **antes** do clique.
- Moderação continua sendo custo operacional real: sugerimos abrir comentários só em formatos
  `review`, `guide`, `listicle` e `theory` na fase 1 — breaking com live blog é onde a moderação
  quebra.

---

## 7. Monetização (AdSense + afiliados)

**Princípio único, do qual todo o resto deriva:** *o leitor precisa conseguir distinguir, em menos de
um segundo e sem ler nada, o que é jornalismo e o que é comércio.* Se essa distinção falha, o ranking
de temperatura perde valor — e o ranking é o produto.

### 7.0 As cinco regras rígidas (e onde cada uma está codificada)

| Regra | Como o design garante |
|---|---|
| 1. Vermelho vivo proibido em anúncio, afiliado e disclosure | A paleta comercial é **cinza/grafite** (`--ad-*`, `--aff-*`) nos dois temas. O CTA de compra é `.btn--buy` (grafite), nem carmim de marca nem vermelho de sinal. |
| 2. Conteúdo urgente: zero comercial acima da dobra | O backend devolve `has_affiliate:false` + `max_body_slots:1`; hero e TL;DR vêm antes de qualquer slot no DOM; a sidebar (único slot desktop) só existe a partir de 1024px e é o último box. |
| 3. Altura reservada sempre | Todo slot é `.ad` com `--ad-h` fixo por variante. Se o anúncio não carregar, a caixa cinza permanece: o texto não pula. Mesmo princípio do `aspect-ratio` do vídeo. |
| 4. Uma barra fixa por vez, e a bottom-nav é sagrada | `body:has(.sticky-bar) .ad-anchor { display:none }` — a exclusividade está no seletor, não na disciplina do time. `.ad-anchor { bottom: 64px }` sempre acima da nav. |
| 5. Disclosure textual antes do clique | `.disclosure` (completa) e `.disclosure--mini` (por bloco/link) são **texto**, não ícone nem cor. Todo link comercial leva `rel="sponsored nofollow"` + etiqueta "afiliado" visível. |

**Máquina de estados da faixa inferior do mobile**, em ordem de prioridade:

1. `bottom-nav` — sempre visível, nunca coberta, nunca reduzida.
2. `sticky-bar` de newsletter — máx. 1x a cada 7 dias, nunca para inscrito, nunca em sessão vinda de push.
3. `ad-anchor` — só se (2) não está na tela, só depois de 50% de rolagem, **nunca** em conteúdo
   urgente enquanto hero/TL;DR estiverem visíveis, sempre com botão de fechar de 40px.

Nunca (2) e (3) juntos. Nunca nenhum dos dois sobre a bottom-nav.

### 7.1 Tabela de densidade: formato × temperatura

Posições sempre ancoradas em componentes que já existem (`.tldr`, `.toc`, `.verdict`, `.cmp`,
`.timeline`). Reservas: leaderboard 100px mobile / 90px desktop · retângulo 250 / 280px ·
sidebar 600px · in-feed 250px · ancorado 50px + 14px de moldura.

| Formato | Faixa típica | Acima da dobra | Slots no corpo — posição exata | Sidebar ≥1024 | Ancorado mobile | Afiliado |
|---|---|---|---|---|---|---|
| **Breaking** | Urgente | **Nenhum** | **1** · leaderboard 320×100 / 728×90, **depois do último parágrafo** (nunca antes do `.tldr`) | 1 · 300×600, último box | **Não** enquanto hero/TL;DR visíveis | **Proibido** |
| **Cobertura ao vivo** | Urgente | **Nenhum** | **1** · depois da `.timeline`, nunca entre atualizações | 1 · 300×600 | **Não** | **Proibido** |
| **Notícia** | Em alta / Relevante | Nenhum | **2** · após 3º parágrafo (300×250) e após o corpo (728×90) | 1 · 300×600 | 1 · após 50% de rolagem | Só link contextual, se natural |
| **Trailer / reação** | Em alta | Nenhum | **1** · abaixo do embed, nunca acima | 1 · 300×600 | 1 | 1 link (pré-venda) + disclosure mini |
| **Review** | Relevante / Guia | Nenhum | **2** · abaixo do `.buybox` (que vem colado ao `.verdict`) e antes das relacionadas | 1 · 300×600 | 1 | **Alta**: `.buybox` + `.aff-summary` |
| **Comparativo** | Relevante / Guia | Nenhum | **2** · abaixo da `.cmp` e no fim | 1 · 300×600 | 1 | **Alta**: coluna de preço na `.cmp` + selo |
| **Guia / Explicador** | Guia | **Nunca antes do `.toc`** | **2–3** · a cada ~4 blocos `h2`, jamais dentro do `.toc` | 1 · 300×600 | 1 | **Alta**: links inline + `.aff-summary` |
| **Listicle** | Guia | Nenhum | **máx. 4** · 1 a cada 3 itens | 1 · 300×600 | 1 | 1 link por item + `.aff-summary` |
| **Hardware (Tech)** | Relevante / Guia | Nenhum | **2** · entre blocos de produto, nunca dentro de um `.prod` | 1 · 300×600 + caixa de ofertas | 1 | **Máxima do site** |
| **Home** | — | Nenhum (hero intocável) | **2** · leaderboard depois do ranking + retângulo no fim da grade | — | Não | Nenhum |
| **Categoria** | — | Nenhum | **máx. 2** · in-feed a cada 6 cards, sempre após linha completa | 1 · 300×250 sticky | 1 | Só na sub-seção Hardware |
| **Em Alta** | — | Nenhum | **0** — fluxo do ranking é zona livre | 1 · 300×250, fim da sidebar | Não | **Proibido** |
| **Hub de franquia** | — | Nenhum (topo é retenção) | **0** no fluxo · bloco `.shop` dentro de "Essencial" | 1 · 300×250 | Não | Bloco "Loja [Franquia]" |

Leitura da tabela em uma frase: **quanto mais quente e mais factual, menos comercial; quanto mais
evergreen e mais próximo de uma decisão de compra, mais tolerância.**

### 7.2 Componentes novos — e por que cada um não quebra LCP/CLS nem a hierarquia

**`.ad` (slot de anúncio, 5 variantes)**
Altura vem de `--ad-h` no CSS, então o espaço existe antes de qualquer requisição — CLS 0 mesmo com
anúncio bloqueado. Nenhuma variante entra antes do LCP (hero/manchete), e o rótulo "Publicidade" em
mono cinza fora da caixa impede que o criativo seja lido como conteúdo. Não usa cor de temperatura,
então não disputa a leitura de "o que está pegando".

**`.ad-anchor` (ancorado mobile)**
Fixo, altura reservada, `bottom: 64px` (acima da bottom-nav) e desligado por CSS quando a sticky bar
existe. Como é `position: fixed`, não participa do fluxo — não desloca nada, não afeta CLS do corpo.
O `padding-bottom` do `body` já reserva a faixa. É o único elemento comercial que o leitor pode
fechar, e o botão de fechar tem o mesmo alvo de toque dos demais ícones.

**`.disclosure` / `.disclosure--mini` / `.disclosure--sponsored`**
Texto puro em HTML, sem imagem e sem requisição: entra no primeiro byte, não afeta LCP nem CLS.
Usa cinza e um filete neutro — nunca vermelho, nunca laranja —, o que a torna informação de
contexto, não sinal de urgência. O modificador `--sponsored` já está pronto para o publieditorial
futuro: mesma família visual, peso maior, rótulo "Patrocinado" preenchido.

**`.buybox` ("Onde comprar", estende `.verdict`)**
É um bloco irmão colado **abaixo** do veredito, nunca um substituto: quem só queria a nota já a leu
acima do bloco. Sem imagens (só texto e preço), então não compete pelo LCP nem introduz layout
shift. Ordenado por preço e com data de verificação visível — o selo de "melhor custo-benefício"
segue o critério editorial, não a comissão.

**Coluna de preço + `.deal-seal` na `.cmp`**
A tabela já existia com rolagem horizontal e larguras estáveis; a coluna nova entra no mesmo
`.table-wrap` e não muda a altura das linhas. O selo é **contorno + ícone + frase em caixa mista** —
o oposto formal do badge de temperatura (preenchido, mono, caixa-alta, pulsante). Impossível
confundir "melhor compra" com "está bombando".

**`.shop` ("Loja [Franquia]" no hub)**
Fica no fim de "Essencial", a três blocos de distância dos botões de retenção do topo, então não
disputa com Seguir/Discord no momento em que a conversão de retenção acontece. As imagens de
produto usam `aspect-ratio: 1` reservado no `.prod__img`; nenhuma delas é candidata a LCP porque
todas estão bem abaixo da dobra.

**`.prod` (card de produto) e `.deal-strip` (ofertas de hardware)**
Grid de duas colunas com imagem quadrada de tamanho fixo: o texto nunca reflui quando a foto chega.
Visual neutro, sem badge, sem selo colorido — um card de produto jamais é confundido com um card
editorial, o que protege a leitura da grade.

**`.aff-link` + `.aff-tag` (link contextual inline)**
Sublinhado tracejado + etiqueta textual "afiliado" ao lado, contra o sublinhado sólido carmim do
link editorial: duas gramáticas visuais distintas na mesma frase, sem depender de cor. Custo zero de
layout (é inline, sem elemento em bloco) e disclosure antes do clique, como manda a regra 5.

**`.aff-summary` ("produtos citados")**
Sempre no fim, depois de todo o conteúdo: não empurra nada relevante para baixo e não entra na
janela de LCP. Serve à intenção de compra de quem chegou até o fim e evita espalhar mais links pelo
meio do texto — menos densidade percebida, mesma receita.

### 7.3 O que ainda depende de decisão comercial

- **Rede de afiliados:** desenhado genérico ("Loja A / Loja B"). Quando a rede for escolhida, entram
  logotipos de 30×30px em `.store__logo` — o layout não muda.
- **Publieditorial:** desligado. Quando existir, é só usar `.disclosure--sponsored` e um selo
  "Patrocinado" no card. **Recomendação:** conteúdo patrocinado nunca entra em `/em-alta`, nunca
  recebe badge de temperatura e nunca aparece no hero.
- **Preços:** o carimbo "verificado em DD/MM, HH:MM" é obrigatório. Preço sem data envelhece e vira
  reclamação — e, pior, mancha a credibilidade do resto do site.

---

## 8. Como o design serve aos KPIs

| KPI | Decisões de design que atacam o KPI |
|---|---|
| Tempo de sessão / páginas por sessão | Hub com 3 pontos de entrada; "Mais de GTA VI"; sidebar "Em alta"; sub-abas |
| Rejeição em notícia quente | TL;DR acima; HTML puro no primeiro byte; embed só ao clique; **zero anúncio acima da dobra** |
| Conversão de newsletter/push | Um campo só; CTA contextual; push no pico de intenção com justificativa |
| Retorno de leitores | Hubs com "seguir" + countdown; bottom-nav com "Meus hubs"; push por franquia |
| Scroll depth em evergreen | Índice fixo; listicles em página única; timeline vertical |
| **Receita sem dano à marca** | Densidade por formato (§7.1); comercial concentrado em Hardware e evergreen; ranking blindado |
| **Core Web Vitals** | Altura reservada em 100% dos slots; nada comercial na janela do LCP; anchor fora do fluxo |

---

## 9. Especificações técnicas do visual

- **Tokens:** tudo em custom properties no `:root` de `assets/ortuspixel.css`, com `light-dark()`.
  Não hardcode cor — nem em `style=` inline.
- **Tipografia:** Archivo (manchetes, 800/900), Inter (corpo, 17px mobile / 18px desktop, linha 1.75,
  medida máx. 44rem), JetBrains Mono (horários, contadores, preços e rótulos de sistema).
  Escala fluida com `clamp()`.
- **Breakpoints:** 320 · 480 (buybox empilha) · 560 · 640 · 768 (fim da bottom-nav e do anchor) ·
  900 · 1024 (sidebar) · 1180 (trilho de share) · 1280 (largura máxima).
- **Acessibilidade:** alvos de toque ≥ 40px (48px em botão primário), foco visível de 3px, skip link,
  landmarks, `aria-current`, contraste ≥ 4.5:1 **nos dois temas** (medido caso a caso na v0.3 —
  ver §10.5, que documenta duas falhas encontradas e corrigidas), `.heatbar` com `aria-label`,
  `prefers-reduced-motion` respeitado. Só duas coisas animam: o badge "Urgente" e o ponto do logo.
- **Ícones:** sprite SVG injetado por JS no protótipo; no produto, inline ou sprite estático.
- **Publicidade e leitores de tela:** rótulo "Publicidade" é texto real, o slot fica fora do
  `<article>` e links comerciais levam `rel="sponsored nofollow"`.

---

## 10. Benchmark de paleta (v0.3) — o que o mercado realmente usa

O dono do site pediu uma pesquisa de paleta e depois **liberou a família de cor**: *"não precisa
manter a base de cores atual, só o dark mode. Decida com base na sua pesquisa."*

Então a pergunta foi reaberta de verdade. O método não foi olhar logotipo em banco de imagem
(que costuma estar desatualizado — os bancos ainda listam o vermelho antigo da IGN, `#E10600`):
foi **baixar o HTML/CSS de produção de 17 portais e extrair os hexadecimais reais**, com a
frequência de cada um e o seletor em que aparecem.

### 10.1 O que foi medido

| Portal | Cor de marca real (CSS de produção) | Base neutra | Observação |
|---|---|---|---|
| **IGN** ([ign.com](https://www.ign.com/)) | `#BF1313` — 213 ocorrências, no `fill` do logo, botões e `.article_type` | `#181C25` / `#F5F5F5` | Vermelho **escurecido**, não o `#E10600` dos bancos de logo. 5.8:1 sobre branco. |
| **CBR** ([cbr.com](https://www.cbr.com/)) | `--brand-color-primary: #C61327` | `#101010` / `#F2F2F2` | Token literalmente chamado "brand primary". 5.5:1. |
| **Polygon** ([polygon.com](https://www.polygon.com/)) | `#E90C59` magenta | idem CBR | Mesmo design system da CBR (grupo Valnet). |
| **ScreenRant** ([screenrant.com](https://screenrant.com/)) | `#D29F13` dourado | idem | Mesmo system, marca diferente. |
| **Collider** ([collider.com](https://collider.com/)) | `#49BF3C` verde | idem | Mesmo system, marca diferente. |
| **Dexerto** ([dexerto.com](https://www.dexerto.com/)) | `#E0005E` / `#D91A68` | — | Magenta, mesma família da Polygon. |
| **The Verge** ([theverge.com](https://www.theverge.com/)) | `#5200FF` roxo + `#3CFFD0` mint | `#131313` | Dois acentos: roxo estrutural, mint como "marca-texto" (`inset box-shadow`). |
| **Kotaku** ([kotaku.com](https://kotaku.com/)) | `#DC3232` | `#0C0C0C` | Vermelho claro, 4.6:1 — no limite do AA. |
| **Den of Geek** ([denofgeek.com](https://www.denofgeek.com/)) | `#ED3226` + `#FBCA0E` | `#32373C` | 4.1:1: **não passa AA** como texto. |
| **GameSpot** ([gamespot.com](https://www.gamespot.com/)) | `#FFC501` amarelo | `#00191D` | Amarelo sobre quase-preto. |
| **Eurogamer** ([eurogamer.net](https://www.eurogamer.net/)) | `#FF4500` laranja | — | |
| **Nerdist** ([nerdist.com](https://nerdist.com/)) | `#01BAF3` azul | `#000006` | |
| **Gizmodo/io9** ([gizmodo.com](https://gizmodo.com/)) | `#004FFF` + `#FF45DC` | `#06062A` | |
| **JovemNerd** ([jovemnerd.com.br](https://jovemnerd.com.br/)) | `--color-brand: #297E7E` (claro) / `#70D0D0` (escuro) | `#282828` / `#FAFAFA` | Teal. |
| **Omelete** ([omelete.com.br](https://www.omelete.com.br/)) | `--colors--omelete--9: #FFC300` | `#202020` | Amarelo. Sem dark mode. |
| **Legião dos Heróis** ([legiaodosherois.com.br](https://www.legiaodosherois.com.br/)) | `#00ACF0` azul | `#212121` | |
| **EiNerd** ([einerd.com.br](https://www.einerd.com.br/)) | multicolorido (`#44D62B`, `#F22178`, `#FFCA1A`…) | — | Sem cor de marca única. |

### 10.2 Os quatro aprendizados que mudaram o CSS

**1. A base preto/cinza é unânime — isso nem estava em disputa.**
Todos os 17, sem exceção, são neutro quase-preto + neutro quase-branco + **uma** cor de acento
saturada. Valnet `#101010`/`#F2F2F2`, Verge `#131313`, Omelete `#202020`, JovemNerd `#282828`/`#FAFAFA`.
Os neutros da Ortus Pixel (`#131317`/`#F5F5F7`) caem exatamente nessa faixa. **Mantidos sem alteração.**

**2. A "regra dos dois vermelhos" não é uma invenção nossa: é prática de produção.**
Este foi o achado mais forte. CBR, Polygon, Collider e ScreenRant rodam o **mesmo** design system
(Valnet) com marcas de famílias completamente diferentes — vermelho, magenta, verde, dourado — e
**todos os quatro carregam o mesmo `#FF1540`**. Rastreando os seletores, esse vermelho vivo nunca é
marca: ele é `.has-notification:after`, `.alert-error`, `input.error`, `.modal-confirm`. Ou seja,
**vermelho vivo é token de sistema/sinal; a marca é outra coisa** — exatamente a separação que a
Ortus Pixel escreveu na §2. A CBR é o caso extremo: marca `#C61327` e sinal `#FF1540` convivem no
mesmo CSS, separados por luminância e saturação. Distância perceptual medida: **ΔE76 = 19,2**.

**3. Nosso carmim estava escuro demais para a faixa do nicho.**
Contraste sobre branco: IGN 5.8:1 · CBR 6.0:1 · Kotaku 4.6:1 · Den of Geek 4.1:1.
Ortus Pixel v0.2: **9.1:1** — mais escuro que todos, sem exceção. Na prática `#8C1C28` lia como vinho
ou marrom em tela pequena: a marca tinha sacrificado a própria presença para não competir com o
sinal. E a medição mostrou que esse sacrifício era desnecessário — a separação marca/sinal da
Ortus Pixel estava em **ΔE 38,2**, o dobro do que a Valnet prova ser suficiente em produção.
Havia folga de sobra para clarear.

**4. Dark mode: o nicho é dark-first, mas isso não vira argumento para forçar.**
Valnet (4 portais), The Verge e JovemNerd declaram `color-scheme: dark`. O que interessa é *como*
o JovemNerd faz: `--color-brand: #297E7E` no claro e `#70D0D0` no escuro — **um token, dois valores,
marca mais clara no escuro.** É literalmente a arquitetura `light-dark()` da §3, com a mesma
regra de clarear o acento no tema escuro. Arquitetura confirmada; a decisão do dono (claro padrão,
escuro por toggle) segue intacta.

### 10.3 A decisão: por que a família continua sendo preto/cinza/vermelho

Com a família reaberta, avaliei as alternativas e todas perdem por motivo concreto, não por gosto:

- **Vermelho é a única família com massa crítica em portal de *notícia*** do nicho: IGN, CBR,
  Kotaku e Den of Geek. Magenta (Polygon, Dexerto) e roxo (Verge) pertencem a marcas de *opinião
  e cultura autoral*; a Ortus Pixel é um agregador de urgência, e vermelho é a única família com
  semântica cultural direta de breaking news.
- **No Brasil, o vermelho está vago.** JovemNerd é teal, Omelete é amarelo, Legião é azul, Nerdist
  é azul, EiNerd é multicolorido. Adotar teal seria virar sósia do concorrente nº 1; amarelo, do
  nº 2. O espaço livre no mercado brasileiro é justamente o que já tínhamos.
- **As outras famílias colidem com tokens já alocados.** Magenta = `--cat-anime`. Roxo = `--cat-eventos`
  (e foi descartado pelo dono na v0.2). Ciano = `--cat-tech`. Verde = `--heat-ever`. Amarelo/laranja
  = `--heat-rise`. Com 6 editorias + 4 temperaturas já coloridas, não sobra espectro limpo.

**Conclusão: a pesquisa confirmou a família e reprovou os tons.** O que mudou foi calibragem.

### 10.4 O que efetivamente mudou no `ortuspixel.css`

| Token | v0.2 | v0.3 | Motivo |
|---|---|---|---|
| `--brand` claro | `#8C1C28` (8.3:1) | **`#A81729`** (6.8:1) | Entra na faixa do nicho, sai do "vinho". Continua um degrau mais escuro que IGN/CBR de propósito: aqui o vermelho de urgência é o produto e precisa de folga. |
| `--brand` escuro | `#B93340` | **`#CA414F`** | **Correção de bug**, ver §10.5. |
| `--brand-600` | `#701420`/`#A02836` | `#8C1424`/`#B4313F` | Acompanha o novo `--brand`. |
| `--brand-ink` | `#8C1C28`/`#E4A0A6` | `#8C1424`/`#E9AEB4` | Marca como **texto** fica AAA nos dois temas (8.6:1 e 9.9:1), enquanto `--brand` fica AA forte em superfície. |
| `--heat-hot` claro | `#E5102F` (4.72:1) | **`#DE0E2D`** (4.99:1) | Passava raspando; agora tem margem. |
| `--heat-hot` escuro | `#FF3050` | **`#E51733`** | **Correção de bug**, ver §10.5. |
| `--heat-hot-text` escuro | `#FF6B7F` | `#FF7C8D` | Acompanha, 7.5:1. |
| Neutros, editorias, laranja, verde, cinza comercial | — | **inalterados** | O benchmark confirmou que já estavam na faixa certa. |

**Separação marca × sinal depois da mudança:** ΔE **22,8** no tema claro e **25,6** no escuro, contra
os 19,2 que a Valnet opera em produção. A marca ganhou presença e a regra dos dois vermelhos
continua com margem **acima** da referência de mercado.

### 10.5 Dois bugs de acessibilidade que a medição encontrou

O README dizia "contraste ≥ 4.5:1 nos dois temas". Medindo caso a caso, **duas combinações não
cumpriam** — nenhuma das duas seria notada a olho nu:

1. **`--brand` no tema escuro** (`#B93340`) dava **2.98:1** contra `--surface-1` (`#1A1A1F`).
   Um filete ou borda de marca sobre card escuro ficava **abaixo do mínimo de 3:1** do
   WCAG 1.4.11 (Non-text Contrast). Agora: 3.62:1.
2. **`--heat-hot` no tema escuro** (`#FF3050`) dava **3.63:1** com o texto branco da pílula
   "URGENTE". Como o badge é mono, caixa-alta, ~11px, ele é *texto pequeno* e exige 4.5:1 —
   ou seja, **o componente mais importante do site falhava em AA justamente no tema escuro**.
   Agora: 4.66:1, e a pílula ainda mantém 3.97:1 contra o fundo. (Nielsen #4: consistência —
   o badge tem que se comportar igual nos dois temas, não só parecer igual.)

Todas as combinações ajustadas foram reconferidas nos dois temas: texto de corpo em **AAA**
(16.6:1 claro, 16.9:1 escuro), texto secundário AAA, texto terciário AA, marca AA/AAA,
badge quente AA.

### 10.6 O que a pesquisa mostrou e nós deliberadamente NÃO copiamos

- **Den of Geek (`#ED3226`, 4.1:1) e Kotaku (`#DC3232`, 4.6:1)** usam vermelhos claros e vivos como
  marca. O de Den of Geek **não passa AA** como texto. Não seguimos: nosso piso é AA real medido.
- **Den of Geek e Eurogamer usam a mesma família (vermelho/laranja vivo) para marca *e* para
  destaque de urgência**, sem separação. É a contradição direta da nossa §2 — e é exatamente o
  problema que a regra dos dois vermelhos existe para evitar: quando tudo é vermelho, "URGENTE"
  para de significar urgência em duas semanas. Mantida a regra da Ortus Pixel.
- **Valnet e The Verge forçam `color-scheme: dark`.** Não seguimos: a decisão do dono (§3) é claro
  como padrão e escuro como escolha, e forçar tema é violação de Nielsen #3 (controle e liberdade
  do usuário). Copiamos a *arquitetura* de token deles, não a imposição.
- **EiNerd não tem cor de marca única** (usa uma cor por categoria, sem âncora). Para um site cujo
  produto é hierarquia de urgência, isso destruiria a leitura da temperatura.

---

## 11. Pendências e backlog

**Precisam de decisão do dono do site:**

1. **Rede de afiliados** (muda logos e parâmetros de URL, não o layout).
2. **Comentários em quais formatos** — sugerimos abrir só em review/guia/listicle/teoria na fase 1,
   por causa do custo de moderação.
3. **Publieditorial** — componente pronto, política editorial ainda não escrita.
4. **Página `/politica-comercial`** — hoje é um link em toda disclosure e ainda não existe.

**Backlog de fase 2:**

- Página de evento (`/evento/ccxp-2026`) com timeline ao vivo e agenda.
- Landing de newsletter e página "Sobre a redação".
- Área "Colecionador/Cultura pop" (persona 5) reaproveitando `.prod` e `.shop`.
- Tela `/admin` da redação, único lugar onde o score 0–100 e os deltas aparecem.
- Busca com autocomplete por franquia e feed "Para você" a partir dos hubs seguidos.
- Comparador de preços com histórico (só depois que o feed de preços for confiável).
