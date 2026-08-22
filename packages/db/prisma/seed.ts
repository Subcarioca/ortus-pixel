/**
 * =============================================================================
 * SEED — dados de desenvolvimento realistas
 * =============================================================================
 *
 * Objetivo: `npm run db:seed` e o portal inteiro funciona — home, categorias,
 * hubs de franquia, trending e painel editorial — SEM nenhuma chave de API.
 *
 * Isso não é conveniência de preguiçoso; é decisão de arquitetura. Como as
 * APIs de sinal são caras, gated (Reddit exige aprovação de 2-4 semanas) ou
 * ainda em alpha (Google Trends), amarrar o desenvolvimento do front à
 * disponibilidade delas travaria o time inteiro. Com o seed, o front e o
 * pipeline evoluem em paralelo à negociação de acesso às APIs.
 *
 * Os dados imitam distribuições REAIS: a maioria dos tópicos é morna, poucos
 * são quentes. Se o seed enchesse o banco de scores 90+, a home ficaria linda
 * no demo e quebraria em produção, quando descobriríamos que o layout não
 * previa "nenhuma notícia quente agora" — que é o estado mais comum do dia.
 *
 * Idempotente: usa `upsert` em tudo, então rodar duas vezes não duplica nada.
 */

import { PrismaClient } from '@prisma/client';
import { CATEGORIES, SUBCATEGORIES, slugify, estimateReadingMinutes } from '@subcarioca/core';

const prisma = new PrismaClient();

/** Datas relativas ao "agora" para que o seed nunca pareça velho. */
const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000);

async function seedCategories() {
  console.log('  Categorias...');
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      // O update mantém o banco alinhado com a taxonomia do código quando ela
      // muda, mas NÃO sobrescreve seoTitle/seoDescription — esses são campos do
      // editor, e um seed jamais deve apagar trabalho humano.
      update: {
        name: c.name,
        shortName: c.shortName,
        description: c.description,
        accentColor: c.accentColor,
        monitoringPriority: c.monitoringPriority,
        launchPhase: c.launchPhase,
        affiliateWeight: c.affiliateWeight,
      },
      create: {
        slug: c.slug,
        name: c.name,
        shortName: c.shortName,
        description: c.description,
        accentColor: c.accentColor,
        monitoringPriority: c.monitoringPriority,
        launchPhase: c.launchPhase,
        affiliateWeight: c.affiliateWeight,
      },
    });
  }
}

/**
 * Sub-categorias (hoje: Hardware ⊂ Tech).
 *
 * Mesmo padrão de "seed tipado" das categorias: a fonte da verdade é
 * `SUBCATEGORIES` em core/taxonomy.ts, e o seed apenas materializa as linhas
 * para que os artigos possam ter chave estrangeira.
 */
async function seedSubcategories() {
  console.log('  Sub-categorias...');
  const categories = await prisma.category.findMany();

  for (const sub of SUBCATEGORIES) {
    const parent = categories.find((c) => c.slug === sub.parent);
    // Se a categoria-mãe não existe, PULAMOS em vez de estourar: o seed é
    // idempotente e não pode falhar por causa de uma taxonomia em transição.
    if (!parent) {
      console.warn(`    [aviso] categoria-mãe "${sub.parent}" não encontrada; pulando ${sub.slug}`);
      continue;
    }

    await prisma.subcategory.upsert({
      where: { categoryId_slug: { categoryId: parent.id, slug: sub.slug } },
      update: {
        name: sub.name,
        description: sub.description,
        affiliateWeight: sub.affiliateWeight,
      },
      create: {
        slug: sub.slug,
        name: sub.name,
        description: sub.description,
        affiliateWeight: sub.affiliateWeight,
        categoryId: parent.id,
      },
    });
  }
}

