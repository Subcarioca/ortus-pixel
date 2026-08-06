/**
 * =============================================================================
 * TEMA CLARO/ESCURO — contrato compartilhado entre servidor e cliente
 * =============================================================================
 *
 * TRÊS ESTADOS, não dois. "Sistema" é o padrão e não é firula:
 *
 *   system → segue `prefers-color-scheme` do aparelho. Quem ativou o modo
 *            escuro no celular espera que TODO site respeite isso; forçar o
 *            claro para essa pessoa é o mesmo erro de forçar o escuro para quem
 *            prefere claro.
 *   light  → escolha explícita do leitor, vence o sistema.
 *   dark   → idem.
 *
 * O design v0.2 definiu tema CLARO como padrão de marca e o escuro como opção
 * (v0.1 era dark-first). Com `color-scheme: light dark` no `:root`, o navegador
 * já resolve isso sozinho: sem `data-theme`, o valor efetivo é o do sistema,
 * começando no claro. Nós só gravamos `data-theme` quando o leitor ESCOLHE.
 *
 * COMO A TROCA ACONTECE, NA PRÁTICA: os tokens usam `light-dark(claro, escuro)`
 * e a única coisa que muda é a propriedade `color-scheme` do `<html>`. Não há
 * paleta duplicada, não há classe `.dark` espalhada por componente, e nenhum
 * componente React precisa saber que existe tema.
 */

export const THEME_VALUES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_VALUES)[number];

/** Chave no localStorage. Constante para o script inline e o React não divergirem. */
export const THEME_STORAGE_KEY = 'canalnerd-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_VALUES.includes(value as ThemePreference);
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Escuro',
};

/**
 * Script INLINE injetado no `<head>`, antes de qualquer pintura.
 *
 * POR QUE ELE PRECISA SER INLINE E SÍNCRONO:
 *
 * As páginas do site são estáticas e servidas pela CDN — o HTML é o mesmo para
 * todo mundo, e o servidor não sabe (nem deve saber) qual tema este leitor
 * escolheu. A preferência vive no navegador.
 *
 * Se aplicássemos o tema depois da hidratação do React, o leitor de tema escuro
 * veria a página CLARA por 200-500ms e então ela piscaria para escuro. É o
 * clássico FOUC ("flash of unstyled content"), e num portal lido à noite ele é
 * literalmente ofensivo: um flash branco em tela cheia às 2h da manhã.
 *
 * Um `<script src>` externo não resolve: ele é baixado depois do HTML e
 * bloquearia a renderização de qualquer jeito, com uma ida à rede a mais.
 *
 * POR QUE ISSO NÃO É "JS PESADO" (o projeto persegue JS quase zero): são ~230
 * bytes, executam uma vez, não fazem I/O e não sobem para o bundle do React.
 *
 * POR QUE USAR COOKIE SERIA PIOR: ler cookie no servidor tornaria TODA página
 * dinâmica (o Next desliga a renderização estática ao ver `cookies()`), o que
 * destruiria o cache de CDN — trocaríamos um flash de 300ms por um site inteiro
 * mais lento para todo mundo.
 *
 * SEGURANÇA: a string é uma constante do nosso código, sem interpolação de
 * dado externo — não há caminho para injeção. Ainda assim, ela obriga a CSP a
 * permitir este script (via hash ou nonce); isso está registrado nas pendências
 * de CSP do README, para que ninguém "endureça" a política e quebre o tema.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
