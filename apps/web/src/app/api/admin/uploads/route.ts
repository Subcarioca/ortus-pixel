/**
 * =============================================================================
 * POST /api/admin/uploads — envio de imagem pelo painel
 * =============================================================================
 *
 * O QUE MUDA PARA A REDAÇÃO: até aqui, publicar uma imagem exigia que ela já
 * estivesse hospedada em algum lugar autorizado, e o painel só aceitava a URL.
 * Na prática isso significava "peça para alguém subir no servidor de imagens" —
 * um passo fora do sistema, feito por outra pessoa, no meio de um fluxo de
 * notícia urgente. Agora o arquivo vai direto do computador de quem escreve.
 *
 * A parte perigosa (validar bytes, gerar nome, escolher onde gravar) mora em
 * `server/uploads.ts`, com o racional completo de segurança. Esta rota é a
 * casca: autentica, lê o multipart e traduz o resultado em resposta HTTP.
 *
 * -----------------------------------------------------------------------------
 * POR QUE `formData()` E NÃO UM PARSER DE MULTIPART
 * -----------------------------------------------------------------------------
 * O runtime do Next já implementa `Request.formData()` sobre a API de plataforma
 * — a mesma que o navegador usa. Trazer `multer`/`busboy` acrescentaria
 * dependência (e superfície de supply chain) para reimplementar algo que já
 * está no runtime. O custo conhecido é que o corpo é materializado em memória;
 * como o teto é de 1,8 MB e o Nginx corta em 2 MB antes de chegar aqui, esse
 * custo tem limite conhecido.
 *
 * -----------------------------------------------------------------------------
 * QUEM PODE
 * -----------------------------------------------------------------------------
 * Qualquer conta ATIVA da redação com `verMaterias` — a mesma capacidade exigida
 * para editar matéria. Não faria sentido alguém poder escrever a matéria e não
 * poder colocar a imagem dela; e ninguém que não pode escrever tem por que
 * gravar arquivo no nosso disco.
 */

import { NextResponse } from 'next/server';

import { requireStaffApi } from '@/server/staff-auth';
import { checkRateLimit, getClientIp } from '@/server/security';
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  saveUploadedImage,
} from '@/server/uploads';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await requireStaffApi('verMaterias');
  if (!guard.ok) return guard.response;

  /**
   * RATE LIMIT MESMO SENDO ROTA AUTENTICADA.
   *
   * A sessão prova QUEM é, não prova que a intenção é boa nem que o cliente não
   * está com defeito. Um laço acidental no painel (ou uma conta comprometida)
   * encheria o disco do servidor em minutos, e disco cheio derruba o site
   * inteiro — inclusive o banco, se compartilharem volume. 40 imagens em 5
   * minutos é folgado para o trabalho real e fecha o cenário de laço.
   *
   * A chave é a CONTA, não o IP: a redação inteira pode estar atrás do mesmo IP
   * de escritório, e limitar por IP puniria todo mundo pelo erro de um.
   */
  const limit = checkRateLimit(`upload:${guard.user.id}`, {
    maxRequests: 40,
    windowSeconds: 300,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: `Muitos envios seguidos. Tente de novo em ${limit.resetInSeconds}s.`,
      },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Cai aqui quando o corpo não é multipart válido — inclusive quando o
    // Nginx cortou o envio por tamanho no meio do caminho.
    return NextResponse.json(
      {
        ok: false,
        message:
          'Não foi possível ler o arquivo. Se a imagem for grande, reduza o tamanho e tente de novo.',
      },
      { status: 400 },
    );
  }

  const file = form.get('file');

  // `instanceof File` distingue arquivo de campo de texto: um cliente que mande
  // `file=alguma-coisa` não pode chegar ao gravador.
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, message: 'Nenhum arquivo foi enviado.' },
      { status: 400 },
    );
  }

  // Checagem BARATA antes de materializar os bytes. O `file.size` vem do
  // envelope e não é prova de nada (o validador confere o tamanho real depois),
  // mas evita ler 50 MB na memória só para recusar em seguida.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        message:
          `A imagem passa do limite de ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1)} MB. ` +
          'Reduza o tamanho antes de enviar.',
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /**
   * DUAS CLASSES DE FALHA, DUAS RESPOSTAS DIFERENTES — e confundi-las manda o
   * editor consertar a coisa errada:
   *
   *   `{ ok: false }`  → problema com o ARQUIVO ou com a CONFIGURAÇÃO conhecida
   *                      (grande demais, não é imagem, UPLOADS_DIR ausente). A
   *                      mensagem já está escrita para um humano ler.
   *   EXCEÇÃO          → o disco recusou a escrita. O caso esperado aqui é a
   *                      raiz de uploads não EXISTIR no servidor (ENOENT) ou não
   *                      ter permissão (EACCES) — ou seja: alguém configurou
   *                      `UPLOADS_DIR` mas ninguém criou a pasta. Sem este
   *                      tratamento, isso viraria um 500 sem corpo, que a tela
   *                      traduz como "Erro de conexão." e manda tentar de novo
   *                      para sempre.
   */
  let saved: Awaited<ReturnType<typeof saveUploadedImage>>;
  try {
    saved = await saveUploadedImage({ bytes, originalName: file.name });
  } catch (error) {
    console.error('[uploads] falha ao gravar no disco:', error);
    return NextResponse.json(
      {
        ok: false,
        message:
          'O servidor não conseguiu gravar a imagem. A pasta de uploads pode não existir ou ' +
          'estar sem permissão de escrita — isto é configuração do servidor, não problema do seu arquivo. ' +
          'Avise um administrador e, por ora, use a URL de uma imagem já hospedada.',
      },
      { status: 500 },
    );
  }

  if (!saved.ok) {
    return NextResponse.json({ ok: false, message: saved.message }, { status: 400 });
  }

  /**
   * A CONFIRMAÇÃO GANHOU UMA SEGUNDA FRASE — o aviso de resolução.
   *
   * Motivo (investigação da queixa "as imagens das matérias estão pixeladas"):
   * esta rota não redimensiona nem recomprime nada, então a nitidez final da
   * capa é EXATAMENTE a do arquivo que chegou aqui. Uma capa de 900px é
   * esticada pelo navegador em qualquer tela de alta densidade, e não existe
   * ajuste de front-end que conserte isso depois. O racional completo, o porquê
   * de avisar em vez de recusar e os números dos limiares estão em
   * `coverResolutionAdvice` (server/upload-rules.ts).
   *
   * As dimensões vão no corpo além do texto: a tela de hoje só mostra
   * `message`, mas o dado bruto é o que permite a qualquer tela futura decidir
   * sozinha o que fazer com ele.
   */
  const message = saved.resolutionAdvice
    ? `Imagem enviada (${(saved.bytes / 1024).toFixed(0)} KB). ${saved.resolutionAdvice}`
    : `Imagem enviada (${(saved.bytes / 1024).toFixed(0)} KB).`;

  return NextResponse.json({
    ok: true,
    url: saved.url,
    message,
    width: saved.dimensions?.width ?? null,
    height: saved.dimensions?.height ?? null,
    accepted: ACCEPTED_IMAGE_EXTENSIONS,
  });
}