async function seedAuthors() {
  console.log('  Autores...');
  const authors = [
    {
      slug: 'marina-alves',
      name: 'Marina Alves',
      email: 'marina@ortuspixel.com',
      role: 'Editora-chefe',
      bio: 'Jornalista com 12 anos de cobertura de games e cultura pop. Cobriu 8 edições da E3 e 6 da CCXP. Especialista em indústria de jogos e mercado brasileiro.',
      systemRole: 'admin',
      expertiseAreas: ['games', 'tech'],
      socialLinks: [
        { platform: 'twitter', url: 'https://x.com/marinaalves' },
        { platform: 'linkedin', url: 'https://linkedin.com/in/marinaalves' },
      ],
    },
    {
      slug: 'rafael-tanaka',
      name: 'Rafael Tanaka',
      email: 'rafael@ortuspixel.com',
      role: 'Repórter de Cinema & Séries',
      bio: 'Crítico de cinema formado em Audiovisual pela USP. Escreve sobre adaptações de quadrinhos e franquias de ficção científica desde 2016.',
      systemRole: 'editor',
      expertiseAreas: ['cinema-e-series', 'hqs'],
      socialLinks: [{ platform: 'twitter', url: 'https://x.com/rafatanaka' }],
    },
    {
      slug: 'juliana-costa',
      name: 'Juliana Costa',
      email: 'juliana@ortuspixel.com',
      role: 'Repórter de Anime & Mangá',
      bio: 'Tradutora de japonês e pesquisadora de cultura otaku. Acompanha o mercado editorial de mangás no Brasil há 9 anos.',
      systemRole: 'writer',
      expertiseAreas: ['anime-e-manga'],
      socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/jucosta' }],
    },
  ];

  for (const a of authors) {
    await prisma.author.upsert({
      where: { email: a.email },
      update: {},
      create: {
        slug: a.slug,
        name: a.name,
        email: a.email,
        role: a.role,
        bio: a.bio,
        systemRole: a.systemRole,
        expertiseAreas: a.expertiseAreas,
        socialLinks: a.socialLinks,
      },
    });
  }
}

async function seedFranchises() {
  console.log('  Franquias...');
  const categories = await prisma.category.findMany();
  const catId = (slug: string) => categories.find((c) => c.slug === slug)!.id;

  const franchises = [
    {
      slug: 'gta',
      name: 'Grand Theft Auto',
      aliases: ['GTA', 'GTA VI', 'GTA 6', 'Rockstar'],
      category: 'games',
      // Índice alto: nossa audiência devora conteúdo de GTA. Este número sairia
      // do job de recálculo em produção; aqui é semeado para o pipeline ter o
      // que consumir desde o primeiro ciclo.
      affinity: 1.8,
      followers: 12400,
      description:
        'A série de mundo aberto da Rockstar Games que redefiniu o gênero e movimenta a maior expectativa da indústria.',
    },
    {
      slug: 'the-legend-of-zelda',
      name: 'The Legend of Zelda',
      aliases: ['Zelda', 'Link', 'Hyrule', 'Tears of the Kingdom'],
      category: 'games',
      affinity: 1.5,
      followers: 9800,
      description: 'A saga da Nintendo que atravessa gerações de consoles e de jogadores.',
    },
    {
      slug: 'star-wars',
      name: 'Star Wars',
      aliases: ['Guerra nas Estrelas', 'SW', 'Mandalorian', 'Jedi'],
      category: 'cinema-e-series',
      affinity: 1.4,
      followers: 15200,
      description:
        'A galáxia muito, muito distante: filmes, séries, games e o fandom mais barulhento da internet.',
    },
    {
      slug: 'marvel',
      name: 'Marvel',
      aliases: ['MCU', 'Vingadores', 'Avengers', 'Homem-Aranha'],
      category: 'cinema-e-series',
      affinity: 1.6,
      followers: 21500,
      description: 'O universo cinematográfico e editorial da Casa das Ideias.',
    },
    {
      slug: 'one-piece',
      name: 'One Piece',
      aliases: ['Luffy', 'Chapéu de Palha', 'Oda'],
      category: 'anime-e-manga',
      affinity: 1.3,
      followers: 11700,
      description: 'A obra de Eiichiro Oda e a maior aventura pirata dos mangás.',
    },
    {
      slug: 'the-last-of-us',
      name: 'The Last of Us',
      aliases: ['TLOU', 'Ellie', 'Joel', 'Naughty Dog'],
      category: 'games',
      affinity: 1.35,
      followers: 8300,
      description: 'A franquia da Naughty Dog que virou fenômeno também na TV.',
    },
    {
      slug: 'dc',
      name: 'DC',
      aliases: ['DCU', 'Batman', 'Superman', 'James Gunn'],
      category: 'cinema-e-series',
      affinity: 1.1,
      followers: 13900,
      description: 'O universo da DC nos cinemas, na TV e nas bancas.',
    },
    {
      slug: 'nintendo',
      name: 'Nintendo',
      aliases: ['Switch', 'Switch 2', 'Mario'],
      category: 'games',
      affinity: 1.45,
      followers: 10200,
      description: 'A veterana de Kyoto e seu ecossistema de consoles e franquias.',
    },
  ];

  for (const f of franchises) {
    await prisma.franchise.upsert({
      where: { slug: f.slug },
      update: { audienceAffinityIndex: f.affinity, followerCount: f.followers },
      create: {
        slug: f.slug,
        name: f.name,
        aliases: f.aliases,
        description: f.description,
        primaryCategoryId: catId(f.category),
        audienceAffinityIndex: f.affinity,
        followerCount: f.followers,
      },
    });
  }
}

