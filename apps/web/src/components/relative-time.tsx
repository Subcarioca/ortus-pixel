/**
 * Exibe tempo relativo ("há 12 min").
 *
 * DECISÃO IMPORTANTE — por que isto é um Server Component e usa <time>:
 *
 * A tentação é calcular no cliente com `useEffect` para o texto ficar sempre
 * atualizado. Isso traz três problemas concretos:
 *   1. Hidratação: o servidor renderiza "há 12 min" e o cliente, 3 segundos
 *      depois, "há 13 min" — o React acusa incompatibilidade e descarta o HTML.
 *   2. Envia JavaScript ao navegador por causa de um texto de 10 caracteres.
 *   3. Piora o LCP, já que o texto só aparece após a hidratação.
 *
 * Como a página é cacheada por 60s, o desvio máximo é de 1 minuto — irrelevante
 * para o leitor. O atributo `dateTime` carrega o horário exato em ISO 8601, que
 * é o que buscadores e leitores de tela leem de fato.
 */

interface RelativeTimeProps {
  date: Date | null;
  /**
   * Padrão vazio, e isso é deliberado: no design v0.3 o horário é um item
   * DENTRO de `.meta` (a linha cinza de rodapé), não um elemento com estilo
   * próprio. Quem posiciona é o contêiner. A versão anterior tinha
   * `'card__meta'` como padrão — uma classe que nunca existiu no design
   * system e, portanto, não pintava nada.
   */
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  if (!date) return null;

  // `unstable_cache` serializa o retorno via JSON: um `Date` chega aqui como
  // string ISO em runtime, mesmo com o tipo declarando `Date`. Normalizamos
  // na borda em vez de espalhar `new Date(...)` em cada chamador.
  const normalized = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(normalized.getTime())) return null;

  const diffMs = Date.now() - normalized.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  let label: string;

  if (minutes < 1) label = 'agora';
  else if (minutes < 60) label = `há ${minutes} min`;
  else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    label = `há ${hours}h`;
  } else {
    const days = Math.floor(minutes / 1440);
    label = days === 1 ? 'ontem' : `há ${days} dias`;
  }

  return (
    <time
      dateTime={normalized.toISOString()}
      className={className}
      title={normalized.toLocaleString('pt-BR')}
    >
      {label}
    </time>
  );
}
