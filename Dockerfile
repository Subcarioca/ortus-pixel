# =============================================================================
# Ortus Pixel — imagem de produção (caminho B: containers)
# =============================================================================
#
# ESTE ARQUIVO PRODUZ DUAS IMAGENS A PARTIR DE UM ÚNICO BUILD:
#
#   docker build --target web     -t ortuspixel-web .
#   docker build --target curator -t ortuspixel-curator .
#
# Um Dockerfile com dois alvos, e não dois arquivos, porque os dois processos
# compartilham exatamente o mesmo `npm ci` e o mesmo `prisma generate`. Com
# arquivos separados, essas duas etapas (as mais lentas do build) rodariam duas
# vezes e poderiam divergir de versão entre si — o tipo de bug que só aparece em
# produção, quando o curator grava uma coluna que o site ainda não conhece.
#
# O CONTEXTO DE BUILD É A RAIZ DO MONOREPO, não `apps/web`. É obrigatório: o
# `apps/web` importa `@canalnerd/*` de `packages/`, que ficariam fora de um
# contexto restrito ao app. Por isso o arquivo mora na raiz.
#
# -----------------------------------------------------------------------------
# ATENÇÃO — DOCKER É O CAMINHO B, NÃO O ÚNICO CAMINHO
# -----------------------------------------------------------------------------
# Localmente o projeto roda sem Docker (Postgres nativo), e o caminho A no VPS
# (PM2 + `next start`) é igualmente suportado — ver `ecosystem.config.js` e a
# seção "Deploy em produção (VPS)" do README. Este arquivo existe porque um VPS
# costuma ter virtualização e há quem prefira imagem imutável; não porque o
# projeto passou a exigir Docker.

# Node 22 LTS: o `package.json` exige >= 20.9, e o 22 é a linha LTS ativa com
# suporte de segurança mais longo. Alpine pela superfície de ataque menor.
# A tag é fixada em MAJOR.MINOR para que um rebuild não troque de runtime sem
# ninguém perceber.
ARG NODE_VERSION=22.20-alpine


# =============================================================================
# ESTÁGIO 1 — base comum
# =============================================================================
FROM node:${NODE_VERSION} AS base

# `openssl` é requisito real do Prisma (o engine é linkado contra ele) e não
# vem na imagem alpine enxuta. Sem ele o erro em runtime é obscuro
# ("Unable to require libquery_engine"), longe da causa.
# `libc6-compat` cobre binários que esperam glibc (caso do engine do Prisma).
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Silencia o telemétrico do Next em build e runtime. Não é só privacidade:
# em rede restrita, a chamada de telemetria adiciona latência ao boot.
ENV NEXT_TELEMETRY_DISABLED=1


# =============================================================================
# ESTÁGIO 2 — dependências
# =============================================================================
#
# Copiamos SÓ os manifestos antes de `npm ci`. É o truque de cache mais
# importante do arquivo: enquanto nenhum `package.json` mudar, o Docker
# reaproveita esta camada inteira e o build pula a instalação. Copiar o código
# junto invalidaria o cache a cada linha alterada.
FROM base AS deps

COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/db/package.json        packages/db/
COPY packages/scoring/package.json   packages/scoring/
COPY services/curator/package.json   services/curator/
COPY apps/web/package.json           apps/web/

# `npm ci` (e não `npm install`): instala exatamente o que está no lockfile e
# falha se o lockfile estiver dessincronizado, em vez de "consertar" sozinho.
# Build reproduzível é o ponto inteiro de usar container.
#
# INSTALAMOS AS devDependencies DE PROPÓSITO (sem `--omit=dev`):
#   - o build do Next precisa de `typescript` e dos `@types/*`;
#   - o Prisma CLI (`prisma`) é devDependency e é quem gera o client;
#   - o curator EXECUTA via `tsx`, que também é devDependency — ou seja, no
#     runtime do curator o tsx não é opcional, é o interpretador.
# A imagem final do site não carrega nada disso: o estágio `web` copia só a
# saída `standalone`, cujo rastreamento inclui apenas o que é usado em runtime.
#
# `PRISMA_SKIP_POSTINSTALL_GENERATE`: neste estágio só existem os manifestos —
# o `schema.prisma` ainda não foi copiado. O postinstall do @prisma/client
# tentaria gerar o client, não acharia o schema e emitiria um aviso confuso no
# meio do log do build. A geração acontece no estágio seguinte, no momento
# certo e com o schema presente.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN npm ci


# =============================================================================
# ESTÁGIO 3 — build
# =============================================================================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# -----------------------------------------------------------------------------
# VARIÁVEIS `NEXT_PUBLIC_*` PRECISAM EXISTIR **AQUI**, NO BUILD
# -----------------------------------------------------------------------------
# Elas são substituídas literalmente dentro do bundle JavaScript durante o
# `next build`. Passá-las apenas no `docker run`/compose não tem efeito nenhum
# sobre o HTML entregue ao leitor — o valor já foi congelado na imagem.
#
# Consequência prática que precisa estar clara: trocar o Publisher ID do AdSense
# ou a URL do site EXIGE REBUILD DA IMAGEM, não basta reiniciar o container.
# O `docker-compose.prod.yml` repassa estes ARGs a partir do `.env.production`.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SITE_NAME
ARG NEXT_PUBLIC_ADSENSE_CLIENT_ID
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY

ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME}
ENV NEXT_PUBLIC_ADSENSE_CLIENT_ID=${NEXT_PUBLIC_ADSENSE_CLIENT_ID}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

