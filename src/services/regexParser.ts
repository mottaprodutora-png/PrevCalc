import { CnisVinculo, CnisSalario } from "../types";

export function parseCnisWithRegex(text: string): { 
  nome?: string, 
  dataNascimento?: string, 
  vinculos: CnisVinculo[] 
} {
  const result: { nome?: string, dataNascimento?: string, vinculos: CnisVinculo[] } = { 
    vinculos: [] 
  };

  // 1. Nome do titular
  const nameMatches = Array.from(text.matchAll(
    /(?:^|\n)Nome:\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s\.]+?)(?=\s+Nome da mãe|\s+Data de nascimento|\s+CPF:|\s+NIT:|\r?\n|$)/gm
  ));
  const validCandidates: { name: string, index: number }[] = [];
  for (const match of nameMatches) {
    const candidate = match[1].trim().split('\n')[0].trim();
    const index = match.index || 0;
    const contextBefore = text.substring(Math.max(0, index - 30), index).toLowerCase();
    const isInstitution = candidate.includes("INSTITUTO NACIONAL") || 
                          candidate.includes("MINISTÉRIO");
    if (!contextBefore.includes("mãe") && !contextBefore.includes("pai") && 
        !isInstitution && candidate.length > 5) {
      validCandidates.push({ name: candidate, index });
    }
  }
  if (validCandidates.length >= 2) {
    result.nome = validCandidates[1].name;
  } else if (validCandidates.length === 1) {
    result.nome = validCandidates[0].name;
  }

  // 2. Data de nascimento
  const birthMatch = text.match(/Data de nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (birthMatch) {
    result.dataNascimento = formatDateToIso(birthMatch[1]);
  }

  // 3. Dividir o texto em BLOCOS por Seq.
  // Cada bloco começa com o número de sequência e vai até o próximo
  // Usamos uma regex que detecta o padrão de início de bloco:
  // - Linha com apenas um número (1-3 dígitos) — padrão do CNIS
  // - Ou "Seq. N" explícito para benefícios/MEI
  
  // Primeiro, normalizamos quebras de linha
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Dividimos por marcadores de sequência que o INSS usa
  // O padrão no PDF extraído é: número isolado numa linha, seguido de NIT/CNPJ
  // OU linhas do tipo "Código Emp. ... Seq. NIT Vín ..."
  
  // Estratégia: encontrar todas as posições onde começa um novo vínculo
  // usando o padrão de "Seq. N" nos cabeçalhos de tabela do CNIS
  
  // O CNIS usa "Seq. NIT Vín" como cabeçalho, e logo abaixo vem:
  // "N  NIT_DO_SEGURADO  CNPJ_EMPRESA  NOME_EMPRESA"
  // OU para benefícios: "N  NIT_DO_SEGURADO  NB  Benefício  ESPECIE  DATA"
  
  // Vamos dividir por blocos identificando onde cada sequência começa
  // através da linha que contém CNPJ (empregador) ou NB (benefício)
  
  // --- NOVA ABORDAGEM: blocos separados por cabeçalho de vínculo ---
  
  // Remove cabeçalhos repetidos de página
  const cleanedLines = normalizedText.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !l.includes("INSS") || l.match(/\d{2}\/\d{4}/))  // mantém linhas com datas mesmo que tenham "INSS"
    .filter(l => !l.includes("CNIS - Cadastro Nacional"))
    .filter(l => !l.includes("Extrato Previdenciário"))
    .filter(l => !l.includes("Identificação do Filiado"))
    .filter(l => !l.includes("Relações Previdenciárias"))
    .filter(l => !l.includes("O INSS poderá rever"))
    .filter(l => !/Página \d+ de \d+/.test(l))
    .filter(l => !/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(l))
    // Remove linha do titular que se repete em cada página
    .filter(l => !(l.includes("NIT:") && l.includes("CPF:") && l.includes("Nome:")))
    .filter(l => !l.startsWith("Nome da mãe:"))
    .filter(l => !l.startsWith("Data de nascimento:") && !l.startsWith("Nome:") && !l.startsWith("NIT:"))
    // Remove cabeçalhos de tabela
    .filter(l => !l.match(/^Seq\.\s+NIT\s+/i))
    .filter(l => !l.match(/^Matrícula do/i))
    .filter(l => !l.match(/^Trabalhador/i))
    .filter(l => !l.match(/^Tipo Filiado no/i))
    .filter(l => !l.match(/^Vínculo/i))
    .filter(l => !l.match(/^Código Emp\.\s+Origem do Vínculo/i))
    .filter(l => !l.match(/^Competência\s+Remuneração\s+Indicadores/i))
    .filter(l => !l.match(/^Remunerações\s*$/i))
    .filter(l => !l.match(/^Contribuições\s*$/i))
    .filter(l => !l.match(/^Data Início\s+Data Fim/i));

  // Identifica linhas que são cabeçalho de vínculo empregador
  // Padrão: CNPJ isolado em linha ou CNPJ + nome empresa
  // No texto extraído do INSS, o cabeçalho de cada vínculo tem este formato após limpeza:
  // Linha com CNPJ: "XX.XXX.XXX/XXXX-XX  NOME DA EMPRESA"
  // OU NIT do beneficiário seguido de NB para benefícios
  
  // Vamos reconstruir os blocos identificando o início de cada vínculo
  // O início é identificado por uma linha que contém um CNPJ formatado
  // (para empregadores) ou "Benefício" + número (para benefícios/auxílios)
  
  interface VinculoBlock {
    seq: number;
    lines: string[];
    tipo: 'empregador' | 'beneficio' | 'mei' | 'agrupamento';
    headerLine: string;
  }
  
  const blocks: VinculoBlock[] = [];
  let currentBlock: VinculoBlock | null = null;
  let seqCounter = 0;

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    
    // Detecta cabeçalho de empregador: linha com CNPJ (XX.XXX.XXX/XXXX-XX)
    const cnpjLineMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+(.*)/);
    
    // Detecta benefício: linha com NB + "Benefício" + espécie
    const benefitLineMatch = line.match(/(\d{9,11})\s+Benefício\s+(\d+)\s*-\s*(.+)/i);
    
    // Detecta RECOLHIMENTO/MEI/AGRUPAMENTO individual
    const meiLineMatch = line.match(/^(RECOLHIMENTO|AGRUPAMENTO DE CONTRATANTES\/COOPERATIVAS)\s*/i);
    
    // Detecta linha de sequência + NIT do segurado (linha anterior ao cabeçalho)
    // Formato: "1  160.09612.11-0  94.420.080/0001-88  NOME..."
    // Ou apenas: "1  167.35735.45-6" (quando NIT e CNPJ estão em linhas separadas)
    const seqNitMatch = line.match(/^(\d{1,3})\s+(\d{3}[\.\s]?\d{5}[\.\s]?\d{2}[-\s]?\d)\s*(.*)/);
    
    if (seqNitMatch) {
      const seq = parseInt(seqNitMatch[1]);
      const restAfterNit = seqNitMatch[3];
      
      // Salva bloco anterior
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      seqCounter = seq;
      
      // Verifica se o CNPJ já está na mesma linha
      const inlineCnpj = restAfterNit.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*(.*)/);
      const inlineBenefit = restAfterNit.match(/(\d{9,11})\s+Benefício\s+(\d+)/i);
      const inlineMei = restAfterNit.match(/RECOLHIMENTO|AGRUPAMENTO/i);
      
      if (inlineBenefit) {
        currentBlock = { seq, lines: [line], tipo: 'beneficio', headerLine: line };
      } else if (inlineMei) {
        currentBlock = { seq, lines: [line], tipo: 'mei', headerLine: line };
      } else if (inlineCnpj) {
        currentBlock = { seq, lines: [line], tipo: 'empregador', headerLine: line };
      } else {
        // CNPJ virá na próxima linha — abre bloco com tipo provisório
        currentBlock = { seq, lines: [line], tipo: 'empregador', headerLine: line };
      }
      continue;
    }
    
    // Se a linha tem CNPJ e não temos seq ainda detectado na linha anterior,
    // pode ser que a linha de seq e NIT não foi detectada (texto sem formatação)
    if (cnpjLineMatch && currentBlock && currentBlock.lines.length <= 2) {
      // Atualiza o headerLine com o CNPJ
      currentBlock.headerLine = line;
      currentBlock.lines.push(line);
      continue;
    }
    
    // Detecta benefício quando está em linha separada do seq
    if (benefitLineMatch && currentBlock && currentBlock.lines.length <= 3) {
      currentBlock.tipo = 'beneficio';
      currentBlock.headerLine = line;
      currentBlock.lines.push(line);
      continue;
    }
    
    if (meiLineMatch && currentBlock && currentBlock.lines.length <= 3) {
      currentBlock.tipo = 'mei';
      currentBlock.headerLine = line;
      currentBlock.lines.push(line);
      continue;
    }
    
    // Linha de dados — adiciona ao bloco atual
    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // 4. Processa cada bloco para extrair o vínculo
  for (const block of blocks) {
    const vinculo = processBlock(block);
    if (vinculo) {
      result.vinculos.push(vinculo);
    }
  }

  // Ordena por seq
  result.vinculos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  // Log de validação
  console.log("--- VALIDAÇÃO PÓS-PARSE ---");
  console.log(`Titular: ${result.nome}`);
  console.log(`Total de vínculos: ${result.vinculos.length}`);
  result.vinculos.forEach(v => {
    const dataInicio = v.inicio ? formatDateFromIso(v.inicio) : '?';
    const dataFim = v.fim ? formatDateFromIso(v.fim) : 'Ativo';
    console.log(`  Seq.${v.seq} - ${(v.empresa || '').padEnd(35)} - ${dataInicio} → ${dataFim} - ${v.salarios?.length || 0} comp.`);
  });
  console.log("---------------------------");

  return result;
}

