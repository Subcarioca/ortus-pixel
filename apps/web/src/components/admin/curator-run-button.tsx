'use client';

/**
 * =============================================================================
 * BOTÃO "BUSCAR PAUTAS AGORA" — dispara um ciclo do curator sob demanda
 * =============================================================================
 *
 * Mora ao lado do KPI "Último ciclo" porque é lá que a pergunta nasce: a pessoa
 * lê "há 240 min" e quer agir. Um botão de disparo em qualquer outro canto da
 * tela obrigaria a olhar duas coisas distantes para tomar uma decisão só.
 *
 * -----------------------------------------------------------------------------
 * POR QUE NÃO REUSAR O `AdminActionButton`
 * -----------------------------------------------------------------------------
 * Ele existe justamente para não duplicar "posta, mostra o resultado, recarrega"
 * — e foi a primeira opção considerada. Não serve aqui por causa do TEMPO.
 *
 * Aquele botão troca o rótulo por "…" enquanto trabalha, o que é perfeito para
 * as ações dele: remover um comentário, vincular uma oferta, coisas de ~200ms.
 * Este ciclo leva de 15s a mais de um minuto — e "…" parado por um minuto é
 * indistinguível de uma tela travada. A reação previsível é clicar de novo, ou
 * recarregar a página no meio do ciclo.
 *
 * Por isso este botão mostra o RELÓGIO CORRENDO e uma expectativa explícita.
 * Não é enfeite: é a diferença entre esperar e desconfiar.
 *
 * -----------------------------------------------------------------------------
 * ESCONDER O BOTÃO NÃO É PROTEÇÃO
 * -----------------------------------------------------------------------------
 * A página só o renderiza para quem tem `curarFilaDePautas` (ver admin/page.tsx),
 * mas quem recusa de verdade é a rota, por conta própria. A checagem na tela
 * existe só para não oferecer uma ação que vai falhar — mesma regra do resto do
 * painel (ver `canEditArticleOf` em core/staff.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { readAdminResponse } from './admin-response';

/** Onde a expectativa de tempo é calibrada. O ciclo real mede ~15s. */
const SEGUNDOS_ESPERADOS = 60;

export function CuratorRunButton() {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  /**
   * Guarda o id do intervalo para poder limpá-lo na desmontagem.
   *
   * Sem isso, navegar para outra tela do painel no meio de um ciclo deixaria um
   * `setInterval` vivo chamando `setState` num componente que não existe mais —
   * vazamento silencioso e um aviso no console que ninguém associa a este botão.
   */
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function disparar() {
    // Guarda de reentrada. O `disabled` do botão já cobre o clique duplo com
    // mouse, mas não cobre um Enter repetido com o foco no botão — e a defesa
    // custa uma linha.
    if (rodando) return;

    setRodando(true);
    setFalhou(false);
    setSegundos(0);
    setMensagem(null);

    tickRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);

    try {
      const response = await fetch('/api/internal/curator-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Corpo vazio: a rota não recebe parâmetro nenhum. O `Content-Type`
        // continua indo por consistência com as outras chamadas do painel.
        body: '{}',
      });

      // `readAdminResponse` nunca lança e traduz o 401 em "sua sessão expirou"
      // — que é a mensagem certa, porque a ação da pessoa é entrar de novo.
      const data = await readAdminResponse(response);

      setMensagem(data.message);
      setFalhou(!data.ok);

      /**
       * `router.refresh()` no sucesso — refaz a renderização do Server
       * Component (a fila E o KPI "Último ciclo") sem recarregar a página nem
       * perder o estado das linhas expandidas.
       *
       * É a mesma convenção do `AdminActionButton`. NÃO usamos o
       * `window.location.reload()` do `topic-row.tsx`: lá o reload é aceitável
       * porque a ação parte de dentro da linha que vai sumir; aqui ele jogaria
       * fora a própria mensagem de resultado que acabou de chegar — e a pessoa
       * ficaria sem saber quantas pautas o ciclo trouxe.
       */
      if (data.ok) router.refresh();
    } catch {
      /**
       * FALHA DE REDE — e aqui a mensagem NÃO pode afirmar que a busca falhou.
       *
       * Este é o caso concreto que o `curator-runner.ts` documenta: em produção
       * há um LiteSpeed na frente, com tempo limite de proxy próprio (fora do
       * nosso controle, tipicamente 60s). Se o ciclo passar disso, o navegador
       * recebe um erro de gateway ENQUANTO o processo filho continua rodando e
       * termina normalmente.
       *
       * Dizer "a busca falhou" aqui seria a mentira mais cara possível: a pessoa
       * clicaria de novo, e o segundo clique bateria na trava de concorrência
       * com "já tem uma busca em andamento" — três mensagens contraditórias em
       * sequência. Mandar CONFERIR é o único texto honesto.
       */
      setMensagem(
        'A conexão caiu antes da resposta — o que NÃO quer dizer que a busca falhou: ' +
          'ela pode ter passado do tempo limite do servidor e continuado rodando. ' +
          'Aguarde um minuto, recarregue a página e confira o KPI “Último ciclo” antes de tentar de novo.',
      );
      setFalhou(true);
      // Atualiza assim mesmo: se o ciclo terminou, o KPI já reflete.
      router.refresh();
    } finally {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setRodando(false);
    }
  }

  return (
    <span className="admin-actions">
      <button
        type="button"
        className="btn btn--sm btn--primary"
        onClick={disparar}
        disabled={rodando}
        // O leitor de tela anuncia a mudança de estado do botão; sem isto, o
        // rótulo mudaria em silêncio para quem não vê a tela.
        aria-busy={rodando}
      >
        {rodando ? `Buscando… ${segundos}s` : 'Buscar pautas agora'}
      </button>

      {/*
        `role="status"` (região viva educada) para que o resultado seja anunciado
        sem interromper o que o leitor de tela estiver falando. É a mesma escolha
        do `AdminActionButton`.
      */}
      <span className="form-hint" role="status">
        {rodando
          ? // A expectativa é dita ANTES de a pessoa começar a desconfiar, e o
            // aviso de "não feche" só aparece quando o tempo passa do esperado —
            // repeti-lo desde o segundo 1 seria alarmante à toa.
            segundos > SEGUNDOS_ESPERADOS
            ? 'Está demorando mais que o normal (fonte externa lenta). Não feche esta aba.'
            : `Consultando as fontes. Costuma levar menos de ${SEGUNDOS_ESPERADOS}s.`
          : mensagem}
      </span>

      {/*
        A falha ganha uma marca semântica além do texto. Não usamos classe de cor
        nova: o design system do projeto é conferido por `npm run check:classes`,
        que recusa classe inexistente na folha — inventar uma aqui quebraria a
        verificação. `<strong>` comunica sem inventar CSS.
      */}
      {falhou && !rodando && (
        <strong className="form-hint" aria-hidden="true">
          ⚠
        </strong>
      )}
    </span>
  );
}
