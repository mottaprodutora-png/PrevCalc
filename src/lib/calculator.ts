import { 
  differenceInDays, 
  parseISO, 
  format, 
  addDays, 
  isBefore, 
  isAfter, 
  startOfMonth, 
  endOfMonth,
  eachMonthOfInterval
} from 'date-fns';
import { CnisVínculo, CalculoResultado, RegraSimulada, Inconsistencia, TimelineEvent } from '../types';

export function calcularPrevidencia(
  vinculos: CnisVínculo[], 
  dataNascimento: string, 
  genero: 'M' | 'F'
): CalculoResultado {
  const nascimento = parseISO(dataNascimento || '1970-01-01');
  const hoje = new Date();
  
  // 1. Calcular Tempo Total (Baseado em meses com contribuição real + Tempo Rural por período)
  const mesesContribuicao = new Map<string, { especial: boolean; rural: boolean }>();
  
  vinculos.forEach(v => {
    if (v.tipo === 'Rural' && v.inicio) {
      try {
        // Para tempo rural, contamos o período entre início e fim
        const start = startOfMonth(parseISO(v.inicio));
        const end = v.fim ? endOfMonth(parseISO(v.fim)) : endOfMonth(hoje);
        
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && isBefore(start, end)) {
          const interval = eachMonthOfInterval({ start, end });
          interval.forEach(date => {
            const comp = format(date, 'yyyy-MM');
            const existing = mesesContribuicao.get(comp);
            if (!existing) {
              mesesContribuicao.set(comp, { especial: false, rural: true });
            }
          });
        }
      } catch (e) {
        console.error("Erro ao processar período rural:", e);
      }
    } else {
      // Para outros tipos, mantemos a lógica de contribuição real (salários > 0)
      v.salarios.forEach(s => {
        if (s.valor > 0) {
          const existing = mesesContribuicao.get(s.competencia);
          // Se já existe e não é especial, mas o atual é, atualizamos para especial
          if (!existing || (!existing.especial && v.especial)) {
            mesesContribuicao.set(s.competencia, { especial: !!v.especial, rural: existing?.rural || false });
          }
        }
      });
    }
  });

  let tempoTotalDias = 0;
  let tempoEspecialAdicionalDias = 0;
  const fator = genero === 'M' ? 1.4 : 1.2;

  mesesContribuicao.forEach((info) => {
    tempoTotalDias += 30; // Cada mês de contribuição conta como 30 dias
    if (info.especial) {
      tempoEspecialAdicionalDias += 30 * (fator - 1);
    }
  });

  const tempoTotalComEspecial = tempoTotalDias + tempoEspecialAdicionalDias;
  const carenciaMeses = Array.from(mesesContribuicao.values()).filter(m => !m.rural).length; // Rural geralmente não conta para carência se não houver contribuição, mas depende da regra. Vamos manter carência para contribuições reais.


  // 2. Regras de Aposentadoria
  const idadeAnos = differenceInDays(hoje, nascimento) / 365.25;
  const tempoAnos = tempoTotalComEspecial / 360; // INSS usa 360 dias/ano (30 dias x 12 meses)
  const pontos = idadeAnos + tempoAnos;

  // Cálculo do tempo na data da reforma (13/11/2019)
  const dataReforma = new Date(2019, 10, 13);
  let mesesEm2019 = 0;
  mesesContribuicao.forEach((info, comp) => {
    const parts = comp.split('-');
    if (parts.length === 2) {
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const dateComp = new Date(y, m - 1, 1);
      if (!isNaN(dateComp.getTime()) && isBefore(dateComp, dataReforma)) {
        mesesEm2019++;
      }
    }
  });
  const tempoAnos2019 = (mesesEm2019 * 30) / 360;

  const regras: RegraSimulada[] = [
    {
      nome: 'Pré-Reforma (Direito Adquirido)',
      status: (genero === 'M' ? tempoAnos2019 >= 35 : tempoAnos2019 >= 30) ? 'Apto' : 'Não Apto',
      descricao: 'Regra vigente até 13/11/2019. Exige 35 anos (H) ou 30 anos (M) de contribuição até a data da reforma.',
      tempoFaltanteDias: Math.max(0, (genero === 'M' ? 35 : 30) * 360 - (tempoAnos2019 * 360))
    },
    {
      nome: 'Transição - Pontos',
      status: (pontos >= (genero === 'M' ? 101 : 91)) ? 'Apto' : 'Não Apto',
      descricao: 'Soma da idade + tempo de contribuição. Exige 101 pts (H) ou 91 pts (M) em 2024.',
      // Na regra de pontos, você ganha 2 pontos por ano (1 de idade + 1 de contribuição)
      tempoFaltanteDias: Math.max(0, (((genero === 'M' ? 101 : 91) - pontos) / 2) * 360)
    },
    {
      nome: 'Transição - Idade Mínima Progressiva',
      status: (idadeAnos >= (genero === 'M' ? 63.5 : 58.5) && tempoAnos >= (genero === 'M' ? 35 : 30)) ? 'Apto' : 'Não Apto',
      descricao: 'Idade mínima que aumenta 6 meses por ano + tempo de contribuição.',
      tempoFaltanteDias: Math.max(
        0, 
        (genero === 'M' ? 35 : 30) * 360 - tempoTotalComEspecial,
        ((genero === 'M' ? 63.5 : 58.5) - idadeAnos) * 360
      )
    },
    {
      nome: 'Transição - Pedágio 50%',
      status: (tempoAnos2019 >= (genero === 'M' ? 33 : 28) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019) * 0.5) ? 'Apto' : 'Não Apto', 
      descricao: 'Para quem faltava menos de 2 anos em 13/11/2019. Exige pedágio de 50%.',
      tempoFaltanteDias: tempoAnos2019 >= (genero === 'M' ? 33 : 28) 
        ? Math.max(0, ((genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019) * 0.5) * 360 - tempoTotalComEspecial)
        : Infinity // Não se aplica
    },
    {
      nome: 'Transição - Pedágio 100%',
      status: (idadeAnos >= (genero === 'M' ? 60 : 57) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019)) ? 'Apto' : 'Não Apto',
      descricao: 'Idade mínima + 100% do tempo que faltava em 2019.',
      tempoFaltanteDias: Math.max(
        0, 
        ((genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019)) * 360 - tempoTotalComEspecial,
        ((genero === 'M' ? 60 : 57) - idadeAnos) * 360
      )
    },
    {
      nome: 'Regra Permanente (Idade)',
      status: (idadeAnos >= (genero === 'M' ? 65 : 62) && carenciaMeses >= 180) ? 'Apto' : 'Não Apto',
      descricao: '65 anos (H) / 62 anos (M) + 15 anos de contribuição.',
      tempoFaltanteDias: Math.max(
        0, 
        ((genero === 'M' ? 65 : 62) - idadeAnos) * 360,
        (180 - carenciaMeses) * 30
      )
    }
  ];

  // 4. Melhor Opção (A que estiver mais próxima ou já apta)
  const aptas = regras.filter(r => r.status === 'Apto');
  const melhorOpcao = aptas.length > 0 
    ? aptas[0] 
    : [...regras].sort((a, b) => (a.tempoFaltanteDias || 0) - (b.tempoFaltanteDias || 0))[0];

  // 5. Cálculo do Benefício
  const todosSalarios = vinculos.flatMap(v => v.salarios.map(s => s.valor));
  const media = todosSalarios.length > 0 
    ? todosSalarios.reduce((a, b) => a + b, 0) / todosSalarios.length 
    : 0;
  
  const anosExcedentes = Math.max(0, tempoAnos - (genero === 'M' ? 20 : 15));
  const coeficiente = 0.6 + (anosExcedentes * 0.02);
  const beneficio = media * coeficiente;

  // 6. Inconsistências
  const inconsistencias: Inconsistencia[] = [];
  vinculos.forEach(v => {
    if (!v.fim && v.tipo !== 'Contribuinte Individual') {
      inconsistencias.push({
        tipo: 'Vínculo Incompleto',
        descricao: `Vínculo na empresa ${v.empresa} sem data de fim.`,
        periodo: `${format(parseISO(v.inicio), 'dd/MM/yyyy')} - Aberto`,
        impactoTempo: 'IMPEDE APOSENTADORIA',
        impactoValor: 'VALOR NÃO CALCULADO'
      });
    }
    v.salarios.forEach(s => {
      if (s.valor < 1320) { // Exemplo de mínimo
        inconsistencias.push({
          tipo: 'Abaixo do Mínimo',
          descricao: `Remuneração na competência ${s.competencia} abaixo do salário mínimo.`,
          periodo: s.competencia,
          impactoTempo: 'REDUZ TEMPO TOTAL',
          impactoValor: 'REDUZ MÉDIA SALARIAL'
        });
      }
    });
  });

  // 7. Timeline e Análise Jurídica
  const timeline: TimelineEvent[] = [];
  
  // Ordenar vínculos por data de início (filtrando inválidos)
  const sortedVinculos = [...vinculos]
    .filter(v => v.inicio && !isNaN(parseISO(v.inicio).getTime()))
    .sort((a, b) => parseISO(a.inicio).getTime() - parseISO(b.inicio).getTime());

  for (let i = 0; i < sortedVinculos.length; i++) {
    const v = sortedVinculos[i];
    if (!v.inicio) continue;
    
    const inicio = parseISO(v.inicio);
    const fim = v.fim ? parseISO(v.fim) : hoje;

    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) continue;

    // Verificar lacuna antes deste vínculo
    if (i > 0) {
      const fimAnterior = sortedVinculos[i-1].fim ? parseISO(sortedVinculos[i-1].fim!) : hoje;
      if (!isNaN(fimAnterior.getTime())) {
        const diasGap = differenceInDays(inicio, fimAnterior);
        if (diasGap > 31) { // Mais de um mês de gap
          timeline.push({
            tipo: 'Lacuna',
            descricao: 'Período sem contribuição detectado',
            periodo: `${format(fimAnterior, 'MM/yyyy')} - ${format(inicio, 'MM/yyyy')}`,
            inicio: sortedVinculos[i-1].fim!,
            fim: v.inicio,
            impacto: 'Impede Aposentadoria'
          });
        }
      }
    }

    timeline.push({
      tipo: v.tipo === 'Rural' ? 'Rural' : (v.especial ? 'Especial' : 'Trabalho'),
      descricao: v.empresa,
      periodo: `${format(inicio, 'MM/yyyy')} - ${v.fim ? format(fim, 'MM/yyyy') : 'Atual'}`,
      inicio: v.inicio,
      fim: v.fim || format(hoje, 'yyyy-MM-dd'),
      impacto: 'Neutro'
    });
  }

  const analiseJuridica = {
    revisoes: [
      'Revisão da Vida Toda: Possibilidade de incluir salários anteriores a 1994.',
      'Revisão do Buraco Negro: Para benefícios concedidos entre 1988 e 1991.',
      'Revisão do Teto: Verificação de descartes de salários acima do teto.'
    ],
    periodosEspeciais: vinculos.filter(v => v.especial).map(v => `Atividade Especial em ${v.empresa}: Necessário PPP para conversão de tempo.`),
    periodosRurais: [
      'Tempo Rural: Possibilidade de averbação de período em regime de economia familiar antes de 1991.',
      'Necessário: Autodeclaração e documentos da época (Escrituras, ITR, Certidões).'
    ],
    contribuinteIndividual: vinculos.filter(v => v.tipo === 'Contribuinte Individual').map(v => `Contribuinte Individual (${v.empresa}): Verificar se há débitos ou necessidade de indenização.`)
  };

  const planoAcao = [
    'Solicitar PPP (Perfil Profissiográfico Previdenciário) para todos os períodos especiais.',
    'Regularizar competências abaixo do salário mínimo via complementação ou agrupamento.',
    'Apresentar Carteira de Trabalho para retificar vínculos com data de fim em aberto no CNIS.',
    'Realizar busca de documentos rurais para aumentar o tempo total de contribuição.',
    'Agendar requerimento administrativo de atualização de vínculos e remunerações (CTC).'
  ];

  const documentos = {
    obrigatorios: ['RG e CPF (ou CNH)', 'Comprovante de Residência Atualizado', 'Certidão de Nascimento ou Casamento'],
    previdenciarios: ['Extrato CNIS Completo', 'Carteiras de Trabalho (todas)', 'Carnês e Guias de Recolhimento (GPS)'],
    estrategicos: [
      'PPP e LTCAT (para tempo especial)',
      'Certidão de Tempo de Contribuição (CTC) de outros regimes',
      'Processos Trabalhistas (se houver)',
      'Documentos Rurais (Escrituras, Certidões de Batismo, etc.)'
    ]
  };

  const tempoFaltanteDias = melhorOpcao.tempoFaltanteDias || 0;
  const previsaoAposentadoria = tempoFaltanteDias === Infinity 
    ? "Indefinida" 
    : format(addDays(hoje, tempoFaltanteDias), 'dd/MM/yyyy');

  return {
    resumo: {
      tempoTotalDias: Math.floor(tempoTotalComEspecial),
      tempoTotalFormatado: formatarTempo(tempoTotalComEspecial),
      carenciaMeses,
      statusAtual: aptas.length > 0 ? 'Apto' : 'Não Apto',
      tempoFaltanteFormatado: formatarTempo(tempoFaltanteDias),
      previsaoAposentadoria,
      percentualConcluido: Math.min(100, (tempoAnos / (genero === 'M' ? 35 : 30)) * 100),
      melhorRegraNome: melhorOpcao.nome
    },
    regras,
    melhorOpcao,
    valorEstimado: {
      media,
      coeficiente: coeficiente * 100,
      beneficio,
      regraUtilizada: melhorOpcao.nome,
      percentualCalculo: coeficiente * 100
    },
    inconsistencias,
    analiseJuridica,
    planoAcao,
    documentos,
    timeline
  };
}

function formatarTempo(dias: number): string {
  if (dias === Infinity) return "Não se aplica";
  if (dias <= 0) return "0 anos, 0 meses e 0 dias";
  
  const anos = Math.floor(dias / 360);
  const diasRestantesAposAnos = dias % 360;
  const meses = Math.floor(diasRestantesAposAnos / 30);
  const restodias = Math.floor(diasRestantesAposAnos % 30);
  
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'ano' : 'anos'}`);
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  if (restodias > 0 || partes.length === 0) partes.push(`${restodias} ${restodias === 1 ? 'dia' : 'dias'}`);
  
  return partes.join(', ');
}