async function seedReleaseCalendar() {
  console.log('  Calendário de lançamentos...');
  const franchises = await prisma.franchise.findMany();
  const fId = (slug: string) => franchises.find((f) => f.slug === slug)?.id ?? null;

  const releases = [
    // Lançamento MUITO próximo: o sinal releaseProximity deve estourar aqui.
    { title: 'GTA VI', kind: 'game', date: daysFromNow(12), franchise: 'gta', confirmed: true },
    {
      title: 'The Last of Us - 3ª Temporada',
      kind: 'series-season',
      date: daysFromNow(45),
      franchise: 'the-last-of-us',
      confirmed: true,
    },
    {
      title: 'Vingadores: Secret Wars',
      kind: 'movie',
      date: daysFromNow(210),
      franchise: 'marvel',
      confirmed: true,
    },
    {
      title: 'One Piece - Arco Elbaf (anime)',
      kind: 'anime-season',
      date: daysFromNow(28),
      franchise: 'one-piece',
      confirmed: true,
    },
    // Data NÃO confirmada: o conector deve ponderar menos.
    {
      title: 'The Legend of Zelda (live-action)',
      kind: 'movie',
      date: daysFromNow(400),
      franchise: 'the-legend-of-zelda',
      confirmed: false,
    },
    { title: 'CCXP', kind: 'event', date: daysFromNow(120), franchise: null, confirmed: true },
  ];

  for (const r of releases) {
    const slug = slugify(r.title);
    await prisma.releaseEvent.upsert({
      where: { slug },
      update: { releaseDate: r.date, isConfirmed: r.confirmed },
      create: {
        slug,
        title: r.title,
        kind: r.kind,
        releaseDate: r.date,
        isConfirmed: r.confirmed,
        franchiseId: r.franchise ? fId(r.franchise) : null,
      },
    });
  }
}

/**
 * Tópicos + artigos.
 *
 * A distribuição de scores é proposital:
 *   1 tópico QUENTE, 2 EM ALTA, 3 RELEVANTES, 2 EVERGREEN.
 * É mais ou menos o que se vê num dia normal de redação. Um seed "todo mundo
 * é 95" esconderia justamente os estados de UI que mais aparecem na prática.
 */
