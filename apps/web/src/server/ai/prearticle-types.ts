/**
 * =============================================================================
 * TIPOS DA PRÉ-MATÉRIA — contrato entre o servidor (IA) e o painel (UI)
 * =============================================================================
 *
 * Este arquivo existe para que o componente do painel (`topic-row.tsx`, que é
 * `'use client'`) possa importar o TIPO do JSON de saída sem puxar o código do
 * servidor (que é `server-only`). Tipos são apagados em compilação, então a
 * importação não cria nenhuma dependência de runtime.
 *
 * O formato espelha, campo a campo, o contrato de saída JSON que o prompt
 * exige do modelo. Se o prompt mudar, este contrato muda junto — manter os dois
 * dissociados é receita para o painel quebrar com "undefined" silencioso.
 */

export interface PopularityModel {
  categoria: string;
  justificativa: string;
  momento_pico: string;
  janela_publicacao: string;
  risco_timing: string;
  estrategia_posicionamento: string;
}

export interface PreMateria {
  titulo: string;
  subtitulo: string;
  abertura: string;
  corpo: string[];
  fechamento_cta: string;
  extras_retencao: string[];
}

export interface Otimizacao {
  palavra_chave_principal: string;
  palavras_chave_secundarias: string[];
  meta_description: string;
  titulos_sociais: string[];
  hashtags: string[];
}

export interface PreArticleOutput {
  contextualizacao: string;
  analise_hype: string[];
  modelo_popularidade: PopularityModel;
  pre_materia: PreMateria;
  otimizacao: Otimizacao;
}
