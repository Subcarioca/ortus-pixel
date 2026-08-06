#!/usr/bin/env bash
# =============================================================================
# Ortus Pixel — deploy no VPS (caminho A: PM2)
# =============================================================================
#
# USO (no VPS, a partir da raiz do projeto):
#
#   ./scripts/deploy.sh                  # deploy normal (inclui o primeiro)
#   ./scripts/deploy.sh --skip-pull      # já atualizou o código na mão
#   ./scripts/deploy.sh --db=none        # não toca no banco
#   ./scripts/deploy.sh --db=push        # ESCAPE DE EMERGÊNCIA — evite (leia a etapa 4)
#
# O PRIMEIRO deploy usa o mesmo comando dos demais. Desde que a migration
# inicial versionada existe (`packages/db/prisma/migrations/20260806120000_init`),
# `prisma migrate deploy` cria o schema inteiro num banco vazio — não há mais
# nenhum cenário normal que exija `db push`.
#
# Na primeira vez:  chmod +x scripts/deploy.sh
#
# -----------------------------------------------------------------------------
# A REGRA QUE ORGANIZA ESTE ARQUIVO: FALHAR ALTO, NUNCA SEGUIR EM SILÊNCIO
# -----------------------------------------------------------------------------
# Um script de deploy que continua depois de um erro é pior que não ter script.
# O modo de falha clássico: o `npm run build` quebra, o script segue, o
# `pm2 reload` reinicia o processo apontando para um `.next` PELA METADE — e o
# site cai. Pior ainda quando o build falha mas o site velho continuaria
# funcionando perfeitamente se ninguém tivesse mexido.
#
# Por isso, além do `set -e`, cada etapa passa por `step()`, que anuncia o que
# vai fazer, executa e aborta com mensagem clara e código de saída diferente de
# zero. E o `trap` no final imprime onde parou.

set -Eeuo pipefail
# -E  : o `trap ERR` também vale dentro de funções (sem isso, falha em função passa batido)
# -e  : aborta em qualquer comando que retorne != 0
# -u  : variável não definida é erro (pega erro de digitação em nome de variável)
# -o pipefail : `a | b` falha se QUALQUER parte falhar, não só a última.
#               Sem isto, `npm run build | tee log` retornaria sucesso mesmo com
#               o build quebrado, porque o `tee` funcionou.

# -----------------------------------------------------------------------------
# Localização: sempre operar a partir da RAIZ do projeto
# -----------------------------------------------------------------------------
# Resolvemos o caminho a partir da posição do próprio script, e não de `pwd`.
# Sem isso, rodar `bash scripts/deploy.sh` de dentro de outra pasta faria o
# `npm ci` instalar no lugar errado — e o erro só apareceria depois.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ROOT_DIR}/.env.production"
LOG_DIR="${ROOT_DIR}/logs"

# --- Aparência (só ajuda a ler o log de um deploy que deu errado às 3h) -------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  # Saída redirecionada para arquivo: sem códigos de cor sujando o log.
  BOLD=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

CURRENT_STEP="inicialização"

info()  { printf '%s\n' "${BOLD}==> ${1}${RESET}"; }
warn()  { printf '%s\n' "${YELLOW}[aviso] ${1}${RESET}" >&2; }
ok()    { printf '%s\n' "${GREEN}    ok: ${1}${RESET}"; }
die()   { printf '%s\n' "${RED}[ERRO] ${1}${RESET}" >&2; exit 1; }

# Executa uma etapa nomeada. Se ela falhar, o `set -e` derruba o script e o
# `trap` abaixo informa exatamente qual etapa morreu.
step() {
  CURRENT_STEP="$1"; shift
  info "${CURRENT_STEP}"
  "$@"
  ok "${CURRENT_STEP}"
}

on_error() {
  local exit_code=$?
  printf '\n%s\n' "${RED}${BOLD}DEPLOY ABORTADO${RESET}" >&2
  printf '%s\n' "${RED}Etapa que falhou: ${CURRENT_STEP} (código ${exit_code})${RESET}" >&2
  printf '%s\n' "${RED}NADA foi reiniciado a partir deste ponto — o processo que já${RESET}" >&2
  printf '%s\n' "${RED}estava no ar continua rodando a versão anterior.${RESET}" >&2
  printf '%s\n' "${YELLOW}Verifique com: pm2 list && pm2 logs --lines 50${RESET}" >&2
  exit "${exit_code}"
}
trap on_error ERR

# -----------------------------------------------------------------------------
# Argumentos
# -----------------------------------------------------------------------------
SKIP_PULL=0
# Estratégia de banco. O padrão é `migrate` (o único seguro em produção).
DB_STRATEGY="migrate"

