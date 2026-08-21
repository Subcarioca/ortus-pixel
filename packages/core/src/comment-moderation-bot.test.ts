/**
 * =============================================================================
 * TESTES DO BOT DE TRIAGEM — o contrato de uma remoção AUTOMÁTICA
 * =============================================================================
 *
 * Estes testes importam mais do que a média do projeto por um motivo específico:
 * o resultado desta função APAGA conteúdo de leitor sem passar por ninguém. Um
 * falso positivo aqui não é um teste vermelho — é um comentário legítimo que
 * sumiu, e uma pessoa concluindo que o site censura.
 *
 * Por isso a suíte está dividida em três blocos, na ordem de importância
 * invertida em relação à intuição:
 *
 *   1. O QUE NÃO PODE SER REMOVIDO (o bloco mais longo, de propósito).
 *   2. O que precisa ser removido.
 *   3. As normalizações que fazem 1 e 2 continuarem valendo quando o texto vem
 *      com acento, caixa alta, letra repetida ou leet.
 *
 * Cada caso do bloco 1 é uma frase que um leitor de portal de cultura pop
 * escreveria num dia normal. Se um deles ficar vermelho depois de alguém
 * acrescentar um termo à lista, a mensagem é: esse termo não pode remover
 * sozinho — ele vai para 'profanity' ou fica fora.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isOffensiveComment,
  normalizeForModeration,
  screenComment,
} from './comment-moderation-bot';

// -----------------------------------------------------------------------------
// 1. O QUE NÃO PODE SER REMOVIDO
// -----------------------------------------------------------------------------

test('palavra inocente que CONTÉM um termo da lista não é ofensiva', () => {
  /**
   * O caso que a fronteira de palavra (`\b`) existe para impedir. Sem ela,
   * "reputação" contém "puta", "escuro" contém "cu", "disputa" contém "puta" e
   * "documento" contém "cu" — quatro remoções automáticas por dia, todas
   * indefensáveis.
   */
  const inocentes = [
    'A reputação do estúdio ficou abalada depois do vazamento.',
    'O cenário é escuro demais, não dá para ver nada.',
    'A disputa entre os dois estúdios rende faísca.',
    'Preciso conferir o documento oficial antes de acreditar.',
    'Esse boss é uma amputação de dificuldade, quase impossível.',
    'A trilha é linda, principalmente o tema do Sapataria (nome do vilarejo).',
  ];

  for (const texto of inocentes) {
    const resultado = screenComment(texto);
    assert.equal(
      resultado.offensive,
      false,
      `Falso positivo em "${texto}" (casou: ${resultado.matches.join(', ')})`,
    );
  }
});

test('crítica dura ao PRODUTO não é ofensa à pessoa', () => {
  // A fronteira que separa "moderar" de "silenciar". Nenhuma destas frases pode
  // sumir automaticamente: elas são a razão de a área de comentários existir.
  const criticas = [
    'Esse jogo é lixo, desinstalei em duas horas.',
    'Que final horrível, desperdiçaram a série inteira.',
    'O terceiro ato é um monstro deformado de tanta reescrita.',
    'A aberração que fizeram com o personagem no live-action é inacreditável.',
    'O vilão é um palhaço, no sentido literal: ele trabalha num circo.',
    'Fui burro de comprar na pré-venda.',
  ];

  for (const texto of criticas) {
    assert.equal(isOffensiveComment(texto), false, `Não pode remover: "${texto}"`);
  }
});

test('palavrão de ÊNFASE não derruba o comentário — só marca a gravidade', () => {
  /**
   * A decisão de produto mais importante do módulo, escrita como teste: se este
   * caso passasse a devolver `offensive: true`, qualquer leitor teria um botão
   * para apagar o comentário alheio — bastaria denunciar quem escreveu "que
   * porra é essa?".
   */
  const resultado = screenComment('Porra, que trailer bom! Fiquei de queixo caído.');

  assert.equal(resultado.offensive, false);
  assert.equal(resultado.severity, 'profanity');
  // O achado É registrado: a fila humana precisa distinguir "denúncia num
  // comentário com linguagem pesada" de "denúncia num comentário educado".
  assert.ok(resultado.matches.length > 0);
});

test('texto vazio, nulo ou de outro tipo devolve "nada encontrado"', () => {
  // O conteúdo chega do banco, que veio de um formulário: a fronteira de
  // confiança está do lado de fora. Um `null` aqui não pode derrubar a rota de
  // denúncia inteira.
  for (const entrada of [null, undefined, 42, {}, '', '   ']) {
    const resultado = screenComment(entrada);
    assert.equal(resultado.offensive, false);
    assert.equal(resultado.severity, 'none');
  }
});

