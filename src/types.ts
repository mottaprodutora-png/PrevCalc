export interface CnisVinculo {
  id: string;
  seq?: number;
  empresa: string;
  cnpj?: string;
  nb?: string; // Número do benefício
  especie?: number; // Espécie do benefício
  inicio: string; // ISO date
  fim?: string;   // ISO date
  tipo: 'Empregado' | 'Contribuinte Individual' | 'Facultativo' | 'Especial' | 'Rural' | 'Benefício' | 'MEI';
  situacao?: string; // CESSADO, ATIVO
  especial?: boolean;
  salarios: CnisSalario[];
  indicadores?: string[];
}

export interface CnisSalario {
  competencia: string; // YYYY-MM
  valor: number;
  indicadores?: string[];
}

export interface CalculoResultado {
  resumo: {
    tempoTotalDias: number;
    tempoTotalFormatado: string;
    carenciaMeses: number;
    statusAtual: 'Apto' | 'Não Apto' | 'Não se aplica';
    tempoFaltanteFormatado: string;
    previsaoAposentadoria: string;
    percentualConcluido: number;
    melhorRegraNome: string;
  };
  regras: RegraSimulada[];
  melhorOpcao: RegraSimulada;
  valorEstimado: {
    media: number;
    coeficiente: number;
    beneficio: number;
    regraUtilizada: string;
    percentualCalculo: number;
  };
  inconsistencias: Inconsistencia[];
  analiseJuridica: {
    revisoes: string[];
    periodosEspeciais: string[];
    periodosRurais: string[];
    contribuinteIndividual: string[];
  };
  planoAcao: string[];
  documentos: {
    obrigatorios: string[];
    previdenciarios: string[];
    estrategicos: string[];
  };
  timeline: TimelineEvent[];
}

export interface TimelineEvent {
  tipo: 'Trabalho' | 'Lacuna' | 'Invalido' | 'Especial' | 'Rural';
  descricao: string;
  periodo: string;
  inicio: string;
  fim: string;
  impacto?: 'Impede Aposentadoria' | 'Reduz Valor' | 'Neutro';
}

export interface RegraSimulada {
  nome: string;
  status: 'Apto' | 'Não Apto' | 'Não se aplica';
  dataAptidao?: string;
  tempoFaltanteDias?: number;
  descricao: string;
}

export interface Inconsistencia {
  tipo: 'Sem Remuneração' | 'Abaixo do Mínimo' | 'Lacuna' | 'Vínculo Incompleto';
  descricao: string;
  periodo: string;
  impactoTempo?: string;
  impactoValor?: string;
}