for arg in "$@"; do
  case "$arg" in
    --skip-pull) SKIP_PULL=1 ;;
    --db=migrate) DB_STRATEGY="migrate" ;;
    --db=push)    DB_STRATEGY="push" ;;
    --db=none)    DB_STRATEGY="none" ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "argumento desconhecido: ${arg}" ;;
  esac
done

printf '%s\n\n' "${BOLD}Ortus Pixel — deploy de produção${RESET}"

# =============================================================================
# ETAPA 0 — VERIFICAÇÕES PRÉVIAS
# =============================================================================
#
# Tudo aqui é barato e roda ANTES de qualquer mudança. A ideia é descobrir que
# falta o `.env.production` em 2 segundos, e não depois de derrubar o site.

preflight() {
  command -v node >/dev/null 2>&1 || die "Node.js não encontrado no PATH."
  command -v npm  >/dev/null 2>&1 || die "npm não encontrado no PATH."
  command -v pm2  >/dev/null 2>&1 || die "PM2 não encontrado. Instale com: npm i -g pm2"

  # O projeto exige Node >= 20.9 (`engines` do package.json). O `--env-file`
  # usado pelo ecosystem.config.js exige >= 20.6. Checamos porque o erro que o
  # Node dá numa flag desconhecida não explica a causa.
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "${major}" -lt 20 ]; then
    die "Node ${major} é antigo demais. O projeto exige >= 20.9 (recomendado: 22 LTS)."
  fi

  [ -f "${ENV_FILE}" ] || die \
    ".env.production não encontrado em ${ENV_FILE}
       Crie-o a partir do template:
         cp .env.production.example .env.production
         nano .env.production && chmod 600 .env.production"

  # Permissão do arquivo de segredos. Não abortamos por isso (não vale derrubar
  # um deploy urgente), mas avisamos alto — 644 significa que qualquer usuário
  # do VPS lê a senha do banco e o token do painel.
  if command -v stat >/dev/null 2>&1; then
    local perm
    perm="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || echo '')"
    if [ -n "${perm}" ] && [ "${perm}" != "600" ] && [ "${perm}" != "400" ]; then
      warn ".env.production está com permissão ${perm}. Corrija: chmod 600 ${ENV_FILE}"
    fi
  fi

  # O PM2 escreve os logs em ./logs (ver ecosystem.config.js). Se a pasta não
  # existir, o processo falha no boot com EACCES/ENOENT — e o motivo real fica
  # escondido atrás de um "errored" genérico no `pm2 list`.
  mkdir -p "${LOG_DIR}"
}
step "verificações prévias" preflight

# =============================================================================
# ETAPA 1 — ATUALIZAR O CÓDIGO
# =============================================================================
pull_code() {
  if [ "${SKIP_PULL}" -eq 1 ]; then
    warn "--skip-pull: mantendo o código atual da árvore de trabalho."
    return 0
  fi

  command -v git >/dev/null 2>&1 || die "git não encontrado no PATH."
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "${ROOT_DIR} não é um repositório git. Use --skip-pull se o deploy for por rsync."

  # ABORTAR SE HOUVER ALTERAÇÃO LOCAL NÃO COMMITADA.
  # É a proteção contra o cenário mais comum de perda de trabalho: alguém
  # editou um arquivo direto no servidor para apagar um incêndio e o `git pull`
  # sobrescreveria (ou geraria conflito no meio do deploy). Melhor parar e
  # deixar a pessoa decidir.
  if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    die "há alterações locais não commitadas (listadas acima).
       Resolva antes de continuar:
         git stash        # guardar para depois
         git checkout --  # descartar
       Ou rode com --skip-pull se elas forem intencionais."
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  info "    branch: ${branch}"

  git fetch --prune origin
  # `--ff-only`: recusa merge automático. Se o histórico divergiu, quem decide
  # é uma pessoa — um merge commit criado por script de deploy é o começo de
  # uma tarde ruim.
  git merge --ff-only "origin/${branch}"
}
step "atualizando o código (git pull)" pull_code

# =============================================================================
# ETAPA 2 — DEPENDÊNCIAS
# =============================================================================
install_deps() {
  # `npm ci` e não `npm install`:
  #   - instala EXATAMENTE o que está no package-lock.json (build reproduzível);
  #   - falha se o lock estiver dessincronizado, em vez de "consertar" sozinho
  #     e produzir em produção uma árvore diferente da testada;
  #   - apaga o node_modules antes, eliminando resto de versão antiga.
  #
  # SEM `--omit=dev`, de propósito: o build do Next precisa do TypeScript, o
  # Prisma CLI é devDependency e o curator EXECUTA via `tsx` — que, para ele,
  # não é ferramenta de desenvolvimento, é o interpretador em produção.
  npm ci
}
step "instalando dependências (npm ci)" install_deps

