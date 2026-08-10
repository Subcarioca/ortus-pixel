# Revisão comparativa — Ortus Pixel × portais de mídia nerd/tech (2026-08-10)

Relatório do Weber, produzido antes da implementação do sistema de contas
(admin/redator) + editor por blocos. As 4 decisões de produto que ele
sinalizou como "quebra decisão existente, precisa aprovação" já foram
aprovadas pelo dono do produto — ver seção 5 no fim, todas com "APROVADO".

## 0. Nota de método

Inspeção direta (fetch do HTML de produção, 09–10/08/2026): **Omelete**
(home, listagem de críticas e uma crítica completa), **Ei Nerd**
(einerd.com), **Kotaku** (home + review de Silksong), **CBR** (home, um
listicle e a categoria /anime/), **ScreenRant** (home + uma matéria),
**GameRant**, **Dexerto** e **Jovem Nerd**.

Sem acesso (bloqueio de user-agent/403): IGN, Polygon, The Verge,
Eurogamer, GameSpot, Nintendo Life. Para o Verge, usou reportagem de
terceiros sobre a redesign de 2026 (StoryStream e Quick Posts). CBR/
ScreenRant/GameRant/Polygon rodam o mesmo design system (Valnet), então
CBR/ScreenRant são proxy razoável (não perfeito) do Polygon.

## 1. Comparação direta

### 1.1 Página de matéria

**O Ortus Pixel já faz melhor que o mercado:**
- TL;DR acima do corpo (Kotaku, CBR, ScreenRant, Omelete não têm).
- Disclosure de afiliado atado por código ao bloco de ofertas
  (`showOffers` liga as duas coisas) — Valnet põe "Recommended For You"
  com links de compra no meio do listicle sem aviso proporcional.
- Densidade comercial derivada de formato + temperatura
  (`commercePolicy`) — nenhum dos 8 portais tem isso codificado.
- Assinatura com "atualizado há X" em vermelho de sinal.
- Push contextualizado, só depois do conteúdo.
- Cobertura ao vivo com `.timeline` — paridade conceitual com o
  StoryStream do Verge.

**O que os grandes fazem e o Ortus não faz (por impacto):**

1. **Caixa "Leia também" NO MEIO do texto**, não só no fim. Verificado
   na ScreenRant (`/22-years-later-star-wars-revives-darth-nihilus/`) e
   na CBR. É o mecanismo nº 1 de páginas/sessão desses portais.
2. **Mais de uma imagem por matéria.** `article-body.tsx` não parseia
   imagem — na prática a matéria tem só a capa. Kotaku intercala
   imagens entre seções da review; ScreenRant insere imagem com
   legenda/crédito no meio; CBR usa uma imagem por item de listicle.
3. **Galeria** (CBR, ScreenRant, Omelete) — necessário pra review de
   hardware, cobertura de evento, antes/depois de patch.
4. **Vídeo na página — bug real, não só ausência.** `json-ld.tsx`
   emite `VideoObject` completo (contentUrl, embedUrl, duration) via
   `article.video`, mas nenhum player é renderizado. Dado estruturado
   declarando vídeo que não existe no documento.
5. **Ficha técnica / infobox.** Kotaku: caixa lateral com
   desenvolvedora, tipo, prós/contras, plataformas, data, tempo jogado.
   Omelete: "Ficha Técnica Completa". O Ortus tem `.verdict` (prós/
   contras) mas não o bloco de metadados — sustenta E-E-A-T e rich
   results.
6. **Item de lista rico.** CBR (`/complete-anime-series-zero-bad-episodes-list/`):
   cada um dos 10 itens = título em negrito → imagem própria com
   legenda → crédito de estúdio → 2–4 parágrafos. O `<ol>` do Ortus
   produz `<li>` com uma frase.
7. **Spoiler granular.** `hasSpoiler` embrulha a matéria INTEIRA no
   `SpoilerBlock` hoje. Ninguém no mercado faz isso — Omelete/IGN
   marcam o trecho. `.spoiler__body[data-hidden]` borra até os H2 que
   dariam contexto pra decidir se vale revelar.
