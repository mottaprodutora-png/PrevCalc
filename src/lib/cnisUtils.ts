import { parse, differenceInDays, addDays, intervalToDuration } from 'date-fns';
import { Vinculo, Duration } from '../types';

export const parseCNISDate = (dateStr: string) => {
  if (!dateStr) return null;
  // Handle DD/MM/YYYY
  return parse(dateStr, 'dd/MM/yyyy', new Date());
};

export const calculateVinculoDuration = (vinculo: Vinculo): Duration => {
  const start = parseCNISDate(vinculo.dataInicio);
  const end = vinculo.dataFim ? parseCNISDate(vinculo.dataFim) : new Date();

  if (!start || !end) return { years: 0, months: 0, days: 0 };

  // Previdência calculation usually includes the start and end day
  const duration = intervalToDuration({
    start,
    end: addDays(end, 1)
  });

  return {
    years: duration.years || 0,
    months: duration.months || 0,
    days: duration.days || 0
  };
};

export const formatDuration = (duration: Duration) => {
  const parts = [];
  if (duration.years > 0) parts.push(`${duration.years}a`);
  if (duration.months > 0) parts.push(`${duration.months}m`);
  if (duration.days > 0) parts.push(`${duration.days}d`);
  return parts.join(' ') || '0d';
};

export const sumDurations = (durations: Duration[]): Duration => {
  let totalDays = 0;
  durations.forEach(d => {
    totalDays += d.years * 365 + d.months * 30 + d.days;
  });

  const years = Math.floor(totalDays / 365);
  totalDays %= 365;
  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;

  return { years, months, days };
};

export const getVinculoLabel = (vinculo: Vinculo) => {
  if (vinculo.tipo === 'beneficio') {
    return `NB ${vinculo.nb} - ${vinculo.descricao || 'Benefício'}`;
  }
  return vinculo.razaoSocial || 'Vínculo sem nome';
};
