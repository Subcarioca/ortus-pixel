import 'server-only';

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ACCEPTED_IMAGE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_PREFIX,
  coverResolutionAdvice,
  detectImageFormat,
  imageDimensions,
  uploadRoot,
} from './upload-rules';

/**
 * =============================================================================
 * ARMAZENAMENTO DE IMAGEM ENVIADA PELO PAINEL
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * A DECISÃO DE INFRAESTRUTURA, E O ERRO QUE QUASE FOI COMETIDO DUAS VEZES
 * -----------------------------------------------------------------------------
 * O pedido era simples: "deixe o redator enviar o arquivo, não só colar a URL".
 * O destino, não. Três caminhos foram considerados:
 *
 *   (a) OBJECT STORAGE (S3, R2, Spaces). É a resposta certa em escala e não
 *       existe neste projeto hoje: não há bucket, não há credencial, não há
 *       linha de orçamento. Implementar contra um serviço que ninguém contratou
 *       seria escrever código que nunca roda — e, pior, dar a impressão de que
 *       o problema está resolvido.
 *
 *   (b) `public/uploads`, o caminho que todo tutorial ensina. NÃO FUNCIONA: o
 *       Next serve `public/` a partir do que existia no momento do BUILD.
 *       Arquivo criado depois, em tempo de execução, não é servido — a
 *       documentação do próprio Next diz isso com todas as letras ("only assets
 *       that are in the public directory at build time will be served"). O
 *       sintoma seria cruel: o upload responde 200, o painel mostra a URL, e a
 *       imagem dá 404 na matéria publicada.
 *
 *   (c) DIRETÓRIO ABSOLUTO FORA DA ÁRVORE DO APP + ROTA QUE SERVE OS BYTES. É o
 *       que está implementado, e o caminho vem de `UPLOADS_DIR`.
 *
 * ⚠ POR QUE (c) EXIGE UM CAMINHO ABSOLUTO CONFIGURADO, E NÃO UMA PASTA `var/`
 * DENTRO DO PROJETO — esta é a parte que só ficou clara depois de conferir o
 * ambiente de verdade, e ela vale mais que o resto do arquivo:
 *
 *   A produção NÃO é um VPS com o repositório clonado em disco. (O `README.md` e
 *   o `ecosystem.config.js` descrevem esse caminho, mas ele é uma OPÇÃO
 *   documentada, não o que está no ar — a conta não tem VPS nenhum.) O que roda
 *   é o "Node.js App Hosting" da Hostinger: hospedagem compartilhada em que cada
 *   `git push` dispara um BUILD NOVO, com identificador próprio, numa árvore
 *   própria; `hbuilds/current` é um link simbólico que passa a apontar para o
 *   build recém-criado.
 *
 *   Consequência: QUALQUER caminho relativo à raiz do app — `public/uploads`,
 *   `var/uploads`, `.next/uploads`, tanto faz — vive numa árvore que é
 *   RECRIADA DO ZERO no deploy seguinte. As imagens não seriam apagadas por
 *   erro de ninguém: elas simplesmente ficariam na árvore antiga, para a qual
 *   nada mais aponta. É o MESMO bug do item (b), só que adiado — em vez de
 *   quebrar na hora (404 imediato, que alguém nota no mesmo dia), ele quebraria
 *   semanas depois, no primeiro deploy após a primeira imagem, com um monte de
 *   matérias publicadas apontando para arquivos que não existem mais.
 *
 *   Por isso `UPLOADS_DIR` é OBRIGATÓRIO em produção e precisa apontar para
 *   fora da árvore de builds — na prática, um diretório irmão de `public_html`,
 *   criado UMA vez à mão, fora do processo de deploy. Como nada no deploy o
 *   cria, nada no deploy o destrói.
 *
 * FALHA ALTO, NUNCA EM SILÊNCIO: sem `UPLOADS_DIR` em produção, o upload é
 * RECUSADO com mensagem explícita, no mesmo espírito do `REVALIDATE_SECRET`
 * ("sem segredo configurado, o endpoint fica desligado"). A alternativa — cair
 * num caminho padrão — é justamente o que faria o bug acima voltar sem aviso.
 *
 * O QUE ESSA ESCOLHA CUSTA, dito sem maquiagem:
 *   - Os bytes da imagem passam pelo processo Node em vez de saírem do disco por
 *     um servidor estático. Numa matéria muito acessada, isso é CPU e memória
 *     que o processo gastaria melhor renderizando página. Nesta hospedagem não
 *     há Nginx nosso para aliviar isso (ver o rodapé do arquivo).
 *   - O armazenamento é LOCAL à conta de hospedagem. No dia em que existir uma
 *     segunda instância, as duas precisarão enxergar o mesmo caminho (ou o
 *     caminho (a)). Está registrado como limitação conhecida, não como surpresa.
 *
 * -----------------------------------------------------------------------------
 * SEGURANÇA — o que um upload autenticado ainda pode fazer de errado
 * -----------------------------------------------------------------------------
 * Só a redação envia arquivo. Isso reduz o risco, não o elimina: uma conta de
 * redator comprometida não pode virar XSS armazenado no domínio principal (que
 * roubaria a sessão do painel de todo mundo, inclusive a do administrador).
 *
 *   A03 (Injeção/XSS) — o tipo é decidido pelos BYTES do arquivo (assinatura
 *        binária), nunca pelo `Content-Type` que o navegador declarou nem pela
 *        extensão do nome enviado. SVG é RECUSADO de propósito: é XML, executa
 *        `<script>` e é o formato de imagem que mais vira XSS.
 *   A01 (Controle de acesso) — o nome do arquivo é gerado por nós, com bytes
 *        aleatórios. Nada do nome original chega ao disco, o que fecha de uma
 *        vez travessia de caminho (`../../.env`), NUL byte e nome com extensão
 *        dupla (`foto.jpg.php`).
 *   A04 (Design inseguro) — teto de tamanho conferido ANTES de escrever
 *        (`MAX_UPLOAD_BYTES`, em upload-rules.ts).
 *   A05 (Configuração) — a pasta de destino fica FORA de `public/`, fora da
 *        árvore de build e fora de qualquer caminho que o Next execute. Um
 *        arquivo lá dentro é dado, não código, e não existe caminho em que ele
 *        seja interpretado.
 *
 * -----------------------------------------------------------------------------
 * ONDE CADA COISA MORA
 * -----------------------------------------------------------------------------
 * As REGRAS (o que é imagem, onde fica a raiz, que caminho pode ser lido) vivem
 * em `upload-rules.ts`, sem efeito colateral e com testes. Este arquivo tem o
 * que TOCA O MUNDO: sorteia nome, cria pasta, escreve byte. A separação existe
 * porque `'server-only'` (a primeira linha daqui) é resolvido pelo bundler do
 * Next e impede que um teste em `node --test` sequer carregue o módulo — e as
 * regras de maior consequência não podiam ficar do lado intestável da linha.
 *
 * O reexport abaixo mantém `server/uploads` como porta de entrada única para
 * quem consome: as rotas importam de um lugar só.
 */