8. **Tabela editável.** `.cmp` existe no CSS mas o parser de Markdown
   não suporta tabela. ScreenRant usa tabela em matéria de notícia
   comum, não só comparativo.
9. **Crédito de imagem separado da legenda.** ScreenRant/CBR imprimem
   "Image via X" em linha própria. Hoje `coverImageAlt` faz de legenda
   — erro semântico (alt substitui a imagem pra quem não vê; legenda
   complementa pra quem vê).
10. **Embeds de post/tweet.** Padrão universal em cobertura nerd.
    Ausente.

**O que os grandes fazem e deve-se EVITAR:**
- Widget de compra dentro do listicle (CBR, após o 3º item) — comércio
  no meio do fluxo editorial sem disclosure proporcional. §7.0 do
  README já proíbe; manter a proibição mesmo com o editor de blocos
  tornando trivial inserir.
- Quiz/minigame no meio da matéria (CBR "Guess the Anime", ScreenRant)
  — engagement-bait que quebra a leitura. Se quiser enquete, só depois
  do último parágrafo.
- Listicle raso (4–5 itens, 2 parágrafos cada) — o bloco de entrada
  rica torna isso barato de produzir, e é assim que uma redação vira
  fazenda de conteúdo em 6 meses. **Piso editorial sugerido no editor**:
  formato `listicle` só publica com ≥7 entradas e ≥60 palavras por
  entrada, aviso não-bloqueante no painel.
- Prompt de login acima da manchete (Omelete) — com contas de leitor
  chegando, é tentação óbvia. Não fazer: nada precede a manchete.
- Ficha técnica no fim de tudo (Omelete, depois do corpo inteiro) —
  seguir o Kotaku, ficha perto do topo.
- Comentários zerados exibidos ("0 de cada", Omelete) — prova social
  negativa. Esconder contador até N ≥ 3.

### 1.2 Home

**Já faz melhor:** hero em cascata com rótulo honesto (sem equivalente
no mercado); `.rank-list` numerado com termômetro é mais informativo
que "Trending"/"Popular News" que são só listas de link.

**Gaps:**
1. Ausência de superfície cronológica — ver decisão APROVADA na seção 5
   ("Acabou de sair").
2. Nenhuma sinalização de formato no card — ver decisão APROVADA na
   seção 5 (selo `.fmt`).
3. Nenhuma superfície de vídeo (Ei Nerd "Assista no Canal", CBR/
   GameRant seção "Videos"/"Shorts", Jovem Nerd põe podcast no hero
   com duração). P2 — depende do bloco de vídeo existir primeiro.
4. "Guias e essenciais" mistura guide+listicle+comparison — separar
   "Análises" só quando passar de ~5 publicações/dia (decisão de
   volume já registrada em `page.tsx`, não reverter agora).
5. Contagem de imagem por card: sem gap, todos usam 1.

### 1.3 Página de editoria

1. **Sem paginação real.** `categoria/[slug]/page.tsx` renderiza TODO
   o acervo (`slice(0,6)` + `slice(6)`) numa página só. CBR usa
   paginação de verdade (`/category/anime/2/`, URL própria, indexável).
   Evitar scroll infinito (padrão de Dexerto/ScreenRant, ruim pro
   crawl e pro botão voltar).
2. **Sub-abas por formato ausentes.** README §1 já previu
   `/games/analises`, `/games/trailers`, `/games/guias`; só a aba de
   sub-seção (Hardware) foi implementada. CBR separa News/Features/
   Lists com URL própria. Implementar como `?formato=` com `canonical`
   pra categoria — sem criar IA nova.
3. **Já faz melhor:** sidebar "Em alta em {categoria}" + "Próximos
   lançamentos" — CBR e Omelete não têm sidebar na categoria.

### 1.4 Engajamento e mobile

- Compartilhamento: Ortus põe no topo E no fim (Kotaku só topo,
  ScreenRant/CBR só fim) — está certo. `.share-rail` de 1180px
  continua morto por falta de sistema de ícones.
