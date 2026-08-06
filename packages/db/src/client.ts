/**
 * Cliente Prisma compartilhado (singleton).
 *
 * POR QUE O SINGLETON GLOBAL PARECE GAMBIARRA MAS NÃO É:
 *
 * Em desenvolvimento, o Next.js recarrega os módulos a cada alteração (HMR).
 * Se instanciássemos `new PrismaClient()` no escopo do módulo, cada recarga
 * criaria um pool de conexões novo, os antigos não seriam liberados e em poucos
 * minutos o Postgres derrubaria a aplicação com "too many connections" — um dos
 * erros mais comuns e mais confusos de quem usa Prisma com Next.
 *
 * Guardar a instância em `globalThis` faz a referência sobreviver ao HMR.
 * Em produção não há recarga de módulo, então o caminho é o normal.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Em dev, logamos as queries para flagrar N+1 cedo. Em produção só erros e
    // avisos: log de query em portal de notícias sob pico vira gargalo de I/O
    // e ainda pode vazar dado sensível para o agregador de logs.
    log:
      process.env.NODE_ENV === 'development'
        ? [{ level: 'query', emit: 'event' }, 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from '@prisma/client';
export { PrismaClient } from '@prisma/client';