function processBlock(block: { 
  seq: number, 
  lines: string[], 
  tipo: string, 
  headerLine: string 
}): CnisVinculo | null {
  
  const id = Math.random().toString(36).substr(2, 9);
  let empresa = '';
  let cnpj: string | undefined;
  let nb: string | undefined;
  let especie: number | undefined;
  let inicio = '';
  let fim: string | undefined;
  let situacao: string | undefined;
  let tipo: CnisVinculo['tipo'] = 'Empregado';
  const salarios: CnisSalario[] = [];
  const indicadores: string[] = [];

  // Extrai informações do cabeçalho
  for (const line of block.lines.slice(0, 6)) { // cabeçalho está nas primeiras linhas
    
    // CNPJ + Nome da empresa
    const cnpjMatch = line.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+(.*)/);
    if (cnpjMatch && !cnpj) {
      cnpj = cnpjMatch[1];
      const rest = cnpjMatch[2];
      // Remove tipo de vínculo e outros campos após o nome
      empresa = rest
        .replace(/Empregad[oa]?\s*(Pú|Pri)?.*$/i, '')
        .replace(/Contribuinte.*$/i, '')
        .replace(/\d{3}\.\d{5}\.\d{2}-\d.*$/, '') // remove NIT
        .trim();
    }
    
    // Datas de início e fim
    const datesMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
    if (datesMatch && !inicio) {
      inicio = formatDateToIso(datesMatch[1]);
      fim = formatDateToIso(datesMatch[2]);
    } else {
      const singleDate = line.match(/(?:Data Início|inicio)[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
      if (singleDate && !inicio) inicio = formatDateToIso(singleDate[1]);
    }
    
    // Benefício
    const benefitMatch = line.match(/Benefício\s+(\d+)\s*-\s*(.+?)(?:\s+\d{2}\/\d{2}\/\d{4}|$)/i);
    if (benefitMatch) {
      tipo = 'Benefício';
      especie = parseInt(benefitMatch[1]);
      empresa = `Benefício ${especie} - ${benefitMatch[2].trim()}`;
      nb = String(especie);
    }
    
    // Situação CESSADO
    if (line.includes('CESSADO') || line.includes('2 - CESSADO')) {
      situacao = 'CESSADO';
    }
    
    // MEI / Recolhimento
    if (block.tipo === 'mei' || line.match(/RECOLHIMENTO|MEI/i)) {
      tipo = 'MEI';
      if (!empresa) empresa = 'RECOLHIMENTO (MEI)';
    }
    
    // Agrupamento
    if (line.match(/AGRUPAMENTO DE CONTRATANTES/i)) {
      tipo = 'Autônomo';
      empresa = 'AGRUPAMENTO DE CONTRATANTES/COOPERATIVAS';
    }
    
    // Indicadores do vínculo
    if (line.startsWith('Indicadores:')) {
      const inds = line.replace('Indicadores:', '').trim().split(/[\s,]+/);
      indicadores.push(...inds.filter(x => x.length > 0));
    }
  }

  // Extrai remunerações/contribuições de TODAS as linhas do bloco
  for (const line of block.lines) {
    // Formato MEI: 09/2024  14/11/2024  70,60  1.412,00  IREC-MEI
    const meiRowMatch = line.match(/^(\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+([\d\.\,]+)\s+([\d\.\,]+)(.*)/);
    if (meiRowMatch) {
      const competencia = formatCompetenciaToIso(meiRowMatch[1]);
      const valor = parseCurrency(meiRowMatch[3]); // salário de contribuição (4ª coluna)
      const inds = meiRowMatch[4].trim().split(/[\s,]+/).filter(x => x.length > 2);
      if (competencia && valor > 0) {
        addOrUpdateSalario({ salarios }, { competencia, valor, indicadores: inds });
      }
      continue;
    }
    
    // Formato padrão: MM/AAAA  valor  [indicador]
    const stdMatches = Array.from(line.matchAll(/(\d{2}\/\d{4})\s+([\d\.\,]+)(?:\s+([A-Z][A-Z\-]+))?/g));
    for (const m of stdMatches) {
      const competencia = formatCompetenciaToIso(m[1]);
      const valor = parseCurrency(m[2]);
      const ind = m[3] ? [m[3]] : undefined;
      if (competencia && valor > 0) {
        addOrUpdateSalario({ salarios }, { competencia, valor, indicadores: ind });
      }
    }
  }

  // Se não conseguimos empresa, tenta pegar da primeira linha não-número
  if (!empresa) {
    for (const line of block.lines) {
      if (/^[A-ZÁÉÍÓÚÀÂÃÊÔÕÇ]/.test(line) && line.length > 5 && !line.match(/^\d/)) {
        empresa = line.trim();
        break;
      }
    }
  }

  return {
    id,
    seq: block.seq,
    empresa: empresa || 'Empresa não identificada',
    cnpj,
    nb,
    especie,
    inicio,
    fim,
    tipo,
    situacao,
    salarios,
    indicadores: [...new Set(indicadores)]
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function addOrUpdateSalario(
  vinculo: { salarios?: CnisSalario[] }, 
  novoSalario: CnisSalario
) {
  if (!vinculo.salarios) vinculo.salarios = [];
  const existing = vinculo.salarios.find(s => s.competencia === novoSalario.competencia);
  if (existing) {
    if (novoSalario.indicadores?.includes('IREM-ACD')) {
      existing.valor += novoSalario.valor;
    } else {
      existing.valor = Math.max(existing.valor, novoSalario.valor);
    }
    if (novoSalario.indicadores) {
      existing.indicadores = [
        ...new Set([...(existing.indicadores || []), ...novoSalario.indicadores])
      ];
    }
  } else {
    vinculo.salarios.push({ ...novoSalario });
  }
}

function formatDateToIso(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return '';
}

function formatDateFromIso(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return isoDate;
}

function formatCompetenciaToIso(compStr: string): string {
  if (!compStr) return '';
  const parts = compStr.split('/');
  if (parts.length === 2) return `${parts[1]}-${parts[0]}`;
  return '';
}

function parseCurrency(valStr: string): number {
  if (!valStr) return 0;
  return parseFloat(valStr.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
}