# =============================================================================
# ETAPA 3 — PRISMA CLIENT
# =============================================================================
generate_client() {
  # Precisa vir ANTES do build: o `next build` faz type-check e importa
  # `@canalnerd/db`, que importa o client gerado. Sem isto, o build falha com
  # "@prisma/client did not initialize yet" — mensagem que manda o
  # desenvolvedor procurar no lugar errado.
  npm run db:generate
}
step "gerando o Prisma Client" generate_client

# =============================================================================
# ETAPA 4 — BANCO DE DADOS
# =============================================================================
#
# O PROJETO USA MIGRATIONS VERSIONADAS. Decisão do dono do site, e é a correta.
#
# A migration inicial (`20260806120000_init`) foi gerada a partir do schema e
# cobre as 28 tabelas, 68 índices e 28 chaves estrangeiras. Um banco VAZIO
# recebe o schema completo com `prisma migrate deploy` — inclusive no primeiro
# deploy. `db push` não faz mais parte do fluxo de produção.
#
# POR QUE `migrate deploy` E NUNCA `db push` AQUI:
# `db push` compara schema e banco e aplica a diferença "como der". Ele resolve
# certas mudanças DESTRUINDO dados — renomear uma coluna vira "apaga a antiga,
# cria a nova, vazia" — não guarda histórico e não tem como ser revertido. Em
# desenvolvimento isso é conveniente; em produção é perda de dados silenciosa.
#
# `migrate deploy`, além de aplicar só o que foi revisado e commitado, também
# NÃO reseta o banco em hipótese alguma e é seguro rodar repetidamente: se não
# há migration pendente, ele não faz nada.
#
# O `--db=push` continua existindo como escape de emergência, mas o script
# grita antes de usá-lo. Se ele parecer necessário, o problema quase sempre é
# outro: alguém alterou o schema sem gerar a migration correspondente.
run_migrations() {
  local migrations_dir="${ROOT_DIR}/packages/db/prisma/migrations"
  local schema="${ROOT_DIR}/packages/db/prisma/schema.prisma"

  if [ "${DB_STRATEGY}" = "none" ]; then
    warn "--db=none: nenhuma alteração de schema será aplicada."
    return 0
  fi

  if [ "${DB_STRATEGY}" = "push" ]; then
    warn "======================================================================"
    warn "--db=push: aplicando o schema SEM passar pelas migrations versionadas."
    warn "Isto pode causar PERDA DE DADOS em alterações destrutivas e deixa o"
    warn "banco DESSINCRONIZADO do histórico de migrations — os deploys"
    warn "seguintes podem falhar por drift."
    warn ""
    warn "O fluxo normal do projeto é 'migrate deploy'. Se você chegou aqui, o"
    warn "provável é que alguém mudou o schema sem gerar a migration:"
    warn "  npx prisma migrate dev --name <descricao>   (no ambiente de DEV)"
    warn "======================================================================"
    # `--accept-data-loss` é exigido pelo Prisma em modo não interativo. Está
    # aqui só porque a pessoa digitou `--db=push` explicitamente; nunca é padrão.
    node_modules/.bin/prisma db push --schema="${schema}" --accept-data-loss --skip-generate
    return 0
  fi

  # Rede de proteção: a partir da decisão de usar migrations versionadas, esta
  # pasta SEMPRE deve existir no repositório. Se sumiu, algo está errado no
  # checkout — e aplicar o schema "de outro jeito" seria justamente o erro que
  # as migrations existem para impedir.
  if [ ! -d "${migrations_dir}" ] || [ -z "$(ls -A "${migrations_dir}" 2>/dev/null)" ]; then
    die "a pasta packages/db/prisma/migrations/ está vazia ou não existe.

       Ela É VERSIONADA e deve vir junto com o código (a migration inicial é
       '20260806120000_init'). Se ela sumiu, o checkout está incompleto —
       NÃO contorne com 'db push'. Verifique:

         git status packages/db/prisma/migrations
         git checkout -- packages/db/prisma/migrations

       Confirme se a pasta não foi ignorada por engano no .gitignore:
         git check-ignore -v packages/db/prisma/migrations"
  fi

  # `migrate deploy` (e nunca `migrate dev` em produção): aplica só o que está
  # pendente, não gera migration nova e jamais pede confirmação interativa nem
  # oferece resetar o banco.
  node_modules/.bin/prisma migrate deploy --schema="${schema}"
}
step "aplicando alterações de schema (estratégia: ${DB_STRATEGY})" run_migrations

