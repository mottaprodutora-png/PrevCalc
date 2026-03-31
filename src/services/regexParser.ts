import { CnisVinculo, CnisSalario } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { vinculos: [] };
  
  // 1. Extração do Nome do Titular (antes de filtrar cabeçalhos)
  // O nome do titular está na mesma linha que NIT e CPF, após Nome:.
  // O nome da mãe está na linha seguinte, após Nome da mãe:.
  const nameMatch = text.match(/Nome:\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s]+?)(?=Data de nascimento|Nome da mãe|$)/i);
  if (nameMatch) {
    result.nome = nameMatch[1].trim();
  }

  // Extração da Data de Nascimento
  const birthMatch = text.match(/Data de nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (birthMatch) {
    result.dataNascimento = formatDateToIso(birthMatch[1]);
  }

  // 2. Filtragem de Cabeçalhos Repetidos
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => {
      const isHeader = 
        l.includes("INSS") || 
        l.includes("CNIS - Cadastro Nacional") || 
        l.includes("Extrato Previdenciário") || 
        l.includes("Identificação do Filiado") || 
        l.includes("Relações Previdenciárias") || 
        l.includes("O INSS poderá rever") || 
        l.includes("NIT:") || // Remove a linha do titular/CPF que se repete
        /Página \d+ de \d+/.test(l);
      return !isHeader;
    });

  let currentVinculo: Partial<CnisVinculo> | null = null;
  let currentSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 3. Detecção de Novo Vínculo (Seq. NIT/CNPJ Nome...)
    // Padrão: número inteiro + NIT/CNPJ + Nome
    // Ex: 1    160.09612.11-0  94.420.080/0001-88   INDUSTRIA DE EQUIP...
    const linkHeaderMatch = line.match(/^(\d+)[\.\s]+(\d{2,3}[\.\d\/\-]{8,})\s+(.+)/);
    const benefitMatch = line.match(/^Seq\.(\d+)(?::|-)\s*Benefício\s*(\d+)/i);
    const meiMatch = line.match(/^Seq\.(\d+)(?::|-)\s*(RECOLHIMENTO|AGRUPAMENTO|MEI)/i);

    const match = linkHeaderMatch || benefitMatch || meiMatch;

    if (match) {
      const seq = parseInt(match[1]);
      
      // Se encontrarmos uma nova sequência maior, fechamos o anterior e abrimos o novo
      if (seq > currentSeq) {
        if (currentVinculo) {
          result.vinculos.push(currentVinculo as CnisVinculo);
        }
        currentSeq = seq;

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
          nb = benefitMatch[2];
          
          const datesMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|à)\s*(\d{2}\/\d{2}\/\d{4})/);
          if (datesMatch) {
            inicio = formatDateToIso(datesMatch[1]);
            fim = formatDateToIso(datesMatch[2]);
          }
          if (line.includes('CESSADO')) situacao = 'CESSADO';
        } else if (meiMatch) {
          tipo = 'MEI';
          empresa = meiMatch[2].toUpperCase();
          const datesMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|à)\s*(\d{2}\/\d{2}\/\d{4})/);
          if (datesMatch) {
            inicio = formatDateToIso(datesMatch[1]);
            fim = formatDateToIso(datesMatch[2]);
          }
        } else {
          cnpj = linkHeaderMatch![2];
          const restOfLine = linkHeaderMatch![3];
          
          // Extração da empresa e datas no restante da linha
          // Procure por datas no formato DD/MM/AAAA
          const datesInLine = restOfLine.match(/(\d{2}\/\d{2}\/\d{4})/g);
          if (datesInLine && datesInLine.length >= 1) {
            inicio = formatDateToIso(datesInLine[0]);
            if (datesInLine.length >= 2) {
              fim = formatDateToIso(datesInLine[1]);
            }
            
            // A empresa está antes da primeira data
            const firstDateIndex = restOfLine.indexOf(datesInLine[0]);
            empresa = restOfLine.substring(0, firstDateIndex).trim();
          } else {
            // Se não houver datas, o resto é a empresa
            empresa = restOfLine.trim();
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

    // 4. Processamento de Remunerações e Indicadores para o Vínculo Ativo
    if (currentVinculo) {
      // Indicadores do vínculo
      if (line.startsWith('Indicadores:')) {
        const indicators = line.replace('Indicadores:', '').trim().split(/\s+/);
        currentVinculo.indicadores = [...new Set([...(currentVinculo.indicadores || []), ...indicators])];
      }

      // Remunerações: MM/AAAA + valor
      // Formato padrão: 10/2003 33,00
      const stdMatches = line.matchAll(/(\d{2}\/\d{4})\s+([\d\.\,]+)/g);
      for (const m of stdMatches) {
        const competencia = formatCompetenciaToIso(m[1]);
        const valor = parseCurrency(m[2]);
        if (competencia && valor > 0) {
          addOrUpdateSalario(currentVinculo, { competencia, valor });
        }
      }

      // Formato MEI: 09/2024 14/11/2024 70,60 1.412,00 IREC-MEI
      const meiRowMatch = line.match(/^(\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+[\d\.\,]+\s+([\d\.\,]+)(.*)/);
      if (meiRowMatch) {
        const competencia = formatCompetenciaToIso(meiRowMatch[1]);
        const valor = parseCurrency(meiRowMatch[2]);
        const indicadores = meiRowMatch[3].trim().split(/[\s,]+/).filter(x => x.length > 0);
        addOrUpdateSalario(currentVinculo, { competencia, valor, indicadores });
      }
    }
  }

  if (currentVinculo) {
    result.vinculos.push(currentVinculo as CnisVinculo);
  }

  // Ordenação final
  result.vinculos = result.vinculos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  // 5. VALIDAÇÃO OBRIGATÓRIA
  console.log("--- VALIDAÇÃO PÓS-PARSE ---");
  console.log(`Titular: ${result.nome}`);
  console.log(`Total de vínculos: ${result.vinculos.length}`);
  console.log("Por vínculo:");
  result.vinculos.forEach(v => {
    const dataFim = v.fim ? formatDateFromIso(v.fim) : 'Ativo';
    const dataInicio = v.inicio ? formatDateFromIso(v.inicio) : '?';
    console.log(`  Seq.${v.seq} - ${v.empresa.padEnd(30)} - ${dataInicio} a ${dataFim} - ${v.salarios?.length || 0} competências`);
  });
  console.log("---------------------------");

  return result;
}

function formatDateFromIso(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
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
