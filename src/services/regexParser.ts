import { CnisVinculo } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, vinculos: CnisVinculo[] } = { vinculos: [] };

  // 1. Extrair Nome
  // Tenta vários padrões comuns em extratos do INSS
  const namePatterns = [
    /Nome:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Nome do Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 5) {
      result.nome = match[1].trim();
      break;
    }
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
      
      // Detectar se é especial
      if (line.toLowerCase().includes('especial') || line.toLowerCase().includes('insalubre') || line.toLowerCase().includes('perigoso')) {
        currentVinculo.especial = true;
      }

      if (dates && dates.length >= 1) {
        // Se encontrarmos datas em uma linha que contém "Empregado", "Individual", etc.
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('empregado') || lowerLine.includes('agente público')) {
          currentVinculo.tipo = 'Empregado';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) currentVinculo.fim = formatDateToIso(dates[1]);
        } else if (lowerLine.includes('contribuinte individual') || lowerLine.includes('autônomo')) {
          currentVinculo.tipo = 'Contribuinte Individual';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) currentVinculo.fim = formatDateToIso(dates[1]);
        } else if (lowerLine.includes('facultativo')) {
          currentVinculo.tipo = 'Facultativo';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) currentVinculo.fim = formatDateToIso(dates[1]);
        } else if (lowerLine.includes('rural') || lowerLine.includes('segurado especial')) {
          currentVinculo.tipo = 'Rural';
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) currentVinculo.fim = formatDateToIso(dates[1]);
        }
      }
      
      // Tenta capturar salários (Competência MM/AAAA e Valor)
      // O CNIS costuma listar vários salários em colunas ou linhas seguidas
      // Padrão comum: 01/2020 1.234,56 ou 01/2020 1234.56
      const salaryMatches = line.matchAll(/(\d{2}\/\d{4})\s+([\d\.,]{4,15})/g);
      for (const match of salaryMatches) {
        const competencia = formatCompetenciaToIso(match[1]);
        const valor = parseCurrency(match[2]);
        if (competencia && !isNaN(valor) && valor > 0) {
          // Evita duplicados no mesmo vínculo
          if (!currentVinculo.salarios?.some(s => s.competencia === competencia)) {
            currentVinculo.salarios?.push({ competencia, valor });
          }
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