export {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_PREFIX,
  coverResolutionAdvice,
  detectImageFormat,
  imageDimensions,
  mimeTypeForStoredFile,
  resolveUploadPath,
  uploadRoot,
  type ImageDimensions,
  type ResolvedUploadPath,
  type UploadRootResult,
} from './upload-rules';

export type SaveImageResult =
  | {
      ok: true;
      url: string;
      bytes: number;
      mimeType: string;
      /**
       * Dimensões lidas do cabeçalho do arquivo, ou `null` quando o formato não
       * permitiu ler com segurança. Ver `imageDimensions` em `upload-rules.ts`.
       */
      dimensions: { width: number; height: number } | null;
      /**
       * Texto para a redação quando a imagem chegou pequena demais para servir
       * de capa — `null` quando não há nada útil a dizer.
       *
       * ELE VIAJA SEPARADO da mensagem de sucesso de propósito: quem monta o
       * texto que vai para a tela é a ROTA (é ela que já compõe "Imagem enviada
       * (N KB)"), e este módulo continua respondendo só sobre o arquivo. Se um
       * dia outra tela quiser tratar o aviso de outro jeito — destacar em
       * amarelo, oferecer "enviar outra" —, ela tem o campo, não uma frase
       * concatenada que precisaria ser desmontada.
       */
      resolutionAdvice: string | null;
    }
  | { ok: false; message: string };

/**
 * Grava a imagem e devolve a URL pública.
 *
 * ORGANIZAÇÃO EM PASTAS `AAAA/MM`: não é estética. Sistemas de arquivos
 * degradam com dezenas de milhares de entradas num mesmo diretório, e — mais
 * imediato que isso — uma pasta única torna qualquer inspeção manual, backup
 * seletivo ou expurgo por período um exercício de paciência.
 */