# Gera o Prisma Client. Roda ANTES do build porque o `next build` faz
# type-check e importa `@canalnerd/db`, que importa o client gerado.
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# Liga a saída `standalone` (ver o comentário no topo de `apps/web/next.config.ts`).
# Ela emite `.next/standalone` com um `server.js` autocontido e só os arquivos
# de node_modules que o rastreamento provou serem necessários — é o que permite
# a imagem final não ter `npm` nem `node_modules` completo.
ENV NEXT_OUTPUT_STANDALONE=1

# `NODE_ENV=production` já no build: desliga checagens de desenvolvimento do
# React e habilita a minificação agressiva.
ENV NODE_ENV=production

RUN npm run build --workspace=@canalnerd/web

# -----------------------------------------------------------------------------
# PRISMA + STANDALONE: cópia explícita do engine
# -----------------------------------------------------------------------------
# O rastreamento de arquivos do Next resolve `@prisma/client`, mas o binário do
# query engine vive em `node_modules/.prisma/client` — uma pasta GERADA depois
# do install, que o rastreamento estático nem sempre enxerga. Quando escapa, o
# container sobe normalmente e só quebra na primeira consulta ao banco.
# Copiar por cima é barato e elimina a classe de falha inteira.
#
# SEM `|| true` de propósito: se `.prisma` não existir, o `prisma generate`
# acima falhou de forma silenciosa e a imagem sairia quebrada. Melhor o build
# parar aqui, com a causa à vista, do que o container subir e só morrer na
# primeira consulta ao banco — em produção, sob tráfego.
RUN cp -r node_modules/.prisma .next-prisma-engine


# =============================================================================
# ESTÁGIO 4a — RUNTIME DO SITE (alvo `web`)
# =============================================================================
FROM base AS web

ENV NODE_ENV=production

# Usuário sem privilégios. Se um dia houver execução remota de código no
# processo Node, o atacante cai como `nextjs`, não como root — a diferença
# entre "comprometeu o app" e "comprometeu o host".
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

WORKDIR /app

# A saída standalone em monorepo PRESERVA A ESTRUTURA DE PASTAS a partir do
# `outputFileTracingRoot` (a raiz do monorepo). Por isso o servidor final fica
# em `apps/web/server.js`, e não em `server.js` na raiz — é o erro mais comum
# ao adaptar um Dockerfile de projeto single-app para monorepo.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./

# `static` e `public` NÃO entram no standalone: o Next assume que um CDN os
# serviria. Sem estas duas linhas o site sobe sem CSS e sem imagens.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public       ./apps/web/public

# Engine do Prisma (ver comentário no estágio de build).
COPY --from=builder --chown=nextjs:nodejs /app/.next-prisma-engine ./node_modules/.prisma

USER nextjs

EXPOSE 3000
ENV PORT=3000
# `0.0.0.0` DENTRO do container é correto e não é uma brecha: quem publica a
# porta para fora é o compose, e lá ela é amarrada em `127.0.0.1` (ver
# docker-compose.prod.yml). Fixar `127.0.0.1` aqui tornaria o container
# inalcançável até pelo Nginx.
ENV HOSTNAME=0.0.0.0

# Healthcheck com o `fetch` global do Node 22 — sem instalar curl só para isso.
# `start-period` generoso porque o primeiro boot do Next inclui a conexão com o
# banco; sem ele o container seria marcado unhealthy antes de terminar de subir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]


# =============================================================================
# ESTÁGIO 4b — RUNTIME DO CURATOR (alvo `curator`)
# =============================================================================
#
# O curator NÃO tem saída standalone: ele é executado como TypeScript-fonte via
# `tsx` (ver `services/curator/package.json`). Então esta imagem precisa mesmo
# do `node_modules` completo. Poderíamos pré-compilar com `tsc` para enxugá-la,
# mas isso criaria um segundo pipeline de build só para este serviço e faria o
# runtime de produção divergir do que roda em desenvolvimento — troca ruim para
# economizar disco em um único container de serviço interno.
FROM base AS curator

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 curator

WORKDIR /app

# `node_modules` vem do BUILDER (e não do `deps`) de propósito: é a única cópia
# que já contém o Prisma Client gerado.
COPY --from=builder --chown=curator:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=curator:nodejs /app/packages     ./packages
COPY --from=builder --chown=curator:nodejs /app/services     ./services
COPY --from=builder --chown=curator:nodejs /app/package.json ./package.json
COPY --from=builder --chown=curator:nodejs /app/tsconfig.base.json ./tsconfig.base.json

USER curator

# Healthcheck de PROCESSO, não de porta: o curator não escuta HTTP, ele é um
# laço com `setTimeout` encadeado. Verificamos que o PID 1 continua vivo.
# É um teste fraco de propósito — um healthcheck que consultasse o banco
# reiniciaria o serviço durante uma manutenção do Postgres, justamente quando
# o comportamento correto é esperar. A saúde real do pipeline é observada pelo
# `PipelineEvent`/`ConnectorHealth` no painel, que enxergam muito mais.
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.kill(1,0)" || exit 1

# Sem `--once`: modo contínuo, com agendador próprio (descoberta 15 min /
# recálculo 5 min) e encerramento gracioso em SIGTERM — confirmado em
# `services/curator/src/main.ts`.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "services/curator/src/main.ts"]
