/**
 * =============================================================================
 * PÁGINA "COMO ESCOLHEMOS O QUE PUBLICAR" — processo editorial
 * =============================================================================
 *
 * DECISÃO DE PRODUTO: esta página antes descrevia o mecanismo de pontuação
 * interno (sinais, pesos, faixas de 0–100) publicamente. Trocamos a moldura de
 * propósito: o leitor não precisa saber que existe um sistema de pontuação por
 * trás — precisa confiar que alguém está de fato acompanhando, verificando e
 * decidindo o que importa. A curadoria deve ler como julgamento editorial
 * humano, não como saída de algoritmo. O conteúdo de bastidor (sinais, faixas,
 * pesos) continua existindo — só não é mais exposto nesta página; vive só em
 * /admin, de uso interno da redação.
 *
 * O que se mantém desta versão anterior: o valor de SEO/E-E-A-T de uma página
 * institucional explicando padrões editoriais — só que contado em termos de
 * processo humano (o que verificamos, o que priorizamos, quando não publicamos),
 * não de fórmula.
 */

import type { Metadata } from 'next';

import { absoluteUrl, routes } from '@subcarioca/core';

import { BreadcrumbJsonLd } from '@/components/json-ld';

export const metadata: Metadata = {
  title: 'Como escolhemos o que publicar',
  description:
    'Como a redação da Ortus Pixel decide o que vira notícia, o que é prioridade e o que é apurado antes de ir ao ar.',
  alternates: { canonical: routes.methodology() },
};

const PRINCIPLES = [
  {
    name: 'Velocidade de verdade, não de achismo',
    description:
      'Acompanhamos buscas, redes sociais e o que as próprias fontes (estúdios, distribuidoras, desenvolvedoras) publicam, o dia inteiro. O objetivo é perceber cedo quando um assunto está pegando de verdade — não adivinhar.',
  },
  {
    name: 'Fonte antes de velocidade',
    description:
      'Um comunicado oficial da Rockstar não tem o mesmo peso que um post anônimo em fórum. Só publicamos como fato confirmado o que realmente foi confirmado; o resto é tratado como rumor, com a devida ressalva.',
  },
  {
    name: 'O que já foi dito em todo lugar não é prioridade',
    description:
      'Acompanhamos o que os grandes portais já publicaram. Preferimos gastar nosso tempo explicando direito o que pouca gente ainda cobriu, em vez de repetir manchete.',
  },
  {
    name: 'Contexto do seu fandom',
    description:
      'Sabemos que quem acompanha games não necessariamente acompanha anime, e vice-versa. Priorizamos o que faz sentido pra quem já está aqui, não o que dá clique fácil pra qualquer um.',
  },
  {
    name: 'Assunto sensível passa por gente, sempre',
    description:
      'Morte de personagem, cancelamento, vazamento não confirmado ou qualquer polêmica nunca vira publicação ou notificação automática. Esses casos são sempre apurados e decididos por um jornalista antes de irem ao ar.',
  },
];

export default function MethodologyPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: 'Como escolhemos o que publicar', url: routes.methodology() },
        ]}
      />

      <div className="container">
        <article className="article">
          <h1 className="article__title">Como escolhemos o que publicar</h1>
          <p className="article__dek">
            A Ortus Pixel acompanha games, cinema, séries, anime, HQs e tech o tempo todo. O que
            chega até você é decidido pela redação — não por sorte, e não sem critério.
          </p>

          <div className="prose">
            <h2 id="o-que-guia">O que guia nossas decisões</h2>
            <p>
              Nenhum critério decide sozinho o que publicar. A redação cruza vários sinais do que
              está acontecendo agora com o bom senso editorial de quem acompanha cada fandom de
              perto.
            </p>

            <dl className="methodology-list">
              {PRINCIPLES.map((item) => (
                <div key={item.name}>
                  <dt>
                    <strong>{item.name}</strong>
                  </dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>

            <h2 id="humano">Uma pessoa decide, sempre</h2>
            <p>
              Nenhuma matéria vai ao ar sem passar por um jornalista. Sinais e monitoramento
              ajudam a redação a perceber cedo o que está crescendo — mas a decisão final de
              publicar, como tratar e quando, é sempre humana.
            </p>
            <p>
              Assuntos sensíveis (vazamentos não confirmados, polêmicas, mortes de personagem)
              nunca são publicados ou notificados automaticamente. Esses casos são sempre
              apurados por gente antes de irem ao ar.
            </p>

            <h2 id="atualizacao">Cobertura viva</h2>
            <p>
              Acompanhamos o desenrolar das notícias ao longo do dia — um trailer que viraliza
              horas depois de sair pode virar destaque, e atualizamos a matéria conforme a
              história muda. É por isso que a página{' '}
              <a href={routes.trending()}>Em alta</a> muda ao longo do dia.
            </p>
          </div>
        </article>
      </div>
    </>
  );
}
