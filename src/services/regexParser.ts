import { CnisVinculo, CnisSalario } from "../types";

export function parseCnisWithRegex(text: string): {
  nome?: string;
  dataNascimento?: string;
  vinculos: CnisVinculo[];
} {
  const result: { nome?: string; dataNascimento?: string; vinculos: CnisVinculo[] } = {
    vinculos: [],
  };

  // ─── 1. NOME DO TITULAR ───────────────────────────────────────────────────
  // Estratégia: pega todos os nomes em maiúsculas que aparecem após "Nome:"
  // e escolhe o que NÃO é nome da mãe e NÃO é instituição
  const nomeMatch = text.match(
    /Nome:\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s]+?)(?=\s*(?:Nome da mãe|Data de nascimento|CPF:|NIT:|\n))/
  );
  if (nomeMatch) {
    const candidato = nomeMatch[1].trim();
    if (
      !candidato.includes("INSTITUTO") &&
      !candidato.includes("MINISTÉRIO") &&
      candidato.length > 5
    ) {
      result.nome = candidato;
    }
  }

  // Se ainda não achou, tenta buscar ALENCAR/nome do segurado diretamente
  // procurando o padrão CPF + Nome juntos
  if (!result.nome) {
    const cpfNomeMatch = text.match(
      /CPF:\s*[\d\.\-]+\s+Nome:\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s]+?)(?=\s*(?:Nome da mãe|Data de nascimento|\n))/
    );
    if (cpfNomeMatch) {
      result.nome = cpfNomeMatch[1].trim();
    }
  }

  // ─── 2. DATA DE NASCIMENTO ────────────────────────────────────────────────
  const nascMatch = text.match(/Data de nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (nascMatch) {
    result.dataNascimento = formatDateToIso(nascMatch[1]);
  }

  // ─── 3. EXTRAÇÃO POR SEQ ─────────────────────────────────────────────────
  // Estratégia central: encontrar todas as ocorrências de "Seq. N" no texto
  // e usar como âncoras para delimitar cada vínculo
  
  // Encontra todas as posições de "Seq. N" (com número)
  const seqPositions: { seq: number; pos: number }[] = [];
  const seqRegex = /\bSeq\.\s+(\d{1,3})\b/g;
  let seqMatch;
  while ((seqMatch = seqRegex.exec(text)) !== null) {
    const seq = parseInt(seqMatch[1]);
    // Evita duplicatas do mesmo seq
    if (!seqPositions.find(s => s.seq === seq)) {
      seqPositions.push({ seq, pos: seqMatch.index });
    }
  }

  // Ordena por posição no texto
  seqPositions.sort((a, b) => a.pos - b.pos);

  // Para cada seq, extrai o bloco de texto correspondente
  for (let i = 0; i < seqPositions.length; i++) {
    const { seq, pos } = seqPositions[i];
    const nextPos = i + 1 < seqPositions.length ? seqPositions[i + 1].pos : text.length;
    
    // Bloco de texto deste vínculo
    const bloco = text.substring(pos, nextPos);
    
    const vinculo = processarBloco(bloco, seq);
    if (vinculo) {
      result.vinculos.push(vinculo);
    }
  }

  // ─── 4. ORDENAÇÃO FINAL ───────────────────────────────────────────────────
  result.vinculos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  // ─── 5. LOG DE VALIDAÇÃO ─────────────────────────────────────────────────
  console.log("=== VALIDAÇÃO PÓS-PARSE ===");
  console.log(`Titular: ${result.nome}`);
  console.log(`Nascimento: ${result.dataNascimento}`);
  console.log(`Total vínculos: ${result.vinculos.length}`);
  result.vinculos.forEach((v) => {
    const ini = v.inicio ? formatDateFromIso(v.inicio) : "?";
    const fim = v.fim ? formatDateFromIso(v.fim) : "ativo";
    console.log(
      `  [${String(v.seq).padStart(2, "0")}] ${v.empresa.padEnd(40)} ${ini} → ${fim} | ${v.salarios?.length || 0} comp.`
    );
  });
  console.log("===========================");

  return result;
}

