/**
 * =============================================================================
 * TESTES — verificador de risco editorial
 * =============================================================================
 *
 * Estes testes protegem duas coisas de naturezas diferentes, e vale dizer qual é
 * qual antes de lê-los:
 *
 *   1. O QUE O VERIFICADOR PEGA. Cada caso aqui é um exemplo real do tipo de
 *      frase que motivou o pedido. Se alguém mexer nas listas e um destes parar
 *      de ser detectado, o build cai.
 *
 *   2. O QUE ELE NÃO PODE ATRAPALHAR — e esta metade é a mais importante. Um
 *      verificador barulhento é desligado (na prática, ignorado) em uma semana,
 *      e aí ele não protege mais nada. Os testes de "não sinaliza" são o que
 *      impede a lista de crescer até virar ruído: acrescentar um termo genérico
 *      demais faz falhar um caso de texto legítimo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasHighRisk,
  requiresJustification,
  scanArticleForRisk,
  summarizeRisk,
  toAuditFindings,
  type EditorialRiskFinding,
} from './editorial-risk';

/** Atalho: varre só o corpo, que é o campo que interessa em quase todo caso. */
function scanBody(content: string): EditorialRiskFinding[] {
  return scanArticleForRisk({ title: 'Título neutro da matéria', excerpt: 'Resumo neutro.', content });
}

function categories(findings: EditorialRiskFinding[]): string[] {
  return findings.map((f) => f.category);
}

// -----------------------------------------------------------------------------
// O CORAÇÃO: acusação com e sem atribuição
// -----------------------------------------------------------------------------

