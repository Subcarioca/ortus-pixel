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

import { excessOverCap, graceCutoff, MAX_ACTIVE_TOPICS } from './topic-pool.ts';

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

/**
 * =============================================================================
 * CARÊNCIA DA PAUTA NOVA — o conserto de um bug que derrubava a funcionalidade
 * =============================================================================
 *
 * Sem a carência, a pauta nova era cortada no MESMO ciclo em que nascia e a
 * fila parava de renovar. A engrenagem está documentada em
 * `NEW_TOPIC_GRACE_HOURS`; o resumo é que pauta nova tem score baixo por
 * construção (ainda não acumulou sinal) e o corte mira o menor score primeiro.
 *
 * O que estes testes travam é a ARITMÉTICA da janela — a parte que erra em
 * silêncio. O filtro em si (`createdAt: { lt: graceCutoff() }`) precisa de
 * banco e é exercitado em produção; a conta de data, não.
 */
describe('carência da pauta recém-encontrada', () => {
  it('o corte fica 6 horas no passado — nem 6 minutos, nem 6 dias', () => {
    const agora = new Date('2026-08-22T12:00:00.000Z');
    assert.equal(graceCutoff(agora).toISOString(), '2026-08-22T06:00:00.000Z');
  });

  it('pauta encontrada AGORA está protegida; a de ontem, não', () => {
    const agora = new Date('2026-08-22T12:00:00.000Z');
    const corte = graceCutoff(agora);

    // O filtro do Prisma é `createdAt < corte`. Reproduzimos a comparação aqui
    // para travar o SENTIDO da desigualdade: invertê-la protegeria justamente
    // as pautas velhas e cortaria as novas — o bug original, ao contrário.
    const recemEncontrada = new Date('2026-08-22T11:59:00.000Z');
    const deOntem = new Date('2026-08-21T12:00:00.000Z');

    assert.equal(recemEncontrada < corte, false, 'pauta nova NÃO pode ser candidata a corte');
    assert.equal(deOntem < corte, true, 'pauta de ontem pode ser cortada normalmente');
  });

  it('a fronteira exata: 6h e 1min sai da proteção, 5h59 continua protegida', () => {
    const agora = new Date('2026-08-22T12:00:00.000Z');
    const corte = graceCutoff(agora);

    assert.equal(new Date('2026-08-22T05:59:00.000Z') < corte, true);
    assert.equal(new Date('2026-08-22T06:01:00.000Z') < corte, false);
  });

  it('a janela é menor que um dia — senão ela viraria o próprio teto', () => {
    // Com 20 pautas novas por ciclo (`MAX_NEW_TOPICS_PER_CYCLE`) e 30 vagas,
    // uma carência de 24h protegeria mais pautas do que existem lugares, e o
    // corte não teria o que cortar. Ver o racional da constante.
    const agora = new Date('2026-08-22T12:00:00.000Z');
    const horas = (agora.getTime() - graceCutoff(agora).getTime()) / 3_600_000;
    assert.ok(horas < 24, 'a carência não pode chegar a um dia inteiro');
    assert.ok(horas >= 1, 'a carência precisa cobrir pelo menos um ciclo com folga');
  });
});
