/**
 * =============================================================================
 * SITEMAP DINÂMICO
 * =============================================================================
 *
 * Requisito do briefing: "sitemap dinâmico atualizado a cada publicação, ping
 * automático para Google/Bing em breaking news".
 *
 * Gerado pelo Next a partir desta função e invalidado por evento quando um
 * artigo é publicado (tag `sitemap`).
 *
 * SOBRE `changeFrequency` E `priority`: o Google declarou publicamente que
 * ignora os dois. Mantemos porque o Bing e outros ainda os consideram, e o
 * custo é zero. O que realmente importa para o Google é `lastModified`, que é
 * como ele decide o que revisitar — por isso ele vem do `updatedAt` real do
 * artigo, e não de `new Date()`.
 *
 * LIMITE DE ESCALA: um sitemap suporta 50 mil URLs. Num portal de alta cadência
 * isso é atingido em 1 a 2 anos. O plano de particionamento (sitemap index +
 * arquivos por mês) está descrito no README, seção "Escalabilidade".
 */

import type { MetadataRoute } from 'next';

import { CATEGORIES, absoluteUrl, routes } from '@subcarioca/core';
import { prisma } from '@subcarioca/db';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // ---- Páginas fixas ----
  entries.push(
    {
      url: absoluteUrl(routes.home()),
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: absoluteUrl(routes.trending()),
      lastModified: new Date(),
      // Muda continuamente com o score — é a página mais dinâmica do site.
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: absoluteUrl(routes.methodology()),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: absoluteUrl(routes.newsroom()),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  );

  // ---- Categorias ----
  for (const category of CATEGORIES) {
    entries.push({
      url: absoluteUrl(routes.category(category.slug)),
      lastModified: new Date(),
      changeFrequency: 'hourly',
      // Prioridade proporcional à importância de negócio: Games (prioridade 1)
      // recebe 0.9; Eventos (prioridade 5), 0.5.
      priority: Math.max(0.5, 1 - category.monitoringPriority * 0.1),
    });
  }

  /**
   * As entradas vindas do banco ficam dentro de um `try`.
   *
   * POR QUÊ: sem isso, o `next build` FALHA se o banco estiver indisponível no
   * momento da compilação — o que é comum em CI, onde o runner normalmente não
   * tem acesso ao Postgres de produção. Quebrar o deploy inteiro porque um
   * sitemap não pôde ser gerado é um péssimo negócio.
   *
   * Degradação escolhida: publicamos o sitemap apenas com as páginas fixas
   * (home, categorias, institucionais), que são conhecidas em tempo de código.
   * Como o sitemap é revalidado de hora em hora e invalidado a cada publicação,
   * a versão completa volta sozinha assim que o banco responder.
   */
  try {
    // ---- Franquias (hubs) ----
    const franchises = await prisma.franchise.findMany({
      select: { slug: true, updatedAt: true },
    });

    for (const franchise of franchises) {
      entries.push({
        url: absoluteUrl(routes.franchise(franchise.slug)),
        lastModified: franchise.updatedAt,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }

    // ---- Artigos ----
    const articles = await prisma.article.findMany({
      where: { status: 'published', noIndex: false },
      select: {
        slug: true,
        updatedAt: true,
        currentScore: true,
        category: { select: { slug: true } },
      },
      orderBy: { publishedAt: 'desc' },
      // Teto de segurança: evita estourar o limite do protocolo enquanto o
      // particionamento não é implementado.
      take: 45_000,
    });

    for (const article of articles) {
      entries.push({
        url: absoluteUrl(routes.article(article.category.slug, article.slug)),
        lastModified: article.updatedAt,
        changeFrequency: 'weekly',
        // Conteúdo com score alto ganha prioridade maior — é um sinal a mais
        // para o rastreador priorizar o que está em alta.
        priority: article.currentScore >= 80 ? 0.9 : article.currentScore >= 60 ? 0.8 : 0.6,
      });
    }
  } catch (error) {
    console.error(
      '[sitemap] banco indisponível; publicando apenas as páginas fixas:',
      error instanceof Error ? error.message : error,
    );
  }

  return entries;
}
