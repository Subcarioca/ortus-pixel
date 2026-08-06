/**
 * =============================================================================
 * SEÇÃO DE COMENTÁRIOS — Server Component
 * =============================================================================
 *
 * A lista inteira é renderizada no servidor: zero JavaScript para LER
 * comentários. Só quem decide escrever carrega o formulário (que é o único
 * pedaço de cliente aqui). Numa página com 60 comentários, isso é a diferença
 * entre uma página de notícia e um aplicativo.
 *
 * SEGURANÇA (OWASP A03 — XSS): o conteúdo é interpolado em JSX como TEXTO. O
 * React escapa tudo. Não há `dangerouslySetInnerHTML`, não há Markdown, não há
 * autolink. Um comentário com `<script>` aparece literalmente como texto — é a
 * mesma garantia estrutural do corpo do artigo (ADR 0005), e aqui ela importa
 * ainda mais, porque comentário é conteúdo de terceiro por definição.
 *
 * POR QUE NÃO RENDERIZAMOS LINKS EM COMENTÁRIO: transformar URL em `<a>` num
 * campo aberto é o convite mais direto que existe para spam de SEO. Enquanto
 * não houver moderação com equipe, a URL aparece como texto — quem quiser
 * seguir, copia. O custo para o leitor honesto é um Ctrl+C; o custo do
 * contrário seria o site virar farm de backlink.
 *
 * PRIVACIDADE: o avatar do provedor NÃO é carregado. Renderizar imagem
 * hospedada no CDN do Discord/Google faria o navegador de todo leitor entregar
 * o IP dele a terceiros só por ler a página. Usamos iniciais. Ver
 * server/reader-session.ts.
 */

import { COMMENT_PROVIDER_LABELS, type CommentView } from '@canalnerd/core';

import { RelativeTime } from '@/components/relative-time';
import { CommentForm } from './comment-form';
import { CommentLogin } from './comment-login';

interface CommentSectionProps {
  articleId: string;
  comments: CommentView[];
  /** Sessão do leitor, resolvida no servidor. `null` = anônimo. */
  session: { displayName: string; provider: string } | null;
  /** Provedores com credencial configurada. Vazio = login indisponível. */
  providers: string[];
  /** Caminho atual, para voltar ao lugar certo depois do login. */
  returnTo: string;
}

export function CommentSection({
  articleId,
  comments,
  session,
  providers,
  returnTo,
}: CommentSectionProps) {
  return (
    <section id="comentarios" className="section" aria-labelledby="comentarios-titulo">
      {/* RE-SKIN v0.3: `.section-head` / `.section-title` (com hífen) são as
          classes do design. As versões com `__` não existiam na folha, então
          este cabeçalho não era uma linha flex e o contador ficava colado ao
          título em vez de separado como número de sistema. */}
      <div className="section-head">
        <h2 id="comentarios-titulo" className="section-title">
          Comentários
          {comments.length > 0 && (
            <span className="cmt__time"> · {comments.length}</span>
          )}
        </h2>
      </div>

      {session ? (
        <CommentForm articleId={articleId} displayName={session.displayName} />
      ) : (
        <CommentLogin providers={providers} returnTo={returnTo} />
      )}

      {comments.length === 0 ? (
        <p className="empty-state">
          Ninguém comentou ainda. Puxe a conversa.
        </p>
      ) : (
        <ol className="cmt-list">
          {comments.map((comment) => (
            <li key={comment.id} className="cmt">
              {/* Iniciais em vez de foto — ver nota de privacidade no topo. */}
              <span className="cmt__avatar" aria-hidden="true">
                {initials(comment.author.displayName)}
              </span>

              <div>
                <div className="cmt__head">
                  <span className="cmt__name">{comment.author.displayName}</span>
                  <span className="cmt__provider">
                    {COMMENT_PROVIDER_LABELS[comment.author.provider]}
                  </span>
                  <RelativeTime date={comment.createdAt} className="cmt__time" />
                </div>

                {/* `{comment.content}` é interpolação JSX: escapada pelo React.
                    A quebra de linha do autor é preservada pelo CSS
                    (`white-space: pre-wrap`), não por HTML. */}
                <p className="cmt__body">{comment.content}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Até duas iniciais do nome de exibição. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
