'use client';

/**
 * =============================================================================
 * CAMPO DE IMAGEM — colar a URL **ou** enviar o arquivo
 * =============================================================================
 *
 * Um componente só, usado na capa da matéria (nos dois formulários) e no bloco
 * de imagem do editor. Fazer três cópias disto seria garantir que uma delas
 * ficasse sem a mensagem de erro certa, sem a prévia, ou aceitando um formato
 * que o servidor recusa.
 *
 * -----------------------------------------------------------------------------
 * POR QUE OS DOIS CAMINHOS CONVIVEM, E NENHUM SUBSTITUI O OUTRO
 * -----------------------------------------------------------------------------
 * O envio de arquivo resolve o caso do dia a dia (a captura de tela, a foto que
 * a assessoria mandou por e-mail). A URL continua indispensável para a imagem
 * que JÁ está publicada num CDN autorizado — reenviá-la criaria uma segunda
 * cópia da mesma imagem no nosso disco, sem ganho nenhum.
 *
 * -----------------------------------------------------------------------------
 * A PRÉVIA É UM `<img>` CRU, E NÃO O `next/image`
 * -----------------------------------------------------------------------------
 * De propósito. O `next/image` LANÇA em tempo de renderização quando o host não
 * está declarado em `remotePatterns` — e aqui o valor no campo é, por
 * definição, algo que a pessoa acabou de digitar e que pode estar errado. Uma
 * prévia que derruba a tela do painel ao ver uma URL inválida seria o oposto do
 * que uma prévia existe para fazer. Fora da otimização, esta imagem é vista por
 * uma pessoa da redação, uma vez, ao editar — o custo de não otimizar é zero.
 */

import { useRef, useState } from 'react';

interface ImageUrlFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Classe do contêiner, para encaixar no grid do formulário. */
  className?: string;
  /** Texto de ajuda extra, específico de cada uso. */
  hint?: string;
}

export function ImageUrlField({ label, value, onChange, className, hint }: ImageUrlFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(file: File) {
    if (busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const body = new FormData();
      body.append('file', file);

      // Sem `Content-Type` no cabeçalho: quem precisa definir a fronteira do
      // multipart é o navegador. Declará-lo à mão quebra o parser do servidor —
      // e o erro resultante ("não foi possível ler o arquivo") não aponta para
      // a causa em lugar nenhum.
      const response = await fetch('/api/admin/uploads', { method: 'POST', body });
      const data = (await response.json()) as { ok: boolean; url?: string; message?: string };

      if (data.ok && data.url) {
        onChange(data.url);
        setMessage(data.message ?? 'Imagem enviada.');
      } else {
        setMessage(data.message ?? 'Não foi possível enviar a imagem.');
      }
    } catch {
      setMessage('Não foi possível falar com o servidor. A imagem não foi enviada.');
    } finally {
      setBusy(false);
      // Limpa o `<input type="file">` para que escolher O MESMO arquivo de novo
      // dispare `change` outra vez. Sem isto, corrigir a imagem, tentar reenviar
      // a mesma e não acontecer nada é um bug que parece do servidor.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={className}>
      <label>
        {label} (URL)
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://... ou envie um arquivo abaixo"
        />
      </label>

      <div className="admin-actions">
        <input
          ref={inputRef}
          type="file"
          // O `accept` é conveniência do seletor de arquivos, NÃO validação:
          // qualquer pessoa troca o filtro na janela do sistema. Quem valida de
          // verdade é o servidor, pelos bytes do arquivo (server/uploads.ts).
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          aria-label={`Enviar arquivo de imagem para ${label.toLowerCase()}`}
        />
        {value && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onChange('');
              setMessage(null);
            }}
            disabled={busy}
          >
            Remover imagem
          </button>
        )}
      </div>

      {busy && (
        <p className="form-hint" role="status">
          Enviando…
        </p>
      )}

      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}

      {hint && <p className="form-hint">{hint}</p>}

      {value && (
        // eslint-disable-next-line @next/next/no-img-element -- prévia do painel; ver o cabeçalho do arquivo
        <img
          src={value}
          alt=""
          // A prévia é decorativa AQUI (alt vazio de propósito): o texto
          // alternativo de verdade é um campo próprio do formulário, e repeti-lo
          // na prévia faria o leitor de tela anunciar a mesma coisa duas vezes.
          className="admin-image-preview"
          style={{ maxWidth: '220px', maxHeight: '140px', objectFit: 'cover', marginTop: '8px' }}
          onError={(event) => {
            // Imagem que não carrega some da tela em vez de deixar o ícone de
            // quebrado: o campo já mostra a URL, e um ícone de erro sugeriria
            // falha do sistema quando o mais provável é URL ainda incompleta.
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
    </div>
  );
}
