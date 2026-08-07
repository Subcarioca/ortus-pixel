#!/usr/bin/env node
/**
 * =============================================================================
 * VERIFICADOR DE CLASSES — o markup do produto × a folha de estilo do design
 * =============================================================================
 *
 * POR QUE ESTE SCRIPT EXISTE
 * --------------------------
 * O produto não escreve CSS próprio: ele carrega a folha do design system
 * (`apps/web/src/app/ortuspixel.css`, cópia verbatim de `design/assets/*.css`
 * mais um apêndice de pontes). Isso é ótimo para manter protótipo e produto
 * alinhados, e cria exatamente um risco: **escrever uma classe que não existe é
 * um erro silencioso**.
 *
 * Não há erro de build. Não há warning no console. O elemento simplesmente
 * renderiza sem o estilo que deveria ter — e como o estado "sem estilo" muitas
 * vezes se parece com o estado correto (um `.rank--base` inexistente deixa a
 * linha neutra, que é o visual desejado), o bug pode viver meses no site.
 * Quando ele NÃO se parece com o correto, o sintoma é confuso: "o corpo do
 * artigo virou uma coluna de 56px", "as imagens não carregam", "o feed inteiro
 * está empilhado no desktop". Todos esses foram, de fato, classes erradas.
 *
 * O QUE ELE VERIFICA (três checagens independentes)
 * -------------------------------------------------
 *  1. RUNTIME — busca cada página no servidor de desenvolvimento e confere que
 *     TODA classe do HTML entregue existe no CSS. É a única checagem que
 *     alcança as classes montadas em tempo de execução (`rank--${heat}`,
 *     `cat--${token}`), que são justamente as que erram.
 *  2. CLASSES MORTAS — proíbe explicitamente o vocabulário das versões
 *     anteriores do design. Elas não quebram nada por si só, mas voltam por
 *     copiar-e-colar de código antigo.
 *  3. REGISTRO DE MODIFICADORES — confere que a tabela HEAT_BLOCK_MODIFIERS do
 *     core descreve os modificadores que o CSS realmente define. Sem isso, a
 *     tabela vira mais uma cópia para desatualizar.
 *
 * A checagem 1 depende de dados: se nenhuma notícia da faixa "relevante"
 * aparecer no ranking hoje, `.rank--base` não é gerado e o erro não aparece. A
 * checagem 3 não depende de dados — ela cobre o mesmo bug pelo outro lado. Uma
 * cobre o que a outra deixa passar, e é por isso que as duas existem.
 *
 * USO
 * ---
 *   node scripts/check-classes.mjs                  # dev server em :3000
 *   node scripts/check-classes.mjs --base=http://localhost:3001
 *   node scripts/check-classes.mjs --skip-runtime   # só as checagens estáticas
 *
 * Sai com código 1 se encontrar problema, para poder entrar no CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILE = path.join(ROOT, 'apps/web/src/app/ortuspixel.css');
const CORE_PRESENTATION = path.join(ROOT, 'packages/core/src/presentation.ts');

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('--base=')) ?? '--base=http://localhost:3000').slice(7);
const SKIP_RUNTIME = args.includes('--skip-runtime');

/**
 * Páginas cobertas. A lista inclui as três variações de editoria cujo slug NÃO
 * coincide com o token do design (`cinema-e-series`, `anime-e-manga`, `hqs`):
 * elas são o caso que já quebrou antes, então precisam estar aqui por nome.
 *
 * Os artigos são os do seed. Se o seed mudar, ajuste aqui — uma URL 404 falha o
 * script de propósito, porque uma página que não abre não foi verificada.
 */
const PAGES = [
  ['home', '/'],
  ['em alta', '/em-alta'],
  ['categoria · games', '/categoria/games'],
  ['categoria · cinema (slug ≠ token)', '/categoria/cinema-e-series'],
  ['categoria · anime (slug ≠ token)', '/categoria/anime-e-manga'],
  ['categoria · hqs (slug ≠ token)', '/categoria/hqs'],
  ['categoria · tech', '/categoria/tech'],
  ['categoria · eventos', '/categoria/eventos'],
  ['sub-categoria · hardware', '/categoria/tech/hardware'],
  ['hub de franquia', '/franquia/gta'],
  ['artigo · notícia', '/games/rockstar-confirma-novo-atraso-de-gta-vi-para-novembro'],
  ['artigo · review + afiliados', '/tech/review-rtx-5070-e-a-placa-de-video-com-melhor-custo-beneficio-de-2026'],
  ['artigo · listicle', '/games/os-15-melhores-jogos-de-mundo-aberto-para-jogar-em-2026'],
  ['metodologia', '/metodologia'],
  ['política de afiliados', '/politica-de-afiliados'],
];

/**
 * Vocabulário das versões anteriores do design (v0.1/v0.2). Nenhuma destas
 * classes existe na folha atual; se alguma reaparecer no HTML, é código antigo
 * voltando por cópia.
 */
