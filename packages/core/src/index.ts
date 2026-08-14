/**
 * Ponto único de entrada do pacote `@subcarioca/core`.
 *
 * Manter um barrel file explícito (em vez de deixar cada consumidor importar
 * caminhos internos como `@subcarioca/core/src/signals.js`) nos dá liberdade
 * para reorganizar os arquivos internos sem quebrar quem consome o pacote.
 */
export * from './taxonomy';
export * from './signals';
export * from './scoring-types';
export * from './domain';
export * from './presentation';
export * from './monetization';
export * from './community';
export * from './staff';
export * from './blocks';
export * from './content-sensitivity';
export * from './editorial-risk';
export * from './topic-origin';
export * from './content-origin';
export * from './analytics';
export * from './recommendation';
export * from './routes';
export * from './utils';