async function seedTopicsAndArticles() {
  console.log('  Tópicos e artigos...');
  const categories = await prisma.category.findMany();
  const franchises = await prisma.franchise.findMany();
  const authors = await prisma.author.findMany();

  const subcategories = await prisma.subcategory.findMany();

  const catId = (slug: string) => categories.find((c) => c.slug === slug)!.id;
  const frId = (slug: string) => franchises.find((f) => f.slug === slug)!.id;
  const auId = (slug: string) => authors.find((a) => a.slug === slug)!.id;
  const subId = (slug?: string) =>
    slug ? (subcategories.find((s) => s.slug === slug)?.id ?? null) : null;

  const items = [
    {
      query: 'GTA VI atraso',
      title: 'Rockstar confirma novo atraso de GTA VI para novembro',
      summary:
        'A Rockstar Games publicou comunicado oficial adiando o lançamento de GTA VI. Ações da Take-Two caem 7% no pré-mercado.',
      category: 'games',
      franchises: ['gta'],
      author: 'marina-alves',
      score: 94.2,
      band: 'HOT',
      seo: 41,
      confidence: 0.88,
      termType: 'head',
      triggers: [] as string[],
      sourceTier: 'official',
      sourceName: 'Rockstar Games (comunicado oficial)',
      hoursOld: 1.5,
      publish: true,
      breaking: true,
      views: 48200,
      pv24: 48200,
      content: `A Rockstar Games confirmou nesta manhã, por meio de comunicado oficial publicado em seus canais, que **GTA VI foi adiado** mais uma vez.

## O que a Rockstar disse

Segundo o comunicado, o adiamento visa "garantir o nível de polimento que a comunidade espera". A nova data ficou para novembro.

## Impacto no mercado

As ações da Take-Two Interactive, controladora da Rockstar, caíram cerca de 7% no pré-mercado logo após o anúncio.

## O que isso significa para os jogadores

Historicamente, adiamentos da Rockstar resultaram em lançamentos mais estáveis. Red Dead Redemption 2 passou por dois adiamentos antes de chegar às lojas.`,
    },
    {
      query: 'trailer The Last of Us temporada 3',
      title: 'HBO divulga primeiro trailer da 3ª temporada de The Last of Us',
      summary:
        'O trailer de 2 minutos mostra os primeiros momentos de Ellie em Santa Barbara e já acumula 4 milhões de views em 6 horas.',
      category: 'cinema-e-series',
      franchises: ['the-last-of-us'],
      author: 'rafael-tanaka',
      score: 76.8,
      band: 'RISING',
      seo: 52,
      confidence: 0.81,
      termType: 'head',
      triggers: [],
      sourceTier: 'official',
      sourceName: 'HBO Max',
      hoursOld: 6,
      publish: true,
      breaking: false,
      views: 22100,
      pv24: 22100,
      video: {
        url: 'https://www.youtube.com/watch?v=exemplo-tlou-s3',
        thumb: 'https://picsum.photos/seed/tlou-s3-trailer/1200/675',
        duration: 128,
      },
      content: `A HBO liberou o primeiro trailer completo da terceira temporada de **The Last of Us**.

## O que o trailer mostra

As imagens confirmam a adaptação do arco final do segundo jogo, com Ellie em Santa Barbara.

## Data de estreia

A temporada estreia em 45 dias, com episódios semanais.`,
    },
    {
      query: 'Nintendo Switch 2 vendas',
      title: 'Switch 2 ultrapassa 15 milhões de unidades vendidas',
      summary:
        'Console da Nintendo bate recorde de velocidade de vendas na história da empresa, superando o Wii.',
      category: 'games',
      franchises: ['nintendo'],
      author: 'marina-alves',
      score: 68.4,
      band: 'RISING',
      seo: 61,
      confidence: 0.79,
      termType: 'mid',
      triggers: [],
      sourceTier: 'official',
      sourceName: 'Nintendo IR',
      hoursOld: 14,
      publish: true,
      breaking: false,
      views: 9800,
      pv24: 11200,
      content: `A Nintendo divulgou seu relatório trimestral confirmando que o **Switch 2** ultrapassou 15 milhões de unidades.

## Comparação com gerações anteriores

O ritmo supera o do Wii no mesmo período.`,
    },
    {
      query: 'James Gunn Superman sequência',
      title: 'James Gunn comenta planos para a sequência de Superman',
      summary:
        'Em entrevista, o chefe da DC Studios falou sobre o cronograma do próximo filme e o futuro do DCU.',
      category: 'cinema-e-series',
      franchises: ['dc'],
      author: 'rafael-tanaka',
      score: 54.1,
      band: 'RELEVANT',
      seo: 66,
      confidence: 0.72,
      termType: 'mid',
      triggers: [],
      sourceTier: 'tier1Press',
      sourceName: 'Variety',
      hoursOld: 20,
      publish: true,
      breaking: false,
      views: 5400,
      pv24: 6100,
      content: `James Gunn falou sobre os próximos passos do DCU em entrevista à Variety.

## O cronograma

Segundo Gunn, o roteiro está em fase inicial.`,
    },
    {
      query: 'One Piece capitulo 1140',
      title: 'One Piece 1140: o que o novo capítulo revela sobre Elbaf',
      summary:
        'O capítulo desta semana traz revelações sobre a ilha dos gigantes e prepara o próximo arco do anime.',
      category: 'anime-e-manga',
      franchises: ['one-piece'],
      author: 'juliana-costa',
      score: 49.7,
      band: 'RELEVANT',
      seo: 74,
      confidence: 0.68,
      termType: 'long-tail',
      triggers: [],
      sourceTier: 'tier2Press',
      sourceName: 'Shonen Jump',
      hoursOld: 30,
      publish: true,
      breaking: false,
      views: 7200,
      pv24: 7900,
      content: `O capítulo 1140 de **One Piece** finalmente mostra o interior de Elbaf.

## As revelações

Sem entrar em spoilers pesados, o capítulo conecta pontas soltas do arco anterior.`,
    },
    {
      query: 'melhores jogos de mundo aberto 2026',
      title: 'Os 15 melhores jogos de mundo aberto para jogar em 2026',
      summary:
        'Seleção com os mundos abertos mais bem construídos disponíveis hoje, de clássicos a lançamentos recentes.',
      category: 'games',
      franchises: ['the-legend-of-zelda'],
      author: 'marina-alves',
      score: 31.2,
      band: 'EVERGREEN',
      // Score de urgência baixo, mas SEO altíssimo: é EXATAMENTE o caso que
      // justifica os dois números separados. Como pauta de velocidade não vale
      // nada; como ativo de tráfego orgânico, vale muito.
      seo: 88,
      confidence: 0.7,
      termType: 'long-tail',
      triggers: [],
      sourceTier: 'tier2Press',
      sourceName: 'Pauta própria',
      hoursOld: 72,
      publish: true,
      breaking: false,
      views: 15600,
      pv24: 3200,
      // O formato estava caindo no padrão 'breaking' porque a chave faltava —
      // uma lista de "os 15 melhores" não é notícia perecível. Agora que a home
      // seleciona "Guias e essenciais" por FORMATO (e não mais por score baixo),
      // o dado errado deixaria a seção vazia justamente com o conteúdo que ela
      // existe para mostrar.
      format: 'listicle',
      content: `Mundo aberto virou sinônimo de jogo grande — mas tamanho não é tudo.

## 1. The Legend of Zelda: Tears of the Kingdom

O melhor uso de verticalidade já feito no gênero.`,
    },
    {
      // ---------------------------------------------------------------------
      // REVIEW DE HARDWARE — o caso de uso que motiva a camada de afiliados.
      //
      // Repare na combinação: score de URGÊNCIA baixo (ninguém precisa saber
      // disso em 30 minutos) e SEO altíssimo (a consulta "vale a pena RTX 5070"
      // é buscada todo dia, o ano inteiro). É o conteúdo que sustenta o tráfego
      // orgânico entre um breaking e outro — e é exatamente aqui que o link de
      // afiliado faz sentido, porque o leitor JÁ está decidindo uma compra.
      // ---------------------------------------------------------------------
      query: 'review RTX 5070 custo beneficio',
      title: 'Review: RTX 5070 é a placa de vídeo com melhor custo-benefício de 2026',
      summary:
        'Testamos a RTX 5070 em 12 jogos a 1440p. Ela entrega 90% do desempenho da 5070 Ti por 70% do preço — com uma ressalva importante sobre VRAM.',
      category: 'tech',
      subcategory: 'hardware',
      franchises: [],
      author: 'marina-alves',
      score: 28.5,
      band: 'EVERGREEN',
      seo: 91,
      confidence: 0.74,
      termType: 'long-tail',
      triggers: [],
      sourceTier: 'tier2Press',
      sourceName: 'Testes próprios',
      hoursOld: 96,
      publish: true,
      breaking: false,
      views: 21300,
      pv24: 4100,
      format: 'review',
      tldr: [
        'A RTX 5070 entrega ~90% do desempenho da 5070 Ti custando cerca de 30% menos.',
        'A 1440p com ray tracing, todos os 12 jogos testados passaram de 60 fps.',
        'Os 12 GB de VRAM são o ponto fraco: em 4K com texturas ultra, já aparecem quedas.',
        'Vale a compra para 1440p; para 4K, o degrau para a 5080 se justifica.',
      ],
      reviewData: {
        score: 8.7,
        pros: [
          'Melhor desempenho por real da geração a 1440p',
          'Consumo 18% menor que a geração anterior',
          'Roda silenciosa mesmo sob carga longa',
        ],
        cons: ['12 GB de VRAM limitam o uso em 4K', 'Sem entrada USB-C nas versões de referência'],
      },
      content: `Passamos duas semanas com a **RTX 5070** rodando 12 jogos a 1440p e 4K, com e sem ray tracing.

## Metodologia

Todos os testes foram feitos na mesma máquina (Ryzen 7, 32 GB, SSD NVMe), com três execuções por cenário e a mediana registrada. Os jogos incluem títulos pesados de ray tracing e títulos otimizados para CPU.

## Desempenho a 1440p

É aqui que a placa brilha. Nos 12 jogos testados, nenhum ficou abaixo de 60 fps com configurações altas e ray tracing ligado.

## O problema da VRAM

Os 12 GB dão conta de 1440p com folga. A 4K com pacote de texturas ultra, porém, começam a aparecer quedas bruscas de frame time — o sintoma clássico de memória de vídeo estourando.

## Vale a pena?

Para quem joga a 1440p, é a compra mais racional da geração. Para 4K, o degrau para a 5080 se justifica.`,
    },
  ];

  for (const item of items) {
    const firstSeenAt = hoursAgo(item.hoursOld);
    const dedupeHash = `seed:${slugify(item.query)}`;

    const topic = await prisma.topic.upsert({
      where: { dedupeHash },
      update: {
        currentScore: item.score,
        currentBand: item.band,
        seoOpportunity: item.seo,
        confidence: item.confidence,
      },
      create: {
        query: item.query,
        title: item.title,
        summary: item.summary,
        aliases: [],
        dedupeHash,
        categoryId: catId(item.category),
        sourceName: item.sourceName,
        sourceTier: item.sourceTier,
        currentScore: item.score,
        currentBand: item.band,
        seoOpportunity: item.seo,
        confidence: item.confidence,
        termType: item.termType,
        emotionalTriggers: item.triggers,
        requiresHumanReview: item.triggers.length > 0,
        weightsVersion: 'v1.0.0-mvp',
        scoreSummary: `Score ${item.score.toFixed(0)} (dados de seed).`,
        status: item.publish ? 'published' : 'new',
        firstSeenAt,
        lastScoredAt: now,
        becameHotAt: item.band === 'HOT' ? hoursAgo(item.hoursOld - 0.2) : null,
        // "Em alta" começa uma faixa ANTES de "quente" (ver o campo no schema):
        // por isso 'RISING' também recebe a marca, e ela é mais ANTIGA que o
        // `becameHotAt` acima — o assunto sobe para EM ALTA e só depois estoura.
        // Sem isto, o painel local nunca exibiria o aviso "Em alta há ...".
        becameTrendingAt:
          item.band === 'HOT' || item.band === 'RISING'
            ? hoursAgo(item.hoursOld - 0.1)
            : null,
        publishedAt: item.publish ? hoursAgo(item.hoursOld - 0.4) : null,
        franchises: {
          create: item.franchises.map((slug) => ({ franchiseId: frId(slug) })),
        },
      },
    });

    if (!item.publish) continue;

    const slug = slugify(item.title);
    await prisma.article.upsert({
      where: { slug },
      update: {
        currentScore: item.score,
        currentBand: item.band,
        viewCount: item.views,
        coverImageUrl: `https://picsum.photos/seed/${slug}/1200/675`,
        videoThumbnailUrl: item.video?.thumb ?? null,
      },
      create: {
        slug,
        title: item.title,
        excerpt: item.summary,
        content: item.content,
        status: 'published',
        categoryId: catId(item.category),
        subcategoryId: subId(item.subcategory),
        authorId: auId(item.author),
        topicId: topic.id,
        format: item.format ?? 'breaking',
        tldr: item.tldr ?? [],
        reviewData: item.reviewData ?? undefined,
        // Placeholder determinístico (mesma seed = mesma imagem sempre) até o
        // pipeline real anexar imagens de fontes licenciadas por notícia.
        coverImageUrl: `https://picsum.photos/seed/${slug}/1200/675`,
        coverImageAlt: item.title,
        videoUrl: item.video?.url ?? null,
        videoThumbnailUrl: item.video?.thumb ?? null,
        videoDurationSeconds: item.video?.duration ?? null,
        isBreaking: item.breaking,
        readingMinutes: estimateReadingMinutes(item.content),
        scoreAtPublish: item.score,
        currentScore: item.score,
        currentBand: item.band,
        viewCount: item.views,
        pageviews24h: item.pv24,
        publishedAt: hoursAgo(item.hoursOld - 0.4),
        franchises: { create: item.franchises.map((s) => ({ franchiseId: frId(s) })) },
      },
    });

    // Histórico de score: 6 pontos ao longo do tempo, formando uma curva de
    // subida. É o que dá vida ao gráfico do painel editorial e permite testar
    // a visualização de tendência sem esperar o pipeline rodar por horas.
    const existingSnapshots = await prisma.scoreSnapshot.count({ where: { topicId: topic.id } });
    if (existingSnapshots === 0) {
      for (let i = 5; i >= 0; i--) {
        const progress = (6 - i) / 6;
        await prisma.scoreSnapshot.create({
          data: {
            topicId: topic.id,
            // Curva de crescimento: começa em ~45% do score final e sobe.
            score: Math.round(item.score * (0.45 + 0.55 * progress) * 10) / 10,
            band: item.band,
            seoOpportunity: item.seo,
            confidence: item.confidence,
            contributions: [],
            weightsVersion: 'v1.0.0-mvp',
            calculatedAt: hoursAgo(item.hoursOld - (item.hoursOld / 6) * (6 - i)),
          },
        });
      }
    }
  }
}

