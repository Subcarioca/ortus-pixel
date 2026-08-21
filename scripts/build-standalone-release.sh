#!/usr/bin/env bash
# =============================================================================
# Monta a árvore `deploy-standalone` a partir de um build standalone Linux.
#
# RODA SÓ NO RUNNER LINUX DO GITHUB ACTIONS. Nunca na máquina Windows do dev:
# um `next build` no Windows produz binários nativos (sharp/Prisma) do Windows
# e grava `outputFileTracingRoot="R:\\Claudio"` no next-server.js — ambos
# INCOMPATÍVEIS com o Linux da Hostinger. Este script só é chamado pelo
# workflow `.github/workflows/deploy-standalone.yml`, que roda em ubuntu-latest.
#
# CONTRATO (o que este script assume existir, e o que ele produz):
#   ENTRADA:
#     ./APPS_WEB_BUILD/        -> `apps/web/.next/standalone/apps/web/` do build
#     ./WEB_STATIC/            -> `apps/web/.next/static/` do build (CSS/chunks,
#                                 fora do output standalone)
#     ./CURATOR_DIST/          -> `services/curator/dist/` do build do curator
#     ./WEB_PUBLIC/            -> `apps/web/public/`
#     ./PRISMA_SCHEMA/         -> o único arquivo `schema.prisma`
#     ./DOT_PRISMA_CLIENT/     -> `.prisma/client` traçado pelo build standalone
#     ./AT_PRISMA_CLIENT/      -> `@prisma/client` traçado pelo build standalone
#     ./deploy/                -> clone da branch `deploy-standalone` (destino)
#   SAÍDA:
#     `deploy-standalone` com overlay MÍNIMO: só o que muda a cada release.
#
# PRESERVA VERBATIM (nunca regerado aqui): server.js, package.json,
# node_modules/ (árvore traçada com sharp/engine Linux), curator/build-info.json
# só é regerado pelo build do curator (via CURATOR_DIST), não à mão.
#
# ⚠ `vendor/dot-prisma-client/` e `vendor/at-prisma-client/` NÃO estão mais
# nessa lista de "preservado verbatim" — ver a etapa (7) abaixo. Ficaram
# congelados desde antes deste pipeline existir, e cada campo novo no schema
# quebrava silenciosamente toda consulta que o usasse (o Prisma recusa
# `select`/`where` com campo desconhecido ANTES de tocar o banco; o erro
# ficava escondido atrás do `safeQuery` da home, que despejava "nenhuma
# matéria" sem pista nenhuma da causa real).
# =============================================================================
set -euo pipefail

# ------------------------------------------------------------------ (1) PATHS
# Caminhos fixos por tarefa. O workflow os cria com estes exatos nomes.
APPS_WEB_BUILD="${APPS_WEB_BUILD:-./APPS_WEB_BUILD}"
WEB_STATIC="${WEB_STATIC:-./WEB_STATIC}"
CURATOR_DIST="${CURATOR_DIST:-./CURATOR_DIST}"
WEB_PUBLIC="${WEB_PUBLIC:-./WEB_PUBLIC}"
PRISMA_SCHEMA="${PRISMA_SCHEMA:-./PRISMA_SCHEMA}"
DOT_PRISMA_CLIENT="${DOT_PRISMA_CLIENT:-./DOT_PRISMA_CLIENT}"
AT_PRISMA_CLIENT="${AT_PRISMA_CLIENT:-./AT_PRISMA_CLIENT}"
DEPLOY_OUT="${DEPLOY_OUT:-./deploy}"

# Valida entradas antes de tocar em qualquer coisa (falha alto e cedo).
for v in APPS_WEB_BUILD WEB_STATIC CURATOR_DIST WEB_PUBLIC PRISMA_SCHEMA DOT_PRISMA_CLIENT AT_PRISMA_CLIENT DEPLOY_OUT; do
  if [[ ! -e "${!v}" ]]; then
    echo "ERRO: entrada ausente: ${v}=${!v}" >&2
    exit 1
  fi
done

