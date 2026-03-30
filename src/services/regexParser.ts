import { parseISO, isBefore, isAfter, differenceInDays } from "date-fns";
import { CnisVinculo } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } {
  // 0. Pré-processamento: Limpar ruídos comuns de PDF sem destruir colunas
  const cleanText = text
    .replace(/(\d)\s*\/\s*(\d)/g, '$1/$2') // Corrige datas com espaços (01 / 01 / 2000)
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2') // Corrige valores com espaços (1.000 , 00)
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2'); // Corrige valores com espaços (1 . 000,00)

  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { vinculos: [] };

  // 1. Extrair Nome e Data de Nascimento
  let dataNascimento: string | null = null;
  
  const namePatterns = [
    /Nome:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Nome do Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Segurado:\s*([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i,
    /Nome\s+([A-Z\s]{5,100}?)(\s+Data de nascimento|Nome da mãe|NIT:|CPF:|$)/i
  ];

  const birthDatePatterns = [
    /(?:Data de nascimento|Nascimento):\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Nasc:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Nascimento\s+(\d{2}\/\d{2}\/\d{4})/i
  ];

  for (const pattern of namePatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1] && match[1].trim().length > 5) {
      result.nome = match[1].trim();
      break;
    }
  }

  for (const pattern of birthDatePatterns) {
    const match = cleanText.match(pattern);
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
  const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentVinculo: Partial<CnisVinculo> | null = null;
  const hoje = new Date();
  
  // Identifica datas de cabeçalho comuns para ignorar
  const headerDates: string[] = [];
  if (dataNascimento) headerDates.push(dataNascimento);
  
  const emissionMatch = cleanText.match(/(?:Emissão|Processamento|Gerado em):\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (emissionMatch) headerDates.push(formatDateToIso(emissionMatch[1]));

  // Padrão para identificar competências e salários em tabelas
  const competenceRegex = /(\d{2}\/\d{4})/g;

  // Flag para saber se já entramos na seção de vínculos
  let inVinculosSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    
    // Detecta início da seção de vínculos, mas não bloqueia se não encontrar
    if (lowerLine.includes('relações previdenciárias') || lowerLine.includes('detalhamento dos vínculos') || lowerLine.includes('dados do vínculo')) {
      inVinculosSection = true;
    }

    // Ignora linhas que são claramente cabeçalhos de página ou rodapés inúteis
    if (lowerLine.includes('cadastro nacional') || lowerLine.includes('extrato do cnis') || lowerLine.includes('página:') || lowerLine.includes('www.inss.gov.br')) {
      continue;
    }
    
    // Tenta identificar o início de um vínculo - Padrões mais simples e robustos
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{2}\.\d{3}\.\d{5}\/\d{2})/);
    const nitMatch = line.match(/(?:NIT|PIS|PASEP):\s*(\d{3}\.\d{5}\.\d{2}-\d{1})/) || line.match(/^(\d+)\s+(\d{3}\.\d{5}\.\d{2}-\d{1})/); 
    const seqMatch = line.match(/^(\d+)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    const seqDateMatch = line.match(/^(\d+)\s+(\d{2}\/\d{2}\/\d{4})/);
    const labelMatch = line.match(/^(?:Vínculo|Seq|Link|Item|Nº):\s*(\d+)/i);
    const employerMatch = line.match(/(?:Empregador|Empresa|Orgão):\s*([A-Z0-9\s\.\-\/]{5,100})/i);
    
    // Se encontrar qualquer um desses, é um novo vínculo
    const isNewLink = cnpjMatch || nitMatch || seqMatch || labelMatch || employerMatch || (seqDateMatch && formatDateToIso(seqDateMatch[2]) !== dataNascimento);

    if (isNewLink) {
      // Se já tínhamos um vínculo sendo processado, salvamos
      if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio || currentVinculo.salarios?.length)) {
        result.vinculos.push(currentVinculo as CnisVinculo);
      }
      
      const id = Math.random().toString(36).substr(2, 9);
      let empresa = 'Vínculo não identificado';
      
      if (employerMatch) empresa = employerMatch[1].trim();
      else if (cnpjMatch) {
        // Tenta pegar o nome que costuma vir antes ou depois do CNPJ na mesma linha
        const namePart = line.replace(cnpjMatch[0], '').replace(/^\d+\s+/, '').trim();
        if (namePart.length > 3) empresa = namePart;
      }

      currentVinculo = {
        id,
        empresa,
        inicio: '',
        tipo: (cnpjMatch || seqMatch || labelMatch || employerMatch) ? 'Empregado' : 'Contribuinte Individual',
        especial: false,
        salarios: []
      };

      if (cnpjMatch || seqMatch || labelMatch || seqDateMatch || employerMatch) {
        const match = cnpjMatch || seqMatch || labelMatch || seqDateMatch || employerMatch;
        // Tenta pegar o nome da empresa na mesma linha
        let lineWithoutCnpj = line.replace(match![0], '').replace(/^(?:Vínculo|Seq|Link|Item|Empregador):\s*\d*/i, '').replace(/^\d+\s+/, '').trim();
        
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
    // Padrão 1: MM/AAAA Valor
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

    // Padrão 2: Tabela de salários (Competência em uma coluna, valor em outra)
    // Se a linha contém apenas uma competência e um valor em posições distantes
    const compMatch = line.match(/(\d{2}\/\d{4})/);
    const valMatch = line.match(/(?:R\$\s*)?([\d\.,]{4,15})/);
    if (compMatch && valMatch && !line.includes('Emissão') && !line.includes('Nascimento') && !line.includes('NIT')) {
        const competencia = formatCompetenciaToIso(compMatch[1]);
        const valor = parseCurrency(valMatch[1]);
        if (competencia && !isNaN(valor) && valor > 10) {
            if (currentVinculo && !currentVinculo.salarios?.some(s => s.competencia === competencia)) {
                currentVinculo.salarios?.push({ competencia, valor });
            }
        }
    }

    // Tenta identificar datas e tipo no bloco atual
    if (currentVinculo) {
      // Procura por "Início: 01/01/2000" ou "Data Início: 01/01/2000"
      const startMatch = line.match(/(?:Início|Data Início|Data de Início):\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (startMatch) {
        currentVinculo.inicio = formatDateToIso(startMatch[1]);
      }

      // Procura por "Fim: 01/01/2000" ou "Data Fim: 01/01/2000"
      const endMatch = line.match(/(?:Fim|Data Fim|Data de Fim|Término):\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (endMatch) {
        currentVinculo.fim = formatDateToIso(endMatch[1]);
      }

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

  // Salva o último vínculo se existir
  if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio || currentVinculo.salarios?.length)) {
    // Verifica se já não foi adicionado (evita duplicatas se o loop terminou em um isNewLink)
    if (!result.vinculos.some(v => v.id === currentVinculo?.id)) {
      result.vinculos.push(currentVinculo as CnisVinculo);
    }
  }

  // Pós-processamento: Limpar vínculos vazios, duplicados e ordenar
  const uniqueVinculos = new Map<string, CnisVinculo>();
  
  result.vinculos.forEach(v => {
    // Se não tem empresa nem início, ignora
    if (v.empresa === 'Vínculo não identificado' && !v.inicio && (!v.salarios || v.salarios.length === 0)) {
      return;
    }

    // Cria uma chave baseada em empresa e início para evitar duplicatas reais
    const key = `${v.empresa}-${v.inicio || 'sem-data'}`;
    if (!uniqueVinculos.has(key) || (v.salarios?.length || 0) > (uniqueVinculos.get(key)?.salarios?.length || 0)) {
      uniqueVinculos.set(key, v);
    }
  });

  result.vinculos = Array.from(uniqueVinculos.values())
    .filter(v => v.inicio || v.empresa !== 'Vínculo não identificado' || v.salarios?.length)
    .sort((a, b) => {
      if (!a.inicio) return 1;
      if (!b.inicio) return -1;
      try {
        return parseISO(b.inicio).getTime() - parseISO(a.inicio).getTime();
      } catch (e) {
        return 0;
      }
    });

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