- Comentários: política do §11 (abrir só em review/guia/listicle/
  teoria na fase 1) é mais conservadora que o mercado — manter.
- Mobile: bottom-nav + máquina de estados da faixa inferior não tem
  equivalente nos benchmarks (que empilham anchor ad + newsletter +
  cookie banner ao mesmo tempo) — não copiar isso.
- Falta: índice (`.toc`) só existe se escrito à mão. Deveria ser
  derivado automaticamente dos títulos dos blocos.

## 2. Tipos de bloco recomendados

**Regra de arquitetura:** separar "blocos" de "campos". TL;DR,
veredito, ficha técnica e ofertas de afiliado NÃO são blocos que o
redator posiciona — a posição é política editorial (§5, §7 do README)
e não pode depender de quem estava de plantão. São campos estruturados
que o template posiciona. O que o redator ordena é o CORPO.

| # | Bloco | Campos | Origem (benchmark) | Prioridade |
|---|---|---|---|---|
| 1 | `paragrafo` | texto rico (negrito, itálico, link, código) | base | P0 |
| 2 | `titulo` | nível (h2/h3), texto → alimenta `.toc` automático | universal | P0 |
| 3 | `imagem` | url, **alt**, legenda, **crédito**, largura (medida/larga/borda-a-borda) | ScreenRant/CBR: imagem+legenda+crédito em linha própria; Kotaku intercala entre atos | P0 |
| 4 | `leia-tambem` | 1-3 artigos internos (busca por título no editor) | ScreenRant/CBR: caixa "Related" dentro do fluxo | P0 |
| 5 | `lista` | ordenada/não, itens com texto rico | base | P0 |
| 6 | `citacao` | texto, autor, cargo/veículo, link da fonte | blockquote atual não tem atribuição | P0 |
| 7 | `video` | provedor, id, duração, thumb, legenda — renderizado como fachada (clique pra carregar) | Ei Nerd, CBR, GameRant; resolve o bug do VideoObject no JSON-LD | P0 |
| 8 | `galeria` | N imagens (url, alt, legenda), legenda coletiva, crédito | CBR, Omelete; obrigatório em review de hardware/evento | P1 |
| 9 | `entrada-de-lista` | número (auto), título, subtítulo, imagem, parágrafos, ficha opcional | CBR listicle; formato mais republicado do nicho | P1 |
| 10 | `ficha-tecnica` | pares rótulo/valor (`<dl>`) | Kotaku, Omelete; E-E-A-T e rich results | P1 |
| 11 | `tabela` | cabeçalho + linhas, coluna de preço opcional (`.cmp` já existe) | ScreenRant usa até em notícia comum | P1 |
| 12 | `spoiler` | rótulo + blocos filhos (1 nível, sem recursão) | **APROVADO — trocar de "matéria inteira" pra "trecho"** | P1 |
| 13 | `callout` | intenção (dica/contexto/aviso), rótulo, texto | evita abuso do blockquote como caixa de destaque | P1 |
| 14 | `embed-social` | rede, url, autor, texto capturado — fachada, sem script de terceiro | universal em cobertura nerd | P1 |
| 15 | `oferta` (afiliado inline) | produto, loja, preço, data de verificação | `.aff-link`/`.buybox` já existem, redator não posiciona hoje | P1 |
| 16 | `separador` | — | ritmo em matéria longa | P2 |
| 17 | `enquete` | pergunta + opções | só depois do corpo, nunca no meio | P2 |

**Decisões de schema (o Coder decide a implementação exata, mas estas
são as restrições):**
- Array plano, UM nível de aninhamento permitido (`spoiler` e
  `callout` aceitam filhos `paragrafo`/`imagem`/`lista`, sem recursão
  livre estilo Notion).
- Bloco `paragrafo` guarda texto com marcação inline em Markdown
  reduzido, reusando o `renderInline` já existente — NUNCA HTML cru
  nem `dangerouslySetInnerHTML` (é uma garantia de segurança
  arquitetural já documentada em `article-body.tsx`, não regredir).
