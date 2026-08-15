/**
 * =============================================================================
 * TESTES — onde o servidor procura o bundle do curator
 * =============================================================================
 *
 * POR QUE ESTA REGRA MERECE TESTE, ENTRE TODAS AS DESTA FUNCIONALIDADE
 * -----------------------------------------------------------------------------
 * Porque ela é a única que NÃO pode ser validada na máquina em que foi escrita.
 * O caminho que importa (`<raiz do app>/curator/curator.cjs`) só existe dentro
 * da árvore de deploy da Hostinger — uma pasta `hbuilds/versions/<uuid>/nodejs/`
 * que não tem equivalente local. Um erro aqui não aparece em `npm run dev`, não
 * aparece no `next build` e não aparece no type-check: aparece para quem clicar
 * no botão em produção, como "bundle não encontrado".
 *
 * `curatorBundleCandidates` é PURA justamente para tornar isso testável: ela
 * recebe o diretório e o ambiente em vez de lê-los do processo, então dá para
 * afirmar aqui, numa máquina Windows, o que ela produzirá no Linux da
 * hospedagem.
 *
 * O QUE ESTES TESTES TRAVAM, em uma frase cada:
 *   1. O caminho de PRODUÇÃO é o primeiro a ser tentado.
 *   2. O caminho de DEV continua funcionando (senão ninguém testa antes de subir).
 *   3. A escotilha `CURATOR_BUNDLE_PATH` vence tudo e não cai para os palpites.
 *   4. NENHUM caminho absoluto de conta de hospedagem entra no resultado.
 *
 * O item 4 é o que impede a regressão mais provável desta funcionalidade: a
 * tentação de "resolver" um caminho quebrado colando `/home/u754239208/...` no
 * código, que funcionaria naquela tarde e quebraria em toda outra conta,
 * ambiente de teste e no dia em que a hospedagem mudar.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { curatorBundleCandidates } from './curator-bundle';

/**
 * A raiz do app em produção. O nome com UUID é ilustrativo — o que o teste
 * exercita é que NADA no resultado depende do formato desse diretório.
 */
const RAIZ_DE_PRODUCAO = '/home/qualquer-conta/hbuilds/versions/abc-123/nodejs';

test('produção: o primeiro candidato é `curator/curator.cjs` ao lado do server.js', () => {
  const [primeiro] = curatorBundleCandidates(RAIZ_DE_PRODUCAO);

  // É este o layout da branch `deploy-standalone`, que É a árvore servida:
  //   nodejs/server.js  +  nodejs/curator/curator.cjs
  assert.equal(primeiro, path.join(RAIZ_DE_PRODUCAO, 'curator', 'curator.cjs'));
});

test('produção: o caminho é relativo ao cwd — trocar de conta não muda o código', () => {
  // O mesmo código, duas contas de hospedagem diferentes. A única coisa que
  // muda é a entrada. Se algum dia alguém fixar um caminho absoluto no módulo,
  // este teste passa a falhar para uma das duas.
  const contaA = curatorBundleCandidates('/home/conta-a/hbuilds/current/nodejs')[0];
  const contaB = curatorBundleCandidates('/home/conta-b/hbuilds/current/nodejs')[0];

  assert.equal(contaA, path.join('/home/conta-a/hbuilds/current/nodejs', 'curator', 'curator.cjs'));
  assert.equal(contaB, path.join('/home/conta-b/hbuilds/current/nodejs', 'curator', 'curator.cjs'));
  assert.notEqual(contaA, contaB);
});

test('desenvolvimento: `apps/web` como cwd encontra services/curator/dist', () => {
  // `npm run dev --workspace=@subcarioca/web` roda com o cwd no diretório DO
  // workspace, não na raiz do monorepo. É o caminho que a pessoa que for testar
  // a funcionalidade antes de subir vai exercitar.
  const candidatos = curatorBundleCandidates(path.join('/repo', 'apps', 'web'));

  assert.ok(
    candidatos.includes(path.join('/repo', 'services', 'curator', 'dist', 'curator.cjs')),
    `esperava o dist do curator entre os candidatos, recebi: ${candidatos.join(' | ')}`,
  );
});

test('desenvolvimento: a raiz do monorepo como cwd também encontra', () => {
  const candidatos = curatorBundleCandidates('/repo');

  assert.ok(
    candidatos.includes(path.join('/repo', 'services', 'curator', 'dist', 'curator.cjs')),
    `esperava o dist do curator entre os candidatos, recebi: ${candidatos.join(' | ')}`,
  );
});

test('CURATOR_BUNDLE_PATH vence e é a ÚNICA candidata', () => {
  const candidatos = curatorBundleCandidates(RAIZ_DE_PRODUCAO, {
    CURATOR_BUNDLE_PATH: '/opt/artefatos/curator.cjs',
  });

  // A lista tem tamanho 1 de propósito. Cair para os palpites depois de alguém
  // ter dito EXPLICITAMENTE onde o arquivo está esconderia um erro de digitação
  // no caminho — o operador veria o botão funcionando e concluiria que a
  // variável dele foi lida, quando não foi.
  assert.equal(candidatos.length, 1);
  assert.equal(candidatos[0], path.resolve('/opt/artefatos/curator.cjs'));
});

test('CURATOR_BUNDLE_PATH vazia ou só espaços é ignorada (não vira caminho válido)', () => {
  // Uma variável declarada e vazia no painel da hospedagem é um acidente comum.
  // Tratá-la como caminho faria a resolução apontar para o diretório atual e
  // falhar com uma mensagem que não ajuda ninguém.
  for (const valor of ['', '   ']) {
    const candidatos = curatorBundleCandidates(RAIZ_DE_PRODUCAO, {
      CURATOR_BUNDLE_PATH: valor,
    });
    assert.ok(candidatos.length > 1, `valor ${JSON.stringify(valor)} não deveria virar candidata`);
    assert.equal(candidatos[0], path.join(RAIZ_DE_PRODUCAO, 'curator', 'curator.cjs'));
  }
});

test('nenhum candidato carrega caminho absoluto de conta de hospedagem', () => {
  // A regressão mais provável desta funcionalidade, travada explicitamente.
  // Note que a busca é pela ASSINATURA do caminho (`/home/u<números>`), e não
  // pelo id da conta atual: qualquer conta colada no código cai aqui.
  const candidatos = curatorBundleCandidates(path.join('/repo', 'apps', 'web'));

  for (const candidato of candidatos) {
    assert.doesNotMatch(
      candidato,
      /[/\\]home[/\\]u\d+/,
      `candidato com caminho absoluto de conta: ${candidato}`,
    );
  }
});