# =============================================================================
# ETAPA 5 — BUILD
# =============================================================================
build_app() {
  # -------------------------------------------------------------------------
  # POR QUE O .env.production É CARREGADO AQUI
  # -------------------------------------------------------------------------
  # As variáveis `NEXT_PUBLIC_*` são congeladas dentro do bundle JavaScript
  # durante o `next build`. Se o build rodar sem elas, o site sai com os
  # fallbacks do código (`?? 'http://localhost:3000'`) — e aí o canonical, o
  # sitemap e os redirects de OAuth apontam todos para localhost, EM
  # PRODUÇÃO, sem nenhum erro aparecer no log.
  #
  # `set -a` faz toda variável definida a seguir ser exportada automaticamente.
  # Roda dentro de um subshell (esta função é chamada normalmente, mas as
  # variáveis só precisam existir para os comandos abaixo).
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a

  # Sanidade: um erro de digitação aqui custa uma reindexação inteira.
  case "${NEXT_PUBLIC_SITE_URL:-}" in
    https://*) : ;;
    '') die "NEXT_PUBLIC_SITE_URL está vazia no .env.production." ;;
    *)  die "NEXT_PUBLIC_SITE_URL deve começar com https:// em produção (valor atual: ${NEXT_PUBLIC_SITE_URL})." ;;
  esac
  case "${NEXT_PUBLIC_SITE_URL}" in
    */) die "NEXT_PUBLIC_SITE_URL não pode terminar com barra (valor atual: ${NEXT_PUBLIC_SITE_URL})." ;;
  esac

  info "    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}"

  export NODE_ENV=production
  # NÃO ligamos NEXT_OUTPUT_STANDALONE: standalone só serve ao caminho Docker.
  # Aqui o PM2 roda `next start`, que usa o build normal.
  npm run build --workspace=@canalnerd/web
}
step "compilando o site (next build)" build_app

# =============================================================================
# ETAPA 6 — REINICIAR OS PROCESSOS
# =============================================================================
restart_processes() {
  # `reload` e não `restart`: no modo fork o PM2 ainda derruba e sobe o
  # processo, mas respeita o `kill_timeout` (10s) configurado no
  # ecosystem.config.js, dando tempo de o Next terminar as requisições em voo e
  # de o curator fechar o ciclo corrente — o que evita deixar registros de
  # `PipelineRun` eternamente com status 'running'.
  #
  # `--update-env` é essencial: sem ele o PM2 REAPROVEITA o ambiente da
  # primeira vez que o processo subiu. Uma chave de API nova no
  # .env.production não teria efeito, e o sintoma seria "mudei a variável e
  # não aconteceu nada".
  if pm2 describe ortuspixel-web >/dev/null 2>&1; then
    pm2 reload ecosystem.config.js --update-env
  else
    info "    primeira execução: registrando os processos no PM2"
    pm2 start ecosystem.config.js
  fi

  # Persiste a lista para que ela volte sozinha depois de um reboot do VPS.
  # Sem `pm2 save`, um reboot deixa o site fora do ar até alguém entrar por SSH.
  pm2 save
}
step "reiniciando os processos (PM2)" restart_processes

# =============================================================================
# ETAPA 7 — VERIFICAÇÃO PÓS-DEPLOY
# =============================================================================
#
# Sem esta etapa, o script terminaria com "sucesso" mesmo se o processo
# subisse e morresse em seguida — que é exatamente o caso de erro de
# configuração (variável faltando, banco inacessível).
verify() {
  # Dá tempo de o Next abrir a porta antes de bater nela.
  sleep 5

  local port="${PORT:-3000}"
  local url="http://127.0.0.1:${port}/"
  local attempt=1
  local max_attempts=6

  while [ "${attempt}" -le "${max_attempts}" ]; do
    if node -e "fetch('${url}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      ok "o site respondeu em ${url}"
      return 0
    fi
    warn "tentativa ${attempt}/${max_attempts}: sem resposta em ${url}, aguardando..."
    attempt=$((attempt + 1))
    sleep 5
  done

  die "o site NÃO respondeu em ${url} após ${max_attempts} tentativas.
       Os processos podem ter subido e morrido. Investigue:
         pm2 list
         pm2 logs ortuspixel-web --lines 80"
}
step "verificando se o site respondeu" verify

# =============================================================================
# FIM
# =============================================================================
printf '\n%s\n' "${GREEN}${BOLD}Deploy concluído com sucesso.${RESET}"
printf '%s\n' "Processos:"
pm2 list
printf '\n%s\n' "Logs em tempo real:  ${BOLD}pm2 logs${RESET}"
printf '%s\n'   "Site:                ${BOLD}https://ortuspixel.com${RESET}"