const DEAD_CLASSES = [
  'article-layout',       // grade de 3 colunas — exige o .share-rail, que o produto não renderiza
  'cat--cinema-e-series', // slug de URL usado como token de design
  'cat--anime-e-manga',
  'cat--hqs',
  'cd-box__title',
  'section__head',
  'section__title',
  'section__dek',
  'rank-list__item',
  'rank-list__num',
  'rank-list__title',
  'rank-list__meta',
  'card__media',
  'card__img',
  'card__foot',
  'card__meta',
  'card__live',
  'article__body',
  'share-bar',
  'share-bar__label',
  'fandom-list',
  'fandom__count',
  'hero-secondary',
  'hero__head',
  'grid--ever',
  'cta-news--compact',
  'trending-head',
  'trending-stats',
  'divider__label',
];

/** Classes que não vêm do design e por isso não precisam existir no CSS. */
const EXTERNAL = /^(adsbygoogle|__|next-)/;

// -----------------------------------------------------------------------------
// Utilitários
// -----------------------------------------------------------------------------

/** Todo nome de classe citado no CSS, com os comentários removidos antes. */
function readDefinedClasses() {
  const css = fs.readFileSync(CSS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
}

const problems = [];
const fail = (msg) => problems.push(msg);

// -----------------------------------------------------------------------------
// Checagem 3 (estática): o registro do core bate com o CSS?
// -----------------------------------------------------------------------------
function checkHeatRegistry(defined) {
  const src = fs.readFileSync(CORE_PRESENTATION, 'utf8');
  const block = src.match(/const HEAT_BLOCK_MODIFIERS = \{([\s\S]*?)\n\} as const/);

  if (!block) {
    fail('HEAT_BLOCK_MODIFIERS não encontrado em core/presentation.ts — o script precisa ser atualizado.');
    return;
  }

  // Cada entrada é `nome: ['a', 'b'],` possivelmente precedida de comentários.
  const entries = [...block[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)];
  if (entries.length === 0) {
    fail('HEAT_BLOCK_MODIFIERS está vazio ou mudou de formato.');
    return;
  }

  const ALL_HEATS = ['hot', 'rise', 'base', 'ever'];

  for (const [, blockName, list] of entries) {
    const declared = new Set([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]));

    for (const heat of ALL_HEATS) {
      const cssHas = defined.has(`${blockName}--${heat}`);
      if (declared.has(heat) && !cssHas) {
        fail(
          `HEAT_BLOCK_MODIFIERS declara .${blockName}--${heat}, mas o CSS não define essa regra. ` +
            'O produto vai emitir uma classe morta.',
        );
      }
      if (!declared.has(heat) && cssHas) {
        fail(
          `O CSS define .${blockName}--${heat}, mas HEAT_BLOCK_MODIFIERS não o declara. ` +
            'O produto nunca vai aplicar esse estilo.',
        );
      }
    }
  }

  console.log(`  registro de temperatura: ${entries.length} blocos conferidos contra o CSS`);
}

// -----------------------------------------------------------------------------
// Checagens 1 e 2 (runtime): o HTML servido
// -----------------------------------------------------------------------------
async function checkPages(defined) {
  const dead = new Set(DEAD_CLASSES);

  for (const [label, url] of PAGES) {
    let res;
    try {
      res = await fetch(BASE + url);
    } catch {
      fail(`${label}: servidor não respondeu em ${BASE}${url}. Rode \`npm run dev\`.`);
      console.log(`  XX  ${label}`);
      continue;
    }

    const html = await res.text();
    const used = new Set();
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/).filter(Boolean)) used.add(c);
    }

    const orphans = [...used].filter((c) => !defined.has(c) && !EXTERNAL.test(c));
    const revived = [...used].filter((c) => dead.has(c));

    if (res.status !== 200) fail(`${label}: HTTP ${res.status}`);
    for (const c of orphans) fail(`${label}: .${c} não existe no CSS`);
    for (const c of revived) fail(`${label}: .${c} é vocabulário de uma versão anterior do design`);

    const ok = res.status === 200 && orphans.length === 0 && revived.length === 0;
    console.log(`  ${ok ? 'ok' : 'XX'}  ${label.padEnd(36)} ${String(used.size).padStart(3)} classes`);
  }
}

// -----------------------------------------------------------------------------

const defined = readDefinedClasses();
console.log(`CSS: ${defined.size} classes definidas em ${path.relative(ROOT, CSS_FILE)}\n`);

console.log('Checagens estáticas');
checkHeatRegistry(defined);

if (!SKIP_RUNTIME) {
  console.log(`\nPáginas servidas por ${BASE}`);
  await checkPages(defined);
} else {
  console.log('\n(runtime pulado por --skip-runtime)');
}

if (problems.length === 0) {
  console.log('\nTudo certo: nenhuma classe fora do design system.');
  process.exit(0);
}

console.log(`\n${problems.length} problema(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
