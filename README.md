# Ortus Pixel

Portal de notícias do universo nerd (games, cinema/séries, anime/mangá, HQs, tech, eventos)
com um **pipeline de curadoria automática** que monitora fontes externas, calcula um
**score de popularidade de 0 a 100** para cada assunto e aciona a redação quando algo
começa a explodir.

> **Estado atual:** esqueleto funcional completo. O motor de score, o pipeline de
> conectores, o modelo de dados e as páginas principais estão implementados e testados.
> Os conectores externos operam em modo simulado até que as credenciais sejam
> configuradas — de propósito (ver [Conectores](#conectores-de-sinal)).

---

## Índice

1. [A ideia em uma página](#a-ideia-em-uma-página)
2. [Como rodar localmente](#como-rodar-localmente)
3. [Deploy em produção (VPS)](#deploy-em-produção-vps)
4. [Arquitetura](#arquitetura)
5. [O algoritmo de score](#o-algoritmo-de-score)
6. [O pipeline de curadoria](#o-pipeline-de-curadoria)
7. [Conectores de sinal](#conectores-de-sinal)
8. [Modelo de dados](#modelo-de-dados)
9. [Front-end e SEO](#front-end-e-seo)
10. [Funil de audiência](#funil-de-audiência)
11. [KPIs e instrumentação](#kpis-e-instrumentação)
12. [Segurança](#segurança)
13. [Decisões de arquitetura (ADRs)](#decisões-de-arquitetura-adrs)
14. [Plano de implementação em fases](#plano-de-implementação-em-fases)
15. [Pendências e decisões em aberto](#pendências-e-decisões-em-aberto)

---

## A ideia em uma página

Portais de nicho competem por **minutos**. Quando a Rockstar anuncia um atraso de GTA VI,
quem publica primeiro leva a maior parte do tráfego orgânico e social; quem publica em
quarto lugar leva uma fração.

A Ortus Pixel ataca isso com um serviço que roda continuamente e responde três perguntas:

| Pergunta | Resposta do sistema |
|---|---|
| O que está acontecendo agora? | Descoberta via feeds RSS de estúdios, publishers e imprensa |
| Isso vai bombar? | Score de 0 a 100 combinando 9 sinais, com peso maior para **aceleração** |
| O que a redação faz com isso? | Faixas de ação: alerta imediato, meta de publicação, push, posição na home |

**A decisão de produto mais importante:** o sinal de maior peso é a *velocidade* de
crescimento do interesse, não o volume absoluto. Volume alto todo mundo enxerga — a
vantagem competitiva está em detectar aceleração antes dos outros.

**A segunda decisão mais importante:** o algoritmo **nunca decide sozinho**. Ele prioriza;
quem publica é gente. Override humano sempre vence, e temas sensíveis (vazamento,
polêmica, morte de personagem) bloqueiam qualquer automação.

---

## Como rodar localmente

### Pré-requisitos

- **Node.js 20.9+** (o projeto foi desenvolvido e testado no Node 24)
- **PostgreSQL 16+** — via Docker ou instalação local
- Redis é **opcional** no MVP (ver [Dependências opcionais](#dependências-opcionais))

### Passo a passo

```bash
# 1. Instalar dependências (npm workspaces resolve o monorepo inteiro)
npm install

# 2. Subir Postgres e Redis
docker compose up -d

# 3. Configurar ambiente
cp .env.example .env
# O .env.example já vem com valores que funcionam com o docker-compose.
# Nenhuma chave de API é necessária para rodar.

# 4. Criar o schema no banco e gerar o client
npm run db:generate
npm run db:push

# 5. Popular com dados realistas (categorias, franquias, artigos, scores)
npm run db:seed

# 6. Subir o site
npm run dev
```

Abra <http://localhost:3000>.

### Rodar o pipeline de curadoria

```bash
# Um ciclo e encerra — ideal para ver o que acontece
npm run curator:once

# Modo contínuo (descoberta a cada 15 min, recálculo a cada 5 min)
npm run dev:curator
```

Sem credenciais de API, os conectores externos entram em **modo simulado**: geram sinais
sintéticos determinísticos e com confiança baixa. O pipeline roda de ponta a ponta, o
painel editorial se popula e nada quebra.

### Painel editorial

<http://localhost:3000/admin> — entra-se com **conta individual** (e-mail e senha).

Na primeira vez, crie a conta de administrador pelo terminal:

```bash
npm run staff:create -- --email=voce@dominio.com --nome="Seu Nome"
npm run staff:create -- --listar        # quem tem acesso hoje
```

O comando pede a senha sem ecoar na tela. Depois disso, as demais contas são criadas
pela própria tela **Contas** do painel. Não existe rota pública de setup, de propósito —
o racional está no cabeçalho de `packages/db/scripts/staff-account.ts`.

Dois níveis de acesso, definidos em `packages/core/src/staff.ts`:

| | Admin | Redator |
|---|---|---|
| Criar/editar matéria | tudo | só as que assina |
| Fila de pautas | ver, assumir, sobrepor score, descartar | ver e assumir |
| Comentários, afiliados, relatórios, contas | sim | não |

### Sugestão de matéria por IA (opcional)

Cada pauta da fila tem, ao lado de **Criar matéria**, o botão **Gerar sugestão com IA**.
Ele chama a API da Anthropic com o que o tópico já sabe (título, resumo, fonte, nível de
autoridade da fonte, editoria e franquias) e devolve um rascunho — manchete, resumo, corpo
em blocos, TL;DR e a lista do que ainda falta apurar. O rascunho abre **no mesmo formulário
de sempre**, com tudo editável; publicar continua sendo um clique humano.

```bash
ANTHROPIC_API_KEY="sk-ant-..."   # sem ela, o botão não aparece e nada quebra
ANTHROPIC_MODEL=""               # vazio = claude-sonnet-5
```

Três limites que são de projeto, não de implementação:

- **Não gera nem busca imagem.** A capa continua sendo escolha humana (upload ou URL).
- **Não apura nada.** A página da fonte NUNCA é baixada — seria SSRF com URL de terceiro,
  e reescrever a matéria alheia inteira não é apuração. O prompt exige atribuição
  (“segundo o *veículo*”), proíbe inventar dado específico e proíbe fala entre aspas.
- **Nunca publica.** Nasce rascunho, com aviso no topo do formulário, e a matéria fica
  marcada com `contentOrigin = 'ai-assisted'` (`packages/core/src/content-origin.ts`) para
  auditoria. A geração em si vira uma linha `topic.ai_suggestion` no `AuditLog`.

Custo da ordem de US$ 0,02 por rascunho, com teto de tokens por chamada e limite de 8
gerações por conta a cada 10 minutos. Detalhes e racional em `apps/web/src/server/ai-draft.ts`.

### Testes e verificação

```bash
npm run typecheck      # verificação de tipos em todos os workspaces
npm test               # testes do motor de score, da deduplicação e da apresentação
npm run check:classes  # markup servido × folha do design (precisa do dev server no ar)
npm run db:studio      # inspeção visual do banco (Prisma Studio)
```

Sobre o `check:classes`: o produto **não escreve CSS próprio** — ele carrega a folha do
design system. Isso mantém protótipo e produto alinhados e cria exatamente um risco:
escrever uma classe que não existe é um **erro silencioso**. Não há falha de build nem
aviso no console; o elemento só renderiza sem o estilo que deveria ter. Este script busca
as páginas no servidor de desenvolvimento e falha se alguma classe do HTML não existir no
CSS — inclusive as montadas em tempo de execução, que são justamente as que erram. Sem
servidor no ar, `npm run check:classes -- --skip-runtime` roda só as checagens estáticas.

### Dependências opcionais

| Serviço | Necessário? | O que acontece sem ele |
|---|---|---|
| PostgreSQL | **Sim** | Nada funciona |
| Redis | Não (MVP) | O agendador roda em processo; rate limit e orçamento de API ficam em memória. Necessário ao escalar para múltiplas réplicas |
| Chaves de API | Não | Conectores em modo simulado, com confiança reduzida |
| Provedor de e-mail | Não | E-mails são impressos no terminal (`EMAIL_PROVIDER=console`) |
| Chaves VAPID | Não | O opt-in de push não é oferecido |

Essa tolerância a ausência de configuração é intencional: as APIs de sinal são caras,
restritas (o Reddit leva de 2 a 4 semanas para aprovar acesso comercial) ou ainda em
alpha (Google Trends). Amarrar o desenvolvimento à disponibilidade delas travaria o time.

---

## Deploy em produção (VPS)

Alvo: **VPS Ubuntu/Debian da Hostinger**, domínio **ortuspixel.com**.

### Arquitetura de produção (decidida)

Quatro escolhas foram fechadas pelo dono do site. O resto desta seção assume todas elas.

| Decisão | Escolha | Consequência prática |
|---|---|---|
| **Execução do app** | **PM2** no VPS | Docker é a opção B, documentada para quando houver escala |
| **Banco de dados** | **Postgres gerenciado** (Hostinger ou outro provedor) | O VPS **não** roda Postgres — nem nativo, nem em container. `sslmode=require` é obrigatório |
| **Schema** | **Migrations versionadas** | `prisma migrate deploy` a partir de `20260806120000_init`. `db push` saiu do fluxo de produção |
| **Domínio canônico** | **`ortuspixel.com`** (apex, sem `www`) | `www` existe no DNS e redireciona 301 por HTTPS |

O VPS, portanto, tem uma responsabilidade só: **rodar a aplicação e o Nginx**. Estado
persistente vive fora dele. Isso melhora três coisas de uma vez — backup e *point-in-time
recovery* passam a ser problema do provedor, recriar o VPS deixa de ter risco de perda de
dados, e o recurso mais escasso da máquina (RAM) fica inteiro para o Node.

> **Sobre os nomes internos.** Os pacotes ainda se chamam `@subcarioca/*` — o rebrand do
> código-fonte é uma tarefa separada. Os artefatos de deploy (domínio, nomes de processo,
> nomes de container, URLs de callback) **já usam a marca final**, porque trocá-los depois
> significaria reemitir certificado, reeditar o Nginx, refazer o `pm2 save` e recadastrar
> os redirect URIs de OAuth. Trocar o nome do pacote npm não afeta nenhum desses arquivos.

### 1. DNS

No painel de DNS do registrador do `ortuspixel.com`, aponte **dois** registros para o IP
do VPS:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| `A` | `@` (ou `ortuspixel.com`) | IP IPv4 do VPS | 3600 |
| `A` | `www` | IP IPv4 do VPS | 3600 |

O `www` precisa existir mesmo sendo redirecionado: sem registro, quem digitar
`www.ortuspixel.com` recebe erro de DNS — e o certificado não pode ser emitido para um
nome que não resolve. Se o VPS tiver IPv6, acrescente os `AAAA` equivalentes.

Antes de seguir, confirme a propagação (pode levar de minutos a algumas horas):

```bash
dig +short ortuspixel.com
dig +short www.ortuspixel.com
```

### 2. Os dois caminhos: PM2 (escolhido) e Docker (opção B)

Ambos **usam o mesmo Nginx** — os dois entregam a aplicação em `127.0.0.1:3000` —, então
migrar de um para o outro no futuro não exige refazer TLS, DNS nem o Nginx.

| | **Caminho A — PM2** (escolhido) | **Caminho B — Docker** |
|---|---|---|
| Arquivos | `ecosystem.config.js`, `scripts/deploy.sh` | `Dockerfile`, `docker-compose.prod.yml` |
| Postgres | gerenciado, fora do VPS | gerenciado **ou** container (`--profile` do serviço) |
| Deploy | `./scripts/deploy.sh` | `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build` |

**O trade-off, em quatro linhas:** o PM2 usa menos RAM (não há camada de virtualização),
faz deploy mais rápido (rebuild incremental do Next em vez de imagem nova) e é mais simples
de depurar — mas o VPS vira um floco de neve, com Node e Nginx instalados à mão, e
"funciona na minha máquina" volta a ser possível. O Docker entrega ambiente reproduzível e
rollback trivial (`docker compose up -d` apontando para a imagem anterior), ao custo de
~300 MB de RAM, builds mais lentos e uma camada a mais para diagnosticar. Para o
lançamento venceu o **caminho A**: o projeto tem um processo de cada tipo, e o principal
argumento do Docker — isolar o estado — perdeu força quando o banco saiu do VPS.

> **Se você usar o caminho B:** o serviço `postgres` do `docker-compose.prod.yml` está
> num perfil desativado (`local-db`) justamente para não subir por acidente. O `up` padrão
> levanta só `web` e `curator`, apontando para o banco gerenciado. Subir o container
> **junto** com o banco gerenciado seria o pior dos mundos: dois bancos no ar e o risco
> real de a aplicação gravar no errado.

### 3. Provisionar o banco gerenciado

O VPS **não** roda Postgres. No painel do provedor:

1. Crie a instância Postgres (16+) e o banco `ortuspixel`.
2. **Restrinja o acesso ao IP do VPS.** Quase todo provedor bloqueia por padrão, mas
   confira: um Postgres aberto para `0.0.0.0/0` é varrido por bots em horas.
3. Copie a string de conexão e acrescente `sslmode=require`:

```
postgresql://USUARIO:SENHA@HOST_DO_PROVEDOR:5432/ortuspixel?schema=public&sslmode=require
```

`sslmode=require` é obrigatório e é a diferença central em relação ao ambiente local:
aqui o tráfego sai do VPS e atravessa a rede do provedor. Sem TLS, a senha e o conteúdo
das consultas viajam em texto claro. Se o provedor oferecer a CA, prefira
`sslmode=verify-full` — `require` cifra, mas não prova com quem você está falando, o que
ainda deixa espaço para um intermediário.

### 4. Preparar o VPS

```bash
# Node 22 LTS (o projeto exige >= 20.9)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

sudo npm install -g pm2

# Firewall: só SSH e HTTP(S) entram. A porta 3000 NUNCA é aberta — o Next
# escuta em 127.0.0.1 e quem fala com a internet é o Nginx.
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Não há Postgres para instalar, e a porta 5432 não é aberta em nenhuma direção: quem
inicia a conexão é o VPS.

> **Se um dia adotar Docker aqui:** ele escreve regras de `iptables` que **passam por
> cima** do ufw. É por isso que o `docker-compose.prod.yml` não publica porta de banco e
> amarra a do site em `127.0.0.1`.

### 5. Configuração e primeiro deploy

```bash
git clone <url-do-repo> /var/www/ortuspixel && cd /var/www/ortuspixel

cp .env.production.example .env.production
nano .env.production          # preencha (o arquivo explica cada variável)
chmod 600 .env.production     # obrigatório: contém a senha do banco e o token do painel

chmod +x scripts/deploy.sh
./scripts/deploy.sh           # o primeiro deploy usa o mesmo comando dos demais
```

O script para na primeira etapa que falhar e **não reinicia nada** depois disso — se o
build quebrar, a versão anterior continua no ar.

> **Migrations versionadas.** A migration inicial
> (`packages/db/prisma/migrations/20260806120000_init`) já está no repositório e cobre as
> 28 tabelas, 68 índices e 28 chaves estrangeiras. Num banco vazio,
> `prisma migrate deploy` cria o schema inteiro — inclusive no primeiro deploy. **`db push`
> saiu do fluxo de produção**: ele resolve certas mudanças destruindo dados (renomear
> coluna vira "apaga a antiga, cria a nova, vazia"), não guarda histórico e não é
> reversível. O `deploy.sh` ainda aceita `--db=push` como escape de emergência, mas grita
> antes; se ele parecer necessário, o problema real costuma ser outro — alguém alterou o
> `schema.prisma` sem gerar a migration correspondente.

**Ao alterar o schema daqui em diante**, gere a migration em desenvolvimento e commite-a
junto com a mudança:

```bash
npx prisma migrate dev --name descricao-curta --schema=packages/db/prisma/schema.prisma
git add packages/db/prisma/migrations
```

O deploy aplica sozinho o que estiver pendente. `migrate deploy` é seguro de rodar
repetidamente: sem migration pendente, ele não faz nada.

### 6. HTTPS (Certbot)

A ordem importa: o `nginx/ortuspixel.conf` referencia arquivos de certificado que ainda não
existem, então instalá-lo antes de emitir o certificado faz o `nginx -t` falhar.

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot

# 1) Emite o certificado para os DOIS nomes (com o Nginx ainda no default).
#    `certonly` = só emite, não reescreve config — assim nosso arquivo continua
#    sendo a fonte da verdade e não é editado por robô.
sudo certbot certonly --nginx \
  -d ortuspixel.com -d www.ortuspixel.com \
  --agree-tos -m contato@ortuspixel.com --no-eff-email

# 2) Só agora instala a configuração do site.
sudo cp nginx/ortuspixel.conf /etc/nginx/sites-available/ortuspixel.conf
sudo ln -s /etc/nginx/sites-available/ortuspixel.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 3) Confirme que a renovação automática funciona (não renova de verdade).
sudo certbot renew --dry-run
```

O certificado cobre os dois nomes porque o `www` é redirecionado **por HTTPS**: um
certificado só para o apex mostraria aviso de segurança em `www` antes mesmo do redirect.

> **`contato@ortuspixel.com` é placeholder.** Troque pelo endereço real antes de rodar —
> é para ele que o Let's Encrypt escreve quando a renovação falha, com 20 dias de
> antecedência. Um e-mail que ninguém lê transforma um aviso em queda do site por
> certificado vencido, num sábado, sem ninguém ter mudado nada.

### 7. Redirect URIs do login social

Os dois provedores exigem que a URI de retorno seja cadastrada **exatamente**, caractere
por caractere — sem barra no final, com `https`, no domínio canônico (apex, sem `www`).
Divergir de `NEXT_PUBLIC_SITE_URL` produz `redirect_uri mismatch`.

| Provedor | Onde | O que cadastrar |
|---|---|---|
| **Discord** | [Developer Portal](https://discord.com/developers/applications) → sua aplicação → **OAuth2** → *Redirects* | `https://ortuspixel.com/api/auth/discord/callback` |
| **Google** | [Cloud Console](https://console.cloud.google.com/apis/credentials) → *Criar credenciais* → **ID do cliente OAuth** → Aplicativo da Web | *Origens JavaScript autorizadas:* `https://ortuspixel.com`<br>*URIs de redirecionamento autorizados:* `https://ortuspixel.com/api/auth/google/callback` |

Escopos: Discord `identify`, Google `openid profile`. **Não peça e-mail** — o projeto não
o armazena, e pedir um escopo que não se usa reduz a taxa de aceite na tela de consentimento.

No Google, enquanto o app estiver em modo *Testing*, só contas listadas conseguem entrar;
publicar exige preencher a tela de consentimento. Como não pedimos escopos sensíveis, a
verificação é simples, mas **não é instantânea** — comece antes do lançamento.

### 8. Operação do dia a dia

```bash
pm2 list                          # estado dos processos
pm2 logs ortuspixel-web --lines 100
pm2 logs ortuspixel-curator
pm2 monit                         # CPU e memória em tempo real
sudo pm2 startup                  # registra no systemd (executar UMA vez)
```

Rodar `pm2 startup` uma vez é o que faz o site voltar sozinho depois de um reboot do VPS.
Sem ele, um reinício deixa tudo fora do ar até alguém entrar por SSH.

### 9. Checklist de pré-lançamento

Nada aqui é opcional. Os quatro primeiros itens são **bloqueadores de lançamento**.

- [x] **`robots.ts` travado no domínio antigo — BLOQUEADOR, CORRIGIDO no rebrand.**
      A rota decidia se permite indexação com
      `NEXT_PUBLIC_SITE_URL?.includes('canalnerd.com.br')`. Com o domínio novo essa
      condição seria **falsa**, e o site entraria no ar servindo `Disallow: /` para todos
      os buscadores — silenciosamente, sem erro em log nenhum. O sintoma seria "o site
      está no ar há três semanas e não indexou nada".
      A condição agora descreve o estado real ("produção + host público HTTPS não-local")
      e não cita domínio nenhum, então trocar de domínio não volta a quebrar isso.
      Ainda assim, **verifique `curl https://ortuspixel.com/robots.txt` antes de
      divulgar o site** — é um teste de 2 segundos contra um erro de 3 semanas.
- [ ] **Conta de administrador criada NO SERVIDOR, com senha forte.** O painel não tem
      mais segredo compartilhado em variável de ambiente: rode
      `npm run staff:create -- --email=... --nome="..."` depois do deploy. Enquanto não
      existir nenhuma conta, ninguém entra — o que é a falha segura correta, mas também
      significa que este passo não pode ser esquecido.
- [ ] **`REVALIDATE_SECRET` e `NEWSLETTER_TOKEN_SECRET` gerados novos.** Mesmo raciocínio:
      os placeholders são públicos. Com o primeiro, um terceiro força invalidação de cache
      à vontade e derruba o site sob pico.
- [ ] **Backup do banco verificado e testado.** Com banco gerenciado, o provedor já faz
      snapshots — **confirme no painel** a frequência e a janela de retenção, porque o
      padrão costuma ser curto (7 dias) e um erro de dados descoberto na segunda semana
      não teria para onde voltar. Mantenha **também** um `pg_dump` próprio: snapshot do
      provedor não protege contra encerramento de conta nem contra `DELETE` acidental
      descoberto tarde.
      ```bash
      # exemplo, via cron às 3h, a partir do VPS ou de outra máquina
      pg_dump "$DATABASE_URL" | gzip > /backup/ortuspixel-$(date +\%F).sql.gz
      ```
      E o passo que quase todo mundo pula: **faça um restore de teste**. Backup nunca
      restaurado não é backup, é esperança. *(O destino do dump ainda não foi definido —
      ver "Pendências de operação".)*
- [ ] **`ads.txt` com o Publisher ID real.** Preencha `ADSENSE_PUBLISHER_ID`
      (`pub-...`, sem o prefixo `ca-`) e `NEXT_PUBLIC_ADSENSE_CLIENT_ID` (`ca-pub-...`).
      Enquanto estiverem vazios, nenhum anúncio é renderizado e `/ads.txt` responde 404 —
      **ambos de propósito**. Depois do deploy, confirme:
      `curl https://ortuspixel.com/ads.txt`.
- [ ] **CSP escrita, com os domínios de `ortuspixel.com`.** Segue pendente (item 3 de
      *Segurança*). Ela deve entrar no `next.config.ts`, **não no Nginx** — precisa do hash
      do script inline de tema, que só o build conhece. Suba primeiro em
      `Content-Security-Policy-Report-Only` por duas semanas: CSP de anúncio costuma
      quebrar só em um formato de criativo, semanas depois.
- [ ] **`NEXT_PUBLIC_SITE_URL=https://ortuspixel.com`**, sem barra no final e sem `www`.
      O `deploy.sh` valida as três coisas e aborta se estiverem erradas.
- [ ] **Chave do IndexNow publicada.** Além de definir `INDEXNOW_KEY`, hospede
      `{CHAVE}.txt` na raiz do site com a própria chave como conteúdo. Sem esse arquivo,
      os envios são recusados em silêncio.
- [ ] **Domínio de e-mail verificado** no provedor, com SPF, DKIM e DMARC no DNS. Sem
      isso, a confirmação de newsletter cai em spam e a reputação do domínio novo é
      queimada na primeira campanha.
- [ ] **`chmod 600 .env.production`** e dono correto. O padrão do `cp` é 644 — qualquer
      usuário do VPS leria a senha do banco.
- [ ] **Search Console e sitemap.** Cadastre a propriedade `https://ortuspixel.com` e
      envie `https://ortuspixel.com/sitemap.xml`.
- [ ] **Conexão com o banco em TLS.** Confirme que a `DATABASE_URL` termina com
      `sslmode=require` (ou `verify-full`) e que só o IP do VPS está liberado no painel
      do provedor.
- [ ] **Migrations aplicadas.** `npx prisma migrate status` deve responder
      *"Database schema is up to date"* apontando para o banco de produção.
- [ ] **Teste do fluxo completo** em produção: comentar com Discord **e** com Google,
      inscrever-se na newsletter e confirmar pelo e-mail recebido.

### 10. Pendências de operação (não bloqueiam o deploy)

Três pontos ainda dependem de decisão do dono do site. Nenhum impede subir a
infraestrutura, mas todos precisam de resposta **antes de divulgar o site**.

| Pendência | O que está valendo hoje | O que muda quando decidir |
|---|---|---|
| **Endereços de e-mail reais** | `contato@ortuspixel.com` e `noticias@ortuspixel.com` estão como **placeholder** no `.env.production.example` e no comando do Certbot | Ajustar `NEWSLETTER_FROM`, `VAPID_SUBJECT`, o `-m` do Certbot e o `REDDIT_USER_AGENT`. As caixas precisam **existir e ser lidas**: é para elas que vão os avisos de expiração de certificado e os problemas de entrega de push |
| **Restrição de IP no `/admin`** | Só rate limit (2 req/s por IP) no `nginx/ortuspixel.conf` | Se a redação tiver IP fixo, acrescentar `allow`/`deny` no bloco `location /admin`. Não foi presumido: um `deny` errado tranca a própria equipe do lado de fora |
| **Destino do backup** | Não configurado | Definir onde o `pg_dump` é guardado (bucket S3/R2, outro provedor) e criar o cron. A regra que importa: **não pode ser o mesmo provedor do banco** — senão um incidente de conta leva banco e backup juntos |

### 11. Melhorias conhecidas deste deploy

Registradas para não virarem descoberta cara depois:

- **Revalidação de cache dá a volta pela internet.** O curator monta a chamada a
  `/api/revalidate` a partir de `NEXT_PUBLIC_SITE_URL`, então o pedido sai do VPS, volta
  pelo Nginx e paga TLS — para dois processos vizinhos. Funciona, mas uma variável de URL
  interna (`http://127.0.0.1:3000` no PM2, `http://web:3000` no Docker) eliminaria o
  desvio. Exige mudança de código no curator, por isso não foi feita aqui.
- **Uma instância do site, modo `fork`.** `instances: 'max'` só é seguro depois do Redis
  para rate limit distribuído e de um `cacheHandler` compartilhado — hoje N processos
  multiplicariam o limite de login por N e revalidariam a mesma página em duplicidade.
  O racional completo está em `ecosystem.config.js`.
- **Sem CDN na frente.** O Nginx serve tudo. Para um lançamento está correto; num breaking
  news com dezenas de milhares de leitores simultâneos, colocar um CDN à frente do
  domínio é a primeira alavanca — e o cache de duas velocidades já foi desenhado para isso.
- **Latência até o banco gerenciado.** Cada consulta agora atravessa a rede, em vez do
  soquete local. Some ~1–3 ms por consulta se o banco estiver na **mesma região** do VPS —
  irrelevante. Em regiões diferentes vira 30–80 ms por consulta e, numa página que faz
  várias, o efeito é visível. **Provisione banco e VPS na mesma região**; se não for
  possível, o caminho é reduzir o número de idas ao banco (menos consultas por página),
  não trocar de arquitetura.
- **Sem pool de conexões externo.** O Prisma mantém o seu próprio pool, o que basta para
  um processo. Se um dia houver várias réplicas, bancos gerenciados têm limite de
  conexões relativamente baixo e o caminho é um PgBouncer (ou o pooler do provedor).

---

## Arquitetura

### Visão geral

```
                    FONTES EXTERNAS
   RSS (estúdios, imprensa) · Google Trends · Reddit · YouTube · X
                            |
                            v
            +-------------------------------+
            |   services/curator            |   Node + TypeScript
            |                               |
            |   descoberta -> dedupe ->     |
            |   triagem -> corte ->         |
            |   enriquecimento -> ações     |
            +-------------------------------+
                     |            |
       grava scores  |            | invalida cache (webhook)
                     v            v
            +-----------------+   +--------------------------+
            |   PostgreSQL    |   |   apps/web (Next.js)     |
            |                 |<--|   site + painel editorial |
            +-----------------+   +--------------------------+
                                             |
                                             v
                                    CDN (páginas estáticas)
```

### Estrutura de pastas

```
R:\Claudio
├── packages/
│   ├── core/          Tipos, contratos e vocabulário de domínio (zero dependências)
│   ├── scoring/       Motor de score — função PURA, testável, sem I/O
│   └── db/            Schema Prisma, client e seed
├── services/
│   └── curator/       Serviço de curadoria
│       ├── connectors/   Conectores plugáveis de sinal
│       ├── discovery/    Descoberta de tópicos via RSS
│       ├── pipeline/     Orquestrador, deduplicação, ciclo principal
│       └── actions/      Alertas, invalidação de cache, instrumentação
├── apps/
│   └── web/           Next.js 15 (App Router) — site público + painel
└── design/            Protótipos de alta fidelidade (entregues pelo time de design)
```

As decisões de arquitetura estão consolidadas na seção [ADRs](#decisões-de-arquitetura-adrs)
deste documento, e o racional detalhado de cada uma vive em comentário no próprio arquivo
que a implementa — perto de onde importa.

### Por que essa separação

| Módulo | Responsabilidade única | Por que isolado |
|---|---|---|
| `core` | Vocabulário compartilhado | Sem dependências — pode ser importado por qualquer camada, inclusive pelo navegador |
| `scoring` | Calcular score | É função pura: testável sem mocks e reexecutável sobre o histórico para recalibração |
| `db` | Persistência | Isola o Prisma; a UI conversa com tipos de domínio, não com linhas de banco |
| `curator` | Coletar e decidir | É um processo longevo, com ciclo de vida próprio, que escala separado do site |
| `web` | Renderizar e converter | Escala com a CDN; não pode ser derrubado por um laço de coleta |

A regra que sustenta tudo: **`core` e `scoring` não conhecem nem banco nem rede**. É isso
que permite testar o algoritmo sem infraestrutura e reprocessar meses de histórico com
pesos novos.

---

## O algoritmo de score

### Os nove sinais e seus pesos

| Sinal | Peso | Racional |
|---|---:|---|
| Aceleração de busca | **0,26** | Único sinal que chega **antes** da concorrência. É o produto |
| Repercussão em redes | 0,16 | Onde o fandom vive; acende antes do volume de busca |
| Autoridade da fonte | 0,12 | Separa fato publicável de rumor que exige apuração |
| Volume de busca | 0,10 | Baixo de propósito: volume sem aceleração é interesse permanente, não notícia |
| Trending nativo | 0,10 | Alta qualidade quando presente, mas esparso |
| Janela de SERP | 0,09 | Chegar em 4º numa notícia saturada rende uma fração de chegar em 1º |
| Afinidade da audiência | 0,08 | **Sinal proprietário** — nenhum concorrente consegue reproduzir |
| Proximidade de lançamento | 0,07 | Amplificador de contexto |
| Gatilho emocional | 0,02 | Quase irrelevante no número **de propósito** (ver abaixo) |

**Por que gatilho emocional pesa 0,02:** peso alto transformaria o sistema numa máquina de
caçar tragédia e polêmica — ótimo para clique imediato, destrutivo para marca e retenção.
O papel desses gatilhos é **levantar a mão para um humano**, não inflar a nota.

### Dois scores, não um

O briefing pede um score de 0 a 100. Ao modelar os sinais, ficou claro que **um número só
não resolve**, por causa do item "cauda longa vs. cabeça":

- `score` (**urgência**) → "isso precisa ir ao ar agora?" Define faixas, push e home.
- `seoOpportunity` (**valor de pauta**) → "vale escrever, mesmo sem pressa?"

Um tópico com score 35 e SEO 82 não é lixo: é uma excelente pauta de cauda longa que
simplesmente não é breaking news. Com um número só, ele seria descartado — e é justamente
esse tipo de conteúdo que sustenta o tráfego orgânico entre um breaking e outro.

### Faixas de ação

| Faixa | Score | Meta | Automação | Home |
|---|---|---|---|---|
| **QUENTE / BREAKING** | 80–100 | 30 min | Alerta imediato + candidato a push | Hero |
| **EM ALTA** | 60–79 | poucas horas | — | Seção Trending |
| **RELEVANTE** | 40–59 | sem meta | — | Feed |
| **EVERGREEN** | 0–39 | — | — | Blocos de guia |

### A propriedade mais importante: renormalização

Quando um conector falha, a abordagem ingênua trata a dimensão ausente como zero. O efeito
é devastador e **silencioso**: se o conector de velocidade (peso 0,26) cai, todo tópico
perde até 26 pontos, nada mais atinge a faixa QUENTE e o sistema **para de detectar
breaking news sem registrar erro algum**.

A solução implementada: calcular a média ponderada **apenas sobre as dimensões
disponíveis**, dividindo pela soma dos pesos disponíveis. O score permanece na escala 0–100
e comparável. O preço da informação faltante é pago na **confiança**, não no score — que é
o lugar honesto de pagá-lo.

Há um teste dedicado a isso (`packages/scoring/src/engine.test.ts`): um tópico com todos os
sinais em 0,8 pontua praticamente igual quando metade das fontes some — mas com confiança
menor.

### Confiança e o freio das automações

A confiança combina **cobertura** (quanto do peso total foi medido) e **qualidade** (quão
confiantes estavam os conectores), por média geométrica. Ela é o que separa
"score 85, dispare push para 200 mil pessoas" de "score 85, mostre ao editor".

Push automático exige, cumulativamente:
1. faixa QUENTE;
2. confiança ≥ 55%;
3. ausência de gatilho sensível.

---

## O pipeline de curadoria

```
[1] DESCOBERTA      feeds RSS -> ~800 itens/dia
[2] DEDUPLICAÇÃO    5 veículos, 1 anúncio -> 1 tópico
[3] TRIAGEM         conectores gratuitos -> score preliminar
[4] CORTE           score >= 35, no máximo 40 por ciclo   <-- decisão crítica
[5] ENRIQUECIMENTO  conectores pagos, só para quem passou
[6] AÇÕES           alerta / push / hero, conforme a faixa
[7] INSTRUMENTAÇÃO  eventos internos para os KPIs editoriais
```

### Por que a etapa [4] existe

É o que torna o produto **economicamente viável**. Com os preços de 2026:

| Cenário | Conta mensal |
|---|---|
| Consultar todas as APIs para todo item descoberto | **~US$ 72.000** |
| Só enriquecer quem passa da triagem | **~US$ 225** |

A diferença não está na qualidade do código dos conectores: está na **topologia** do
pipeline. Foi por isso que `stage` (`discovery` | `enrichment`) virou parte do contrato de
conector, e o registry se recusa a inicializar se um conector pago for declarado como
`discovery`.

### Resiliência: quatro camadas

| Camada | Cobre o modo de falha |
|---|---|
| Timeout por conector | API que aceita a conexão e nunca responde |
| `Promise.allSettled` | API que devolve erro ou JSON malformado |
| Circuit breaker | API fora do ar há horas (evita gastar 8s por tópico, por ciclo) |
| Renormalização de pesos | A consequência final: o score continua válido |

O circuito abre após 3 falhas consecutivas e testa novamente após 5 minutos.

### Deduplicação (e um achado real)

Duas camadas: hash canônico (rápido, exato) e similaridade de Jaccard sobre tokens
(tolerante). Jaccard foi escolhido em vez de distância de edição porque interessa o
*conjunto de conceitos*, não a grafia: por Levenshtein, "GTA VI adiado" e "GTA VI
confirmado" parecem quase iguais — sendo notícias opostas.

**Bug encontrado pelos testes durante o desenvolvimento:** sem tratamento morfológico, a
deduplicação falhava no caso mais comum da redação:

```
"Rockstar adia GTA VI"          -> {rockstar, adia, gta}
"GTA VI adiado pela Rockstar"   -> {rockstar, adiado, gta}
Jaccard = 0,5  -> abaixo do limiar -> DOIS tópicos para o mesmo anúncio
```

O português é muito flexionado, então comparar formas de superfície não funciona. Foi
implementado um **stemmer leve** (15 linhas, zero dependências) que reduz ao radical:
`adia`, `adiado` e `adiaram` viram `adi`. Sem isso, o mesmo fato ocuparia a home várias
vezes, gastaria o orçamento de API em duplicidade e — pior — **diluiria o score entre
registros, impedindo a detecção do breaking news**.

O limiar de 0,6 é calibrado a favor do falso negativo: duplicata gera ruído visível que o
editor corrige em um clique; fusão errada faz uma notícia **desaparecer**, e ninguém
percebe o que não apareceu.

---

## Conectores de sinal

### Como adicionar uma fonte nova (ex.: TikTok)

1. Crie `services/curator/src/connectors/tiktok.ts` exportando um `SignalConnector`.
2. Adicione ao array `ALL_CONNECTORS` em `connectors/registry.ts`.
3. Pronto.

Não há passo 4. Nenhum arquivo do motor de score, do orquestrador ou do front-end precisa
ser tocado. Isso funciona porque o núcleo conhece apenas a **interface** e a semântica das
**dimensões** — nunca uma fonte concreta.

A peça que faz isso funcionar de verdade é a **normalização**: todo conector é obrigado a
devolver valores em [0,1] com significado único ("0 = irrelevante, 1 = tão grande quanto
isso costuma ficar"). O motor soma peras com peras; o conector, que entende a escala da
sua plataforma, faz a tradução.

### Conectores implementados

| Conector | Dimensões | Custo | Estágio |
|---|---|---|---|
| `source-authority` | Autoridade | grátis | descoberta |
| `release-calendar` | Sazonalidade | grátis | descoberta |
| `audience-affinity` | Afinidade | grátis | descoberta |
| `emotional-triggers` | Gatilhos | grátis | descoberta |
| `youtube` | Social + trending | quota | descoberta |
| `google-trends` | Volume + **velocidade** | pago | enriquecimento |
| `reddit` | Social + trending | pago | enriquecimento |
| `serp-competition` | Janela de SERP | grátis | enriquecimento |
| `x-twitter` | Social | pago | enriquecimento |

**Quatro conectores são internos e gratuitos.** Isso é estratégico: eles funcionam sem
nenhuma API externa, custam zero e são os que a concorrência não consegue copiar. Mesmo
com todas as APIs externas fora do ar, o pipeline continua produzindo scores úteis.

### Realidade de acesso às APIs (verificada em ago/2026)

Esta pesquisa **mudou decisões de arquitetura** e vale registrar:

| API | Situação | Impacto no projeto |
|---|---|---|
| Google Trends | Oficial existe, mas segue em **alpha por convite** | Conector com 3 estratégias: oficial / SerpApi / simulado |
| Reddit | Free tier de 100 QPM **proíbe uso comercial**; aprovação leva 2–4 semanas | Tratado como pago, no estágio de enriquecimento, com cache agressivo |
| X (Twitter) | **Sem free tier** desde fev/2026; ~US$ 0,005 por post lido | Conector mais caro; guarda de orçamento que se autodesliga aos 95% |
| YouTube | 10.000 unidades/dia grátis; `videos.list` custa 1 | Melhor custo-benefício — único externo na descoberta |

> **Atenção jurídica:** um portal monetizado é uso comercial. Operar o Reddit no free tier
> violaria os termos, com risco de banimento da chave em produção. O processo de aprovação
> comercial deve começar junto com o desenvolvimento.

### A decisão que economiza mais dinheiro

Para medir concorrência de SERP, o caminho óbvio seria uma API paga de busca. Ela tem dois
problemas: custa por consulta e sofre de **latência de indexação** — o Google leva minutos
a horas para indexar uma matéria nova, justamente na primeira hora, quando a decisão de
publicar rápido precisa ser tomada.

A solução adotada: **monitorar os feeds RSS dos concorrentes** (Omelete, JovemNerd, IGN
Brasil, Legião dos Heróis, EiNerd, The Enemy). Custo zero, dentro dos termos de uso,
latência quase nula e precisão maior — sabemos exatamente *quem* publicou e *quando*.

---

## Modelo de dados

PostgreSQL + Prisma. As entidades principais:

| Entidade | Papel |
|---|---|
| `Category` | Editoria. URL estável (`/categoria/games`), prioridade de monitoramento |
| `Franchise` | Fandom (Star Wars, Zelda). **Motor de retenção** + índice de afinidade |
| `Topic` | Um **fato do mundo** detectado pelo pipeline |
| `Article` | **Nosso conteúdo** sobre um tópico |
| `ScoreSnapshot` | Série temporal de scores — permite reprocessar o passado |
| `SignalReading` | Medição bruta por conector — permite recalibrar sem viés dos pesos antigos |
| `ReleaseEvent` | Calendário próprio de lançamentos (ativo proprietário) |
| `Subscriber` / `PushSubscription` | Funil de audiência |
| `Subcategory` | Sub-seção roteável de uma editoria (hoje: **Hardware** ⊂ Tech) |
| `AffiliateOffer` / `ArticleAffiliateOffer` | Ofertas de afiliado e o vínculo N:N com artigos |
| `CommentAuthor` / `CommentSession` / `Comment` | Comentários com identidade social (Discord/Google) |
| `PipelineEvent` / `AuditLog` | KPIs editoriais e rastreabilidade |

### Monetização: por que a loja é texto livre

A rede de afiliados **ainda não foi escolhida**. Isso muda a modelagem: em vez de
desenhar em cima da primeira integração (`amazonAsin`, `awinMerchantId`), modelamos o
**dado editorial** — produto, loja, preço, link. Os campos `network` e `externalId` já
existem, vazios, esperando a fase 2. Resultado: cadastro manual (fase 1) e sincronização
por API (fase 2) usam as mesmas tabelas, sem redesenho.

Três detalhes que valem a leitura do schema:

- **Preço em centavos inteiros.** Nunca `Float`: 0,1 + 0,2 ≠ 0,3 em ponto flutuante
  binário, e o erro aparece na hora errada.
- **`priceUpdatedAt` é separado de `updatedAt`.** São perguntas diferentes: "quando a
  linha mudou" e "esse preço é de quando". Juntas, uma correção de digitação
  rejuvenesceria um preço de três semanas.
- **`Article.hasAffiliateLinks` é derivado**, mantido por `syncAffiliateFlag()` dentro da
  mesma transação que altera o vínculo — e recalculado a partir da relação na leitura.
  Ver ADR 0013.

### Comentários: o que NÃO guardamos

| Dado do provedor | Guardamos? | Por quê |
|---|---|---|
| ID da conta | Só o **hash** | Precisamos *reconhecer* a mesma pessoa, não identificá-la fora do site |
| Nome de exibição | Sim, em claro | Aparece publicamente no comentário — é a finalidade |
| E-mail | **Não** | Nem pedimos o escopo. Discord: `identify`; Google: `openid profile` |
| Avatar | **Não** | Renderizar imagem do CDN do provedor entregaria o IP de todo leitor a terceiros. Exibimos iniciais |
| Token de acesso | **Não** | Usado uma vez para ler o perfil e descartado. Guardar token é guardar acesso à conta alheia |

### Por que `Topic` e `Article` são tabelas separadas

Um tópico é um fato ("a Rockstar anunciou o atraso"); um artigo é o nosso conteúdo sobre
ele. Um tópico pode gerar três artigos (notícia, análise, repercussão) — ou nenhum. Uni-los
produziria linhas "fantasma" de artigos nunca escritos poluindo o CMS e o sitemap.

### Desnormalizações conscientes

`currentScore` e `scoreDelta1h` são duplicados em `Topic`/`Article`, mesmo existindo em
`ScoreSnapshot`. A home e a página Em Alta ordenam por score a cada requisição não
cacheada; fazer isso com subquery no histórico seria caro exatamente no pico de tráfego.
Gravamos os dois: histórico para análise, atual para leitura.

`scoreAtPublish` é **congelado** e nunca atualizado — é o "previsto" do KPI de precisão.
Atualizá-lo destruiria a capacidade de avaliar o algoritmo.

---

## Front-end e SEO

Next.js 15 com App Router. Quase tudo são **Server Components**: os únicos componentes de
cliente são o formulário de newsletter, o opt-in de push, a barra de compartilhamento, o
bloco de spoiler e as ações do painel. Isso mantém o JavaScript enviado ao navegador
próximo de zero nas páginas de conteúdo — decisivo para o LCP no celular, que é o público
majoritário.

### Cache em duas velocidades

| Superfície | Estratégia | Motivo |
|---|---|---|
| **Artigo** | Cache longo (1h) + invalidação na edição | Conteúdo quase imutável. 50 mil leitores simultâneos num breaking news são servidos da CDN, sem tocar no banco |
| **Home / Em Alta** | Cache curto (60s) + **invalidação por evento** | Mudam de verdade quando um score muda de faixa |

A invalidação por evento é o ponto central: com `revalidate: 30`, a home pagaria
regeneração a cada 30s o dia inteiro, inclusive às 4h da manhã. Com invalidação por evento,
ela fica em cache indefinidamente e é regenerada **no instante** em que algo relevante
acontece — mais fresca quando importa, mais barata quando não importa.

Só invalidamos quando a **faixa** muda, não a cada variação de score: invalidar por 0,3
ponto destruiria a taxa de acerto do cache justamente durante um pico.

### Tema claro e escuro

O tema **claro é o padrão** (design v0.2) e o escuro é uma opção — não o contrário, e
nenhum dos dois é forçado. São três estados: *Sistema* (padrão, segue o aparelho),
*Claro* e *Escuro*, num controle no rodapé.

Mecanicamente é quase nada: todos os tokens usam `light-dark(claro, escuro)` e trocar de
tema muda **uma** propriedade (`color-scheme`) no `<html>`. Nenhuma paleta duplicada,
nenhum componente sabendo que existe tema.

A preferência vive no `localStorage` e é aplicada por um script inline de ~230 bytes no
`<head>`, antes da primeira pintura. Sem ele, quem usa tema escuro veria a página clara
por alguns décimos de segundo — um flash branco em tela cheia às 2h da manhã. Cookie lido
no servidor resolveria o flash e tornaria **toda** página dinâmica, matando o cache de
CDN (ADR 0010).

### O score numérico saiu da interface pública

Nenhuma página pública exibe `97/100`, `+38` ou `score 74`. No lugar entraram:
badge textual, `heatbar` (termômetro de 4 blocos, com `aria-label`) e tendência
qualitativa ("Disparando", "Subindo", "Esfriando", "Novo").

Ganho colateral que não estava no pedido: "Disparando" comunica melhor que "+38" para
quem não conhece a escala — e a escala é justamente o que não queremos publicar. O número
continua no banco, no ranqueamento, na API interna e na tela da redação (ADR 0009).

### Monetização (AdSense + afiliados)

A regra que organiza tudo, vinda do design (§7.1): **quanto mais quente e mais factual,
menos comercial; quanto mais evergreen e mais perto de uma decisão de compra, mais
tolerância.**

| Superfície | Anúncios | Afiliado |
|---|---|---|
| Breaking / cobertura ao vivo | 1 slot, depois do último parágrafo | **Proibido** |
| Notícia, trailer | 1–2 slots no corpo + trilho lateral | Só link contextual |
| Review, comparativo, guia, listicle | 2 slots + trilho | **Permitido** (`.buybox`) |
| Em Alta | **Nenhum** no fluxo do ranking | **Proibido** |
| Home | 0 no hero; slots depois do ranking | Nenhum |

Detalhes de implementação que sustentam as Core Web Vitals e a conta do AdSense:

- **Altura reservada por CSS** (`--ad-h`) em todo slot: CLS zero mesmo com o anúncio
  bloqueado — e boa parte da audiência bloqueia.
- **`strategy="lazyOnload"`** no carregador e `IntersectionObserver` por slot: o script
  de 100+ KB não disputa banda com a imagem de capa na janela em que o LCP é medido.
- **Sem Publisher ID, nada é renderizado** — nem o espaço reservado, nem a requisição.
  Em desenvolvimento, ninguém gera impressão inválida navegando pelo site.
- **`/ads.txt` é rota do Next**, montada a partir de variável de ambiente. Sem ID
  configurado, responde **404** de propósito: um `ads.txt` com linha inválida *bloqueia*
  a venda legítima do inventário, enquanto a ausência do arquivo é neutra.

### Disclosure: por que ele não depende do editor

O selo é injetado no Server Component do artigo a partir de `hasAffiliateLinks`, que é
derivado da relação artigo↔oferta. As ofertas e o selo saem da **mesma variável** — não
existe caminho de código em que um apareça sem o outro (ADR 0013). Todo link comercial
sai com `rel="sponsored nofollow noopener"` e etiqueta textual "afiliado" ao lado, e a
URL passa pela mesma função de sanitização que protege os links do corpo do artigo
(`lib/safe-url.ts`), na variante que exige HTTPS.

### Schema.org implementado

- `NewsArticle` — pré-requisito para o Google Notícias e o carrossel "Principais notícias"
- `Product` + `Offer`/`AggregateOffer` — **só** em review e comparativo, e só com preço
  verificado nas últimas 24h. É a família "product snippet" (páginas onde não se compra),
  a única elegível ao rich result de **prós e contras** — que o projeto já tem em
  `reviewData`. Preço obsoleto não é marcado (ADR 0016)
- `VideoObject` — miniatura na busca; central num nicho onde trailer é conteúdo-chave
- `Person` + `NewsMediaOrganization` — E-E-A-T (autor com credenciais verificáveis)
- `BreadcrumbList` — trilha na SERP e hierarquia do site
- `CollectionPage` + `ItemList` — categorias e hubs

Emitimos um único grafo com `@graph`, para que as entidades se referenciem por `@id` — em
blocos `<script>` soltos, a ligação entre artigo e autor se perde.

### Sitemap e indexação

Sitemap dinâmico com `lastModified` real (o Google ignora `priority` e `changeFrequency`,
mas o Bing não). Invalidado por evento a cada publicação. Conteúdo com score alto recebe
prioridade maior, como sinal extra para o rastreador.

**Sobre o "ping automático para Google/Bing" pedido no briefing** — o mecanismo mudou e
vale registrar, para que ninguém "conserte" isso no futuro sem contexto:

| Caminho | Situação | O que fizemos |
|---|---|---|
| Ping clássico de sitemap (`google.com/ping`) | **Descontinuado pelo Google em 2023** | Não implementado — seria código que não faz nada |
| **IndexNow** (Bing, Yandex, Seznam, Naver) | Ativo, gratuito, um envio se propaga entre todos | **Implementado**, disparado só para conteúdo QUENTE |
| Google Indexing API | Restrita a `JobPosting` e `BroadcastEvent`; usar para notícia viola os termos | Não implementado |
| Sitemap fresco + autoridade | É o que de fato funciona para o Google | Invalidação por evento a cada publicação |

O ping roda apenas na faixa QUENTE: em breaking news, minutos de antecedência na indexação
valem tráfego; no fluxo normal, o sitemap dá conta.

---

## Funil de audiência

```
Anônimo -> Leitor engajado -> Inscrito -> Comunidade -> Advocate
```

| Etapa | Mecanismo | Regra |
|---|---|---|
| Engajamento | TL;DR, relacionadas por franquia, hubs | Sempre |
| Newsletter | CTA no corpo do artigo | Após o 3º parágrafo; **só o e-mail** |
| Push | Opt-in contextualizado | Só em artigo com score ≥ 60; nunca no 1º pageview; 30 dias de carência se recusado |
| Comentário | Login social (Discord **ou** Google) | Sem comentário anônimo; 1º comentário de cada conta passa por moderação |
| Comunidade | Discord por fandom | Canal específico (`#gta-6`), não convite genérico |

### Comentários: a "escada de confiança"

Moderação tem duas soluções clássicas, ruins em pontas opostas. Pré-moderação total mata
a conversa (ninguém volta 6 horas depois) e cria fila infinita para a redação;
pós-moderação total funciona até o primeiro ataque coordenado — e aí o estrago já foi lido.

O que fazemos: **o primeiro comentário de uma conta entra como pendente; a partir do
primeiro aprovado, os seguintes publicam direto.**

Funciona porque o abuso quase sempre vem de conta descartável, criada para uma investida
só — ela esbarra na moderação e nunca chega à segunda mensagem. O leitor recorrente paga
o pedágio uma vez na vida. O custo operacional passa a ser proporcional a **contas novas**,
não a comentários.

Complementos: exigir conta real transfere o custo do antiabuso para Discord e Google
(que já o pagam); o limite de taxa é por autor, não por IP (um IP pune a escola inteira,
e o abusador troca de IP em segundos); bloquear um autor **revoga as sessões dele na
hora** e remove os comentários anteriores — é o caso de uso que motivou a sessão opaca
em vez de JWT (ADR 0011).

Comentário é renderizado como **texto puro**: sem Markdown, sem HTML e sem autolink.
URLs aparecem como texto — transformá-las em `<a>` num campo aberto é o convite mais
direto que existe para spam de SEO.

### Newsletter: double opt-in

Não é firula de marketing. É (a) prova de consentimento exigida pela LGPD, (b) proteção
contra cadastro de e-mails de terceiros e (c) o que preserva a reputação de envio — sem
ele, um bot inscreve mil endereços inválidos, os bounces disparam e **todo o domínio vai
para spam**, um dano lento e caro de reverter.

Implementado com token de 256 bits, armazenado em **hash**, de uso único, com validade de
48h. O descadastro de um clique (RFC 8058) é obrigatório na prática desde 2024 — Gmail e
Yahoo filtram remetentes em massa que não o oferecem.

### Push: por que o opt-in tem dois passos

Pedir `Notification.requestPermission()` ao carregar a página é a razão nº 1 de bloqueio
**permanente** — e "permanente" é literal: uma vez que o usuário clica em "Bloquear", o
navegador nunca mais mostra o pedido para o domínio, e não há nada que o site possa fazer.
Cada pedido malfeito é um assinante perdido para sempre.

Por isso: primeiro um convite em HTML explicando o motivo e a frequência ("no máximo 2 por
dia"), e só depois do clique chamamos o navegador. O botão "Agora não" tem o mesmo tamanho
do "Ativar" — dar proeminência desproporcional ao "sim" converte pior no médio prazo.

O service worker tem escopo **deliberadamente mínimo**: só push e clique. Um SW que cacheia
HTML é a causa mais comum de "o site não atualiza para alguns usuários" — inaceitável num
portal de notícias.

---

## KPIs e instrumentação

### Por que o GA4 não basta

O GA4 mede o **leitor**: sessões, origem, scroll, rejeição. Ele não sabe que o score de um
tópico cruzou 80 às 14h03 e que a matéria saiu às 14h31 — esses fatos acontecem dentro do
pipeline e nunca chegam ao navegador de ninguém.

Por isso há instrumentação própria (`PipelineEvent`, `AuditLog`).

| KPI | Fonte |
|---|---|
| Sessões por origem, scroll, rejeição | GA4 |
| **Time-to-publish** (score cruzou 80 → publicado) | `PipelineEvent` |
| **% de QUENTES publicados em 30 min** | `PipelineEvent` |
| **Precisão do score** (previsto × pageviews reais) | `Article.scoreAtPublish` × `pageviews24h` |
| Saúde dos conectores, custo por ciclo | `ConnectorHealth`, `PipelineRun` |

O `claimedAt` separa "demoramos a **ver** o alerta" de "demoramos a **escrever**" — são
gargalos diferentes, com soluções diferentes.

### Precisão do score: Spearman, não Pearson

Ninguém espera que score 80 renda exatamente o dobro de score 40. Pageviews têm
distribuição de cauda longa, e um punhado de virais dominaria uma correlação linear,
deixando o número instável a ponto de ser inútil.

O que importa é **ordenação**: se o algoritmo diz que A é mais quente que B, A rendeu mais
tráfego? Isso é correlação de postos (Spearman), robusta a outliers.

O relatório se **recusa a exibir um número** com menos de 20 amostras: correlação sobre 5
pontos é numerologia, e levaria alguém a mexer nos pesos por engano.

---

## Segurança

Tratamos o OWASP Top 10 como checklist mínimo.

| Risco | Mitigação |
|---|---|
| **A01** Controle de acesso | Segredo comparado em **tempo constante** (`timingSafeEqual`); cookie `httpOnly` + `sameSite=strict`; painel e `/api/` bloqueados no `robots.txt` |
| **A02** Falhas criptográficas | Tokens de 256 bits com `randomBytes` (nunca `Math.random`); armazenados em **hash**; IP em hash com sal |
| **A03** Injeção / XSS | Markdown renderizado como **elementos React**, nunca `dangerouslySetInnerHTML`; links com protocolo validado (bloqueia `javascript:`); JSON-LD com escape de `<`, `>` e `&` |
| **A04** Design inseguro | Double opt-in; rate limiting; orçamento de API com autodesligamento; automação de push com três travas cumulativas |
| **A05** Configuração incorreta | Cabeçalhos de segurança no `next.config.ts` (HSTS, nosniff, X-Frame-Options, Permissions-Policy); `robots.txt` bloqueia tudo fora de produção |
| **A07** Falhas de autenticação | Rate limit agressivo no login (5/15min); resposta genérica sem revelar se o token existe |
| **A10** SSRF | Endpoint de push validado contra lista fechada de domínios, com casamento por sufixo **com ponto** (não `includes`) |

Cuidados adicionais específicos deste domínio:

- **Enumeração de usuários:** a inscrição responde sempre a mesma mensagem, tenha o e-mail
  sido cadastrado ou não. Revelar "esse e-mail já está inscrito" permitiria mapear a base.
- **Host header injection:** URLs de e-mail vêm de variável de ambiente, nunca do cabeçalho
  `Host` — senão o sistema viraria ferramenta de phishing com o nosso próprio remetente.
- **XXE:** o parser de RSS usa regex e não resolve entidades externas, então o vetor não
  existe.
- **Vazamento em logs:** URLs são limpas de query string antes de logar (chaves de API
  costumam viajar como parâmetro).
- **LGPD:** IP e e-mail em hash; auditoria de consentimento; descadastro de um clique.

### Pendências antes de produção

1. ~~**Autenticação do painel**~~ — **RESOLVIDO**. O segredo compartilhado saiu; cada
   pessoa tem conta individual (e-mail + senha com scrypt, sessão opaca em `StaffSession`)
   e o `AuditLog` passou a gravar `actorId`. O que ficou de fora, conscientemente:
   recuperação de senha por e-mail (a redação é pequena; um admin redefine pela tela de
   contas) e segundo fator. Ver `apps/web/src/server/staff-auth.ts`.
2. **Rate limiting distribuído** — hoje em memória. Com múltiplas réplicas, o limite real
   vira N × o configurado. Migrar para Redis (`INCR` + `EXPIRE`).
3. **Content-Security-Policy** — não configurada ainda. O inventário de domínios cresceu
   com a camada de monetização e o login social; segue abaixo o que a política precisará
   liberar. **Antes de escrever a CSP, leia a lista inteira**: uma política restritiva
   demais quebra anúncio (receita) ou login (comentários) de forma difícil de diagnosticar.

   | Diretiva | Domínios | Motivo |
   |---|---|---|
   | `script-src` | `pagead2.googlesyndication.com`, `*.googlesyndication.com`, `*.googletagservices.com`, `*.google.com`, `*.googleadservices.com` | AdSense carrega scripts em cascata a partir do loader |
   | `script-src` | **hash do script inline de tema** (ou `nonce`) | O anti-FOUC é inline por necessidade (ADR 0010). Sem o hash, o site abre no tema errado |
   | `script-src` | `www.googletagmanager.com` | GA4 |
   | `frame-src` | `googleads.g.doubleclick.net`, `*.safeframe.googlesyndication.com`, `www.youtube-nocookie.com` | Criativos rodam em iframe; embeds de trailer |
   | `img-src` | `*.googlesyndication.com`, `*.doubleclick.net`, `*.g.doubleclick.net`, CDN de imagem próprio, `i.ytimg.com` | Criativos e miniaturas |
   | `connect-src` | `*.google-analytics.com`, `*.googlesyndication.com` | Beacons |
   | `style-src` | `fonts.googleapis.com` + `'unsafe-inline'` | O AdSense injeta estilo inline; sem isso, o slot não pinta |
   | `font-src` | `fonts.gstatic.com` | |
   | `form-action` | `discord.com`, `accounts.google.com` | Início do fluxo OAuth |
   | `frame-ancestors` | `'none'` | Já coberto pelo `X-Frame-Options` |
   | **a definir** | domínios da rede de afiliados | Depende da rede escolhida. Se ela usar redirecionador próprio ou pixel de conversão, entram em `img-src`/`connect-src` |

   Recomendação de implantação: subir primeiro em `Content-Security-Policy-Report-Only`
   por duas semanas e ler os relatórios. CSP de anúncio quebra de formas que não aparecem
   em teste manual — costuma falhar só em um formato de criativo, semanas depois.

4. ~~**Autenticação individual nas telas de afiliados e moderação**~~ — **RESOLVIDO** junto
   com o item 1: as duas passaram a exigir nível `admin` e registram `actorId` no
   `AuditLog`, então uma remoção de comentário contestada tem responsável identificável.
5. **Proxy de imagem de produto** — as fotos das ofertas virão do CDN das lojas. Servi-las
   direto entrega o IP do leitor ao varejista e nos deixa reféns de link quebrado. O
   `next/image` com `remotePatterns` resolve o segundo problema; o primeiro exige proxy.
6. **Limpeza de sessões expiradas** — hoje a sessão de leitor expirada é apagada de forma
   oportunista, no primeiro uso. Quem nunca mais voltar deixa uma linha para trás; um job
   semanal (`DELETE WHERE expiresAt < now()`) resolve quando o volume justificar.

---

## Decisões de arquitetura (ADRs)

| # | Decisão | Alternativa descartada | Por quê |
|---|---|---|---|
| 0001 | **Next.js** para o site | Astro, Remix | ISR + invalidação por tag resolve exatamente o requisito "artigo estático + home dinâmica"; RSC minimiza JS no mobile |
| 0002 | **PostgreSQL + Prisma** | MongoDB, Drizzle | Domínio fortemente relacional (N:N artigo↔franquia) e séries temporais de score; `jsonb` cobre o que é sem esquema, evitando um segundo banco |
| 0003 | **TypeScript no pipeline** | Python | Compartilhar tipos e schema com o front elimina drift de contrato; uma linguagem só para o time. Fronteira limpa para extrair um serviço Python de recalibração na Fase 3 |
| 0004 | **Pipeline em dois estágios** | Consultar tudo para todos | Diferença entre US$ 72.000 e US$ 225 por mês |
| 0005 | **Markdown no corpo** | HTML, editor de blocos | Renderizado como elementos React: XSS impossível por construção, sem depender de sanitizador bem configurado |
| 0006 | **Conectores como plugins** | `switch` no núcleo | Fonte nova = arquivo novo + 1 linha no registry; zero alteração no núcleo |
| 0007 | **npm workspaces** | Turborepo, Nx | 5 pacotes não justificam cache distribuído; adicionar Turborepo depois é incremental |
| 0008 | **Dois scores (urgência + SEO)** | Score único | Com um número só, conteúdo de cauda longa sempre perde — e é ele que sustenta o orgânico entre breakings |
| 0009 | **Score numérico só no `/admin`** | Flag `SHOW_NUMERIC_SCORE` no componente compartilhado | Uma flag pode ser reativada por descuido em qualquer tela nova. Removemos a *capacidade*: `HeatBadge` não aceita mais `score`, e exibir o número exige importar `components/admin/score-value.tsx` — um import que grita "isto é do painel" em revisão de código. A `/api/trending` também parou de expor o número: escondê-lo na tela e mantê-lo num endpoint público com CORS aberto seria teatro |
| 0010 | **Tema claro/escuro com `light-dark()` + `data-theme`** | `next-themes`; classe `.dark` em cada componente; cookie lido no servidor | Um token, dois valores: trocar de tema muda **uma** propriedade CSS (`color-scheme`) e nenhuma paleta é duplicada. Cookie no servidor tornaria toda página dinâmica e destruiria o cache de CDN — trocaríamos 300ms de flash por um site inteiro mais lento. O custo é um script inline de ~230 bytes no `<head>` |
| 0011 | **Cliente OAuth próprio + sessão opaca no banco** | Auth.js (NextAuth) v5 | Três motivos: a v5 segue em **beta** (a v4 é do Pages Router); o adaptador do Auth.js guarda nome, e-mail e tokens **em claro**, contra a política de minimização do projeto; e sessão em JWT **não se revoga** — o caso de uso central da moderação é "bane esse sujeito agora". Somos apenas o *cliente* de um fluxo padronizado (nada de criptografia própria), com `state` + PKCE construídos sobre as mesmas primitivas já usadas nos tokens de newsletter |
| 0012 | **Modelo de afiliados genérico** (loja como texto livre; `network`/`externalId` reservados) | Modelar sobre a API da primeira rede escolhida | A rede ainda não foi definida. Modelar em cima de `amazonAsin`/`awinMerchantId` obrigaria a remodelar metade do schema depois, com dados em produção. Assim, a fase 1 (cadastro manual) e a fase 2 (sincronização por API) usam **as mesmas tabelas** |
| 0013 | **`hasAffiliateLinks` derivado da relação; disclosure automático** | Checkbox "tem afiliado" no CMS | O checkbox falha em silêncio: ninguém marca às 23h publicando às pressas, nada quebra, nenhum teste falha — e o site veicula link comercial sem aviso (CDC art. 36, Código do CONAR, políticas do Google). Derivando da relação, "ter link" e "mostrar o selo" são o mesmo fato |
| 0014 | **Preço fresco por invalidação por evento + regra de 24h** | Baixar o `revalidate` do artigo para 5 min; buscar preço no cliente | Encurtar o cache custaria 12 regenerações por hora em **todos** os artigos para atualizar preço em alguns — e ainda exibiria preço de 5 minutos atrás. A garantia real não é o cache: passadas 24h sem conferência, o número **sai da página**. Funciona mesmo se toda a invalidação falhar |
| 0015 | **Política de anúncios como dado estático no front** | Tabela de densidade no banco, editável por painel | Densidade de anúncio é decisão editorial; decisão editorial editável por formulário acaba editada por quem tem meta de receita numa sexta à noite. Morar em `apps/web` também torna **estruturalmente impossível** o motor de score enxergá-la (pacote nunca importa quem o consome) |
| 0016 | **`Product`/`Offer` só em review e comparativo, com preço fresco** | Emitir em todo artigo com oferta; não emitir nada | "Product snippet" é a família de dado estruturado para páginas onde **não se compra** — e a única elegível ao rich result de prós e contras, que o projeto já tem em `reviewData`. Marcar preço obsoleto viola política do Google e é caminho conhecido para ação manual, então oferta vencida simplesmente não entra no `@graph` |
| 0017 | **Hardware como sub-categoria roteável** | Tag livre "hardware" | Tag não tem URL estável, não entra no menu e é filtrada por texto. Sub-categoria tem chave estrangeira com índice, `/categoria/tech/hardware` indexável e intenção de busca própria ("melhor placa de vídeo custo-benefício" não é "notícias de tecnologia") |
| 0018 | **Verificador de risco editorial por regras estáticas, que AVISA e registra — nunca bloqueia** | Classificador por LLM; trava de publicação; capacidade nova só para admin | Regra explícita é auditável ("qual linha sinalizou, e ela deve continuar existindo?"), custa zero por publicação e não manda matéria embargada para servidor de terceiro. Bloquear seria pôr um verificador **heurístico** como editor-chefe: ele erra nos dois sentidos, e uma trava contornável treina a redação a contorná-la. A proteção real é o par **aviso visível + reconhecimento gravado em `AuditLog`** (com justificativa obrigatória no risco alto) — nenhuma capacidade nova foi criada, porque o redator já publica o que assina e uma trava a mais não impediria a mesma acusação escrita com outras palavras. Ver `packages/core/src/editorial-risk.ts` |

---

## Plano de implementação em fases

### MVP — Games + Cinema & Séries (6 a 8 semanas)

**Objetivo:** provar que o pipeline detecta breaking news antes da concorrência.

| Frente | Entrega |
|---|---|
| Coleta | 11 fontes RSS (estúdios + imprensa tier 1) |
| Score | Todos os 9 sinais com os pesos v1; conectores internos reais, externos conforme credenciais saírem |
| Site | Home, Em Alta, categoria, hub de franquia, artigo |
| Funil | Newsletter com double opt-in; push |
| Redação | Painel com fila por score, override manual e alerta no Slack |
| Métricas | Time-to-publish, % na meta de 30 min, GA4 |

**Critérios de saída:**
- pipeline rodando 24/7 com menos de 1% de ciclos falhos;
- ao menos 20 matérias publicadas a partir de tópicos QUENTE;
- primeira medição de precisão do score (mínimo de 20 amostras);
- p75 de LCP abaixo de 2,5s no mobile.

**Não entra no MVP:** colecionáveis, app, feed personalizado.

> **Antecipados para esta rodada** (decisão do dono do site, fora do plano original):
> tema claro/escuro, comentários com login social, camada de monetização (AdSense +
> afiliados) e a sub-seção Hardware. O que puxou a antecipação foi a monetização: ela
> muda o modelo de dados, e mexer em schema depois de indexado custa mais caro.

### Fase 2 — Anime/Mangá + HQs + Tech (4 a 6 semanas)

- Ativar as fontes de fase 2 (`CURATOR_PHASE=2`) — as categorias já existem no modelo
  desde o dia 1, porque **mudar URL depois de indexado custa autoridade**.
- **Primeira recalibração dos pesos** com dados reais das 8–12 semanas anteriores, via
  shadow scoring: calcular em paralelo com pesos candidatos e só promover se a correlação
  de Spearman melhorar.
- Elevar o peso de `audienceAffinity` — ele começa baixo por falta de histórico, e é o
  sinal proprietário que mais deve crescer.
- **Sincronização de preço por API** da rede de afiliados escolhida — as colunas
  `network`/`externalId` já existem para isso (o cadastro manual da fase 1 continua
  valendo como caminho de exceção).
- Comentários: respostas em thread, denúncia pelo leitor e métricas de moderação. A base
  (identidade, sessão revogável, escada de confiança) já está no ar.
- Redis para rate limiting distribuído e fila BullMQ.

### Fase 3 — Colecionáveis/Eventos + refinamento (contínuo)

- Páginas de evento com cobertura ao vivo (CCXP, Game Awards, Gamescom).
- **Recalibração automática:** job que roda o shadow scoring semanalmente e sugere ajustes.
  É o momento natural para extrair um serviço Python (pandas/scikit-learn), com a fronteira
  já isolada em `packages/scoring`.
- Classificador de gatilhos emocionais por LLM, substituindo as palavras-chave — **se** os
  dados rotulados mostrarem que o ganho compensa o custo e a perda de determinismo.
- Novos conectores: TikTok, Instagram, Twitch (o registry já suporta).
- Particionamento do sitemap (índice + arquivos por mês) ao aproximar de 50 mil URLs.
- Feed personalizado a partir dos hubs seguidos.

---

## Pendências e decisões em aberto

Itens que **precisam de decisão do cliente** antes do lançamento:

1. **Estrutura de URL** — o briefing pede `/categoria/games` e `/franquia/x`; o design
   propõe `/games` e `/f/x`. Implementado o formato do briefing como canônico, com
   redirecionamento 301 do outro. **Trocar é alterar constantes em `core/routes.ts`** — mas
   só até a indexação começar; depois custa autoridade.
2. **Acesso comercial ao Reddit** — iniciar o processo agora; leva de 2 a 4 semanas.
3. **Orçamento mensal de API** — o padrão está conservador (US$ 100/mês no X). Definir o
   teto real ajusta `X_MONTHLY_READ_BUDGET` e o limite de enriquecimento por ciclo.
4. **Rede de afiliados** — a única decisão comercial que ainda trava receita. O sistema
   funciona inteiro sem ela (cadastro manual no `/admin/afiliados`); quando a rede sair,
   entram `network`/`externalId` e um job de sincronização de preço. Também define os
   domínios que faltam na CSP.
5. **Publisher ID do AdSense** — enquanto `NEXT_PUBLIC_ADSENSE_CLIENT_ID` estiver vazio,
   nenhum anúncio é renderizado e `/ads.txt` responde 404 (ambos de propósito).
6. **Credenciais de OAuth (Discord e Google)** — sem elas, os comentários ficam em modo
   leitura. Cadastrar as URLs de retorno **exatamente** como
   `{SITE_URL}/api/auth/{provider}/callback`.

### Decisões que já foram resolvidas nesta rodada

| Antes em aberto | Decisão do dono do site |
|---|---|
| Exibir o score numérico publicamente | **Não.** Só no `/admin` (ADR 0009) |
| Tema escuro como padrão | **Não.** Claro por padrão, escuro por escolha, com opção "Sistema" (ADR 0010) |
| Comentários nativos × Discord | **Ambos como login**: Discord e Google, com moderação por escada de confiança (ADR 0011) |
| Paleta de marca | Resolvida no design v0.2: marca em carmim/grafite; vermelho vivo e laranja seguem exclusivos da temperatura, e a paleta comercial é cinza |

### Dívida técnica registrada

- **`light-dark()` exige navegador de 2024+** (Chrome 123, Safari 17.5, Firefox 120).
  Cobertura hoje é alta, mas num navegador antigo os tokens ficam inválidos. O caminho de
  saída já está documentado pelo design: compilar os tokens em dois blocos (`:root` e
  `[data-theme=dark]`). A arquitetura não muda, só a saída do CSS.
- ~~**Re-skin para o design v0.2.**~~ **Concluído** — ver a seção abaixo.

### Re-skin para o design v0.3 — status: **concluído**

O produto não escreve CSS próprio: ele carrega a folha do design system
(`apps/web/src/app/ortuspixel.css`), que é cópia **verbatim** de `design/assets/*.css`
até a seção 17. O que estava desalinhado, portanto, nunca foi o estilo — era o
**markup**, que citava classes de versões anteriores ou classes que nunca existiram.

**O que foi sincronizado**

| Área | O que mudou |
|---|---|
| Vocabulário v0.1/v0.2 → v0.3 | `.cd-box` → `.side-box`, `.rank-list__*` → `.rank__*`, `.section__head` → `.section-head`, `.card__foot` → `.meta`, `.article__body` → `.prose`, `.share-bar` → `.share`, `.fandom-list` → `.fandoms`, `.trending-head` → `.hub-hero` |
| Grades | `.grid` sozinho não define coluna nenhuma no design; os feeds ganharam `.g-sm-2` / `.g-md-3` / `.g-lg-4` |
| Layout de artigo | `.article-layout` → `.layout-2col`. A primeira é grade de **três** colunas (`56px │ 1fr │ 320px`) e a coluna de 56px é o trilho de compartilhamento, que o produto não renderiza — acima de 1180px o texto da matéria caía nela |
| Slug de editoria × token do design | `cat--${slug}` gerava `.cat--cinema-e-series`, `.cat--anime-e-manga` e `.cat--hqs`; agora passa por `catModifier()` / `catClass()` |
| Modificadores de temperatura | `heatbar--${heat}` gerava `.heatbar--base` em quase todo card. `base` é o estado **padrão** e não tem modificador. Centralizado em `heatClass()` |
| Bloco de afiliados | A variante `summary` reutilizava o markup da `buybox`; passou a usar `.aff-summary__list` + `.prod`, que é o cartão de **produto** (a `.buybox` compara **lojas**) |
| Newsletter | `.cta-inline` é grade de duas colunas e distribui pela ordem dos **filhos diretos**; o bloco emitia cinco elementos soltos e saía em zigue-zague |

**O que garante que não volta**

`npm run check:classes` compara o HTML **realmente servido** por 15 páginas com o CSS
do design e falha se aparecer classe inexistente ou vocabulário morto. Precisa do dev
server no ar; sem ele, `npm run check:classes -- --skip-runtime` mantém as checagens
estáticas. `packages/core/src/presentation.test.ts` cobre os dois mapas de tradução
(slug → token de editoria, temperatura → modificador) sem depender de servidor nem de
dados.

**O que ficou de fora — e por quê**

Nada disso é dívida de re-skin: são recursos do protótipo que o produto ainda não tem.
Estão listados para não serem confundidos com divergência de estilo.

| Do protótipo | Por que não entrou |
|---|---|
| `.share-rail`, `.icon-btn`, `.nav-toggle`, `.thumb__play`, `.trend` com seta | **Não há sistema de ícones.** O protótipo usa `<svg><use href="#i-…">`; sem os ícones, esses componentes sairiam como círculos e quadrados vazios. É a maior lacuna visual restante e vale como próximo passo |
| `.verdict` / `.verdict__score` / `.pros-cons` | O veredito de review (nota, prós e contras) já existe no **banco** (`reviewData`), mas nenhuma página o renderiza |
| `.toc` | Sumário de artigo longo — os `id` dos títulos já são gerados por `article-body.tsx`, falta a lista |
| `.progress` / `.sticky-bar` | Barra de progresso de leitura: exigiria transformar a página de artigo em Client Component |
| `.shop`, `.deal-strip` | Vitrine de produtos no hub de franquia e faixa de ofertas em Hardware — dependem de dado que o pipeline ainda não coleta |
| `.social-proof` / `.avatars` / `.online` | Indicadores de presença ao vivo. Não temos o dado, e um indicador que não reflete estado nenhum é pior que nenhum |
| `.load-more`, `.chip__count`, `.editoria` | Paginação, contadores por filtro e blocos por editoria na home — mudanças de consulta, não de apresentação |
| `.table-wrap` / `.cmp` | Tabelas comparativas: o parser de Markdown ainda não suporta tabelas (decisão deliberada, ver `article-body.tsx`) |

O **rebrand de "CanalNerd" para "Ortus Pixel"** foi aplicado primeiro em `design/` e
depois no código do app, em tarefas separadas de propósito: misturar renomeação de marca
com refactor de markup tornaria os dois impossíveis de revisar.

**Status: concluído.** Continuam com o nome antigo, por decisão explícita e isolada:
o escopo dos pacotes npm (`@subcarioca/*`) e as credenciais do Postgres de
desenvolvimento (`docker-compose.yml`), que renomear quebraria o volume local sem
benefício nenhum. Ambos são trabalho de uma tarefa futura, com o site já estável no ar.

---

## Referências

- Protótipos e arquitetura de informação: [`design/README.md`](design/README.md)
- Contrato de sinais: [`packages/core/src/signals.ts`](packages/core/src/signals.ts)
- Pesos e racional: [`packages/scoring/src/weights.ts`](packages/scoring/src/weights.ts)
- Testes do motor: [`packages/scoring/src/engine.test.ts`](packages/scoring/src/engine.test.ts)
