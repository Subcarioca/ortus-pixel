/**
 * =============================================================================
 * CORPO DO ARTIGO — renderização de Markdown
 * =============================================================================
 *
 * ESTE É O PONTO MAIS SENSÍVEL DO SITE EM TERMOS DE SEGURANÇA (OWASP A03 —
 * Injection / Cross-Site Scripting). Vale explicar com calma.
 *
 * O corpo do artigo é conteúdo editável. Se um editor for comprometido — ou se
 * um dia importarmos conteúdo de terceiros — o texto pode conter
 * `<script>roubar_cookies()</script>`. Renderizar isso como HTML executaria o
 * script no navegador de TODOS os leitores.
 *
 * ABORDAGEM ADOTADA: um parser de Markdown que produz ELEMENTOS REACT, nunca
 * uma string de HTML.
 *
 * Por que isso elimina o risco pela raiz: o React escapa automaticamente todo
 * texto interpolado em JSX. Se o conteúdo contiver `<script>`, o React renderiza
 * os caracteres literais "&lt;script&gt;" — o navegador exibe o texto e não
 * executa nada. Como NUNCA chamamos `dangerouslySetInnerHTML` aqui, não existe
 * caminho para injeção.
 *
 * POR QUE NÃO USAR `marked` + `DOMPurify`:
 *   - São duas dependências a mais na superfície de ataque (supply chain).
 *   - `DOMPurify` precisa de DOM; no servidor exige `jsdom`, que é pesado.
 *   - A segurança passaria a depender de configurar a sanitização corretamente
 *     — e configuração errada de sanitizador é uma fonte histórica de CVEs.
 *   Com elementos React, a segurança é uma propriedade da arquitetura, não uma
 *   configuração que alguém pode errar.
 *
 * LIMITAÇÃO ACEITA: suportamos um subconjunto do Markdown (títulos, parágrafos,
 * listas, negrito, itálico, links, citação, código). É o que uma redação de
 * notícias de fato usa. Se surgir necessidade de tabelas ou embeds, a extensão
 * é feita aqui, de forma controlada.
 */

import Link from 'next/link';

import { safeContentUrl } from '@/lib/safe-url';

interface ArticleBodyProps {
  markdown: string;
}

export function ArticleBody({ markdown }: ArticleBodyProps) {
  const blocks = parseBlocks(markdown);

  // RE-SKIN v0.3: `.prose`, não `.article__body`.
  //
  // `.prose` é a classe do design que estiliza o corpo por ELEMENTO
  // (`.prose p`, `.prose h2`, `.prose blockquote`, `.prose a`…). É ela que dá
  // ao texto a medida de 44rem, a entrelinha 1.75 e — o detalhe que mais
  // importa aqui — o link editorial com sublinhado carmim, que é o que separa
  // visualmente um link de matéria de um link de afiliado (§7.2 do design).
  // `.article__body` não existia na folha: o corpo do artigo saía com o
  // line-height do body e links sem nenhuma marcação além da cor herdada.
  return <div className="prose">{blocks.map((block, i) => renderBlock(block, i))}</div>;
}

type Block =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string };

/** Divide o Markdown em blocos. Trabalha por linhas: previsível e testável. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Linha em branco: separador.
    if (trimmed === '') {
      i++;
      continue;
    }

    // Bloco de código cercado por ```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++; // consome o fechamento
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      continue;
    }

    // Títulos. Só h2 e h3: o h1 é a manchete da página, e ter dois h1
    // prejudica a estrutura semântica e a leitura por buscadores.
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch?.[1] && headingMatch[2]) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length === 2 ? 2 : 3,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Citação
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('> ')) {
        quoteLines.push((lines[i] ?? '').trim().slice(2));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    // Lista não ordenada
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Lista ordenada
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Parágrafo: agrega linhas até encontrar uma em branco.
    const paragraphLines: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const current = (lines[i] ?? '').trim();
      // Para se a próxima linha iniciar outro tipo de bloco.
      if (/^(#{2,3}\s|>\s|[-*]\s|\d+\.\s|```)/.test(current) && paragraphLines.length > 0) break;
      paragraphLines.push(current);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
    }
  }

  return blocks;
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case 'heading':
      // Títulos internos recebem `id` para permitir índice clicável e links
      // diretos para a seção (útil em listicles e guias longos).
      return block.level === 2 ? (
        <h2 key={key} id={slugifyHeading(block.text)}>
          {renderInline(block.text)}
        </h2>
      ) : (
        <h3 key={key} id={slugifyHeading(block.text)}>
          {renderInline(block.text)}
        </h3>
      );

    case 'paragraph':
      return <p key={key}>{renderInline(block.text)}</p>;

    case 'quote':
      return (
        <blockquote key={key}>
          <p>{renderInline(block.text)}</p>
        </blockquote>
      );

    case 'list':
      return block.ordered ? (
        <ol key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );

    case 'code':
      // `{block.text}` é interpolação JSX: o React escapa o conteúdo.
      // Mesmo que o texto contenha uma tag, ela aparece como texto.
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
  }
}

/**
 * Formatação em linha: **negrito**, *itálico*, `código` e [links](url).
 *
 * Devolve um array de nós React — nunca uma string de HTML. Cada trecho de
 * texto vira um nó de texto escapado pelo React.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Regex única com grupos alternativos, para varrer o texto em uma passada.
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={key++}>{match[4]}</em>);
    } else if (match[6]) {
      nodes.push(<code key={key++}>{match[6]}</code>);
    } else if (match[8] && match[9]) {
      nodes.push(renderLink(match[8], match[9], key++));
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Renderiza um link com validação de protocolo.
 *
 * SEGURANÇA: sem esta checagem, `[clique](javascript:alert(1))` produziria um
 * link executável — um XSS por URL, que passa despercebido porque não parece
 * uma tag de script.
 *
 * A validação em si mora em `lib/safe-url.ts`, compartilhada com os links de
 * afiliado. Ver o comentário de lá para o motivo de NÃO existirem duas cópias
 * desta regra no projeto.
 */
function renderLink(label: string, href: string, key: number): React.ReactNode {
  const trimmed = href.trim();

  // Link interno: usa o <Link> do Next para navegação sem recarregar a página.
  // A checagem `startsWith('/')` com rejeição de '//' é importante: `//evil.com`
  // é uma URL absoluta de protocolo relativo, e trataria um destino externo
  // como se fosse rota interna (open redirect disfarçado de link interno).
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return (
      <Link key={key} href={trimmed}>
        {label}
      </Link>
    );
  }

  const { href: safeHref } = safeContentUrl(trimmed);

  // URL inválida ou com esquema proibido: renderiza como TEXTO puro. Nunca
  // criamos um link quebrado nem, pior, um link com esquema perigoso.
  if (!safeHref) {
    return <span key={key}>{label}</span>;
  }

  return (
    <a
      key={key}
      href={safeHref}
      // `noopener` evita tabnabbing (a página de destino manipular nossa aba);
      // `noreferrer` evita vazar a URL de origem.
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}

function slugifyHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