/**
 * Ofertas de afiliado fictícias, vinculadas ao review de hardware.
 *
 * DOIS DETALHES DELIBERADOS, para que o seed exercite os estados REAIS da UI:
 *
 *  1. Uma das ofertas tem o preço propositalmente VELHO (36h). Com isso, ao
 *     rodar o site, o desenvolvedor vê imediatamente como o sistema se comporta
 *     quando o preço obsoleto: o número some da página pública e a linha aparece
 *     destacada no painel. Um seed em que está tudo fresco esconderia justamente
 *     o estado que mais aparece na operação real.
 *  2. `retailerName` são nomes genéricos ("Loja Parceira A/B/C") e as URLs
 *     apontam para example.com. A rede de afiliados ainda não foi escolhida —
 *     usar "Amazon" no seed criaria a falsa impressão de uma integração que não
 *     existe, e alguém acabaria copiando isso para produção.
 */
async function seedAffiliateOffers() {
  console.log('  Ofertas de afiliado...');

  const article = await prisma.article.findFirst({
    where: { subcategory: { slug: 'hardware' } },
    orderBy: { publishedAt: 'desc' },
  });

  if (!article) {
    console.warn('    [aviso] nenhum artigo de hardware encontrado; pulando ofertas.');
    return;
  }

  const offers = [
    {
      key: 'rtx-5070-loja-a',
      productName: 'Placa de Vídeo RTX 5070 12GB',
      retailerName: 'Loja Parceira A',
      brand: 'NVIDIA',
      priceCents: 429_900,
      programCategory: 'hardware',
      // Preço conferido há 2h: estado "fresco" — a UI exibe o número.
      priceAgeHours: 2,
      availability: 'in-stock',
      position: 0,
      isHighlighted: true,
      label: 'Melhor custo-benefício',
    },
    {
      key: 'rtx-5070ti-loja-b',
      productName: 'Placa de Vídeo RTX 5070 Ti 16GB',
      retailerName: 'Loja Parceira B',
      brand: 'NVIDIA',
      priceCents: 619_900,
      programCategory: 'hardware',
      // 36h: acima do limite de 24h -> a UI pública ESCONDE o preço e o painel
      // marca a oferta como "preço vencido".
      priceAgeHours: 36,
      availability: 'unknown',
      position: 1,
      isHighlighted: false,
      label: 'Top de linha',
    },
    {
      key: 'fonte-750w-loja-c',
      productName: 'Fonte 750W 80 Plus Gold Modular',
      retailerName: 'Loja Parceira C',
      brand: null,
      priceCents: 54_900,
      programCategory: 'hardware',
      priceAgeHours: 5,
      availability: 'in-stock',
      position: 2,
      isHighlighted: false,
      label: null,
    },
  ];

  for (const o of offers) {
    const priceUpdatedAt = hoursAgo(o.priceAgeHours);

    const offer = await prisma.affiliateOffer.upsert({
      // `externalId` é o campo da fase 2; no seed ele serve de chave estável
      // para a idempotência do upsert (não temos slug em oferta).
      where: { id: `seed-offer-${o.key}` },
      update: {
        priceCents: o.priceCents,
        priceUpdatedAt,
        lastCheckedAt: priceUpdatedAt,
      },
      create: {
        id: `seed-offer-${o.key}`,
        productName: o.productName,
        retailerName: o.retailerName,
        brand: o.brand,
        priceCents: o.priceCents,
        currency: 'BRL',
        // URL de exemplo, sem rede de afiliados definida. Sempre https: link
        // comercial em http vaza o referer e permite adulteração no caminho.
        offerUrl: `https://example.com/oferta/${o.key}?ref=ortuspixel-placeholder`,
        programCategory: o.programCategory,
        availability: o.availability,
        disclosureKind: 'affiliate',
        // Placeholder determinístico, mesmo padrão das capas de artigo.
        imageUrl: `https://picsum.photos/seed/${o.key}/600/600`,
        priceUpdatedAt,
        lastCheckedAt: priceUpdatedAt,
      },
    });

    await prisma.articleAffiliateOffer.upsert({
      where: { articleId_offerId: { articleId: article.id, offerId: offer.id } },
      update: { position: o.position, isHighlighted: o.isHighlighted, label: o.label },
      create: {
        articleId: article.id,
        offerId: offer.id,
        position: o.position,
        isHighlighted: o.isHighlighted,
        label: o.label,
      },
    });
  }

  // Sincroniza a coluna derivada. No app isso é feito por `syncAffiliateFlag`
  // dentro de uma transação; aqui replicamos o efeito para o seed ficar
  // coerente sem importar a camada de repositório dentro do script.
  const activeLinks = await prisma.articleAffiliateOffer.count({
    where: { articleId: article.id, offer: { isActive: true } },
  });
  await prisma.article.update({
    where: { id: article.id },
    data: { hasAffiliateLinks: activeLinks > 0 },
  });
}