// ─── PROCESSA UM BLOCO DE TEXTO DE UM ÚNICO VÍNCULO ──────────────────────────
function processarBloco(bloco: string, seq: number): CnisVinculo | null {
  let empresa = "";
  let cnpj: string | undefined;
  let nb: string | undefined;
  let especie: number | undefined;
  let inicio = "";
  let fim: string | undefined;
  let situacao: string | undefined;
  let tipo: CnisVinculo["tipo"] = "Empregado";
  const salarios: CnisSalario[] = [];
  const indicadores: string[] = [];

  // ── Tipo: Benefício ────────────────────────────────────────────────────────
  const beneficioMatch = bloco.match(
    /Benefício\s+(\d+)\s*[-–]\s*([A-ZÇÁÉÍÓÚÀÂÃÊÔÕ][^\n]+)/i
  );
  if (beneficioMatch) {
    tipo = "Benefício";
    especie = parseInt(beneficioMatch[1]);
    empresa = `Benefício ${especie} - ${beneficioMatch[2].trim()}`;
    nb = String(especie);

    // NB número
    const nbMatch = bloco.match(/\b(\d{9,11})\b/);
    if (nbMatch) nb = nbMatch[1];

    // Datas
    const datasMatch = bloco.match(/(\d{2}\/\d{2}\/\d{4})/g);
    if (datasMatch && datasMatch.length >= 1) {
      inicio = formatDateToIso(datasMatch[0]);
      if (datasMatch.length >= 2) fim = formatDateToIso(datasMatch[1]);
    }

    if (bloco.includes("CESSADO") || bloco.includes("2 - CESSADO")) {
      situacao = "CESSADO";
    }

    return {
      id: makeId(),
      seq,
      empresa,
      cnpj,
      nb,
      especie,
      inicio,
      fim,
      tipo,
      situacao,
      salarios,
      indicadores,
    };
  }

  // ── Tipo: MEI / Recolhimento ───────────────────────────────────────────────
  if (bloco.match(/RECOLHIMENTO/i)) {
    tipo = "MEI";
    empresa = "RECOLHIMENTO (MEI)";

    // Datas de início e fim do vínculo
    const dataInicioMatch = bloco.match(/Data Início\s+(\d{2}\/\d{2}\/\d{4})/i);
    const dataFimMatch = bloco.match(/Data Fim\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (dataInicioMatch) inicio = formatDateToIso(dataInicioMatch[1]);
    if (dataFimMatch) fim = formatDateToIso(dataFimMatch[1]);

    // Contribuições MEI: MM/AAAA  DD/MM/AAAA  valor  salário
    const meiRows = bloco.matchAll(
      /(\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+[\d\.,]+\s+([\d\.,]+)/g
    );
    for (const m of meiRows) {
      const competencia = formatCompetenciaToIso(m[1]);
      const valor = parseCurrency(m[2]);
      if (competencia && valor > 0) {
        addOrUpdateSalario(salarios, { competencia, valor });
      }
    }

    return {
      id: makeId(),
      seq,
      empresa,
      cnpj,
      nb,
      especie,
      inicio,
      fim,
      tipo,
      situacao,
      salarios,
      indicadores,
    };
  }

  // ── Tipo: Agrupamento ──────────────────────────────────────────────────────
  if (bloco.match(/AGRUPAMENTO DE CONTRATANTES/i)) {
    tipo = "Autônomo";
    empresa = "AGRUPAMENTO DE CONTRATANTES/COOPERATIVAS";

    const remuMatch = bloco.match(/(\d{2}\/\d{4})\s+[\d\.]+\s+[\d\.]+\/[\d\-]+\s+([\d\.,]+)/);
    if (remuMatch) {
      const competencia = formatCompetenciaToIso(remuMatch[1]);
      const valor = parseCurrency(remuMatch[2]);
      if (competencia && valor > 0) {
        addOrUpdateSalario(salarios, { competencia, valor });
      }
    }

    return {
      id: makeId(),
      seq,
      empresa,
      cnpj,
      nb,
      especie,
      inicio,
      fim,
      tipo,
      situacao,
      salarios,
      indicadores,
    };
  }

  // ── Tipo: Empregador (CLT/comum) ───────────────────────────────────────────

  // CNPJ
  const cnpjMatch = bloco.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (cnpjMatch) {
    cnpj = cnpjMatch[1];
    // Nome da empresa: texto maiúsculo após o CNPJ
    const afterCnpj = bloco.substring(bloco.indexOf(cnpj) + cnpj.length);
    const empresaMatch = afterCnpj.match(
      /\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s\.\-\/&,]+?)(?=\s*(?:Empregad|Contribuint|Tipo Filiado|Data Início|\d{2}\/\d{2}\/\d{4}|\n\n))/
    );
    if (empresaMatch) {
      empresa = empresaMatch[1].trim();
    }
  }

  // CNPJ sem formatação (ex: Americanas "00.776.574")
  if (!cnpj) {
    const cnpjSimples = bloco.match(/\b(\d{2}\.\d{3}\.\d{3})\b/);
    if (cnpjSimples) cnpj = cnpjSimples[1];
  }

  // Se não achou empresa pelo CNPJ, tenta pegar nome em maiúsculas no bloco
  if (!empresa) {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
    for (const linha of linhas) {
      if (
        /^[A-ZÁÉÍÓÚÀÂÃÊÔÕÇ]/.test(linha) &&
        linha === linha.toUpperCase() &&
        !linha.match(/^(SEQ|NIT|CPF|COMPETÊNCIA|REMUNERAÇÃO|INDICADORES|DATA|TIPO|VÍNCULO|MATRÍCULA|ORIGEM)/) &&
        !linha.match(/^\d/) &&
        linha.length > 5
      ) {
        empresa = linha;
        break;
      }
    }
  }

  // Datas de início e fim
  const dataInicioMatch = bloco.match(/Data Início\s+(\d{2}\/\d{2}\/\d{4})/i);
  const dataFimMatch = bloco.match(/Data Fim\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (dataInicioMatch) inicio = formatDateToIso(dataInicioMatch[1]);
  if (dataFimMatch) fim = formatDateToIso(dataFimMatch[1]);

  // Fallback: duas datas juntas ex "15/10/2003 31/12/2003"
  if (!inicio) {
    const duasDatas = bloco.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
    if (duasDatas) {
      inicio = formatDateToIso(duasDatas[1]);
      fim = formatDateToIso(duasDatas[2]);
    }
  }

  // Situação
  if (bloco.includes("CESSADO") || bloco.includes("2 - CESSADO")) {
    situacao = "CESSADO";
  }

  // Indicadores do vínculo
  const indMatch = bloco.match(/Indicadores:\s*([A-Z][A-Z\-,\s]+)/);
  if (indMatch) {
    const inds = indMatch[1].split(/[\s,]+/).filter((x) => x.length > 2);
    indicadores.push(...inds);
  }

  // ── Remunerações ───────────────────────────────────────────────────────────
  // Formato padrão: MM/AAAA  valor  [indicador]
  const remuneracoesRegex = /(\d{2}\/\d{4})\s+([\d\.,]+)(?:\s+([A-Z][A-Z\-]+))?/g;
  let remuMatch;
  while ((remuMatch = remuneracoesRegex.exec(bloco)) !== null) {
    const competencia = formatCompetenciaToIso(remuMatch[1]);
    const valor = parseCurrency(remuMatch[2]);
    const ind = remuMatch[3] ? [remuMatch[3]] : undefined;

    // Filtra valores que são claramente datas ou irrelevantes
    if (competencia && valor > 0 && valor < 50000) {
      addOrUpdateSalario(salarios, { competencia, valor, indicadores: ind });
    }
  }

  return {
    id: makeId(),
    seq,
    empresa: empresa || "Empresa não identificada",
    cnpj,
    nb,
    especie,
    inicio,
    fim,
    tipo,
    situacao,
    salarios,
    indicadores: [...new Set(indicadores)],
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function addOrUpdateSalario(
  salarios: CnisSalario[],
  novo: CnisSalario
) {
  const existing = salarios.find((s) => s.competencia === novo.competencia);
  if (existing) {
    if (novo.indicadores?.includes("IREM-ACD")) {
      existing.valor += novo.valor;
    } else {
      existing.valor = Math.max(existing.valor, novo.valor);
    }
    if (novo.indicadores) {
      existing.indicadores = [
        ...new Set([...(existing.indicadores || []), ...novo.indicadores]),
      ];
    }
  } else {
    salarios.push({ ...novo });
  }
}

function makeId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function formatDateToIso(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("/");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return "";
}

function formatDateFromIso(isoDate: string): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return isoDate;
}

function formatCompetenciaToIso(compStr: string): string {
  if (!compStr) return "";
  const parts = compStr.split("/");
  if (parts.length === 2) return `${parts[1]}-${parts[0]}`;
  return "";
}

function parseCurrency(valStr: string): number {
  if (!valStr) return 0;
  return (
    parseFloat(
      valStr.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")
    ) || 0
  );
}
