/**
 * =============================================================================
 * LAYOUT DO PAINEL EDITORIAL — a segunda camada contra anúncio em tela interna
 * =============================================================================
 *
 * ESTE LAYOUT NÃO DESENHA NADA. Ele existe por um motivo só, e o motivo é a
 * conta do AdSense.
 *
 * O CONTEXTO: com "Auto ads" ligado (um interruptor da CONTA do Google, não do
 * nosso código), o Google injeta unidades de anúncio sozinho em qualquer página
 * onde o script `adsbygoogle.js` esteja carregado. Anúncio no painel significa
 * impressão gerada pela PRÓPRIA REDAÇÃO — tráfego inválido pela definição do
 * programa, e a punição para tráfego inválido é a suspensão da conta inteira,
 * com todo o histórico de receita junto.
 *
 * A PRIMEIRA CAMADA já resolve o caso comum: `components/adsense-loader.tsx` não
 * renderiza o script quando a rota atual está sob `/admin`. Abrir, recarregar ou
 * colar qualquer URL do painel no navegador nunca baixa o script do Google.
 *
 * O QUE ESTA SEGUNDA CAMADA COBRE, e que a primeira não tem como cobrir:
 * a navegação do lado do cliente. Um editor que estava lendo o site público
 * (script já baixado e em memória) e clica para o painel não recarrega a página —
 * o App Router troca só a árvore de componentes. Não existe "descarregar" um
 * script já executado. `<AdsPaused />` escreve `pauseAdRequests = 1` na fila do
 * próprio AdSense, que é o mecanismo previsto pelo Google para dizer "nesta
 * navegação, não peça anúncio". Ver o cabeçalho de `components/ads-paused.tsx`.
 *
 * POR QUE UM LAYOUT, E NÃO UMA LINHA EM CADA PÁGINA DO PAINEL: porque o layout
 * envolve a subárvore INTEIRA, inclusive as telas que ainda não existem. A
 * alternativa dependeria de todo mundo lembrar de repetir a linha — e a primeira
 * página em que alguém esquecesse seria indistinguível de uma que funciona.
 *
 * O PREÇO DESTA ESCOLHA, declarado para não ser descoberto como surpresa:
 * `AdsPaused` não religa os pedidos ao desmontar (o porquê está lá — religar
 * cria uma corrida que, quando perdida, veicula anúncio na página errada). Então
 * um visitante ANÔNIMO que caia em `/admin` (verá a tela de login), e dali
 * navegue para o site pelo cabeçalho sem recarregar, fica sem anúncio pelo resto
 * daquela sessão. É improvável — `/admin` é bloqueado no robots.txt e não há
 * link público apontando para lá — e o prejuízo é algumas impressões perdidas
 * numa sessão. O erro na direção contrária custaria a conta. Mantemos a
 * assimetria a favor da conta, conscientemente.
 *
 * ⚠ O que este arquivo NÃO faz: autenticação. Cada página do painel chama
 * `requireStaffPage` por conta própria, e isso é deliberado — o porquê está no
 * cabeçalho de `server/staff-auth.ts`. Layout do App Router não é fronteira de
 * segurança: ele não roda antes das rotas de API e não é reexecutado em toda
 * navegação, então uma checagem feita só aqui daria uma sensação de proteção que
 * não corresponde ao que o framework garante.
 *
 * -----------------------------------------------------------------------------
 * ELE GANHOU UMA SEGUNDA RESPONSABILIDADE: A FOLHA DE ESTILO DO PAINEL
 * -----------------------------------------------------------------------------
 * O import de `./admin.css` logo abaixo é o que faz as regras de `/admin`
 * chegarem SÓ às rotas de `/admin`. Elas moraram até aqui dentro de
 * `app/ortuspixel.css` (a folha do design system, importada pelo layout RAIZ),
 * e portanto eram baixadas por todo leitor do site público — ~8 KB de CSS que
 * nenhuma página pública usa, dentro do arquivo que bloqueia a primeira
 * pintura. Ver o cabeçalho de `admin.css` para o racional completo, para o que
 * NÃO foi separado e por quê, e para a verificação de ordem de cascata.
 *
 * O layout é o lugar certo deste import pelo mesmo motivo que já valia para o
 * `<AdsPaused>`: ele cobre a subárvore inteira, inclusive as telas do painel
 * que ainda não existem.
 */

import './admin.css';
import { AdsPaused } from '@/components/ads-paused';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdsPaused />
      {children}
    </>
  );
}
