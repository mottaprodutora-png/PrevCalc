import { parseISO, isBefore, isAfter, differenceInDays } from "date-fns";
import { CnisVinculo } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { vinculos: [] };

  // 1. Extrair Nome e Data de Nascimento
  let dataNascimento: string | null = null;
  
  const namePatterns = [
    /Nome:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Nome do Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i
  ];

  const birthDatePatterns = [
    /(?:Data de nascimento|Nascimento):\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Nasc:\s*(\d{2}\/\d{2}\/\d{4})/i
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim().length > 5) {
      result.nome = match[1].trim();
      break;
    }
  }

  for (const pattern of birthDatePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      dataNascimento = formatDateToIso(match[1]);
      result.dataNascimento = dataNascimento;
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
  const hoje = new Date();
  
  // Identifica datas de cabeçalho comuns para ignorar
  const headerDates: string[] = [];
  if (dataNascimento) headerDates.push(dataNascimento);
  
  const emissionMatch = text.match(/(?:Emissão|Processamento|Gerado em):\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (emissionMatch) headerDates.push(formatDateToIso(emissionMatch[1]));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    
    // Ignora linhas que são claramente cabeçalhos de página
    if (lowerLine.includes('cadastro nacional') || lowerLine.includes('extrato do cnis') || lowerLine.includes('página:')) {
      continue;
    }
    
    // Tenta identificar o início de um vínculo
    // Padrão 1: CNPJ/CEI
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/);
    // Padrão 2: NIT
    const nitMatch = line.match(/^(\d+)\s+(\d{3}\.\d{5}\.\d{2}-\d{1})/); 
    // Padrão 3: Sequencial de vínculo (ex: "1 21.234.567/0001-00")
    const seqMatch = line.match(/^(\d+)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    // Padrão 4: Sequencial seguido de data (ex: "1 01/01/2000")
    const seqDateMatch = line.match(/^(\d+)\s+(\d{2}\/\d{2}\/\d{4})/);
    // Padrão 5: "Vínculo: X" ou "Seq: X"
    const labelMatch = line.match(/^(?:Vínculo|Seq|Link|Item):\s*(\d+)/i);
    
    const isNewLink = cnpjMatch || nitMatch || seqMatch || labelMatch || (seqDateMatch && formatDateToIso(seqDateMatch[2]) !== dataNascimento);

    if (isNewLink) {
      // Se já tínhamos um vínculo sendo processado, salvamos
      if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio || currentVinculo.salarios?.length)) {
        result.vinculos.push(currentVinculo as CnisVinculo);
      }
      
      currentVinculo = {
        id: Math.random().toString(36).substr(2, 9),
        empresa: '',
        inicio: '',
        tipo: (cnpjMatch || seqMatch || labelMatch) ? 'Empregado' : 'Contribuinte Individual',
        especial: false,
        salarios: []
      };

      if (cnpjMatch || seqMatch || labelMatch || seqDateMatch) {
        const match = cnpjMatch || seqMatch || labelMatch || seqDateMatch;
        // Tenta pegar o nome da empresa na mesma linha
        let lineWithoutCnpj = line.replace(match![0], '').replace(/^(?:Vínculo|Seq|Link|Item):\s*\d+/i, '').replace(/^\d+\s+/, '').trim();
        
        // Filtra nomes que são apenas cabeçalhos do CNIS ou informações genéricas
        const isInvalidName = (text: string) => 
          text.toLowerCase().includes('cadastro nacional') || 
          text.toLowerCase().includes('extrato do cnis') ||
          text.toLowerCase().includes('inss') ||
          text.toLowerCase().includes('página') ||
          text.toLowerCase().includes('emissão') ||
          text.toLowerCase().includes('processamento') ||
          text.toLowerCase().includes('competência') ||
          text.length < 3;

        if (isInvalidName(lineWithoutCnpj)) {
          lineWithoutCnpj = '';
        }

        // Se a linha tiver pouco conteúdo, tenta a linha anterior ou posterior
        if (!lineWithoutCnpj) {
          // Procura nas 2 linhas anteriores e 2 posteriores
          const candidates = [lines[i-1], lines[i-2], lines[i+1], lines[i+2]];
          for (const cand of candidates) {
            if (cand && cand.length > 5 && !cand.match(dateRegex) && !cand.match(cnpjRegex) && !isInvalidName(cand)) {
              lineWithoutCnpj = cand;
              break;
            }
          }
        }
        
        currentVinculo.empresa = lineWithoutCnpj || 'Empresa não identificada';
      } else if (nitMatch) {
        currentVinculo.empresa = 'Contribuinte Individual / Autônomo';
      }
    }

    // Tenta capturar salários (Competência MM/AAAA e Valor)
    const salaryMatches = line.matchAll(/(\d{2}\/\d{4})\s*(?:R\$\s*)?([\d\.,]{4,15})/g);
    for (const match of salaryMatches) {
      const competencia = formatCompetenciaToIso(match[1]);
      const valor = parseCurrency(match[2]);
      
      // Validação extra: se a competência for muito próxima de hoje, pode ser a data de emissão
      const compDate = parseISO(competencia + '-01');
      const isTooRecent = differenceInDays(hoje, compDate) < 30;

      if (competencia && !isNaN(valor) && valor > 10 && !isTooRecent) {
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
        // Filtra datas que são muito recentes (provavelmente data de emissão do documento)
        // E também filtra a data de nascimento do segurado
        const validDates = dates.filter(d => {
          const isoDate = formatDateToIso(d);
          if (!isoDate) return false;
          
          // Ignora data de nascimento e outras datas de cabeçalho
          if (headerDates.includes(isoDate)) return false;
          
          // Ignora datas muito recentes (provavelmente data de emissão)
          const dateObj = parseISO(isoDate);
          if (isAfter(dateObj, hoje)) return false;
          if (differenceInDays(hoje, dateObj) < 5) return false; // Ignora datas de hoje ou ontem
          
          return true;
        });

        if (validDates.length >= 1) {
          const d1 = formatDateToIso(validDates[0]);
          const d2 = validDates.length > 1 ? formatDateToIso(validDates[1]) : null;

          if (!currentVinculo.inicio) {
            if (d2) {
              const date1 = parseISO(d1);
              const date2 = parseISO(d2);
              if (isBefore(date1, date2)) {
                currentVinculo.inicio = d1;
                currentVinculo.fim = d2;
              } else {
                currentVinculo.inicio = d2;
                currentVinculo.fim = d1;
              }
            } else {
              currentVinculo.inicio = d1;
            }
          } else if (!currentVinculo.fim) {
            const possibleEnd = formatDateToIso(validDates[validDates.length - 1]);
            if (possibleEnd !== currentVinculo.inicio) {
              const start = parseISO(currentVinculo.inicio);
              const end = parseISO(possibleEnd);
              if (isAfter(end, start)) {
                currentVinculo.fim = possibleEnd;
              }
            }
          }
        }

        // Tenta identificar o tipo se ainda for o padrão
        const lowerLine = line.toLowerCase();
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
  
  // Remove R$ e espaços (incluindo espaços entre milhares)
  let clean = valStr.replace(/R\$/g, '').replace(/\s/g, '').trim();
  
  // Se houver vírgula e ponto, o ponto é milhar e a vírgula é decimal (Padrão BR: 1.234,56)
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } 
  // Se houver apenas vírgula, é decimal (1234,56)
  else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  // Se houver apenas ponto, pode ser decimal (1234.56) ou milhar (1.234)
  else if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts[parts.length - 1].length !== 2) {
      // Provavelmente milhar (ex: 1.000)
      clean = clean.replace(/\./g, '');
    }
  }

  const num = parseFloat(clean);
  // Filtra valores absurdos ou que parecem ser sequenciais (ex: 1.00 ou 2.00 isolados)
  if (isNaN(num) || num < 0.01) return 0;
  return num;
}