export async function saveUploadedImage(file: {
  bytes: Uint8Array;
  /** Só para a mensagem de erro. NADA daqui vai para o disco. */
  originalName: string;
}): Promise<SaveImageResult> {
  if (file.bytes.length === 0) {
    return { ok: false, message: 'O arquivo chegou vazio. Tente enviar de novo.' };
  }

  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message:
        `A imagem tem ${(file.bytes.length / 1024 / 1024).toFixed(1)} MB e o limite é ` +
        `${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1)} MB. ` +
        'Reduza a imagem antes de enviar — uma capa acima disso também deixaria a página lenta no celular.',
    };
  }

  /**
   * A RAIZ É CONFERIDA ANTES DE QUALQUER TRABALHO PESADO.
   *
   * Antes de detectar formato, criar pasta ou escrever byte nenhum: se o destino
   * não está configurado, nada do que vem depois faz sentido, e a mensagem que o
   * editor precisa ver é sobre CONFIGURAÇÃO, não sobre o arquivo dele.
   */
  const root = uploadRoot();
  if (!root.ok) return { ok: false, message: root.message };

  const format = detectImageFormat(file.bytes);
  if (!format) {
    return {
      ok: false,
      message:
        'Este arquivo não é uma imagem em formato aceito ' +
        `(${ACCEPTED_IMAGE_EXTENSIONS.join(', ')}). ` +
        'Arquivos SVG não são aceitos por segurança, mesmo que a extensão diga imagem.',
    };
  }

  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  /**
   * NOME GERADO POR NÓS, com 16 bytes aleatórios.
   *
   * O nome original é DESCARTADO por inteiro, e isso fecha várias portas de uma
   * vez: travessia de caminho (`../../.env`), NUL byte, extensão dupla
   * (`foto.jpg.php`) e nome com 4 mil caracteres. Fecha também um vazamento
   * discreto e real: nome de arquivo costuma carregar informação interna
   * ("capa-embargo-ate-sexta.jpg") numa URL que qualquer pessoa vê.
   *
   * Aleatório e não sequencial pelo mesmo motivo dos `cuid()` do banco: um
   * contador entregaria o volume de publicação e permitiria varrer as imagens
   * de matérias ainda não publicadas.
   */
  const name = `${randomBytes(16).toString('hex')}.${format.extension}`;

  const directory = path.join(root.path, folder);

  /**
   * `recursive: true` cria as subpastas de ano/mês — mas NÃO cria a raiz de
   * verdade em produção, e essa distinção é intencional: a raiz é um diretório
   * fora da árvore de build, criado uma única vez à mão por quem administra o
   * servidor. Se ela não existir, o `mkdir` falha com `ENOENT`/`EACCES` e o
   * `catch` da rota transforma isso numa mensagem para o editor — em vez de a
   * aplicação criar sozinha uma pasta no lugar errado e dar a impressão de que
   * está tudo certo até o próximo deploy.
   */
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), file.bytes, { flag: 'wx' });

  /**
   * A MEDIÇÃO ACONTECE DEPOIS DA GRAVAÇÃO, E ISSO É DELIBERADO.
   *
   * Resolução baixa NÃO é motivo para recusar o arquivo (o racional está em
   * `coverResolutionAdvice`, em upload-rules.ts: numa redação, bloquear a única
   * imagem disponível produz matéria sem imagem, que é pior). Como a leitura
   * não pode mudar o desfecho, ela fica depois — assim nenhum bug futuro nesse
   * parser tem como impedir um upload legítimo.
   */
  const dimensions = imageDimensions(file.bytes);

  return {
    ok: true,
    url: `${UPLOAD_URL_PREFIX}${folder}/${name}`,
    bytes: file.bytes.length,
    mimeType: format.mimeType,
    dimensions,
    resolutionAdvice: coverResolutionAdvice(dimensions),
  };
}

/**
 * -----------------------------------------------------------------------------
 * PRÓXIMOS PASSOS REGISTRADOS — nenhum é dívida escondida
 * -----------------------------------------------------------------------------
 *
 * 1. TIRAR O NODE DO CAMINHO DOS BYTES. Na hospedagem atual não temos um Nginx
 *    nosso para configurar, então isto fica pendente de plataforma. O prefixo
 *    `/uploads/` foi escolhido (em vez de `/api/uploads/`) justamente porque é
 *    um caminho de arquivo estático plausível: no dia em que houver um servidor
 *    estático na frente — VPS com Nginx, CDN, ou o próprio object storage —,
 *    basta apontá-lo para a raiz e NENHUMA URL muda. As imagens já publicadas
 *    nas matérias continuam funcionando exatamente iguais. Num VPS seria:
 *
 *      location ^~ /uploads/ {
 *          alias /caminho/absoluto/do/UPLOADS_DIR/;
 *          expires 1y;
 *          add_header Cache-Control "public, immutable";
 *          # a pasta guarda DADO, nunca código: nada aqui pode ser executado
 *          location ~ \.(php|js|mjs|html?)$ { deny all; }
 *      }
 *
 * 2. BACKUP. A pasta de uploads está FORA da árvore de deploy, o que a protege
 *    do `git push` — e, pela mesma razão, ela não é coberta por nada que o
 *    processo de deploy faça. Ela precisa entrar na rotina de backup da conta de
 *    hospedagem por conta própria, senão as imagens são o único dado do produto
 *    sem cópia. (O banco tem backup do provedor; isto aqui, não.)
 */
