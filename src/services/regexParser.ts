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
    
    // Tenta identificar o início de um vínculo
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/);
    const nitMatch = line.match(/^(\d+)\s+(\d{3}\.\d{5}\.\d{2}-\d{1})/); // Padrão NIT: XXX.XXXXX.XX-X
    
    if (cnpjMatch || nitMatch) {
      // Se já tínhamos um vínculo sendo processado, salvamos
      if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio || currentVinculo.salarios?.length)) {
        result.vinculos.push(currentVinculo as CnisVinculo);
      }
      
      currentVinculo = {
        id: Math.random().toString(36).substr(2, 9),
        empresa: cnpjMatch ? '' : (nitMatch ? 'Contribuinte Individual' : ''),
        inicio: '',
        tipo: cnpjMatch ? 'Empregado' : 'Contribuinte Individual',
        especial: false,
        salarios: []
      };

      if (cnpjMatch) {
        const lineWithoutCnpj = line.replace(cnpjMatch[0], '').replace(/^\d+\s+/, '').trim();
        if (lineWithoutCnpj.length > 5) {
          currentVinculo.empresa = lineWithoutCnpj;
        } else if (i + 1 < lines.length && lines[i+1].length > 5 && !lines[i+1].match(dateRegex)) {
          currentVinculo.empresa = lines[i + 1];
        }
      }
    }

    // Tenta capturar salários (Competência MM/AAAA e Valor)
    const salaryMatches = line.matchAll(/(\d{2}\/\d{4})\s*(?:R\$\s*)?([\d\.,]{1,15})/g);
    let foundSalary = false;
    for (const match of salaryMatches) {
      const competencia = formatCompetenciaToIso(match[1]);
      const valor = parseCurrency(match[2]);
      if (competencia && !isNaN(valor)) {
        foundSalary = true;
        // Se não houver vínculo ativo, cria um genérico
        if (!currentVinculo) {
          currentVinculo = {
            id: Math.random().toString(36).substr(2, 9),
            empresa: 'Vínculo não identificado',
            inicio: '',
            tipo: 'Empregado',
            especial: false,
            salarios: []
          };
        }
        
        if (!currentVinculo.salarios?.some(s => s.competencia === competencia)) {
          currentVinculo.salarios?.push({ competencia, valor });
        }
      }
    }

    // Tenta identificar datas e tipo no bloco atual
    if (currentVinculo) {
      const dates = line.match(dateRegex);
      
      if (line.toLowerCase().includes('especial') || line.toLowerCase().includes('insalubre') || line.toLowerCase().includes('perigoso')) {
        currentVinculo.especial = true;
      }

      if (dates && dates.length >= 1) {
        const lowerLine = line.toLowerCase();
        
        if (!currentVinculo.inicio) {
          currentVinculo.inicio = formatDateToIso(dates[0]);
          if (dates.length > 1) currentVinculo.fim = formatDateToIso(dates[1]);
        } else if (dates.length >= 1 && !currentVinculo.fim) {
          // Se já temos início mas não fim, e achamos mais datas, pode ser o fim
          const possibleEnd = formatDateToIso(dates[dates.length - 1]);
          if (possibleEnd !== currentVinculo.inicio) {
            currentVinculo.fim = possibleEnd;
          }
        }

        // Tenta identificar o tipo se ainda for o padrão
        if (lowerLine.includes('empregado') || lowerLine.includes('agente público')) {
          currentVinculo.tipo = 'Empregado';
        } else if (lowerLine.includes('contribuinte individual') || lowerLine.includes('autônomo')) {
          currentVinculo.tipo = 'Contribuinte Individual';
        } else if (lowerLine.includes('facultativo')) {
          currentVinculo.tipo = 'Facultativo';
        } else if (lowerLine.includes('rural') || lowerLine.includes('segurado especial')) {
          currentVinculo.tipo = 'Rural';
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
  if (!valStr) return 0;
  
  // Remove R$ e espaços
  let clean = valStr.replace(/R\$/g, '').trim();
  
  // Se houver vírgula e ponto, o ponto é milhar e a vírgula é decimal (Padrão BR: 1.234,56)
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } 
  // Se houver apenas vírgula, é decimal (1234,56)
  else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  // Se houver apenas ponto, pode ser decimal (1234.56) ou milhar (1.234)
  // No CNIS, valores de salário geralmente têm 2 casas decimais.
  // Se o ponto estiver na posição de decimal (ex: .56), tratamos como decimal.
  else if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts[parts.length - 1].length !== 2) {
      // Provavelmente milhar (ex: 1.000)
      clean = clean.replace(/\./g, '');
    }
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
