import { CnisVinculo } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, vinculos: CnisVinculo[] } = { vinculos: [] };

  // 1. Extrair Nome
  const nameMatch = text.match(/Nome:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i);
  if (nameMatch && nameMatch[1]) {
    result.nome = nameMatch[1].trim();
  }

  // 2. Extrair Vínculos (Abordagem por blocos)
  // Procuramos por padrões de CNPJ/CEI seguidos de datas
  // Exemplo: 1 94.420.080/0001-88 ... 15/10/2003 31/12/2003
  
  const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
  const cnpjRegex = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/g;
  
  // Dividir o texto em linhas para processar melhor
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentVinculo: Partial<CnisVinculo> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Tenta identificar o início de um vínculo (Número Seq + CNPJ/CEI ou apenas CNPJ/CEI)
    // Padrão: 1 94.420.080/0001-88 ou apenas 94.420.080/0001-88
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/);
    
    if (cnpjMatch) {
      // Se já tínhamos um vínculo sendo processado, salvamos
      if (currentVinculo && currentVinculo.empresa && currentVinculo.inicio) {
        result.vinculos.push(currentVinculo as CnisVinculo);
      }
      
      currentVinculo = {
        id: Math.random().toString(36).substr(2, 9),
        empresa: '',
        inicio: '',
        tipo: 'Empregado',
        especial: false,
        salarios: []
      };

      // Tenta pegar o nome da empresa (geralmente na mesma linha ou na próxima)
      const lineWithoutCnpj = line.replace(cnpjMatch[0], '').replace(/^\d+\s+/, '').trim();
      if (lineWithoutCnpj.length > 5) {
        currentVinculo.empresa = lineWithoutCnpj;
      } else if (i + 1 < lines.length && lines[i+1].length > 5 && !lines[i+1].match(dateRegex)) {
        currentVinculo.empresa = lines[i + 1];
      }
    }

    // Tenta identificar datas e tipo no bloco atual
    if (currentVinculo) {
      const dates = line.match(dateRegex);
      if (dates && dates.length >= 1) {
        // Se encontrarmos datas em uma linha que contém "Empregado", "Individual", etc.
        if (line.toLowerCase().includes('empregado') || line.toLowerCase().includes('agente público')) {
          currentVinculo.tipo = 'Empregado';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) {
            currentVinculo.fim = formatDateToIso(dates[1]);
          }
        } else if (line.toLowerCase().includes('contribuinte individual')) {
          currentVinculo.tipo = 'Contribuinte Individual';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) {
            currentVinculo.fim = formatDateToIso(dates[1]);
          }
        } else if (line.toLowerCase().includes('facultativo')) {
          currentVinculo.tipo = 'Facultativo';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) {
            currentVinculo.fim = formatDateToIso(dates[1]);
          }
        }
      }
      
      // Tenta capturar salários (Competência MM/AAAA e Valor)
      // Exemplo: 01/2020 1.234,56
      const salaryMatch = line.match(/(\d{2}\/\d{4})\s+([\d\.,]+)/);
      if (salaryMatch) {
        const competencia = formatCompetenciaToIso(salaryMatch[1]);
        const valor = parseCurrency(salaryMatch[2]);
        if (competencia && !isNaN(valor)) {
          currentVinculo.salarios?.push({ competencia, valor });
        }
      }
    }
  }

  // Adiciona o último vínculo se existir
  if (currentVinculo && currentVinculo.empresa && currentVinculo.inicio) {
    result.vinculos.push(currentVinculo as CnisVinculo);
  }

  return result;
}

function formatDateToIso(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return '';
}

function formatCompetenciaToIso(compStr: string): string {
  const parts = compStr.split('/');
  if (parts.length === 2) {
    return `${parts[1]}-${parts[0]}`;
  }
  return '';
}

function parseCurrency(valStr: string): number {
  // Remove pontos de milhar e troca vírgula por ponto
  const clean = valStr.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
}
