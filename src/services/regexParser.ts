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
    // Padrão 1: CNPJ/CEI
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/);
    // Padrão 2: NIT
    const nitMatch = line.match(/^(\d+)\s+(\d{3}\.\d{5}\.\d{2}-\d{1})/); 
    // Padrão 3: Sequencial de vínculo (ex: "1 21.234.567/0001-00")
    const seqMatch = line.match(/^(\d+)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    
    if (cnpjMatch || nitMatch || seqMatch) {
      // Se já tínhamos um vínculo sendo processado, salvamos
      if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio || currentVinculo.salarios?.length)) {
        result.vinculos.push(currentVinculo as CnisVinculo);
      }
      
      currentVinculo = {
        id: Math.random().toString(36).substr(2, 9),
        empresa: '',
        inicio: '',
        tipo: (cnpjMatch || seqMatch) ? 'Empregado' : 'Contribuinte Individual',
        especial: false,
        salarios: []
      };

      if (cnpjMatch || seqMatch) {
        const match = cnpjMatch || seqMatch;
        // Tenta pegar o nome da empresa na mesma linha
        let lineWithoutCnpj = line.replace(match![0], '').replace(/^\d+\s+/, '').trim();
        
        // Se a linha tiver pouco conteúdo, tenta a linha anterior ou posterior
        if (lineWithoutCnpj.length < 3) {
          // Tenta linha anterior (muitas vezes o nome vem ANTES do CNPJ no PDF)
          if (i > 0 && lines[i-1].length > 5 && !lines[i-1].match(dateRegex) && !lines[i-1].match(cnpjRegex)) {
            lineWithoutCnpj = lines[i-1];
          } 
          // Tenta linha posterior
          else if (i + 1 < lines.length && lines[i+1].length > 5 && !lines[i+1].match(dateRegex)) {
            lineWithoutCnpj = lines[i+1];
          }
        }
        
        currentVinculo.empresa = lineWithoutCnpj || 'Empresa não identificada';
      } else if (nitMatch) {
        currentVinculo.empresa = 'Contribuinte Individual / Autônomo';
      }
    }

    // Tenta capturar salários (Competência MM/AAAA e Valor)
    // Padrões comuns: "01/2020 1.234,56" ou "01/2020 R$ 1.234,56" ou "01/20201.234,56"
    const salaryMatches = line.matchAll(/(\d{2}\/\d{4})\s*(?:R\$\s*)?([\d\.,]{4,15})/g);
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
      
      if (line.toLowerCase().includes('especial') || 
          line.toLowerCase().includes('insalubre') || 
          line.toLowerCase().includes('perigoso') ||
          line.match(/\b(IEAN|AEE|PEN|PENS)\b/)) {
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
