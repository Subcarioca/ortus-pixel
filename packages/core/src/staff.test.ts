/**
 * =============================================================================
 * TESTES DE RBAC — a tabela de permissões como contrato
 * =============================================================================
 *
 * POR QUE TESTAR UMA TABELA DE BOOLEANOS, que "não tem lógica nenhuma":
 *
 * Porque o modo de falha desta tabela é ADICIONAR uma capacidade nova e marcá-la
 * `true` nos dois níveis por hábito — copia-se a linha de cima, ajusta-se o
 * nome, e um redator ganha acesso a algo que ninguém decidiu dar a ele. Não há
 * erro de compilação, não há tela quebrada, e a revisão de código vê uma
 * diferença de duas linhas que parece igual às outras.
 *
 * Estes testes transformam cada decisão de permissão numa afirmação explícita.
 * Mudar qualquer uma delas passa a exigir mudar um teste — ou seja, exige dizer
 * em voz alta "eu quero que redator possa fazer isto".
 *
 * A LISTA ABAIXO É A RESPOSTA à pergunta que uma auditoria de segurança faz:
 * "o que exatamente um redator alcança?".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STAFF_CAPABILITIES,
  canEditArticleOf,
  can,
  requiresSensitiveApproval,
  toAccessLevel,
  type StaffCapabilities,
} from './staff';

/**
 * O QUE SÓ ADMINISTRADOR PODE.
 *
 * Cada item aqui é uma ação com efeito FORA da própria matéria de quem executa:
 * muda o que o site inteiro exibe, escreve na caixa de entrada dos outros,
 * expõe o desempenho alheio ou mexe no que o Google vê.
 */
const SOMENTE_ADMIN: (keyof StaffCapabilities)[] = [
  'curarFilaDePautas',
  'moderarComentarios',
  'gerenciarComercial',
  'verRelatorios',
  'gerenciarContas',
  'atribuirOutroAutor',
  'verAnalyticsDoSite',
  'reduzirRestricaoDeConteudo',
  'dispararAlertaViral',
  'aprovarConteudoSensivel',
];

/** O que TODA conta ativa da redação pode. */
const TODA_A_REDACAO: (keyof StaffCapabilities)[] = [
  'verFilaDePautas',
  'verMaterias',
  'criarPauta',
  // Cadastrar franquia nova no catálogo. Decisão explícita, e não herdada de
  // `criarPauta`: ela cria uma PÁGINA PÚBLICA permanente (`/franquia/x`), o que
  // é mais do que acrescentar uma linha numa fila interna. Continua liberada
  // para o redator porque acrescentar não altera nem remove nada do que já
  // existe — e porque a alternativa era editar o banco na mão. Editar e apagar
  // franquia NÃO estão incluídos; ver o comentário da chave em core/staff.ts.
  'criarFranquia',
  'verAnalytics',
];

test('administrador tem todas as capacidades', () => {
  for (const capability of Object.keys(STAFF_CAPABILITIES.admin) as (keyof StaffCapabilities)[]) {
    assert.equal(can('admin', capability), true, `admin deveria ter ${capability}`);
  }
});

test('redator NÃO tem nenhuma das capacidades privativas', () => {
  for (const capability of SOMENTE_ADMIN) {
    assert.equal(can('redator', capability), false, `redator NÃO deveria ter ${capability}`);
  }
});

test('redator tem o que precisa para trabalhar', () => {
  for (const capability of TODA_A_REDACAO) {
    assert.equal(can('redator', capability), true, `redator deveria ter ${capability}`);
  }
});

