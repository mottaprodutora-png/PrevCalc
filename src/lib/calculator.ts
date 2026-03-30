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
import { CnisVinculo, CalculoResultado, RegraSimulada, Inconsistencia, TimelineEvent } from '../types';

// Constantes de Salário Mínimo (Simplificadas para validação pós-reforma)
const SALARIO_MINIMO_2024 = 1412;
const DATA_REFORMA = new Date(2019, 10, 13); // 13/11/2019

export function calcularPrevidencia(
  vinculos: CnisVinculo[], 
  dataNascimento: string, 
  genero: 'M' | 'F'
): CalculoResultado {
  const nascimento = parseISO(dataNascimento || '1970-01-01');
  const hoje = new Date();
  
  // 1. Calcular Tempo Total e Carência
  // Meses de contribuição: Map<competencia, info>
  const mesesContribuicao = new Map<string, { especial: boolean; rural: boolean; valor: number; tipo: string }>();
  
  vinculos.forEach(v => {
    if (v.inicio) {
      try {
        const start = startOfMonth(parseISO(v.inicio));
        const end = v.fim ? endOfMonth(parseISO(v.fim)) : endOfMonth(hoje);
        
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && isBefore(start, end)) {
          const interval = eachMonthOfInterval({ start, end });
          interval.forEach(date => {
            const comp = format(date, 'yyyy-MM');
            const existing = mesesContribuicao.get(comp);
            
            // Pega o salário se existir para esta competência
            const salario = v.salarios.find(s => s.competencia === comp)?.valor || 0;

            if (!existing) {
              mesesContribuicao.set(comp, { 
                especial: v.especial || false, 
                rural: v.tipo === 'Rural' || false,
                valor: salario,
                tipo: v.tipo || 'Empregado'
              });
            } else {
              // Soma os salários se houver sobreposição (limitado ao teto na prática, mas aqui somamos tudo)
              // Prioriza o tipo 'Empregado' se houver conflito, pois tem presunção de recolhimento
              mesesContribuicao.set(comp, {
                especial: existing.especial || v.especial,
                rural: existing.rural || (v.tipo === 'Rural'),
                valor: existing.valor + salario,
                tipo: existing.tipo === 'Empregado' ? 'Empregado' : (v.tipo || existing.tipo)
              });
            }
          });
        }
      } catch (e) {
        console.error("Erro ao processar período:", e);
      }
    } else {
      // Fallback para quando só temos os salários mas não o período (raro no CNIS)
      v.salarios.forEach(s => {
        if (s.valor > 0) {
          const existing = mesesContribuicao.get(s.competencia);
          if (!existing) {
            mesesContribuicao.set(s.competencia, { 
              especial: !!v.especial, 
              rural: v.tipo === 'Rural',
              valor: s.valor,
              tipo: v.tipo || 'Empregado'
            });
          } else {
            mesesContribuicao.set(s.competencia, {
              especial: existing.especial || !!v.especial,
              rural: existing.rural || (v.tipo === 'Rural'),
              valor: existing.valor + s.valor,
              tipo: existing.tipo === 'Empregado' ? 'Empregado' : (v.tipo || existing.tipo)
            });
          }
        }
      });
    }
  });

  let tempoTotalDias = 0;
  let tempoEspecialAdicionalDias = 0;
  let carenciaMeses = 0;
  let mesesEm2019 = 0;

  const fatorConversao = genero === 'M' ? 1.4 : 1.2;

  mesesContribuicao.forEach((info, comp) => {
    const [year, month] = comp.split('-').map(Number);
    const dataComp = new Date(year, month - 1, 1);
    const isPosReforma = isAfter(dataComp, DATA_REFORMA);

    // Regra Pós-Reforma: Só conta se for >= Salário Mínimo (exceto rural)
    // Para Empregado, se não houver valor no CNIS, assumimos que foi pago (presunção de recolhimento)
    // a menos que seja explicitamente abaixo do mínimo.
    const valorMinimoHistorico = year >= 2024 ? 1412 : (year >= 2023 ? 1320 : 1000);
    
    let contaParaTempo = true;
    if (isPosReforma && !info.rural) {
      if (info.tipo === 'Empregado') {
        // Se for empregado e tiver valor, deve ser >= mínimo. 
        // Se valor for 0, no CNIS de hoje em dia costuma vir o indicador PREC-MENOR-MIN se for abaixo.
        // Aqui, se for 0, vamos assumir que conta (presunção) a menos que o usuário tenha inserido 0 manualmente.
        contaParaTempo = info.valor === 0 || info.valor >= valorMinimoHistorico;
      } else {
        // Individual/Facultativo: PRECISA ter pago pelo menos o mínimo
        contaParaTempo = info.valor >= valorMinimoHistorico;
      }
    }

    if (contaParaTempo) {
      tempoTotalDias += 30;
      
      // Conversão de tempo especial SÓ para períodos ANTES da reforma
      if (info.especial && !isPosReforma) {
        tempoEspecialAdicionalDias += 30 * (fatorConversao - 1);
      }

      if (isBefore(dataComp, DATA_REFORMA)) {
        mesesEm2019++;
      }

      // Carência: 
      // 1. Empregado: Sempre conta (se o tempo contar)
      // 2. Rural: Só conta se for antes de 11/1991 ou se houver contribuição (valor > 0)
      // 3. Individual/Facultativo: Só conta se houver contribuição (valor > 0)
      if (info.tipo === 'Empregado') {
        carenciaMeses++;
      } else if (info.rural) {
        if (year < 1991 || (year === 1991 && month <= 10) || info.valor > 0) {
          carenciaMeses++;
        }
      } else {
        // Individual / Facultativo
        if (info.valor > 0) {
          carenciaMeses++;
        }
      }
    }
  });

  const tempoTotalComEspecial = tempoTotalDias + tempoEspecialAdicionalDias;
  const tempoAnos = tempoTotalComEspecial / 360;
  const tempoAnos2019 = (mesesEm2019 * 30) / 360;
  const idadeAnos = differenceInDays(hoje, nascimento) / 365.25;
  const pontos = idadeAnos + tempoAnos;

  // 2. Cálculo da Média Salarial (100% dos salários desde 07/1994)
  const salariosParaMedia = vinculos.flatMap(v => 
    v.salarios
      .filter(s => {
        const [y, m] = s.competencia.split('-').map(Number);
        return y > 1994 || (y === 1994 && m >= 7);
      })
      .map(s => s.valor)
  );

  // Simulação de correção monetária (Apenas para não mostrar valores defasados)
  // Em um sistema real, usaríamos a tabela do INPC
  const media = salariosParaMedia.length > 0 
    ? salariosParaMedia.reduce((a, b) => a + b, 0) / salariosParaMedia.length 
    : 0;

  // 3. Simulação das Regras de Transição
  const regras: RegraSimulada[] = [
    {
      nome: 'Direito Adquirido (Pré-Reforma)',
      status: (genero === 'M' ? tempoAnos2019 >= 35 : tempoAnos2019 >= 30) ? 'Apto' : 'Não Apto',
      descricao: 'Regra antiga. Exige 35 anos (H) ou 30 anos (M) de contribuição completos até 13/11/2019.',
      tempoFaltanteDias: Math.max(0, (genero === 'M' ? 35 : 30) * 360 - (tempoAnos2019 * 360)),
      dataAptidao: (genero === 'M' ? tempoAnos2019 >= 35 : tempoAnos2019 >= 30) ? '13/11/2019' : undefined
    },
    {
      nome: 'Transição: Pontos (2024)',
      status: (pontos >= (genero === 'M' ? 101 : 91) && tempoAnos >= (genero === 'M' ? 35 : 30)) ? 'Apto' : 'Não Apto',
      descricao: 'Soma de idade + tempo. Exige 101 pts (H) ou 91 pts (M) em 2024, com tempo mínimo de 35/30 anos.',
      tempoFaltanteDias: Math.max(0, (((genero === 'M' ? 101 : 91) - pontos) / 2) * 360),
      dataAptidao: pontos >= (genero === 'M' ? 101 : 91) ? format(hoje, 'dd/MM/yyyy') : format(addDays(hoje, Math.max(0, (((genero === 'M' ? 101 : 91) - pontos) / 2) * 360)), 'dd/MM/yyyy')
    },
    {
      nome: 'Transição: Idade Mínima Progressiva',
      status: (idadeAnos >= (genero === 'M' ? 63.5 : 58.5) && tempoAnos >= (genero === 'M' ? 35 : 30)) ? 'Apto' : 'Não Apto',
      descricao: 'Idade mínima de 63,5 (H) ou 58,5 (M) em 2024 + tempo de contribuição.',
      tempoFaltanteDias: Math.max(
        0, 
        (genero === 'M' ? 35 : 30) * 360 - tempoTotalComEspecial,
        ((genero === 'M' ? 63.5 : 58.5) - idadeAnos) * 360
      ),
      dataAptidao: (idadeAnos >= (genero === 'M' ? 63.5 : 58.5) && tempoAnos >= (genero === 'M' ? 35 : 30)) ? format(hoje, 'dd/MM/yyyy') : undefined
    },
    {
      nome: 'Transição: Pedágio 50%',
      status: (tempoAnos2019 >= (genero === 'M' ? 33 : 28) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019) * 0.5) ? 'Apto' : 'Não Apto', 
      descricao: 'Apenas para quem faltava menos de 2 anos para aposentar em 2019. Aplica Fator Previdenciário.',
      tempoFaltanteDias: tempoAnos2019 >= (genero === 'M' ? 33 : 28) 
        ? Math.max(0, ((genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019) * 0.5) * 360 - tempoTotalComEspecial)
        : Infinity,
      dataAptidao: (tempoAnos2019 >= (genero === 'M' ? 33 : 28) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019) * 0.5) ? format(hoje, 'dd/MM/yyyy') : undefined
    },
    {
      nome: 'Transição: Pedágio 100%',
      status: (idadeAnos >= (genero === 'M' ? 60 : 57) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019)) ? 'Apto' : 'Não Apto',
      descricao: 'Idade mínima de 60/57 anos + pedágio de 100% do tempo que faltava em 2019. Sem fator previdenciário.',
      tempoFaltanteDias: Math.max(
        0, 
        ((genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019)) * 360 - tempoTotalComEspecial,
        ((genero === 'M' ? 60 : 57) - idadeAnos) * 360
      ),
      dataAptidao: (idadeAnos >= (genero === 'M' ? 60 : 57) && tempoAnos >= (genero === 'M' ? 35 : 30) + ((genero === 'M' ? 35 : 30) - tempoAnos2019)) ? format(hoje, 'dd/MM/yyyy') : undefined
    },
    {
      nome: 'Aposentadoria por Idade (Nova Regra)',
      status: (idadeAnos >= (genero === 'M' ? 65 : 62) && carenciaMeses >= 180) ? 'Apto' : 'Não Apto',
      descricao: 'Regra permanente: 65 anos (H) / 62 anos (M) + 15 anos de carência.',
      tempoFaltanteDias: Math.max(
        0, 
        ((genero === 'M' ? 65 : 62) - idadeAnos) * 360,
        (180 - carenciaMeses) * 30
      ),
      dataAptidao: (idadeAnos >= (genero === 'M' ? 65 : 62) && carenciaMeses >= 180) ? format(hoje, 'dd/MM/yyyy') : undefined
    }
  ];

  // 4. Melhor Opção
  const aptas = regras.filter(r => r.status === 'Apto');
  const melhorOpcao = aptas.length > 0 
    ? aptas[0] 
    : [...regras].sort((a, b) => (a.tempoFaltanteDias || 0) - (b.tempoFaltanteDias || 0))[0];

  // 5. Cálculo do Valor do Benefício (Baseado na melhor regra)
  let coeficiente = 0;
  let beneficio = 0;

  if (melhorOpcao.nome.includes('Pedágio 100%') || melhorOpcao.nome.includes('Direito Adquirido')) {
    coeficiente = 1.0; // 100% da média
  } else if (melhorOpcao.nome.includes('Pedágio 50%')) {
    coeficiente = 0.85; // Simulação de Fator Previdenciário médio
  } else {
    // Regra Geral: 60% + 2% por ano que exceder 20(H)/15(M)
    const anosExcedentes = Math.max(0, tempoAnos - (genero === 'M' ? 20 : 15));
    coeficiente = 0.6 + (anosExcedentes * 0.02);
  }
  
  beneficio = media * coeficiente;

  // 6. Inconsistências
  const inconsistencias: Inconsistencia[] = [];
  vinculos.forEach(v => {
    if (!v.fim && v.tipo !== 'Contribuinte Individual' && v.tipo !== 'Rural') {
      inconsistencias.push({
        tipo: 'Vínculo Incompleto',
        descricao: `Vínculo na empresa ${v.empresa} sem data de fim. Pode não estar sendo contado totalmente.`,
        periodo: `${format(parseISO(v.inicio), 'dd/MM/yyyy')} - Aberto`,
        impactoTempo: 'REDUZ TEMPO TOTAL',
        impactoValor: 'INCERTEZA NA MÉDIA'
      });
    }
    v.salarios.forEach(s => {
      const [y] = s.competencia.split('-').map(Number);
      if (y >= 2019 && s.valor < 1320) { // Simplificação do mínimo
        inconsistencias.push({
          tipo: 'Abaixo do Mínimo',
          descricao: `Competência ${s.competencia} abaixo do mínimo. Após a Reforma, este mês não conta para tempo/carência sem complementação.`,
          periodo: s.competencia,
          impactoTempo: 'NÃO CONTA TEMPO',
          impactoValor: 'REDUZ MÉDIA'
        });
      }
    });
  });

  // 7. Timeline e Análise Jurídica (Mantido original com ajustes)
  const timeline: TimelineEvent[] = [];
  const sortedVinculos = [...vinculos]
    .filter(v => v.inicio && !isNaN(parseISO(v.inicio).getTime()))
    .sort((a, b) => parseISO(a.inicio).getTime() - parseISO(b.inicio).getTime());

  for (let i = 0; i < sortedVinculos.length; i++) {
    const v = sortedVinculos[i];
    const inicio = parseISO(v.inicio);
    const fim = v.fim ? parseISO(v.fim) : hoje;

    timeline.push({
      tipo: v.tipo === 'Rural' ? 'Rural' : (v.especial ? 'Especial' : 'Trabalho'),
      descricao: v.empresa,
      periodo: `${format(inicio, 'MM/yyyy')} - ${v.fim ? format(fim, 'MM/yyyy') : 'Atual'}`,
      inicio: v.inicio,
      fim: v.fim || format(hoje, 'yyyy-MM-dd'),
      impacto: v.especial ? 'Neutro' : 'Neutro'
    });
  }

  const analiseJuridica = {
    revisoes: [
      'Revisão da Vida Toda: Possibilidade de incluir salários anteriores a 1994 (Aguardando STF).',
      'Revisão do Teto: Verificação de descartes de salários acima do teto.',
      'Revisão do Artigo 29: Para benefícios por incapacidade calculados entre 2002 e 2009.'
    ],
    periodosEspeciais: vinculos.filter(v => v.especial).map(v => `Atividade Especial (${v.empresa}): Conversão de 1.4/1.2 aplicada apenas até 13/11/2019.`),
    periodosRurais: [
      'Tempo Rural: Períodos antes de 1991 contam para carência e tempo sem necessidade de contribuição.',
      'Documentação: Necessário Autodeclaração homologada pelo INSS.'
    ],
    contribuinteIndividual: vinculos.filter(v => v.tipo === 'Contribuinte Individual').map(v => `Individual (${v.empresa}): Verificar se as guias foram pagas em dia para contar carência.`)
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
    planoAcao: [
      'Obter PPP para períodos especiais para garantir a conversão de tempo até 2019.',
      'Complementar contribuições abaixo do mínimo após 11/2019 para que contem como tempo.',
      'Averbar tempo rural anterior a 1991 para aumentar o tempo total sem custos.',
      'Verificar indicadores (OUI, PEXT, etc) no CNIS que podem invalidar períodos.'
    ],
    documentos: {
      obrigatorios: ['RG/CPF', 'Comprovante de Residência', 'Certidão de Casamento'],
      previdenciarios: ['CNIS Completo', 'CTPS (Carteiras de Trabalho)', 'Carnês GPS'],
      estrategicos: ['PPP/LTCAT', 'Certidão de Alistamento Militar', 'Certidão de Tempo de Aluno-Aprendiz']
    },
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
