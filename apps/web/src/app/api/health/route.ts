/**
 * =============================================================================
 * GET /api/health — o banco está de pé?
 * =============================================================================
 *
 * Existe porque o incidente de 2026-08 (banco de produção inacessível)
 * levou horas para diagnosticar: os sintomas eram 404 em artigo/categoria,
 * indistinguíveis à primeira vista de "conteúdo realmente ausente". Com esta
 * rota, a mesma pergunta ("é o banco?") vira uma checagem de 5 segundos.
 *
 * Resposta minimalista de propósito: nenhuma mensagem de erro, stack trace ou
 * string de conexão. Isso é público e sem autenticação — vazar detalhe de
 * infraestrutura aqui seria trocar um incidente por outro.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@subcarioca/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { db: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[health] banco inacessível:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { db: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