test('TODA capacidade está classificada — nenhuma entra sem decisão explícita', () => {
  /**
   * ESTE É O TESTE QUE IMPORTA DE VERDADE.
   *
   * Ele falha quando alguém acrescenta uma chave a `StaffCapabilities` sem
   * colocá-la em uma das duas listas acima. A mensagem de erro é o pedido para
   * a pessoa DECIDIR: "isto é de todo mundo ou só do administrador?".
   *
   * Sem ele, os outros três testes continuariam passando alegremente com uma
   * capacidade nova, liberada para o redator, que ninguém revisou.
   */
  const classificadas = new Set<string>([...SOMENTE_ADMIN, ...TODA_A_REDACAO]);
  const declaradas = Object.keys(STAFF_CAPABILITIES.admin);

  for (const capability of declaradas) {
    assert.ok(
      classificadas.has(capability),
      `A capacidade "${capability}" não está classificada em staff.test.ts. ` +
        'Decida se ela é de toda a redação ou só de administrador e acrescente-a à lista certa.',
    );
  }

  assert.equal(classificadas.size, declaradas.length);
});

// -----------------------------------------------------------------------------
// A REGRA POR LINHA (dono da matéria)
// -----------------------------------------------------------------------------

test('redator edita o que assina e nada além', () => {
  const redator = { id: 'autor-1', accessLevel: 'redator' as const };
  assert.equal(canEditArticleOf(redator, 'autor-1'), true);
  assert.equal(canEditArticleOf(redator, 'autor-2'), false);
});

test('administrador edita matéria de qualquer pessoa', () => {
  const admin = { id: 'chefe', accessLevel: 'admin' as const };
  assert.equal(canEditArticleOf(admin, 'autor-2'), true);
});

// -----------------------------------------------------------------------------
// APROVAÇÃO PRÉVIA DE CONTEÚDO SENSÍVEL
// -----------------------------------------------------------------------------
//
// Os ranks são os de `content-sensitivity.ts`: 0 = 'none', 1 = 'sensitive',
// 2 = 'adult'. Escritos como número aqui de propósito — o módulo de permissão
// não importa vocabulário editorial, e o teste segue a mesma fronteira.

const REDATOR = { accessLevel: 'redator' as const };
const ADMIN = { accessLevel: 'admin' as const };

test('redator publicando conteúdo sensível para na fila de aprovação', () => {
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 1, liveRank: null }),
    true,
  );
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 2, liveRank: null }),
    true,
  );
});

test('administrador publicando conteúdo sensível vai direto ao ar', () => {
  // Ele é justamente quem aprovaria: mandá-lo para a própria fila seria
  // cerimônia sem revisão nenhuma no meio.
  assert.equal(
    requiresSensitiveApproval({ viewer: ADMIN, publishing: true, nextRank: 2, liveRank: null }),
    false,
  );
});

test('matéria comum ("none") nunca passa pela fila', () => {
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 0, liveRank: null }),
    false,
  );
});

test('salvar RASCUNHO sensível não pede aprovação', () => {
  // Rascunho já não está no ar. Mandá-lo para a fila só encheria a mesa do
  // administrador de trabalho inacabado que o próprio autor ainda vai mudar.
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: false, nextRank: 2, liveRank: null }),
    false,
  );
});

test('editar matéria sensível JÁ no ar não a derruba de volta para a fila', () => {
  // O caso que motivou a condição: sem ela, corrigir uma vírgula numa matéria
  // sensível já aprovada a despublicaria — quebrando link e posição no Google.
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 1, liveRank: 1 }),
    false,
  );
});

test('ESCALAR a classificação de uma matéria no ar volta para a fila', () => {
  // Fecha a porta dos fundos de dois passos: publicar como 'none' e, na edição
  // seguinte, marcar 'adult' sem ninguém revisar.
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 1, liveRank: 0 }),
    true,
  );
  assert.equal(
    requiresSensitiveApproval({ viewer: REDATOR, publishing: true, nextRank: 2, liveRank: 1 }),
    true,
  );
});

test('papel desconhecido no banco vira redator, nunca admin', () => {
  // A direção da falha é o ponto: errar para 'redator' faz alguém ver um botão a
  // menos; errar para 'admin' entrega o site a quem não deveria tê-lo.
  assert.equal(toAccessLevel('ADMIN'), 'redator');
  assert.equal(toAccessLevel('editor-chefe'), 'redator');
  assert.equal(toAccessLevel(undefined), 'redator');
  assert.equal(toAccessLevel('admin'), 'admin');
});
