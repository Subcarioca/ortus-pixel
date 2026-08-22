/**
 * =============================================================================
 * TESTES — teto da fila ativa (a faxina por relevância)
 * =============================================================================
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ: a consulta e a escrita no banco. É o mesmo
 * corte de `expire-topics.test.ts` e `topic-quota.test.ts` — testa-se o que é
 * determinístico e roda sem infraestrutura. Um teste que precisasse de MySQL de
 * pé não rodaria em CI nem na máquina de quem só quer conferir uma mudança, e
 * teste que não roda é comentário mentiroso.
 *
 * O QUE SOBRA é exatamente onde um erro passaria despercebido: A ARITMÉTICA DO
 * EXCESSO. Ela não gera exceção nem log quando está errada — inverter a
 * subtração ou perder o piso em zero simplesmente faz a rotina cortar as pautas
 * ERRADAS (ou a fila inteira), e o sintoma ("as pautas somem sozinhas") não
 * aponta para uma conta de três termos. É a mesma razão pela qual `expiryCutoff`
 * foi extraída para poder ser testada.
 *
 * AS REGRAS QUE NÃO SÃO TESTÁVEIS AQUI vivem no `where`/`orderBy` do Prisma e
 * estão documentadas no cabeçalho de `topic-pool.ts` (só 'new'/'assigned', nunca
 * pauta com matéria vinculada, nunca pauta com override manual, corte por
 * `currentScore` ascendente com desempate por `createdAt`). Elas dependem do
 * banco para valer — o lugar de conferi-las é a execução manual com `dryRun`,
 * que mede sem gravar.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { excessOverCap, MAX_ACTIVE_TOPICS } from './topic-pool.ts';

describe('o número do requisito', () => {
  it('a fila ativa cabe em 30 pautas', () => {
    // Escrito num lugar só e usado no corte, no log do ciclo e no payload do
    // evento de instrumentação. Este teste é o que impede alguém de "subir para
    // 200 só para ver a fila cheia" e esquecer.
    assert.equal(MAX_ACTIVE_TOPICS, 30);
  });

  it('o teto do TOTAL é maior que o teto de CRIAÇÃO por ciclo — e isso é proposital', () => {
    // Os dois números medem coisas diferentes (30 = quantas existem ao mesmo
    // tempo; 20 = quantas nascem por rodada) e a relação entre eles é o que
    // mantém a fila viva sem varrê-la inteira a cada ciclo. Se um dia alguém
    // igualar os dois, ou inverter, TODA rodada forte trocaria a fila completa —
    // e a conversa precisa acontecer antes do deploy, não depois de a redação
    // perder de vista uma pauta que estava lendo.
    assert.ok(MAX_ACTIVE_TOPICS > 20);
  });
});

describe('quantas pautas passam do teto', () => {
  it('fila menor que o teto não corta nada', () => {
    assert.equal(excessOverCap(12), 0);
  });

  it('fila exatamente no teto não corta nada', () => {
    // O limite se resolve a favor de MANTER, como o `createdAt < corte` da
    // expiração: cortar no empate tiraria uma pauta boa sem que a fila tivesse
    // de fato passado do tamanho combinado.
    assert.equal(excessOverCap(MAX_ACTIVE_TOPICS), 0);
  });

  it('uma pauta acima do teto corta exatamente uma', () => {
    assert.equal(excessOverCap(MAX_ACTIVE_TOPICS + 1), 1);
  });

  it('o passivo da primeira execução é medido inteiro', () => {
    // A estreia em produção encontra a fila que cresceu sem teto nenhum. O
    // número devolvido aqui é o que o teto de lote (500) vai drenar em blocos —
    // se esta conta subestimar, o passivo nunca termina de sair.
    assert.equal(excessOverCap(430), 400);
  });

  it('NUNCA devolve negativo — e este é o caso perigoso', () => {
    // Sem o piso em zero, uma fila de 12 pautas devolveria -18, e um `take: -18`
    // faz o Prisma percorrer a ordenação AO CONTRÁRIO: a rotina passaria a
    // descartar as MELHORES pautas da fila, silenciosamente, todo ciclo. É a
    // falha mais cara possível deste módulo e a mais fácil de reintroduzir.
    assert.equal(excessOverCap(0), 0);
    assert.equal(excessOverCap(1), 0);
    assert.equal(excessOverCap(29), 0);
  });

  it('o teto é parametrizável para o teste, mas o padrão é o do requisito', () => {
    // O parâmetro existe para exercitar a regra com números pequenos (e para o
    // `dryRun` poder simular outro tamanho de fila antes de mudar a constante),
    // sem que isso abra caminho para configurar o teto por ambiente — ver o
    // comentário da constante.
    assert.equal(excessOverCap(10, 4), 6);
    assert.equal(excessOverCap(4, 4), 0);
    assert.equal(excessOverCap(100), excessOverCap(100, MAX_ACTIVE_TOPICS));
  });
});
