'use client';

/**
 * =============================================================================
 * PAINEL DA ENTREVISTA — a conversa que vira matéria
 * =============================================================================
 *
 * A interface do SEGUNDO modo de geração (ver `server/ai/interview.ts` para o
 * porquê do modo existir). É uma conversa: o entrevistador pergunta, o autor
 * responde, e em algum momento sai um rascunho de matéria.
 *
 * -----------------------------------------------------------------------------
 * POR QUE UM COMPONENTE PRÓPRIO, E NÃO MAIS UM BLOCO EM `topic-row.tsx`
 * -----------------------------------------------------------------------------
 * `topic-row.tsx` já carrega três fluxos (sugestão, pré-matéria, criar matéria)
 * e passa de 800 linhas. Uma conversa tem estado próprio (histórico, mensagem
 * sendo digitada, turno em andamento) que não interessa a nenhum dos outros — e
 * o efeito prático de misturar seria que qualquer resposta do entrevistador
 * re-renderizaria a linha inteira da fila, formulário aberto incluído.
 *
 * -----------------------------------------------------------------------------
 * O HISTÓRICO VIVE AQUI, EM MEMÓRIA — e o preço disso
 * -----------------------------------------------------------------------------
 * Mesma decisão da pré-matéria (que também não persiste nada): conversa é
 * material de trabalho, não estado do produto. O que vira estado é o rascunho
 * no fim, quando o autor copia o texto para o formulário de matéria.
 *
 * A consequência que o usuário sente: recarregar a página perde a conversa. Por
 * isso o aviso na tela — melhor dizer antes do que a pessoa descobrir depois de
 * meia hora de entrevista.
 */

import { useEffect, useRef, useState } from 'react';

import type { InterviewMessage } from '@/server/ai/interview-types';

interface InterviewPanelProps {
  topicId: string;
  /** Título da pauta, só para o cabeçalho do painel. */
  pautaTitulo: string;
  onClose: () => void;
}