test('acusação categórica sem fonte é sinalizada como alto risco', () => {
  const findings = scanBody('O presidente da editora é corrupto e todo mundo sabe disso.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.category, 'acusacao');
  assert.equal(findings[0]?.severity, 'alto');
  assert.equal(hasHighRisk(findings), true);
});

test('a MESMA frase com atribuição não é sinalizada — é jornalismo correto', () => {
  // Este é o teste que impede o verificador de punir quem fez a coisa certa.
  assert.deepEqual(
    scanBody('O presidente da editora é acusado de corrupção pelo Ministério Público.'),
    [],
  );
  assert.deepEqual(
    scanBody('Segundo o processo, o presidente da editora é corrupto.'),
    [],
  );
  assert.deepEqual(
    scanBody('O estúdio teria fraudado os números de venda, afirma o relatório.'),
    [],
  );
});

test('a atribuição vale mesmo estando na frase anterior', () => {
  // Português real não coloca a fonte dentro da mesma oração toda vez.
  assert.deepEqual(
    scanBody(
      'A denúncia foi protocolada na segunda-feira pelo sindicato. A empresa fraudou os números do balanço.',
    ),
    [],
  );
});

test('pergunta retórica não é imputação', () => {
  assert.deepEqual(scanBody('A editora fraudou os números de vendas?'), []);
});

test('acusação dentro de aspas é rebaixada, mas continua aparecendo', () => {
  // Reproduzir a ofensa de um terceiro não isenta o veículo — então o aviso
  // sobrevive; o que muda é a exigência de justificativa.
  const findings = scanBody('"O estúdio plagiou o nosso design", escreveu o artista na rede social.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, 'atencao');
  assert.equal(requiresJustification(findings), false);
});

test('acusação em contexto claramente ficcional é rebaixada', () => {
  // O falso positivo mais provável deste portal, e o motivo de FICTION_MARKERS
  // existir: cobertura de jogo fala de criminosos o tempo todo.
  const findings = scanBody('O protagonista do jogo é um ladrão que rouba corporações.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, 'atencao');
});

test('"heróis e bandidos" NÃO vira acusação — o acento em "é" é o que separa', () => {
  // Se o texto fosse normalizado sem acento, a conjunção "e" casaria com "é" e
  // esta frase inocente seria sinalizada. Ver o cabeçalho de editorial-risk-terms.
  assert.deepEqual(scanBody('O elenco de personagens tem heróis e bandidos memoráveis.'), []);
});

test('verbos comuns em jogo não disparam acusação', () => {
  // "matou", "roubou a cena" e afins ficaram DE FORA das listas de propósito.
  assert.deepEqual(
    scanBody('O jogador matou o chefe final em três minutos e a cena roubou a apresentação.'),
    [],
  );
});

// -----------------------------------------------------------------------------
// Discriminação e vocabulário
// -----------------------------------------------------------------------------

test('termo discriminatório inequívoco é alto risco, mesmo no título', () => {
  const findings = scanArticleForRisk({
    title: 'O novo personagem é um retardado, diz análise',
    excerpt: 'Resumo neutro sobre o lançamento.',
    content: 'Corpo neutro com informação suficiente sobre o jogo.',
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.field, 'titulo');
  assert.equal(findings[0]?.severity, 'alto');
  assert.equal(findings[0]?.category, 'discriminacao');
});

test('termo desatualizado vem com a troca pronta, em nível de atenção', () => {
  const findings = scanBody('A série discute o homossexualismo do protagonista.');

  assert.equal(findings[0]?.category, 'termo-inadequado');
  assert.equal(findings[0]?.severity, 'atencao');
  assert.equal(findings[0]?.suggestion, 'homossexualidade');
  assert.equal(requiresJustification(findings), false);
});

test('"Mongólia" não vira "mongoloide": a fronteira de palavra entende acento', () => {
  // Com `\b` (ASCII), "mongol" casaria dentro de "Mongólia". É o caso que
  // justifica as asserções `\p{L}` do `compileRule`.
  assert.deepEqual(scanBody('A expansão do jogo se passa nas estepes da Mongólia medieval.'), []);
});

test('texto editorial comum não é sinalizado', () => {
  // A garantia mais importante do arquivo: o dia a dia da redação passa limpo.
  assert.deepEqual(
    scanBody(
      'A Nintendo anunciou nesta terça-feira a data de lançamento do novo jogo da série, ' +
        'que chega ao console em março com suporte a português brasileiro e modo cooperativo.',
    ),
    [],
  );
});

// -----------------------------------------------------------------------------
// Dado pessoal (LGPD)
// -----------------------------------------------------------------------------

test('CPF no texto é alto risco', () => {
  const findings = scanBody('O documento anexado ao processo traz o CPF 123.456.789-00 do autor.');

  assert.equal(categories(findings).includes('dado-pessoal'), true);
  assert.equal(hasHighRisk(findings), true);
});

test('telefone entre parênteses é detectado', () => {
  const findings = scanBody('O contato divulgado na denúncia era (21) 98888-7777, segundo o site.');
  assert.equal(categories(findings).includes('dado-pessoal'), true);
});

test('número de versão ou data não vira CPF', () => {
  assert.deepEqual(scanBody('A atualização 1.2.3 chegou em 12/05/2026 com 40 correções.'), []);
});

// -----------------------------------------------------------------------------
// Forma do resultado — o que a tela e a auditoria consomem
// -----------------------------------------------------------------------------

test('o achado traz contexto dos dois lados para o redator se localizar', () => {
  const findings = scanBody(
    'Depois de meses de silêncio sobre o assunto, veio a declaração: o diretor é um golpista, ' +
      'e a comunidade reagiu mal ao anúncio feito na semana passada.',
  );

  const finding = findings[0];
  assert.ok(finding, 'esperava um achado');
  assert.match(finding.match, /é um golpista/i);
  assert.ok(finding.before.includes('declaração'), 'contexto à esquerda ausente');
  assert.ok(finding.after.includes('comunidade'), 'contexto à direita ausente');
  // O contexto é achatado: quebra de linha no meio do painel quebraria o layout
  // e não ajuda a ler.
  assert.ok(!finding.before.includes('\n'));
});

test('a mesma ofensa repetida aparece uma vez só', () => {
  const findings = scanBody(
    'O executivo assediou a equipe. Testemunhas afirmam que ele assediou outras pessoas. ' +
      'Um terceiro caso diz que ele assediou mais alguém.',
  );

  // A segunda e a terceira ocorrência têm atribuição, mas mesmo sem ela a
  // deduplicação por (campo, categoria, termo) devolveria um aviso só.
  assert.equal(findings.filter((f) => f.category === 'acusacao').length <= 1, true);
});

test('o resumo em uma linha diz quantos e de que tipo', () => {
  const findings = scanBody('O diretor é corrupto e o CPF 123.456.789-00 dele está no processo.');

  const resumo = summarizeRisk(findings);
  assert.match(resumo, /alto risco/);
  assert.equal(summarizeRisk([]), 'Nenhum trecho sinalizado.');
});

test('a versão para auditoria não carrega o texto da matéria junto', () => {
  // Sem nenhuma marca de atribuição na frase — de propósito. A primeira versão
  // deste teste dizia "…, segundo ninguém", e "segundo" É uma marca: o achado
  // sumia e o teste falhava. Ficou registrado porque é uma boa ilustração de
  // como a regra funciona.
  const findings = scanBody('O diretor da editora é corrupto.');
  const audit = toAuditFindings(findings);

  assert.equal(audit.length, findings.length);
  // Só os quatro campos previstos: sem `before`/`after`, a coluna Json não vira
  // uma segunda cópia da matéria.
  assert.deepEqual(Object.keys(audit[0] ?? {}).sort(), [
    'campo',
    'categoria',
    'gravidade',
    'trecho',
  ]);
});

test('achados de alto risco vêm antes dos de atenção', () => {
  const findings = scanBody(
    'A série discute o homossexualismo do personagem. O produtor é um estelionatário.',
  );

  assert.equal(findings[0]?.severity, 'alto');
  assert.equal(findings.at(-1)?.severity, 'atencao');
});
