/**
 * =============================================================================
 * TESTES — fronteira do painel editorial (`isAdminPath`)
 * =============================================================================
 *
 * ESTES TESTES GUARDAM UMA CONTA DE ADSENSE, não um detalhe de roteamento.
 *
 * O bug corrigido: o script do AdSense era carregado no layout raiz, portanto em
 * TODA página — inclusive no painel. Com "Auto ads" ligado na conta do Google,
 * isso significa anúncio injetado nas telas internas, visto pela própria
 * redação: impressão inválida, e a punição do AdSense é a suspensão da conta
 * inteira.
 *
 * `isAdminPath` é a regra que decide se o script entra. Ela falha em silêncio
 * dos dois lados — se der falso-negativo, o anúncio volta ao painel e ninguém
 * nota até chegar o e-mail do Google; se der falso-positivo, uma página pública
 * para de monetizar e ninguém nota até alguém conferir o relatório. Nenhum dos
 * dois aparece como erro. Por isso a regra é testada caso a caso.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAdminPath, ROUTE_PREFIXES, routes } from './routes';

// -----------------------------------------------------------------------------
// O QUE É PAINEL (o script do AdSense NÃO pode carregar)
// -----------------------------------------------------------------------------

test('a raiz do painel é painel', () => {
  assert.equal(isAdminPath('/admin'), true);
  assert.equal(isAdminPath('/admin/'), true);
});

test('TODA rota do painel declarada em `routes` é reconhecida como painel', () => {
  /**
   * Este é o teste mais valioso do arquivo: ele não confere uma lista escrita à
   * mão, confere as rotas REAIS do painel. Uma tela nova (`routes.adminSeja lá o
   * quê`) entra automaticamente na verificação — e se alguém a escrever fora do
   * prefixo, o teste quebra AQUI, e não em produção com anúncio no painel.
   */
  const rotasDoPainel = [
    routes.admin(),
    routes.adminTopic('abc123'),
    routes.adminArticles(),
    routes.adminPreview('abc123'),
    routes.adminAnalytics(),
    routes.adminAccuracy(),
    routes.adminAffiliates(),
    routes.adminComments(),
    routes.adminAccounts(),
    routes.adminFranchises(),
  ];

  for (const rota of rotasDoPainel) {
    assert.equal(isAdminPath(rota), true, `${rota} deveria ser tratada como painel`);
  }

  // Trava de segurança contra o próprio teste envelhecer: se alguém acrescentar
  // uma rota `admin*` em `routes` e esquecer de listá-la acima, este número
  // denuncia. É barato e evita um teste que passa por não estar olhando.
  const totalDeRotasAdmin = Object.keys(routes).filter((nome) => nome.startsWith('admin')).length;
  assert.equal(
    rotasDoPainel.length,
    totalDeRotasAdmin,
    'existe rota de painel em `routes` que este teste não está verificando',
  );
});

test('rota de painel que ainda não existe também é painel (a regra é o prefixo)', () => {
  assert.equal(isAdminPath('/admin/uma-tela-que-sera-criada-em-2027'), true);
  assert.equal(isAdminPath('/admin/preview/qualquer-id?x=1'.split('?')[0] ?? ''), true);
});

test('maiúsculas não escapam da regra', () => {
  // `/ADMIN` não é rota válida no Next (o roteador diferencia caixa), mas um
  // proxy ou redirect pode preservar o caminho original. Custo de normalizar:
  // zero. Custo de não normalizar: a conta.
  assert.equal(isAdminPath('/ADMIN/materias'), true);
});

test('caminho sem barra inicial ou com espaços não fura a regra nem estoura', () => {
  assert.equal(isAdminPath('admin/contas'), true);
  assert.equal(isAdminPath('  /admin/contas  '), true);
  assert.equal(isAdminPath(''), false);
});

// -----------------------------------------------------------------------------
// O QUE NÃO É PAINEL (o site precisa continuar monetizando)
// -----------------------------------------------------------------------------

test('rotas públicas não são painel', () => {
  for (const rota of [
    routes.home(),
    routes.trending(),
    routes.category('games'),
    routes.article('games', 'gta-6-trailer'),
    routes.account(),
    routes.newsletter(),
    routes.methodology(),
  ]) {
    assert.equal(isAdminPath(rota), false, `${rota} não deveria ser tratada como painel`);
  }
});

test('prefixo parecido não conta — a comparação é por segmento', () => {
  // Sem a checagem por segmento, um `startsWith('/admin')` cru desmonetizaria
  // qualquer página pública cujo caminho comece com as mesmas letras.
  assert.equal(isAdminPath('/administrativo'), false);
  assert.equal(isAdminPath('/admin-de-verdade'), false);
  assert.equal(isAdminPath('/categoria/admin'), false);
});

test('o prefixo do painel é o esperado (contrato com robots.txt e staff-auth)', () => {
  // Mudar este valor muda três coisas de uma vez: indexação, autenticação e
  // carregamento de anúncio. Se alguém mexer, que seja com este teste na frente.
  assert.equal(ROUTE_PREFIXES.admin, '/admin');
});
