/**
 * =============================================================================
 * ÍCONES DE NAVEGAÇÃO COMPARTILHADOS
 * =============================================================================
 *
 * `NavIcon` (o "molde": mesmo viewBox, mesma espessura de traço, sem
 * preenchimento) e `PersonIcon` nasceram em `bottom-nav.tsx` (ver o cabeçalho
 * de lá para o racional completo dos 5 ícones da barra mobile). Saíram de lá
 * porque `site-header.tsx` passou a precisar do MESMO símbolo de "Conta" no
 * desktop — duplicar o SVG à mão garantiria que um dia alguém ajustasse um
 * traço no ícone mobile e esquecesse do desktop, e as duas telas passariam a
 * mostrar pessoas visualmente diferentes para o mesmo conceito.
 *
 * Os outros quatro ícones da barra mobile (Home, Em alta, Editorias, Meus
 * hubs) continuam só em `bottom-nav.tsx`: nada mais, hoje, precisa deles fora
 * dali. Mova para cá se isso mudar — não antes.
 */
export function NavIcon({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Conta — silhueta de pessoa (cabeça + ombros), leitura imediata de "perfil". */
export function PersonIcon({ className }: { className?: string }) {
  return (
    <NavIcon className={className}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M4.5 20.2a7.5 7.5 0 0 1 15 0" />
    </NavIcon>
  );
}