# ------------------------------------------------------------------ (2) .next
# O build standalone emite em `apps/web/.next/standalone/apps/web/`:
#   - server.js          (entry autocontido do Next)
#   - .next/             (BUILD_ID, server/ — SEM static/)
#   - node_modules/      (árvore TRACEADA pelo outputFileTracingRoot)
# A branch quer o `.next` NA RAIZ, e o `server.js` renomeado p/ `next-server.js`.
# O overlay aqui NÃO copia node_modules — a árvore traçada da branch já tem
# sharp/engine Linux e é preservada (sem dep npm nova nesta release).
#
# `.next/static/` (CSS + chunks JS) fica de fora do output standalone de
# propósito (comportamento documentado do Next) — por isso vem separado em
# WEB_STATIC (copiado de `apps/web/.next/static`, fora da pasta standalone) e
# é sobreposto em `.next/static/` DEPOIS de trocar o `.next` inteiro. Sem
# isso, `_next/static/*` responde 404 em produção e o navegador recusa
# aplicar/executar CSS e JS por MIME type incompatível.

echo "[overlay] substituindo .next/ ..."
rm -rf "${DEPLOY_OUT}/.next"
cp -r "${APPS_WEB_BUILD}/.next" "${DEPLOY_OUT}/.next"

echo "[overlay] .next/static/ ..."
cp -r "${WEB_STATIC}" "${DEPLOY_OUT}/.next/static"

echo "[overlay] substituindo next-server.js ..."
cp "${APPS_WEB_BUILD}/server.js" "${DEPLOY_OUT}/next-server.js"

# ------------------------------------------------------------------ (3) public
# public/ é o conteúdo estático servido (sw.js). Só re-copiado quando mudou;
# idempotente, não apaga o que não precisa.
echo "[overlay] public/ ..."
rm -rf "${DEPLOY_OUT}/public"
cp -r "${WEB_PUBLIC}" "${DEPLOY_OUT}/public"

# ------------------------------------------------------------------ (4) schema
# packages/db/prisma/schema.prisma. Inalterado nesta release, mas idempotente:
# mantém a árvore da branch fiel ao schema canônico do monorepo.
echo "[overlay] schema.prisma ..."
mkdir -p "${DEPLOY_OUT}/prisma"
cp "${PRISMA_SCHEMA}/schema.prisma" "${DEPLOY_OUT}/prisma/schema.prisma"

# ------------------------------------------------------------------ (5) curator
# services/curator/dist/ -> curator/ (curator.cjs + node_modules/.prisma + engine
# debian-openssl-1.1.x). Regenerado pelo build do curator na release; aqui só
# sobrepõe o que o build produz. build-info.json vem junto do dist.
echo "[overlay] curator/ ..."
rm -rf "${DEPLOY_OUT}/curator"
cp -r "${CURATOR_DIST}" "${DEPLOY_OUT}/curator"

# ------------------------------------------------------------------ (7) vendor/Prisma
# `server.js` (nesta branch) restaura `node_modules/.prisma/client` e
# `node_modules/@prisma/client` A CADA PROCESSO a partir destas duas pastas —
# é o jeito de sobreviver ao `npm install` da Hostinger, que roda sem
# lockfile e deixa só stubs. O problema histórico: nada regenerava esse
# `vendor/`, então ele congelou no schema de quando foi criado à mão, bem
# antes deste workflow existir. Agora ele é sobreposto a cada release, com o
# Client de verdade que ACABOU de ser gerado (Linux, schema atual, mesmo
# `binaryTargets` do `packages/db/prisma/schema.prisma`).
#
# O engine (`.so.node`, ~20MB) vai junto dentro de `dot-prisma-client/` — não
# é copiado a cada processo (`server.js` usa `PRISMA_QUERY_ENGINE_LIBRARY`
# para apontar direto pra cá, sem `existsSync`/cópia), mas PRECISA existir
# fisicamente neste caminho, senão o processo derruba com "engine do Prisma
# ausente" no boot. Overlay completo, sem filtro de arquivo: mais simples e
# mais seguro que manter uma lista de exclusões que precisaria acompanhar
# toda mudança de versão do Prisma.
echo "[overlay] vendor/dot-prisma-client/ e vendor/at-prisma-client/ ..."
rm -rf "${DEPLOY_OUT}/vendor/dot-prisma-client" "${DEPLOY_OUT}/vendor/at-prisma-client"
mkdir -p "${DEPLOY_OUT}/vendor"
cp -r "${DOT_PRISMA_CLIENT}" "${DEPLOY_OUT}/vendor/dot-prisma-client"
cp -r "${AT_PRISMA_CLIENT}"  "${DEPLOY_OUT}/vendor/at-prisma-client"

# ------------------------------------------------------------------ (8) done
# server.js, package.json e node_modules/ ficaram INTACTOS — nenhuma linha
# acima os toca. O git status do passo de push revela exatamente o diff
# enxuto que a Hostinger precisa promover.
echo "[overlay] concluído. diff enxuto em ${DEPLOY_OUT}/"
