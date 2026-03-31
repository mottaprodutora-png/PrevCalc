import { CnisVinculo, CnisSalario } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { vinculos: [] };
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentVinculo: Partial<CnisVinculo> | null = null;
  let inRemunerations = false;
  let currentSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Header Parsing
    // NIT: 167.35735.45-6  CPF: 020.485.330-35  Nome: ALENCAR MATTOS DE OLIVEIRA
    // Ensure we only pick "Nome:" when NIT and CPF are present to avoid picking "Nome da mãe:"
    if (line.includes('Nome:') && line.includes('NIT:') && !result.nome) {
      const nameMatch = line.match(/Nome:\s*([A-Z\s]+?)(?:\s+Nome da mãe:|$)/i);
      if (nameMatch) result.nome = nameMatch[1].trim();
    }
    // Data de nascimento: 27/08/1989
    if (line.includes('Data de nascimento:') && !result.dataNascimento) {
      const birthMatch = line.match(/Data de nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (birthMatch) result.dataNascimento = formatDateToIso(birthMatch[1]);
    }

    // 2. Link Detection
    // Seq.  NIT Vín         Código Emp.          Origem do Vínculo         Data Início  Data Fim  Últ. Remun.
    //  1    160.09612.11-0  94.420.080/0001-88   INDUSTRIA DE EQUIP...     15/10/2003   31/12/2003   12/2003
    // NIT format can vary, so let's be more flexible: \d{3}[\.\s]?\d{5}[\.\s]?\d{2}[-\s]?\d
    const linkHeaderMatch = line.match(/^(\d+)[\.\s]+\d{3}[\.\s]?\d{5}[\.\s]?\d{2}[-\s]?\d\s+([\d\.\-\/]+)/);
    
    // Also handle "Seq.12: Benefício 31" or "Seq.12 - Benefício 31" style
    const benefitMatch = line.match(/^Seq\.(\d+)(?::|-)\s*Benefício\s*(\d+)/i);

    if (linkHeaderMatch || benefitMatch) {
      const seq = parseInt(linkHeaderMatch ? linkHeaderMatch[1] : benefitMatch![1]);
      
      if (seq > currentSeq) {
        if (currentVinculo) {
          result.vinculos.push(currentVinculo as CnisVinculo);
        }
        currentSeq = seq;
        inRemunerations = false;

        let tipo: CnisVinculo['tipo'] = 'Empregado';
        let empresa = '';
        let inicio = '';
        let fim: string | undefined;
        let cnpj: string | undefined;
        let nb: string | undefined;
        let especie: number | undefined;
        let situacao: string | undefined;

        if (benefitMatch) {
          tipo = 'Benefício';
          especie = parseInt(benefitMatch[2]);
          empresa = `Benefício ${especie}`;
          
          // Look for dates in the same line: (09/12/2012 a 10/01/2013)
          const datesMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|à)\s*(\d{2}\/\d{2}\/\d{4})/);
          if (datesMatch) {
            inicio = formatDateToIso(datesMatch[1]);
            fim = formatDateToIso(datesMatch[2]);
          }
          if (line.includes('CESSADO')) situacao = 'CESSADO';
        } else {
          cnpj = linkHeaderMatch![2];
          
          // More robust company name extraction: it's between CNPJ and the first date
          const companyAndDatesMatch = line.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})/);
          if (companyAndDatesMatch) {
            empresa = companyAndDatesMatch[1].trim();
            inicio = formatDateToIso(companyAndDatesMatch[2]);
            
            // Try to find the end date which follows the start date
            const remainingLine = line.substring(line.indexOf(companyAndDatesMatch[2]) + 10);
            const endDateMatch = remainingLine.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (endDateMatch) {
              fim = formatDateToIso(endDateMatch[1]);
            }
          } else {
            // Fallback to split if regex fails
            const parts = line.split(/\s{2,}/);
            if (parts.length >= 5) {
              empresa = parts[3];
              inicio = formatDateToIso(parts[4]);
              if (parts[5] && parts[5].match(/\d{2}\/\d{2}\/\d{4}/)) {
                fim = formatDateToIso(parts[5]);
              }
            }
          }
        }

        currentVinculo = {
          id: Math.random().toString(36).substr(2, 9),
          seq: currentSeq,
          empresa: empresa || 'Empresa não identificada',
          cnpj,
          nb,
          especie,
          inicio,
          fim,
          tipo,
          situacao,
          salarios: [],
          indicadores: []
        };
        continue;
      }
    }

    // Special case for MEI/Recolhimento (Seq. 19/20)
    const meiMatch = line.match(/^Seq\.(\d+)(?::|-)\s*(RECOLHIMENTO|AGRUPAMENTO|MEI)/i);
    if (meiMatch) {
      const seq = parseInt(meiMatch[1]);
      if (seq > currentSeq) {
        if (currentVinculo) result.vinculos.push(currentVinculo as CnisVinculo);
        currentSeq = seq;
        inRemunerations = true; // MEI usually lists competencies directly
        
        const datesMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|à)\s*(\d{2}\/\d{2}\/\d{4})/);
        
        currentVinculo = {
          id: Math.random().toString(36).substr(2, 9),
          seq: currentSeq,
          empresa: meiMatch[2].toUpperCase(),
          tipo: 'MEI',
          inicio: datesMatch ? formatDateToIso(datesMatch[1]) : '',
          fim: datesMatch ? formatDateToIso(datesMatch[2]) : undefined,
          salarios: [],
          indicadores: []
        };
        continue;
      }
    }

    if (currentVinculo) {
      // Indicators for link
      if (line.startsWith('Indicadores:')) {
        const indicators = line.replace('Indicadores:', '').trim().split(/\s+/);
        currentVinculo.indicadores = [...(currentVinculo.indicadores || []), ...indicators];
      }

      // Remunerations section
      if (line.includes('— Remunerações —')) {
        inRemunerations = true;
        continue;
      }

      // Reset inRemunerations if we hit a new section that is NOT remunerations
      if (inRemunerations && (line.includes('Seq.') || line.includes('NIT:') || line.includes('Página:'))) {
        // But only if it's not a line we can parse as a remuneration
        const isRemunLine = line.match(/\d{2}\/\d{4}/);
        if (!isRemunLine) {
          inRemunerations = false;
        }
      }

      if (inRemunerations) {
        // MEI format: 09/2024 14/11/2024 70,60 1.412,00 IREC-MEI
        const meiRowMatch = line.match(/^(\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+[\d\.\,]+\s+([\d\.\,]+)(.*)/);
        if (meiRowMatch) {
          const competencia = formatCompetenciaToIso(meiRowMatch[1]);
          const valor = parseCurrency(meiRowMatch[2]);
          const indicadores = meiRowMatch[3].trim().split(/[\s,]+/).filter(x => x.length > 0);
          
          addOrUpdateSalario(currentVinculo, { competencia, valor, indicadores });
          continue;
        }

        // Standard format: 10/2003 33,00 11/2003 90,00
        const stdMatches = line.matchAll(/(\d{2}\/\d{4})\s+([\d\.\,]+)/g);
        for (const match of stdMatches) {
          const competencia = formatCompetenciaToIso(match[1]);
          const valor = parseCurrency(match[2]);
          if (competencia && valor > 0) {
            addOrUpdateSalario(currentVinculo, { competencia, valor });
          }
        }
      }
    }
  }

  if (currentVinculo) {
    result.vinculos.push(currentVinculo as CnisVinculo);
  }

  // Sort and clean
  result.vinculos = result.vinculos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  return result;
}

