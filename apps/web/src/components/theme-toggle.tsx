'use client';

/**
 * =============================================================================
 * CONTROLE DE TEMA — o único componente de cliente adicionado nesta entrega
 * =============================================================================
 *
 * É um dos poucos `'use client'` do projeto, e o custo foi pesado antes de
 * aceitá-lo: cerca de 1 KB de JS, sem `useEffect` de sincronização pesada e sem
 * biblioteca de tema (next-themes e similares trazem contexto, provider e
 * re-render de árvore inteira para resolver um problema de uma linha de CSS).
 *
 * DECISÕES DE UX (design v0.2 + heurísticas de Nielsen):
 *
 *  1. TRÊS OPÇÕES VISÍVEIS, não um interruptor de duas posições. Um toggle
 *     binário torna impossível VOLTAR para "seguir o sistema" depois de tocar
 *     nele uma vez — o usuário fica preso a uma escolha que talvez tenha feito
 *     por curiosidade. (Nielsen #3: controle e liberdade.)
 *  2. O estado atual é anunciado por `aria-pressed`, não só pela cor de fundo.
 *  3. Alvos de 38px+ de altura, dentro da regra de toque do design system.
 *
 * POR QUE ESTE COMPONENTE NÃO RENDERIZA NADA NO PRIMEIRO PAINT DO SERVIDOR:
 * o servidor não sabe a preferência (ela vive no localStorage). Se
 * renderizássemos "Sistema" como selecionado no HTML e o leitor tivesse
 * escolhido "Escuro", haveria divergência de hidratação — o React reclamaria no
 * console e, pior, o botão apareceria marcado errado por um instante.
 *
 * A saída é marcar a seleção SÓ depois da montagem. O rótulo e os três botões
 * já vêm no HTML (nada "pula" na tela); apenas o destaque de selecionado surge
 * no mesmo frame da hidratação.
 */

import { useEffect, useState } from 'react';

import {
  THEME_LABELS,
  THEME_STORAGE_KEY,
  THEME_VALUES,
  isThemePreference,
  type ThemePreference,
} from '@/lib/theme';

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  // Lê a preferência salva UMA vez, após a montagem.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      setPreference(isThemePreference(stored) ? stored : 'system');
    } catch {
      // localStorage pode lançar (modo privado antigo do Safari, storage
      // desativado por política corporativa). O site inteiro precisa continuar
      // funcionando: caímos no padrão e seguimos a vida.
      setPreference('system');
    }
  }, []);

  function apply(next: ThemePreference) {
    setPreference(next);

    // 'system' significa AUSÊNCIA de `data-theme`: sem o atributo, vale o
    // `color-scheme: light dark` do :root, que delega ao aparelho.
    if (next === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }

    try {
      if (next === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Sem persistência, o tema vale só nesta navegação. Degradar é melhor do
      // que estourar um erro na cara de quem só queria trocar a cor do site.
    }
  }

  return (
    <fieldset className="theme-field">
      <legend>Aparência</legend>
      <div className="theme-seg" role="group">
        {THEME_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => apply(value)}
            // `aria-pressed` comunica o estado a leitores de tela — cor de
            // fundo sozinha não comunica nada para quem não enxerga.
            // RE-SKIN v0.3: sem classe de estado. Quem pinta o botão ativo é
            // `.theme-seg button[aria-pressed="true"]` — o estilo lê o MESMO
            // atributo que o leitor de tela lê, então é impossível o visual e a
            // acessibilidade discordarem. Uma classe `theme-seg__on` paralela
            // seria uma segunda fonte de verdade para o mesmo estado.
            aria-pressed={preference === value}
          >
            {THEME_LABELS[value]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
