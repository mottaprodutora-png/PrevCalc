import { 
  differenceInDays, 
  parseISO, 
  isBefore, 
  isAfter, 
  addDays, 
  addMonths, 
  format, 
  eachMonthOfInterval, 
  startOfMonth, 
  endOfMonth,
  differenceInYears,
  differenceInMonths,
  addYears
} from "date-fns";
import { CnisVinculo, CalculoResultado, RegraSimulada, Inconsistencia, TimelineEvent } from "../types";

export function calcularPrevidencia(
  vinculos: CnisVinculo[], 
  dataNascimento: string, 
  sexo: 'M' | 'F'
): CalculoResultado {
  const nascimento = parseISO(dataNascimento);
  const hoje = new Date();
  const dataReforma = parseISO('2019-11-13');

  // 1. Calculate Age
  const idadeAnos = differenceInYears(hoje, nascimento);
  const idadeMeses = differenceInMonths(hoje, nascimento) % 12;
  const idadeDias = differenceInDays(hoje, addMonths(addYears(nascimento, idadeAnos), idadeMeses));

  // 2. Calculate Contribution Time (Tempo de Contribuição)
  const diasContribuidos = new Set<string>();
  const mesesCarencia = new Set<string>();
  const salariosContribuicao: { competencia: string, valor: number }[] = [];
  const timeline: TimelineEvent[] = [];

  vinculos.forEach(v => {
    if (!v.inicio) return;
    
    const inicio = parseISO(v.inicio);
    const fim = v.fim ? parseISO(v.fim) : hoje;
    
    // Períodos de benefício por incapacidade (espécie 31) contam como tempo de contribuição
    const isEspecie31 = v.tipo === 'Benefício' && v.especie === 31;
    const shouldCount = v.tipo !== 'Benefício' || isEspecie31;

    if (shouldCount) {
      // Add days to the set (Set handles concomitant periods automatically)
      let current = inicio;
      while (isBefore(current, fim) || current.getTime() === fim.getTime()) {
        const comp = format(current, 'yyyy-MM');
        
        // PDT-NASC-FIL-INV -> Idade do filiado menor que permitida — desconsiderar essas competências
        const hasInvalidIndicator = v.salarios?.some(s => 
          s.competencia === comp && s.indicadores?.includes('PDT-NASC-FIL-INV')
        );

        if (!hasInvalidIndicator) {
          diasContribuidos.add(format(current, 'yyyy-MM-dd'));
        }
        current = addDays(current, 1);
      }

      // Add months to carencia
      const interval = eachMonthOfInterval({ start: startOfMonth(inicio), end: endOfMonth(fim) });
      interval.forEach(m => {
        const comp = format(m, 'yyyy-MM');
        const hasInvalidIndicator = v.salarios?.some(s => 
          s.competencia === comp && s.indicadores?.includes('PDT-NASC-FIL-INV')
        );
        if (!hasInvalidIndicator) {
          mesesCarencia.add(comp);
        }
      });
    }

    // Collect salaries
    v.salarios?.forEach(s => {
      // PDT-NASC-FIL-INV -> desconsiderar
      if (s.valor > 0 && !s.indicadores?.includes('PDT-NASC-FIL-INV')) {
        salariosContribuicao.push(s);
      }
    });

    // Add to timeline
    timeline.push({
      tipo: v.especial ? 'Especial' : v.tipo === 'Rural' ? 'Rural' : v.tipo === 'Benefício' ? 'Invalido' : 'Trabalho',
      descricao: v.empresa,
      periodo: `${format(inicio, 'dd/MM/yyyy')} - ${v.fim ? format(fim, 'dd/MM/yyyy') : 'Atual'}`,
      inicio: v.inicio,
      fim: v.fim || format(hoje, 'yyyy-MM-dd'),
      impacto: 'Neutro'
    });
  });

  const totalDias = diasContribuidos.size;
  const anosTC = Math.floor(totalDias / 365.25);
  const mesesTC = Math.floor((totalDias % 365.25) / 30.4375);
  const diasTC = Math.floor((totalDias % 365.25) % 30.4375);

  // 3. Calculate Average Salary (Média)
  const salariosPos94 = salariosContribuicao
    .filter(s => isAfter(parseISO(s.competencia + '-01'), parseISO('1994-07-01')))
    .map(s => s.valor);
  
  const media = salariosPos94.length > 0 
    ? salariosPos94.reduce((a, b) => a + b, 0) / salariosPos94.length 
    : 1412;

  // 4. Simulate Rules
  const metaTempo = sexo === 'M' ? 35 : 30;
  const tempoAteReformaDias = calculateDaysUntil(vinculos, dataReforma);
  const anosAteReforma = tempoAteReformaDias / 365.25;
  const diasFaltantesEm2019 = Math.max(0, (metaTempo * 365.25) - tempoAteReformaDias);

  const regras: RegraSimulada[] = [
    {
      nome: 'Direito Adquirido (Pré-Reforma)',
      status: anosAteReforma >= metaTempo ? 'Apto' : 'Não Apto',
      dataAptidao: anosAteReforma >= metaTempo ? '13/11/2019' : undefined,
      tempoFaltanteDias: Math.max(0, (metaTempo * 365.25) - tempoAteReformaDias),
      descricao: `Requisito: ${metaTempo} anos de contribuição até 13/11/2019.`
    },
    {
      nome: 'Transição - Pedágio 50%',
      status: 'Não Apto',
      descricao: `Requisito: Ter pelo menos ${sexo === 'M' ? 33 : 28} anos em 2019 + pedágio de 50% do tempo faltante.`
    },
    {
      nome: 'Transição - Pedágio 100%',
      status: 'Não Apto',
      descricao: `Requisito: Idade (60M/57F) + ${metaTempo} anos + pedágio de 100% do tempo faltante em 2019.`
    },
    {
      nome: 'Transição - Pontos',
      status: 'Não Apto',
      descricao: `Requisito: Soma de idade + tempo de contribuição atingindo a pontuação mínima (2024: 101M/91F).`
    },
    {
      nome: 'Regra Permanente (Idade)',
      status: 'Não Apto',
      descricao: `Requisito: Idade mínima (65M/62F) + tempo de contribuição (20M/15F).`
    }
  ];

  // Update rule statuses and dates
  regras.forEach(r => {
    if (r.nome.includes('Pedágio 50%')) {
      const anosMinimos2019 = sexo === 'M' ? 33 : 28;
      if (anosAteReforma < anosMinimos2019) {
        r.status = 'Não se aplica';
        r.descricao = `Requisito não atingido em 2019: Tinha apenas ${anosAteReforma.toFixed(1)} anos de contribuição (mínimo ${anosMinimos2019}).`;
      } else if (anosAteReforma >= metaTempo) {
        r.status = 'Apto';
        r.dataAptidao = '13/11/2019';
      } else {
        const pedagioDias = diasFaltantesEm2019 * 0.5;
        const totalDiasNecessarios = (metaTempo * 365.25) + pedagioDias;
        if (totalDias >= totalDiasNecessarios) {
          r.status = 'Apto';
          r.dataAptidao = format(hoje, 'dd/MM/yyyy');
        } else {
          r.status = 'Não Apto';
          r.tempoFaltanteDias = totalDiasNecessarios - totalDias;
        }
      }
    }

    if (r.nome.includes('Pedágio 100%')) {
      const metaIdade = sexo === 'M' ? 60 : 57;
      const pedagioDias = diasFaltantesEm2019;
      const totalDiasNecessarios = (metaTempo * 365.25) + pedagioDias;
      
      if (idadeAnos >= metaIdade && totalDias >= totalDiasNecessarios) {
        r.status = 'Apto';
        r.dataAptidao = format(hoje, 'dd/MM/yyyy');
      } else {
        r.status = 'Não Apto';
        const faltanteIdade = Math.max(0, (metaIdade - idadeAnos) * 365.25);
        const faltanteTempo = Math.max(0, totalDiasNecessarios - totalDias);
        r.tempoFaltanteDias = Math.max(faltanteIdade, faltanteTempo);
      }
    }

    if (r.nome.includes('Pontos')) {
      const pontos = idadeAnos + anosTC;
      const meta = sexo === 'M' ? 101 : 91;
      if (pontos >= meta && anosTC >= metaTempo) {
        r.status = 'Apto';
        r.dataAptidao = format(hoje, 'dd/MM/yyyy');
      } else {
        r.status = 'Não Apto';
        r.tempoFaltanteDias = Math.max(0, (meta - pontos) * 365.25 / 2);
      }
    }

    if (r.nome.includes('Permanente')) {
      const metaIdade = sexo === 'M' ? 65 : 62;
      const metaTempoMin = sexo === 'M' ? 20 : 15;
      if (idadeAnos >= metaIdade && anosTC >= metaTempoMin) {
        r.status = 'Apto';
        r.dataAptidao = format(hoje, 'dd/MM/yyyy');
      } else {
        r.status = 'Não Apto';
        const faltanteIdade = Math.max(0, (metaIdade - idadeAnos) * 365.25);
        const faltanteTempo = Math.max(0, (metaTempoMin - anosTC) * 365.25);
        r.tempoFaltanteDias = Math.max(faltanteIdade, faltanteTempo);
      }
    }
  });

  const melhorRegra = regras.find(r => r.status === 'Apto') || regras[regras.length - 1];
  const coeficiente = calcularCoeficiente(anosTC, sexo);

  return {
    resumo: {
      tempoTotalDias: totalDias,
      tempoTotalFormatado: `${anosTC} anos, ${mesesTC} meses e ${diasTC} dias`,
      carenciaMeses: mesesCarencia.size,
      statusAtual: melhorRegra.status,
      tempoFaltanteFormatado: melhorRegra.tempoFaltanteDias ? `${Math.ceil(melhorRegra.tempoFaltanteDias / 365.25)} anos` : 'Requisito atingido',
      previsaoAposentadoria: melhorRegra.dataAptidao || 'Calculando...',
      percentualConcluido: Math.min(100, (anosTC / metaTempo) * 100),
      melhorRegraNome: melhorRegra.nome
    },
    regras,
    melhorOpcao: melhorRegra,
    valorEstimado: {
      media,
      coeficiente,
      beneficio: media * coeficiente,
      regraUtilizada: melhorRegra.nome,
      percentualCalculo: coeficiente * 100
    },
    inconsistencias: verificarInconsistencias(vinculos),
    analiseJuridica: {
      revisoes: ['Revisão da Vida Toda (se aplicável)', 'Revisão do Buraco Negro (se aplicável)'],
      periodosEspeciais: vinculos.filter(v => v.especial).map(v => v.empresa),
      periodosRurais: vinculos.filter(v => v.tipo === 'Rural').map(v => v.empresa),
      contribuinteIndividual: vinculos.filter(v => v.tipo === 'Contribuinte Individual').map(v => v.empresa)
    },
    planoAcao: [
      'Solicitar PPP das empresas com períodos especiais',
      'Reunir provas de atividade rural (se houver)',
      'Aguardar atingimento da idade mínima'
    ],
    documentos: {
      obrigatorios: ['RG/CPF', 'Comprovante de Residência', 'Carteira de Trabalho'],
      previdenciarios: ['CNIS Atualizado', 'PPP/LTCAT', 'Certidão de Tempo de Contribuição'],
      estrategicos: ['Cópia de Processo Administrativo', 'Declaração de Atividade Rural']
    },
    timeline
  };
}

