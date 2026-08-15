/**
 * =============================================================================
 * TESTES — expiração de pautas
 * =============================================================================
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ: a consulta e a escrita no banco. O corte é o
 * mesmo do resto do serviço (ver `dedupe.test.ts` e `rewrite-ptbr.test.ts`):
 * testa-se o que é determinístico e roda sem infraestrutura. Um teste que
 * precisasse de MySQL de pé não rodaria em CI nem na máquina de quem só quer
 * conferir uma mudança — e teste que não roda é comentário mentiroso.
 *
 * O que sobra é justamente onde um erro passaria despercebido: a ARITMÉTICA DA
 * IDADE. Trocar dias por horas na conta do corte não derruba nada, não gera
 * exceção e não aparece em nenhum log — só faz a fila inteira ser descartada a
 * cada 15 minutos, e o sintoma ("as pautas somem sozinhas") não aponta para uma
 * multiplicação de milissegundos.
 *
 * As regras que NÃO são testáveis aqui vivem no `where` do Prisma e estão
 * documentadas no cabeçalho de `expire-topics.ts` (só 'new'/'assigned', nunca
 * pauta com matéria vinculada, medição por `createdAt`). Elas dependem do banco
 * para valer — o lugar de verificá-las é a conferência manual descrita no
 * relatório de entrega, com `dryRun`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { expiryCutoff, TOPIC_EXPIRY_DAYS } from './expire-topics.ts';

describe('idade máxima de uma pauta na fila', () => {
  it('o prazo é o do requisito: uma semana', () => {
    // O número está escrito em um lugar só (e é usado no log do ciclo e no
    // payload do evento de instrumentação). Este teste é o que impede alguém de
    // "ajustar temporariamente para 1 dia" e esquecer.
    assert.equal(TOPIC_EXPIRY_DAYS, 7);
  });

  it('o corte fica exatamente 7 dias antes do instante informado', () => {
    const agora = new Date('2026-08-15T12:00:00.000Z');
    assert.equal(expiryCutoff(agora).toISOString(), '2026-08-08T12:00:00.000Z');
  });

  it('a pauta de exatamente 7 dias AINDA NÃO expira', () => {
    // O filtro usa `createdAt < corte` (estritamente menor). A escolha é
    // deliberada e vale a asserção: no limite, a dúvida se resolve a favor de
    // manter a pauta. Perder uma pauta boa por um milissegundo de arredondamento
    // é um prejuízo invisível; manter uma pauta velha por mais 15 minutos, até o
    // próximo ciclo, não é prejuízo nenhum.
    const agora = new Date('2026-08-15T12:00:00.000Z');
    const criadaHa7DiasExatos = new Date('2026-08-08T12:00:00.000Z');
    assert.equal(criadaHa7DiasExatos < expiryCutoff(agora), false);
  });

  it('a pauta de 7 dias e um segundo expira', () => {
    const agora = new Date('2026-08-15T12:00:00.000Z');
    const criada = new Date('2026-08-08T11:59:59.000Z');
    assert.equal(criada < expiryCutoff(agora), true);
  });

  it('a conta atravessa a virada de mês sem truque de calendário', () => {
    // A conta é em milissegundos justamente para não depender de aritmética de
    // calendário (mês com 30/31 dias, fevereiro). Este caso fixa isso.
    const agora = new Date('2026-03-03T08:30:00.000Z');
    assert.equal(expiryCutoff(agora).toISOString(), '2026-02-24T08:30:00.000Z');
  });

  it('sem argumento, mede a partir de agora', () => {
    const antes = Date.now() - TOPIC_EXPIRY_DAYS * 86_400_000;
    const corte = expiryCutoff().getTime();
    const depois = Date.now() - TOPIC_EXPIRY_DAYS * 86_400_000;
    assert.ok(corte >= antes && corte <= depois);
  });
});