- Anúncio é DERIVADO dos blocos (ex: "depois do N-ésimo `paragrafo`,
  nunca adjacente a `leia-tambem`/`oferta`/`cta`"), nunca posicionado
  pelo redator diretamente.
- `readingMinutes` e o `.toc` passam a ser derivados dos blocos.
- `alt` obrigatório em `imagem`/`galeria`, com checkbox "imagem
  decorativa" pra gravar `alt=""` conscientemente. Publicar sem isso
  marcado = aviso bloqueante no painel (WCAG 1.1.1) — mesma disciplina
  que o §7 já aplica ao comercial (regra no sistema, não na boa
  vontade).
- `excerpt` (dek) e meta description são campos DIFERENTES — hoje
  `article.excerpt` faz os dois papéis, separar enquanto o schema
  ainda está sendo desenhado.
- `hasSpoiler` passa a ser CALCULADO ("existe algum bloco spoiler?"),
  não mais marcado à mão — aprovado na seção 5.

## 3. Recomendações priorizadas

### P0 — só CSS/JSX, não dependem do editor de blocos

1. Rótulo de formato nos cards e no kicker do artigo (`.fmt`, contorno/
   mono, dado já existe via `item.format`/`FORMAT_LABELS`) — **APROVADO**.
2. Paginação real na categoria (`/categoria/games/2`, link "Ver mais").
3. Resolver a incoerência do `VideoObject` (renderizar vídeo real ou
   não emitir o schema).
4. Blocos de mídia podem furar a medida de 44rem do `.article`
   — **APROVADO**, variável de largura própria pra mídia, texto
   continua na largura de sempre.
5. Sprite SVG de ícones (6-8), destrava `.share-rail`, `.tabs`,
   `.heat`, `.trend`.
6. Índice (`.toc`) automático a partir dos H2, sticky no desktop.
7. Esconder contador de comentários quando for 0.
8. Sub-abas por formato na categoria (`/games/analises` etc.).

### P0-condicional — decisões do dono, já resolvidas

9. Faixa "Acabou de sair" na home (4-5 títulos, com horário, sem
   imagem, entre o ranking e a grade) — **APROVADO**, não muda a
   ordenação por repercussão existente.
10. Separar "Análises" de "Guias e essenciais" — só quando volume
    passar de ~5/dia. NÃO implementar agora.

### P1 — dependem do editor de blocos existir

Ordem de maior pra menor retorno: `imagem` (com crédito) → `leia-tambem`
→ `video` (fachada) → `entrada-de-lista` + `galeria` → `ficha-tecnica`
+ `tabela` → `spoiler` granular + `callout` + `embed-social` → `oferta`
inline.

### P2

Atualizações da cobertura ao vivo viram listas de blocos (hoje
`update.content` é um `<p>` cru); rail de vídeo na home; enquete.

## 4. Protótipo

`R:\Claudio\design\artigo-blocos.html` — usa o CSS real do produto
(`../apps/web/src/app/ortuspixel.css`), sem alterá-lo. Matéria de
review montada só com blocos do catálogo acima, cada um marcado com
`<!-- BLOCO: tipo -->` pra mapeamento direto. CSS dos componentes
novos está num `<style>` no topo, construído sobre os tokens da seção 1
do design system (nenhuma cor hardcoded).

## 5. Decisões que quebravam documentação/decisão existente — resolvidas

1. **Faixa cronológica na home** (contraria "a home inteira é ordenada
   por repercussão", `page.tsx` linhas 65-81) — **APROVADO pelo dono**.
2. **Mídia furando os 44rem** (mexe em componente homologado do design
   v0.3) — **APROVADO pelo dono**.
3. **Segundo badge no card** (`.fmt`, adiciona elemento à linha
   reservada à temperatura pelo §4; argumento: é a mesma distinção de
   forma — contorno/mono × pílula preenchida — que o §7.2 já usa pro
   `.deal-seal` não se confundir com badge de temperatura) —
   **APROVADO pelo dono**.
4. **Spoiler por trecho substitui spoiler por matéria inteira** (muda
   o significado de `hasSpoiler` no contrato de dados do §4 — passa a
   ser derivado) — **APROVADO pelo dono**.
