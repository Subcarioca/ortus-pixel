import type { ContentFormat } from '@subcarioca/core';

/**
 * Rótulos dos formatos de conteúdo para os formulários do painel.
 *
 * Vive num arquivo próprio porque DOIS formulários o usam (criar e editar), e
 * uma lista divergente entre eles produziria um bug particularmente irritante:
 * o editor criaria a matéria como "Guia" e, ao reabrir para editar, veria outro
 * formato selecionado — sem nada ter mudado no banco.
 *
 * O tipo `ContentFormat` vem do core, então o TypeScript recusa um formato
 * inventado aqui e cobra a atualização desta lista quando um novo for criado lá.
 */
export const FORMAT_OPTIONS: { value: ContentFormat; label: string }[] = [
  { value: 'breaking', label: 'Notícia quente (breaking)' },
  { value: 'live', label: 'Cobertura ao vivo' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'review', label: 'Análise / review' },
  { value: 'listicle', label: 'Lista' },
  { value: 'theory', label: 'Teoria' },
  { value: 'comparison', label: 'Comparativo' },
  { value: 'guide', label: 'Guia' },
];

/** Formatos em que o TL;DR é obrigatório (regra em core/presentation.ts). */
export function formatRequiresTldr(format: string): boolean {
  return format === 'breaking' || format === 'review';
}
