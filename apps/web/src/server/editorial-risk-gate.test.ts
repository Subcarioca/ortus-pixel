/**
 * =============================================================================
 * TESTES — o portão de risco editorial
 * =============================================================================
 *
 * O módulo de regras (`core/editorial-risk.ts`) já tem os seus testes: eles
 * dizem O QUE é sinalizado. Estes aqui protegem outra coisa, e é a que tem
 * consequência: O QUE ACONTECE com a publicação depois de sinalizada.
 *
 * A propriedade central, a que não pode quebrar nunca: NENHUM texto sinalizado
 * é publicado na PRIMEIRA tentativa. Se um refator inverter esse padrão, a
 * funcionalidade continua "funcionando" — o painel mostra avisos, os testes de
 * regra passam — e ninguém percebe que o aviso virou decorativo. É exatamente o
 * tipo de falha silenciosa que justifica um teste.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EditorialRiskFinding } from '@subcarioca/core';

import { editorialRiskGate } from './editorial-risk-gate';

function finding(severity: 'alto' | 'atencao'): EditorialRiskFinding {
  return {
    category: 'acusacao',
    severity,
    field: 'corpo',
    match: 'é corrupto',
    before: 'O diretor ',
    after: ', diz o texto.',
    reason: 'motivo qualquer',
    suggestion: null,
  };
}

test('sem nada sinalizado, o portão é transparente', () => {
  const result = editorialRiskGate({ publish: true }, { publish: true, riskFindings: [] });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.acknowledgement, null);
});

test('RASCUNHO passa mesmo com trecho de alto risco', () => {
  // Rascunho não é publicação. Travá-lo empurraria a redação a escrever fora do
  // painel — o único lugar onde o texto seria verificado.
  const result = editorialRiskGate({}, { publish: false, riskFindings: [finding('alto')] });

  assert.equal(result.ok, true);
});

test('a PRIMEIRA tentativa de publicar texto sinalizado é interrompida', async () => {
  const result = editorialRiskGate({ publish: true }, { publish: true, riskFindings: [finding('alto')] });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.response.status, 409);

  const body = await result.response.json();
  assert.equal(body.ok, false);
  // A bandeira que a tela usa para abrir o painel em vez de mostrar um erro seco.
  assert.equal(body.needsEditorialRiskAck, true);
  assert.equal(body.requiresReason, true);
  assert.equal(body.findings.length, 1);
});

test('reconhecer sem justificativa NÃO basta quando há alto risco', async () => {
  const result = editorialRiskGate(
    { publish: true, acknowledgeEditorialRisk: true },
    { publish: true, riskFindings: [finding('alto')] },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.response.status, 400);
  const body = await result.response.json();
  // O painel precisa continuar aberto: a pessoa não errou o caminho, ela só não
  // escreveu o porquê ainda.
  assert.equal(body.needsEditorialRiskAck, true);
});

test('justificativa curta demais é recusada, como no override de score', async () => {
  const result = editorialRiskGate(
    { publish: true, acknowledgeEditorialRisk: true, editorialRiskReason: 'ok' },
    { publish: true, riskFindings: [finding('alto')] },
  );

  assert.equal(result.ok, false);
});

test('reconhecido e justificado, publica — e devolve o que precisa ser auditado', () => {
  const result = editorialRiskGate(
    {
      publish: true,
      acknowledgeEditorialRisk: true,
      editorialRiskReason: '  falso positivo: é fala de personagem  ',
    },
    { publish: true, riskFindings: [finding('alto')] },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.acknowledgement?.reason, 'falso positivo: é fala de personagem');
  assert.equal(result.acknowledgement?.findings.length, 1);
});

test('só ATENÇÃO: reconhecer basta, sem justificativa obrigatória', () => {
  // A assimetria proposital: fricção onde está o risco, e não em todo lugar.
  const result = editorialRiskGate(
    { publish: true, acknowledgeEditorialRisk: true },
    { publish: true, riskFindings: [finding('atencao')] },
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.acknowledgement?.reason, null);
});

test('bandeira de reconhecimento só vale como booleano verdadeiro', async () => {
  // Um `"true"` em string (o que um formulário mal montado mandaria) NÃO pode
  // valer como reconhecimento: seria um jeito de o aviso nunca aparecer.
  const result = editorialRiskGate(
    { publish: true, acknowledgeEditorialRisk: 'true' },
    { publish: true, riskFindings: [finding('atencao')] },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 409);
});