export function InterviewPanel({ topicId, pautaTitulo, onClose }: InterviewPanelProps) {
  const [mensagens, setMensagens] = useState<InterviewMessage[]>([]);
  const [rascunho, setRascunho] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  /**
   * Guarda se a abertura já foi pedida.
   *
   * `useRef` e não `useState` porque isto NÃO pode disparar re-render: é uma
   * trava contra a chamada dupla, e o `useEffect` do React em modo estrito roda
   * duas vezes no desenvolvimento de propósito. Sem a trava, abrir o painel
   * gastaria duas chamadas pagas e o autor veria dois briefings.
   */
  const aberturaPedida = useRef(false);
  const fimDaConversa = useRef<HTMLDivElement | null>(null);

  async function enviar(texto: string | null) {
    if (ocupado) return;

    setOcupado(true);
    setErro(null);

    // A mensagem do autor entra na tela ANTES da resposta chegar: a chamada
    // leva dezenas de segundos, e ver a própria fala aparecer é o que diz que o
    // envio funcionou. Se a chamada falhar, ela é removida no `catch` — deixar
    // uma pergunta sem resposta no histórico faria o próximo turno mandar ao
    // modelo uma conversa que não aconteceu.
    const historicoAnterior = mensagens;
    const historicoComEnvio: InterviewMessage[] =
      texto === null ? mensagens : [...mensagens, { role: 'user', content: texto }];

    if (texto !== null) setMensagens(historicoComEnvio);

    try {
      const response = await fetch(`/api/admin/topics/${topicId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'interview', mensagens: historicoComEnvio }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        resposta?: string;
        message?: string;
      };

      if (data.ok && typeof data.resposta === 'string') {
        setMensagens([...historicoComEnvio, { role: 'assistant', content: data.resposta }]);
      } else {
        setMensagens(historicoAnterior);
        setErro(data.message ?? 'Não foi possível continuar a entrevista.');
      }
    } catch {
      setMensagens(historicoAnterior);
      setErro('Não foi possível falar com o servidor. Sua mensagem não foi enviada.');
    } finally {
      setOcupado(false);
    }
  }

  // Abertura automática: o painel abre já perguntando, sem exigir um clique a
  // mais para começar algo que a pessoa acabou de pedir para começar.
  useEffect(() => {
    if (aberturaPedida.current) return;
    aberturaPedida.current = true;
    void enviar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda uma vez, na montagem; ver `aberturaPedida`
  }, []);

  // Rola para a fala mais recente a cada turno. Sem isso, a resposta nova nasce
  // fora da área visível numa conversa longa e parece que nada aconteceu.
  useEffect(() => {
    fimDaConversa.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens, ocupado]);

  function submeter(event: React.FormEvent) {
    event.preventDefault();
    const texto = rascunho.trim();
    if (texto.length === 0) return;
    setRascunho('');
    void enviar(texto);
  }

  /**
   * Copia a ÚLTIMA fala do entrevistador — que, depois da Fase 3, é o rascunho
   * da matéria. É o caminho de saída deste modo: o texto vai para o formulário
   * de "Criar matéria" pelas mãos do autor.
   *
   * Copia a última fala inteira, e não uma tentativa de extrair "só a matéria"
   * dela: qualquer heurística de recorte (procurar por "TÍTULO:", cortar antes
   * de "SUAS FALAS QUE MANTIVE") erra em silêncio no dia em que o modelo variar
   * o formato — e o erro seria cortar metade do texto sem avisar. Colar demais
   * e apagar o excesso é trabalho de segundos; recuperar o que sumiu, não.
   */
  async function copiarUltima() {
    const ultima = [...mensagens].reverse().find((m) => m.role === 'assistant');
    if (!ultima) return;

    try {
      await navigator.clipboard.writeText(ultima.content);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2_000);
    } catch {
      setErro('O navegador bloqueou a cópia. Selecione o texto e copie à mão.');
    }
  }

  const temResposta = mensagens.some((m) => m.role === 'assistant');

  return (
    <div className="admin-row__detail admin-row__prearticle">
      <div className="admin-row__prearticle-head">
        <h4 className="admin-row__title">Entrevista sobre a pauta</h4>
        <div className="admin-actions">
          {temResposta && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copiarUltima()}>
              {copiado ? 'Copiado ✓' : 'Copiar última resposta'}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>

      <p className="form-hint">
        Pauta: <b>{pautaTitulo}</b> · A conversa vive só nesta tela — recarregar a página perde o
        que foi dito. Quando o texto estiver bom, copie e cole em “Criar matéria”.
      </p>

      <div className="admin-interview__log">
        {mensagens.map((mensagem, i) => (
          <div
            key={i}
            className={
              mensagem.role === 'user'
                ? 'admin-interview__msg admin-interview__msg--autor'
                : 'admin-interview__msg'
            }
          >
            <span className="admin-interview__quem">
              {mensagem.role === 'user' ? 'Você' : 'Entrevistador'}
            </span>
            {/* `white-space: pre-wrap` no CSS preserva as quebras de linha do
                modelo (que estrutura tudo em bullets e seções). Interpolação
                JSX comum: o React escapa o texto, então nada aqui vira HTML. */}
            <p className="admin-interview__texto">{mensagem.content}</p>
          </div>
        ))}

        {ocupado && (
          <p className="form-hint" role="status">
            {mensagens.length === 0 ? 'Lendo a pauta…' : 'Escrevendo…'}
          </p>
        )}

        <div ref={fimDaConversa} />
      </div>

      {erro && (
        <p className="form-hint form-hint--error" role="alert">
          {erro}
        </p>
      )}

      <form onSubmit={submeter} className="admin-interview__form">
        <label className="sr-only" htmlFor={`entrevista-${topicId}`}>
          Sua resposta
        </label>
        <textarea
          id={`entrevista-${topicId}`}
          value={rascunho}
          onChange={(event) => setRascunho(event.target.value)}
          rows={3}
          placeholder="Responda com sua opinião — ou digite 'escreve' para ele já montar o rascunho."
          disabled={ocupado}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter envia. Enter sozinho continua quebrando linha: as
            // respostas aqui costumam ter mais de um parágrafo, e um Enter que
            // envia sem querer é a forma mais rápida de mandar meia resposta.
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submeter(event);
            }
          }}
        />
        <div className="admin-actions">
          <button type="submit" className="btn btn--primary btn--sm" disabled={ocupado || rascunho.trim().length === 0}>
            Responder
          </button>
          <span className="form-hint">Ctrl+Enter envia</span>
        </div>
      </form>
    </div>
  );
}
