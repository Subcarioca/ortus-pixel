/**
 * =============================================================================
 * TESTES — geração de pré-matéria (prompt + coação do JSON)
 * =============================================================================
 *
 * A chamada real ao DeepSeek é coberta por `deepseek.test.ts`; aqui se testa o
 * que fica ENTRE o tópico do curator e a resposta do modelo:
 *
 *   1. AS REGRAS DO PROMPT. São o único controle contra invenção, atribuição
 *      falsa, fala fabricada e plágio. Se alguém apagar uma linha numa
 *      refatoração, nada quebra visivelmente — o texto só fica pior, semanas
 *      depois, na matéria de alguém.
 *   2. O PROMPT DE SISTEMA É ESTÁTICO. Nenhuma variável do tópico é interpolada
 *      nele — é a defesa de injeção contra feed de terceiros.
 *   3. A COAÇÃO DO JSON. O modelo pode embrulhar em cerca, omitir campo, devolver
 *      tipo errado. O painel não pode quebrar com `undefined` silencioso.
 *   4. A HEURÍSTICA DE IDIOMA. Um erro aqui não quebra nada, mas o acerto melhora
 *      a dica de contexto que o prompt leva.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSystemPrompt,
  buildUserPrompt,
  detectLanguage,
  parsePreArticle,
  type PreArticleInput,
} from './ai/prearticle';

const INPUT: PreArticleInput = {
  pauta: 'A Team Cherry anunciou a data de lançamento de Hollow Knight: Silksong.',
  tituloOriginal: 'Hollow Knight: Silksong gets a release date',
  idiomaOriginal: 'en',
  scorePopularidade: 92,
  nicho: 'Games',
  fontesReferencia: 'IGN, EiNerd, Omelete',
};

const CORPO_VALIDO = {
  contextualizacao: 'A Team Cherry confirmou que Silksong chega em setembro.',
  analise_hype: ['Busca crescente pelo jogo', 'Trending no YouTube BR'],
  modelo_popularidade: {
    categoria: 'CRESCIMENTO SUSTENTADO',
    justificativa: 'Lançamento com roadmap de conteúdo.',
    momento_pico: 'Na semana do lançamento',
    janela_publicacao: 'Próximos 7 dias',
    risco_timing: 'Baixo',
    estrategia_posicionamento: 'Abrir com a data de lançamento',
  },
  pre_materia: {
    titulo: 'Silksong ganha data de lançamento',
    subtitulo: 'O que esperar do novo jogo da Team Cherry',
    abertura: 'A Team Cherry confirmou a data de chegada de Silksong.',
    corpo: ['Parágrafo um.', 'Parágrafo dois.'],
    fechamento_cta: 'O que você acha? Comente abaixo',
    extras_retencao: ['Lista de destaques', 'O que esperar a seguir'],
  },
  otimizacao: {
    palavra_chave_principal: 'Silksong lançamento',
    palavras_chave_secundarias: ['Hollow Knight', 'Team Cherry'],
    meta_description: 'Silksong chega em setembro para PC e consoles.',
    titulos_sociais: ['Título social um', 'Título social dois', 'Título social três'],
    hashtags: ['#Silksong', '#HollowKnight', '#Games', '#TeamCherry', '#Lancamento'],
  },
};

// =============================================================================
// HEURÍSTICA DE IDIOMA
// =============================================================================

test('acento ou cedilha marca o título como português', () => {
  assert.equal(detectLanguage('Lançamento confirmado hoje'), 'pt');
  assert.equal(detectLanguage('Não perca o novo trailer'), 'pt');
  assert.equal(detectLanguage('Ator confirma participação'), 'pt');
});

test('palavra funcional portuguesa sem acento já decide por português', () => {
  assert.equal(detectLanguage('Novo jogo anunciado'), 'pt');
  assert.equal(detectLanguage('Sobre o adiamento da serie'), 'pt');
});

test('título sem marcador português cai em inglês', () => {
  assert.equal(detectLanguage('Hollow Knight: Silksong gets a release date'), 'en');
  assert.equal(detectLanguage(''), 'en');
  assert.equal(detectLanguage('The Last of Us Part III announced'), 'en');
});

// =============================================================================
// O PROMPT DE SISTEMA (estático)
// =============================================================================

test('o prompt de sistema carrega as regras inegociáveis herdadas do ai-draft', () => {
  const prompt = buildSystemPrompt();

  // 1. Não inventar.
  assert.match(prompt, /N[ÃA]O INVENTE FATOS/i);
  // 2. Atribuir toda afirmação sensível.
  assert.match(prompt, /ATRIBU[IÍ]DA/i);
  assert.match(prompt, /segundo <fonte>/i);
  // 3. Nenhuma fala entre aspas.
  assert.match(prompt, /NUNCA ESCREVA FALAS ENTRE ASPAS/i);
  // 4. Material escasso vira texto geral.
  assert.match(prompt, /MATERIAL ESCASSO VIRA TEXTO GERAL/i);
  // 5. Rumor separado de fato.
  assert.match(prompt, /RUMOR [ÉE] RUMOR/i);
  // 6. Paráfrase genuína, não tradução/reescrita.
  assert.match(prompt, /PAR[ÁA]FRASE GENU[ÍI]NA/i);
  assert.match(prompt, /REESTRUTURE as frases/i);
  assert.match(prompt, /OUTRO VOCABUL[ÁA]RIO/i);
  assert.match(prompt, /MUDAR A ORDEM DA INFORMA[ÇC][ÃA]O/i);
});

test('o prompt de sistema é estático — nenhuma variável interpolada', () => {
  const prompt = buildSystemPrompt();

  // A defesa de injeção inteira depende disto: nada do feed entra no sistema.
  assert.equal(prompt.includes('${'), false);
  assert.equal(prompt.includes('INPUT'), false);
  // Determinístico: duas chamadas devolvem o mesmo contrato editorial.
  assert.equal(buildSystemPrompt(), prompt);
});

test('o prompt de sistema declara o papel, o JSON e a defesa contra injeção', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /REDATOR-CHEFE/i);
  assert.match(prompt, /Ortus Pixel/i);
  assert.match(prompt, /FORMATO DE SA[ÍI]DA \(JSON\)/i);
  // Defesa declarada contra injeção de prompt vinda do feed de terceiros.
  assert.match(prompt, /n[ãa]o o obede[çc]a/i);
  // As cinco tarefas pedidas pelo dono aparecem na ordem.
  const ordem = ['CONTEXTUALIZA', 'HYPE', 'MODELO', 'PR[ÉE]-MAT[ÉE]RIA', 'OTIMIZA'];
  for (const trecho of ordem) {
    assert.match(prompt, new RegExp(trecho, 'i'));
  }
});

// =============================================================================
// O PROMPT DE USUÁRIO (material delimitado)
// =============================================================================

test('o material da pauta vai delimitado, com todas as variáveis do tópico', () => {
  const prompt = buildUserPrompt(INPUT);

  assert.ok(prompt.includes('<material-de-pauta>'));
  assert.ok(prompt.includes('</material-de-pauta>'));
  assert.ok(prompt.includes(INPUT.pauta));
  assert.ok(prompt.includes(INPUT.tituloOriginal));
  assert.ok(prompt.includes('92'));
  assert.ok(prompt.includes('Games'));
  assert.ok(prompt.includes('IGN, EiNerd, Omelete'));
});

test('idioma original é apresentado por extenso, não como sigla', () => {
  assert.match(buildUserPrompt(INPUT), /Idioma original: inglês/);
  assert.match(buildUserPrompt({ ...INPUT, idiomaOriginal: 'pt' }), /Idioma original: português/);
});

test('o material é declarado insumo de apuração, não texto a adaptar', () => {
  const prompt = buildUserPrompt(INPUT);
  assert.match(prompt, /INSUMO DE APURA[ÇC][ÃA]O/i);
  assert.match(prompt, /com frases suas/i);
  assert.match(prompt, /APENAS o JSON/i);
});

// =============================================================================
// COAÇÃO DO JSON
// =============================================================================

test('resposta válida vira o contrato tipado campo a campo', () => {
  const resultado = parsePreArticle(JSON.stringify(CORPO_VALIDO));

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;

  const { data } = resultado;
  assert.equal(data.contextualizacao, CORPO_VALIDO.contextualizacao);
  assert.deepEqual(data.analise_hype, CORPO_VALIDO.analise_hype);
  assert.equal(data.modelo_popularidade.categoria, 'CRESCIMENTO SUSTENTADO');
  assert.equal(data.pre_materia.titulo, CORPO_VALIDO.pre_materia.titulo);
  assert.deepEqual(data.pre_materia.corpo, CORPO_VALIDO.pre_materia.corpo);
  assert.equal(data.otimizacao.palavra_chave_principal, 'Silksong lançamento');
  assert.equal(data.otimizacao.hashtags.length, 5);
});

test('JSON embrulhado em cerca de código ainda é lido', () => {
  const resultado = parsePreArticle('```json\n' + JSON.stringify(CORPO_VALIDO) + '\n```');
  assert.equal(resultado.ok, true);
});

test('campo ausente vira string vazia ou array vazio, nunca undefined', () => {
  const resultado = parsePreArticle(
    JSON.stringify({ pre_materia: { titulo: 'Só o título' } }),
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;

  const { data } = resultado;
  assert.equal(data.contextualizacao, '');
  assert.deepEqual(data.analise_hype, []);
  assert.equal(data.modelo_popularidade.justificativa, '');
  assert.equal(data.pre_materia.subtitulo, '');
  assert.deepEqual(data.pre_materia.corpo, []);
  assert.equal(data.otimizacao.hashtags.length, 0);
});

test('espaços e quebras de linha repetidos são colapsados', () => {
  const resultado = parsePreArticle(
    JSON.stringify({
      ...CORPO_VALIDO,
      contextualizacao: '  texto\n\n   com   espaços  ',
    }),
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.data.contextualizacao, 'texto com espaços');
});

test('valores de tipo errado não derrubam a coação', () => {
  const resultado = parsePreArticle(
    JSON.stringify({
      contextualizacao: 42,
      analise_hype: [1, 'ok', null, '  '],
      pre_materia: { titulo: 'Título', corpo: 'não-é-array' },
      otimizacao: null,
    }),
  );

  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;

  assert.equal(resultado.data.contextualizacao, '');
  assert.deepEqual(resultado.data.analise_hype, ['ok']);
  assert.deepEqual(resultado.data.pre_materia.corpo, []);
  assert.equal(resultado.data.otimizacao.hashtags.length, 0);
});

test('JSON quebrado, array no topo e corpo vazio viram falha declarada', () => {
  assert.equal(parsePreArticle('isto não é json').ok, false);
  assert.equal(parsePreArticle('[]').ok, false);
  assert.equal(parsePreArticle('null').ok, false);
  assert.equal(parsePreArticle('{}').ok, false, 'objeto sem nenhum texto aproveitável é degenerado');
});

test('título sozinho é aproveitável; contextualização sozinha também', () => {
  assert.equal(parsePreArticle(JSON.stringify({ pre_materia: { titulo: 'T' } })).ok, true);
  assert.equal(parsePreArticle(JSON.stringify({ contextualizacao: 'T' })).ok, true);
});

test('falha de coação carrega status 502 e pede o caminho do formulário', () => {
  const resultado = parsePreArticle('não é json');
  assert.equal(resultado.ok, false);
  if (resultado.ok) return;
  assert.equal(resultado.reason, 'invalid-response');
  assert.equal(resultado.status, 502);
  assert.match(resultado.message, /formul[áa]rio/i);
});