function calculateDaysUntil(vinculos: CnisVinculo[], limitDate: Date): number {
  const days = new Set<string>();
  vinculos.forEach(v => {
    if (!v.inicio) return;
    let current = parseISO(v.inicio);
    const end = v.fim ? parseISO(v.fim) : new Date();
    const actualEnd = isBefore(end, limitDate) ? end : limitDate;
    
    const isEspecie31 = v.tipo === 'Benefício' && v.especie === 31;
    const shouldCount = v.tipo !== 'Benefício' || isEspecie31;

    if (shouldCount) {
      while (isBefore(current, actualEnd) || current.getTime() === actualEnd.getTime()) {
        const comp = format(current, 'yyyy-MM');
        const hasInvalidIndicator = v.salarios?.some(s => 
          s.competencia === comp && s.indicadores?.includes('PDT-NASC-FIL-INV')
        );

        if (!hasInvalidIndicator) {
          days.add(format(current, 'yyyy-MM-dd'));
        }
        current = addDays(current, 1);
      }
    }
  });
  return days.size;
}

function calcularCoeficiente(anos: number, sexo: 'M' | 'F'): number {
  const base = 0.6;
  const anosMinimos = sexo === 'M' ? 20 : 15;
  const adicional = Math.max(0, (anos - anosMinimos) * 0.02);
  return base + adicional;
}