/** Tópicos ainda NÃO publicados — a fila de trabalho do painel editorial. */
async function seedPendingTopics() {
  console.log('  Tópicos pendentes (fila da redação)...');
  const categories = await prisma.category.findMany();
  const franchises = await prisma.franchise.findMany();
  const catId = (slug: string) => categories.find((c) => c.slug === slug)!.id;
  const frId = (slug: string) => franchises.find((f) => f.slug === slug)!.id;

  const pending = [
    {
      query: 'vazamento elenco Vingadores Secret Wars',
      title: 'Suposto vazamento revela elenco de Secret Wars',
      summary:
        'Post em fórum lista supostos retornos ao MCU. Não confirmado por fontes oficiais.',
      category: 'cinema-e-series',
      franchises: ['marvel'],
      score: 83.5,
      band: 'HOT',
      seo: 58,
      confidence: 0.51,
      termType: 'head',
      // Caso didático: score de faixa QUENTE, mas gatilho de vazamento +
      // confiança baixa. O sistema DEVE bloquear a automação e exigir humano.
      triggers: ['leak'],
      sourceTier: 'unverified',
      sourceName: 'Fórum 4chan (não verificado)',
      hoursOld: 0.8,
      status: 'new',
    },
    {
      query: 'Zelda live action elenco',
      title: 'Nintendo anuncia protagonista do filme live-action de Zelda',
      summary: 'Estúdio confirmou o ator escalado para viver Link nos cinemas.',
      category: 'games',
      franchises: ['the-legend-of-zelda', 'nintendo'],
      score: 71.2,
      band: 'RISING',
      seo: 63,
      confidence: 0.84,
      termType: 'mid',
      triggers: [],
      sourceTier: 'official',
      sourceName: 'Nintendo',
      hoursOld: 3,
      status: 'assigned',
    },
    {
      query: 'easter egg Star Wars Mandalorian temporada 4',
      title: 'O easter egg de Mandalorian que conecta com a trilogia original',
      summary: 'Detalhe no episódio 3 referencia diretamente O Império Contra-Ataca.',
      category: 'cinema-e-series',
      franchises: ['star-wars'],
      // Urgência baixa, SEO alto: pauta de cauda longa clássica.
      score: 38.9,
      band: 'EVERGREEN',
      seo: 79,
      confidence: 0.66,
      termType: 'long-tail',
      triggers: ['nostalgia'],
      sourceTier: 'tier2Press',
      sourceName: 'Reddit r/StarWars',
      hoursOld: 26,
      status: 'new',
    },
  ];

  for (const p of pending) {
    const dedupeHash = `seed:${slugify(p.query)}`;
    await prisma.topic.upsert({
      where: { dedupeHash },
      update: { currentScore: p.score, currentBand: p.band },
      create: {
        query: p.query,
        title: p.title,
        summary: p.summary,
        aliases: [],
        dedupeHash,
        categoryId: catId(p.category),
        sourceName: p.sourceName,
        sourceTier: p.sourceTier,
        currentScore: p.score,
        currentBand: p.band,
        seoOpportunity: p.seo,
        confidence: p.confidence,
        termType: p.termType,
        emotionalTriggers: p.triggers,
        requiresHumanReview: p.triggers.some((t) =>
          ['leak', 'controversy', 'character-death', 'cancellation'].includes(t),
        ),
        weightsVersion: 'v1.0.0-mvp',
        scoreSummary: `Score ${p.score.toFixed(0)} (dados de seed).`,
        status: p.status,
        firstSeenAt: hoursAgo(p.hoursOld),
        lastScoredAt: now,
        becameHotAt: p.band === 'HOT' ? hoursAgo(p.hoursOld - 0.1) : null,
        // Mesma regra do outro bloco de seed: 'EM ALTA' já conta, e a marca é
        // anterior à de "quente".
        becameTrendingAt:
          p.band === 'HOT' || p.band === 'RISING' ? hoursAgo(p.hoursOld - 0.05) : null,
        claimedAt: p.status === 'assigned' ? hoursAgo(p.hoursOld - 0.5) : null,
        franchises: { create: p.franchises.map((s) => ({ franchiseId: frId(s) })) },
      },
    });
  }
}

async function main() {
  console.log('Semeando banco da Ortus Pixel...\n');
  // A ordem importa: categorias antes de franquias (FK), franquias antes de
  // tópicos, e assim por diante.
  await seedCategories();
  await seedSubcategories();
  await seedAuthors();
  await seedFranchises();
  await seedReleaseCalendar();
  await seedTopicsAndArticles();
  await seedAffiliateOffers();
  await seedPendingTopics();

  const counts = {
    categorias: await prisma.category.count(),
    subcategorias: await prisma.subcategory.count(),
    franquias: await prisma.franchise.count(),
    autores: await prisma.author.count(),
    topicos: await prisma.topic.count(),
    artigos: await prisma.article.count(),
    lancamentos: await prisma.releaseEvent.count(),
    ofertas: await prisma.affiliateOffer.count(),
  };

  console.log('\nSeed concluído:', counts);
}

main()
  .catch((error) => {
    console.error('Falha no seed:', error);
    // Exit code diferente de zero é o que faz o CI/pipeline detectar a falha.
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
