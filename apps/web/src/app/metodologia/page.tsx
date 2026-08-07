/**
 * =============================================================================
 * PÁGINA DE METODOLOGIA — como o score é calculado
 * =============================================================================
 *
 * Esta página tem TRÊS funções, e nenhuma delas é decorativa:
 *
 *  1. E-E-A-T: explicar publicamente o método é um sinal forte de
 *     confiabilidade. Um número de 0 a 100 sem explicação parece inventado —
 *     com explicação, vira credencial editorial.
 *  2. SEO: é conteúdo evergreen único, que ninguém mais tem.
 *  3. Produto: diferencia a Ortus Pixel dos concorrentes, que publicam "achando"
 *     o que vai bombar.
 *
 * O QUE EXPOMOS E O QUE NÃO EXPOMOS: descrevemos os SINAIS e as FAIXAS, mas não
 * os pesos exatos, os limiares de corte nem as fórmulas de normalização. É o
 * equilíbrio entre transparência (que gera confiança) e proteger a calibração,
 * que é o ativo construído ao longo de meses.
 */

import type { Metadata } from 'next';

import { SCORE_BANDS, absoluteUrl, routes } from '@canalnerd/core';

import { BreadcrumbJsonLd } from '@/components/json-ld';

export const metadata: Metadata = {
  title: 'Como calculamos o score de popularidade',
  description:
    'Entenda a metodologia por trás do score de 0 a 100 que ordena as notícias da Ortus Pixel: quais sinais usamos, como eles são combinados e o que cada faixa significa.',
  alternates: { canonical: routes.methodology() },
};

const SIGNALS = [
  {
    name: 'Aceleração de busca',
    description:
      'O sinal mais importante. Comparamos o volume de buscas das últimas horas com o período imediatamente anterior. O que nos interessa não é o tamanho do interesse, mas a VELOCIDADE com que ele cresce — é isso que revela um assunto explodindo antes que ele vire manchete em todo lugar.',
  },
  {
    name: 'Volume de busca',
    description:
      'Quantas pessoas procuram o termo. Pesa menos do que a aceleração de propósito: "Star Wars" tem volume gigante todo dia, e isso não é notícia.',
  },
  {
    name: 'Repercussão em redes sociais',
    description:
      'Menções, upvotes, comentários e compartilhamentos no Reddit, no X e no YouTube. Comentário vale mais que curtida, porque exige mais esforço — e portanto indica mobilização real.',
  },
  {
    name: 'Trending nativo das plataformas',
    description:
      'Presença nos trending topics do YouTube, nos assuntos do momento do X e no topo dos subreddits de cada fandom.',
  },
  {
    name: 'Autoridade da fonte',
    description:
      'Um anúncio oficial da Rockstar não é a mesma coisa que um post anônimo em fórum. Classificamos cada fonte em níveis, e isso muda tanto a urgência quanto o tratamento editorial: fato confirmado se publica; rumor se apura.',
  },
  {
    name: 'Proximidade de lançamento',
    description:
      'Mantemos uma base própria de datas de estreias de filmes, séries, jogos e temporadas de anime. Uma notícia a três dias de um lançamento confirmado vale mais do que a mesma notícia a oito meses.',
  },
  {
    name: 'Concorrência já publicada',
    description:
      'Monitoramos em tempo real o que os grandes portais já publicaram. Quanto menos gente cobriu, maior a janela de oportunidade — e maior a urgência de sermos os primeiros a explicar direito.',
  },
  {
    name: 'Afinidade da nossa audiência',
    description:
      'Como os leitores da Ortus Pixel historicamente reagem a cada franquia. É o único sinal que nenhum concorrente consegue reproduzir, porque depende do comportamento da nossa própria base.',
  },
  {
    name: 'Gatilhos editoriais sensíveis',
    description:
      'Identificamos temas delicados (morte de personagem, cancelamento, vazamento, polêmica). Eles NÃO aumentam o score de forma relevante — ao contrário: acionam revisão humana obrigatória e bloqueiam qualquer automação.',
  },
];

export default function MethodologyPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: routes.home() },
          { name: 'Metodologia', url: routes.methodology() },
        ]}
      />

      {/* Página de texto corrido, sem sidebar: só o `.container`. Antes era
          `.article-layout`, a grade de três colunas do artigo — e como esta
          página tem um único filho, a partir de 1180px o texto inteiro caía na
          coluna de 56px reservada ao trilho de compartilhamento. Ver a nota
          longa em app/[categoria]/[slug]/page.tsx. O `.article` já limita a
          medida a 44rem sozinho, que é o que uma página de leitura precisa. */}
      <div className="container">
        <article className="article">
          <h1 className="article__title">Como calculamos o score de popularidade</h1>
          <p className="article__dek">
            Toda notícia da Ortus Pixel recebe uma nota de 0 a 100 que indica o quanto o assunto
            está em ascensão neste momento. Ela define o que vai para o topo da home, o que
            entra em &ldquo;Em alta&rdquo; e o que dispara alerta na redação.
          </p>

          <div className="prose">
            <h2 id="o-que-medimos">O que medimos</h2>
            <p>
              O score combina nove sinais independentes. Nenhum deles decide sozinho: a nota
              final é uma média ponderada, calibrada continuamente comparando o que previmos com
              o desempenho real das matérias.
            </p>

            <dl className="methodology-list">
              {SIGNALS.map((signal) => (
                <div key={signal.name}>
                  <dt>
                    <strong>{signal.name}</strong>
                  </dt>
                  <dd>{signal.description}</dd>
                </div>
              ))}
            </dl>

            <h2 id="faixas">O que cada faixa significa</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Faixa</th>
                  <th scope="col">Pontuação</th>
                  <th scope="col">O que acontece</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_BANDS.map((band) => (
                  <tr key={band.band}>
                    <th scope="row">{band.label}</th>
                    <td>
                      {band.min}–{band.max}
                    </td>
                    <td>{band.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 id="humano">O algoritmo não decide sozinho</h2>
            <p>
              O score é uma <strong>ferramenta de priorização</strong>, não um editor. Toda
              decisão de publicação passa por um jornalista, que pode discordar da nota e
              sobrepô-la manualmente a qualquer momento — registrando o motivo.
            </p>
            <p>
              Assuntos sensíveis (vazamentos não confirmados, polêmicas, mortes de personagem)
              nunca disparam publicação ou notificação automática, por mais alta que seja a
              pontuação. Nesses casos, o sistema apenas avisa a redação de que algo está
              crescendo — e a checagem é feita por gente.
            </p>

            <h2 id="atualizacao">O score muda depois da publicação</h2>
            <p>
              Recalculamos a nota continuamente, inclusive de matérias já publicadas. Um trailer
              que viraliza três horas depois de sair pode subir sozinho para o topo da home. É
              por isso que a ordem da página <a href={routes.trending()}>Em alta</a> muda ao
              longo do dia.
            </p>

            <h2 id="erros">Onde erramos</h2>
            <p>
              Nenhum modelo de previsão acerta sempre. Medimos sistematicamente a correlação
              entre o score previsto e a audiência real de cada matéria, e usamos esse resultado
              para recalibrar os pesos. Quando um sinal externo fica indisponível, o cálculo
              segue com os demais e a confiança da estimativa cai — preferimos uma nota honesta
              e menos precisa a uma nota falsamente exata.
            </p>
          </div>
        </article>
      </div>
    </>
  );
}
