import { CnisVinculo, ResultadoCalculo } from "../types";

const SALARIO_MINIMO_2024 = 1412.00;
const DATA_REFORMA = new Date('2019-11-13');

export function calcularPrevidencia(vinculos: CnisVinculo[]): ResultadoCalculo {
  let totalDias = 0;
  let somaSalarios = 0;
  let contagemSalarios = 0;

  vinculos.forEach(v => {
    const inicio = new Date(v.dataInicio);
    const fim = v.dataFim ? new Date(v.dataFim) : new Date();
    
    // Diferença em dias
    const diffTime = Math.abs(fim.getTime() - inicio.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Lógica de exclusão de competências abaixo do mínimo (Pós-Reforma)
    const salariosValidos = v.salarios.filter(s => {
      const dataComp = new Date(s.competencia.split('/').reverse().join('-'));
      if (dataComp >= DATA_REFORMA && s.valor < 1000) { // Simplificado para o exemplo
        return false;
      }
      return true;
    });

    totalDias += diffDays;
    salariosValidos.forEach(s => {
      somaSalarios += s.valor;
      contagemSalarios++;
    });
  });

  const anos = Math.floor(totalDias / 365);
  const media = contagemSalarios > 0 ? somaSalarios / contagemSalarios : 0;

  return {
    tempoTotal: { anos, meses: 0, dias: 0 },
    mediaSalarial: media,
    pontos: anos + 50, // Exemplo simplificado
    regras: []
  };
}
