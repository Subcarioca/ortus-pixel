/**
 * =============================================================================
 * AVISO DE RESOLUÇÃO DE CAPA — lógica pura, compartilhada por servidor e cliente
 * =============================================================================
 *
 * Estes números e esta função nasceram em `server/upload-rules.ts` (ver o
 * comentário grande de lá para o racional completo: por que 1200/1600px, por
 * que avisar em vez de recusar, e por que a causa raiz da pixelização não se
 * resolve em arquivo de configuração nenhum). Aquele módulo continua sendo a
 * FONTE — ele reexporta os três nomes daqui — mas o texto do aviso só existia
 * do lado do SERVIDOR, e só disparava para quem enviava um arquivo.
 *
 * Isso deixava um buraco: colar a URL de uma imagem já hospedada (o outro
 * caminho do mesmo campo, `image-url-field.tsx`) nunca passava por nenhuma
 * checagem de resolução — o servidor não baixa a imagem alheia só para medir
 * seus pixels. Este módulo não importa `node:path` nem lê variável de
 * ambiente, então roda tanto em `server/upload-rules.ts` quanto direto no
 * componente cliente do campo de imagem, que já tem a imagem carregada na
 * prévia e pode ler `naturalWidth`/`naturalHeight` de graça, sem round-trip
 * nenhum ao servidor.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Largura abaixo da qual a imagem fica visivelmente esticada MESMO em tela
 * comum (densidade 1). A capa ocupa 1088px de CSS no desktop; com folga para o
 * recorte 16:9 do `.thumb`, 1200 é o piso honesto.
 */
export const COVER_WIDTH_POOR = 1200;

/**
 * Largura a partir da qual a capa se sustenta em tela de alta densidade.
 *
 * O ideal aritmético seria 2176 (1088 × 2), mas exigir isso de uma redação com
 * teto de 1,8 MB por arquivo seria uma recomendação que ninguém consegue
 * cumprir — e recomendação impossível é ignorada por inteiro, inclusive quando
 * o caso é grave. 1600 é o número que cobre o desktop a 150% de escala (o
 * cenário mais comum no Windows) e reduz muito o esticamento a 2×.
 */
export const COVER_WIDTH_GOOD = 1600;

/**
 * Conselho de resolução para exibir junto da confirmação de envio (ou,
 * agora, junto da prévia de qualquer capa — enviada OU colada por URL).
 *
 * `null` quando não há nada útil a dizer — e isso inclui o caso em que não
 * conseguimos ler as dimensões. Um "não consegui medir sua imagem" seria ruído
 * puro para quem está fechando uma matéria: a informação não muda nada do que
 * a pessoa pode fazer.
 */
export function coverResolutionAdvice(dimensions: ImageDimensions | null): string | null {
  if (!dimensions) return null;

  const { width } = dimensions;

  if (width < COVER_WIDTH_POOR) {
    return (
      `⚠ Esta imagem tem só ${width}px de largura. Como capa de matéria ela vai aparecer ` +
      `esticada até em tela comum (a capa é exibida com até 1088px). Se for a CAPA, procure ` +
      `uma versão com ${COVER_WIDTH_GOOD}px ou mais; se for ilustração no meio do texto, está de bom tamanho.`
    );
  }

  if (width < COVER_WIDTH_GOOD) {
    return (
      `Esta imagem tem ${width}px de largura: suficiente para tela comum, mas macia em celular ` +
      `e notebook de alta resolução. Como capa, o ideal é ${COVER_WIDTH_GOOD}px ou mais.`
    );
  }

  return null;
}