function addOrUpdateSalario(vinculo: Partial<CnisVinculo>, novoSalario: CnisSalario) {
  if (!vinculo.salarios) vinculo.salarios = [];
  
  const existing = vinculo.salarios.find(s => s.competencia === novoSalario.competencia);
  if (existing) {
    // If IREM-ACD is present, we should sum. Otherwise, use the new value if it's higher
    if (novoSalario.indicadores?.includes('IREM-ACD')) {
      existing.valor += novoSalario.valor;
    } else {
      existing.valor = Math.max(existing.valor, novoSalario.valor);
    }
    if (novoSalario.indicadores) {
      existing.indicadores = [...new Set([...(existing.indicadores || []), ...novoSalario.indicadores])];
    }
  } else {
    vinculo.salarios.push(novoSalario);
  }
}

function formatDateToIso(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return '';
}

function formatCompetenciaToIso(compStr: string): string {
  if (!compStr) return '';
  const parts = compStr.split('/');
  if (parts.length === 2) {
    return `${parts[1]}-${parts[0]}`;
  }
  return '';
}

function parseCurrency(valStr: string): number {
  if (!valStr) return 0;
  // Remove dots (thousands) and replace comma with dot (decimal)
  let clean = valStr.replace(/\./g, '').replace(',', '.').replace(/[^\d\.]/g, '');
  return parseFloat(clean) || 0;
}
