import { parseISO, isBefore, isAfter, differenceInDays } from "date-fns";
import { CnisVinculo } from "../types";

export function parseCnisWithRegex(text: string): { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } {
  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { vinculos: [] };
  
  // Clean text but preserve structure
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentVinculo: Partial<CnisVinculo> | null = null;
  const hoje = new Date();

  // 1. Extract Name and Birth Date
  for (const line of lines) {
    if (!result.nome) {
      const nameMatch = line.match(/(?:Nome|Segurado|Nome do Segurado):\s*([A-Z\s]{5,100})/i);
      if (nameMatch) result.nome = nameMatch[1].trim();
    }
    if (!result.dataNascimento) {
      const birthMatch = line.match(/(?:Nascimento|Nasc|Data de nascimento):\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (birthMatch) result.dataNascimento = formatDateToIso(birthMatch[1]);
    }
  }

  // 2. Process Links and Salaries
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect new link start
    // Pattern 1: Number followed by CNPJ/CPF
    const linkStartMatch = line.match(/^(\d+)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/);
    // Pattern 2: Explicit CNPJ/CPF label
    const cnpjLabelMatch = line.match(/(?:CNPJ|CEI|CPF|NIT):\s*([\d\.\-\/]+)/i);
    
    if (linkStartMatch || cnpjLabelMatch) {
      if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio)) {
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

      // Try to find company name (Razão Social)
      let companyName = '';
      if (linkStartMatch) {
        // The name is often after the CNPJ in the same line
        companyName = line.replace(linkStartMatch[0], '').trim();
      }
      
      if (!companyName || companyName.length < 3) {
        // Look ahead for "Nome do Empregador" or "Razão Social"
        for (let j = 1; j <= 5; j++) {
          const nextLine = lines[i + j];
          if (!nextLine) break;
          
          const empMatch = nextLine.match(/(?:Nome do Empregador|Empregador|Empresa|Razão Social):\s*(.+)/i);
          if (empMatch) {
            companyName = empMatch[1].trim();
            break;
          }
          
          // If the line is just uppercase text and not a date/cnpj, it might be the name
          if (nextLine === nextLine.toUpperCase() && nextLine.length > 5 && !nextLine.match(/\d/) && !nextLine.includes(':')) {
            companyName = nextLine.trim();
            break;
          }
        }
      }
      currentVinculo.empresa = companyName || 'Empresa não identificada';
    }

    if (currentVinculo) {
      // Extract Dates
      const startMatch = line.match(/(?:Início|Data Início):\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (startMatch) currentVinculo.inicio = formatDateToIso(startMatch[1]);
      
      const endMatch = line.match(/(?:Fim|Data Fim|Término):\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (endMatch) currentVinculo.fim = formatDateToIso(endMatch[1]);

      // Extract Salaries - Strict Pattern: MM/YYYY followed by Value
      // Avoid matching years like 2024 as values
      const competenceMatch = line.match(/^(\d{2}\/\d{4})/);
      if (competenceMatch) {
        const comp = competenceMatch[1];
        const restOfLine = line.replace(comp, '').trim();
        
        // Look for values like 1.234,56 or 1234,56
        // Must have a comma and two digits at the end
        const valueMatch = restOfLine.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
        if (valueMatch) {
          const competencia = formatCompetenciaToIso(comp);
          const valor = parseCurrency(valueMatch[1]);
          
          // Basic validation: salary shouldn't be just a year (e.g. 2024,00 is possible but 2024 is not)
          if (competencia && valor > 0 && !currentVinculo.salarios?.some(s => s.competencia === competencia)) {
            currentVinculo.salarios?.push({ competencia, valor });
          }
        }
      }

      // Detect Special Time
      if (line.match(/\b(IEAN|AEE|PEN|PENS|ESPECIAL|INSALUBRE)\b/i)) {
        currentVinculo.especial = true;
      }
    }
  }

  // Push last link
  if (currentVinculo && (currentVinculo.empresa || currentVinculo.inicio)) {
    result.vinculos.push(currentVinculo as CnisVinculo);
  }

  // Deduplicate and sort
  const unique = new Map<string, CnisVinculo>();
  result.vinculos.forEach(v => {
    const key = `${v.empresa}-${v.inicio}`;
    if (!unique.has(key) || (v.salarios?.length || 0) > (unique.get(key)?.salarios?.length || 0)) {
      unique.set(key, v);
    }
  });

  result.vinculos = Array.from(unique.values())
    .sort((a, b) => {
      if (!a.inicio) return 1;
      if (!b.inicio) return -1;
      return b.inicio.localeCompare(a.inicio);
    });

  return result;
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
  
  // Remove R$ and spaces
  let clean = valStr.replace(/R\$/g, '').replace(/\s/g, '').trim();
  
  // Standard BR format: 1.234,56
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } 
  else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  else if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts[parts.length - 1].length !== 2) {
      clean = clean.replace(/\./g, '');
    }
  }

  const num = parseFloat(clean);
  if (isNaN(num) || num < 0.01) return 0;
  return num;
}
