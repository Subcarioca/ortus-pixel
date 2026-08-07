/**
 * =============================================================================
 * IDENTIDADE DA MARCA — fonte única da verdade
 * =============================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE (criado no reposicionamento CanalNerd → Ortus Pixel):
 *
 * Antes, o nome do site aparecia como literal de fallback em pelo menos cinco
 * lugares independentes (layout, JSON-LD, e-mail transacional, push, ads.txt).
 * Cada um deles lia a mesma variável de ambiente e repetia o mesmo `?? 'Nome'`.
 * O efeito prático de espalhar assim só aparece na hora em que a marca muda:
 * é fácil trocar quatro dos cinco e ficar com um e-mail transacional assinado
 * com o nome antigo — o tipo de erro que ninguém revisa e todo assinante vê.
 *
 * Trade-off assumido: um import a mais em cada consumidor, em troca de uma
 * mudança de marca voltar a ser uma edição de uma linha só. Como são constantes
 * puras (sem I/O, sem `server-only`), o arquivo é importável tanto de Server
 * Components quanto de código de cliente sem custo de bundle relevante.
 *
 * REGRA DE ESTILO DA MARCA (decisões do dono do site, ver design/README.md):
 *   - Wordmark: "Ortus" em tinta neutra + "Pixel" em `--brand` (o `<b>` do `.logo`).
 *   - Em texto corrido leva ARTIGO FEMININO: "a Ortus Pixel" (como "a Omelete",
 *     "a IGN"). Em vocativo ou nome próprio solto, sem artigo.
 *   - Não existe subtítulo fixo ("Ortus Pixel News" e similares estão fora).
 */

/**
 * Nome da marca.
 *
 * Continua atrás de `NEXT_PUBLIC_SITE_NAME` porque ambientes de homologação
 * costumam querer um nome diferente ("Ortus Pixel [STAGING]") para que ninguém
 * confunda as duas abas abertas lado a lado. O fallback é o valor de produção.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Ortus Pixel';

/**
 * URL canônica do site.
 *
 * O fallback é `localhost` DE PROPÓSITO, e não o domínio de produção: em
 * desenvolvimento, um fallback apontando para produção faria links de e-mail e
 * URLs de Open Graph saírem apontando para o site real durante um teste local —
 * e, pior, esconderia o esquecimento de configurar a variável no deploy, que é
 * exatamente o erro que a gente quer que apareça cedo e alto.
 *
 * O domínio canônico de produção é o APEX, sem `www` (decisão de infraestrutura;
 * o Nginx redireciona `www` → apex). Ver `.env.production.example`.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Tagline oficial. Usada no rodapé e como assinatura de voz da marca. */
export const SITE_TAGLINE = 'Sempre antenado no universo nerd.';

/**
 * Descrição padrão do site (meta description da home e fallback global).
 * Texto homologado no protótipo `design/index.html` — mantenha os dois em sincronia.
 */
export const SITE_DESCRIPTION =
  'Games, cinema, séries, anime, HQs e tech: o que está pegando fogo agora no universo nerd, com curadoria em tempo real. Sempre antenado.';

/**
 * Handle único em todas as redes sociais.
 *
 * Um handle só para todas as plataformas é decisão de marca: reduz o custo de
 * memória do leitor e evita o "arroba errado" em card de compartilhamento.
 */
export const SOCIAL_HANDLE = '@ortuspixel';

/** Perfis oficiais — alimentam o `sameAs` do JSON-LD (sinal de entidade para o Google). */
export const SOCIAL_PROFILES = [
  'https://x.com/ortuspixel',
  'https://www.instagram.com/ortuspixel',
  'https://www.tiktok.com/@ortuspixel',
  'https://www.youtube.com/@ortuspixel',
] as const;

/** Convite público do servidor da comunidade. */
export const DISCORD_INVITE_URL = 'https://discord.gg/ortuspixel';

/**
 * Endereços de contato.
 *
 * `noticias@` assina o que é automático e de massa (newsletter); `contato@` é o
 * canal humano e o `mailto:` do VAPID — separar os dois protege a reputação de
 * envio: uma reclamação de spam na newsletter não contamina o endereço que os
 * serviços de push usam para falar com a gente em caso de problema.
 */
export const NEWSLETTER_FROM_EMAIL = 'noticias@ortuspixel.com';
export const CONTACT_EMAIL = 'contato@ortuspixel.com';