// -----------------------------------------------------------------------------
// 2. O QUE PRECISA SER REMOVIDO
// -----------------------------------------------------------------------------

test('xingamento claro é detectado e classificado como insulto', () => {
  const resultado = screenComment('Cala a boca, seu idiota. Ninguém pediu sua opinião.');

  assert.equal(resultado.offensive, true);
  assert.equal(resultado.severity, 'insult');
  assert.ok(resultado.matches.includes('idiota'));
});

test('xingamento em FRASE (várias palavras) é detectado', () => {
  // O caso que uma lista de palavras soltas erra: cada palavra de "vai se foder"
  // é inofensiva sozinha.
  assert.equal(isOffensiveComment('vai se foder, moderador'), true);
  assert.equal(isOffensiveComment('esse cara é um filho da puta'), true);
  assert.equal(isOffensiveComment('vai tomar no cu com essa análise'), true);
});

test('sigla de xingamento é detectada', () => {
  // Siglas são usadas justamente por escaparem de filtro ingênuo.
  assert.equal(isOffensiveComment('tu é um fdp mesmo'), true);
  assert.equal(isOffensiveComment('vtnc'), true);
});

test('discurso de ódio é classificado acima de insulto', () => {
  // A severidade não é decoração: ela é o que a nota de moderação registra e o
  // que permitirá, um dia, tratar reincidência de ódio diferente de bate-boca.
  const resultado = screenComment('sai daqui, viado');

  assert.equal(resultado.offensive, true);
  assert.equal(resultado.severity, 'hate');
});

test('a categoria MAIS GRAVE vence quando as duas aparecem', () => {
  const resultado = screenComment('seu idiota retardado');
  assert.equal(resultado.severity, 'hate');
});

test('incitação ao suicídio é ódio, mas o verbo isolado não é', () => {
  assert.equal(isOffensiveComment('vai se matar, ninguém gosta de você'), true);
  // "se mata" solto tem uso legítimo — é por isso que a lista guarda a FRASE.
  assert.equal(isOffensiveComment('ele se mata de trabalhar nesse estúdio'), false);
});

// -----------------------------------------------------------------------------
// 3. NORMALIZAÇÃO — o que faz 1 e 2 continuarem valendo
// -----------------------------------------------------------------------------

test('ignora acento e caixa', () => {
  assert.equal(isOffensiveComment('OTÁRIO'), true);
  assert.equal(isOffensiveComment('Otário'), true);
  assert.equal(isOffensiveComment('otario'), true);
  assert.equal(isOffensiveComment('IDIOTA!!!'), true);
  assert.equal(isOffensiveComment('desgraçado'), true);
});

test('ignora plural', () => {
  assert.equal(isOffensiveComment('vocês são uns idiotas'), true);
  assert.equal(isOffensiveComment('bando de otários'), true);
});

test('ignora letra repetida (alongamento)', () => {
  // "idiotaaaa" é como se escreve xingamento gritado. Sem o colapso, ele passa.
  assert.equal(isOffensiveComment('seu idiotaaaaa'), true);
  assert.equal(isOffensiveComment('imbeciiiil'), true);
});

test('ignora leet básico', () => {
  assert.equal(isOffensiveComment('1d10t4'), true);
  assert.equal(isOffensiveComment('0tario'), true);
});

test('ignora pontuação usada como separador entre palavras da frase', () => {
  // A normalização transforma hífen e pontuação em espaço, então "vai-se-foder"
  // e "vai se foder" são o mesmo texto para o bot.
  assert.equal(isOffensiveComment('vai-se-foder!'), true);
});

test('normalizeForModeration entrega texto comparável', () => {
  // O teste da peça isolada: ela é exportada porque outros filtros futuros
  // (busca, antispam) vão querer a MESMA normalização, e duas versões dela é
  // uma delas ficar para trás.
  assert.equal(normalizeForModeration('Ótimo, ELE  chegou!'), 'otimo ele chegou');
  assert.equal(normalizeForModeration('não—é   isso'), 'nao e isso');
});

test('a ofuscação por separador DENTRO da palavra ainda passa (limitação aceita)', () => {
  /**
   * Este teste documenta uma FALHA CONHECIDA, e é intencional que ele afirme o
   * comportamento atual em vez de pedir o ideal.
   *
   * Tratar "i.d.i.o.t.a" exigiria remover pontuação dentro das palavras, o que
   * destruiria a fronteira de palavra e faria o bloco 1 inteiro desabar. O
   * comentário continua denunciável e continua chegando ao painel — o que ele
   * não sofre é remoção automática.
   *
   * Se um dia alguém resolver isso sem quebrar o bloco 1, este teste vira o
   * lugar certo para inverter a afirmação.
   */
  assert.equal(isOffensiveComment('i.d.i.o.t.a'), false);
});