function verificarInconsistencias(vinculos: CnisVinculo[]): Inconsistencia[] {
  const incs: Inconsistencia[] = [];
  vinculos.forEach(v => {
    if (!v.fim && isBefore(parseISO(v.inicio), addDays(new Date(), -90)) && v.tipo !== 'Benefício') {
      incs.push({
        tipo: 'Vínculo Incompleto',
        descricao: `Vínculo na empresa ${v.empresa} sem data de fim.`,
        periodo: `${v.inicio} - Aberto`
      });
    }
    if (v.salarios && v.salarios.length === 0 && v.tipo !== 'Rural' && v.tipo !== 'Benefício') {
      incs.push({
        tipo: 'Sem Remuneração',
        descricao: `Vínculo na empresa ${v.empresa} sem salários registrados.`,
        periodo: v.inicio
      });
    }

    v.salarios?.forEach(s => {
      if (s.indicadores?.includes('PSC-MEN-SM-EC103')) {
        incs.push({
          tipo: 'Abaixo do Mínimo',
          descricao: `Competência ${s.competencia} na empresa ${v.empresa} está abaixo do mínimo (PSC-MEN-SM-EC103).`,
          periodo: s.competencia
        });
      }
      if (s.indicadores?.includes('IREC-INDPEND')) {
        incs.push({
          tipo: 'Vínculo Incompleto',
          descricao: `Competência ${s.competencia} na empresa ${v.empresa} possui pendência no recolhimento (IREC-INDPEND).`,
          periodo: s.competencia
        });
      }
    });
  });
  return incs;
}
