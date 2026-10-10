export function parseBusinessHours(bh) {
  if (!bh || typeof bh !== 'object') {
    if (typeof bh === 'string' && bh.trim()) {
      const parts = bh.trim().split('·').map((s) => s.trim());
      if (parts.length >= 2) {
        return { days: parts[0], time: parts[1], extra: parts.slice(2).join(' · ') || null };
      }
      return { days: null, time: bh.trim(), extra: null };
    }
    return null;
  }
  if (Object.keys(bh).length === 0) return null;

  if (bh.start && bh.end) {
    const days = Array.isArray(bh.days) ? bh.days : [];
    let daysLabel = 'Todos os dias';
    if (days.length === 7) {
      daysLabel = 'Todos os dias';
    } else if (days.length === 6 && days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sábado';
    } else if (days.length === 5 && !days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sexta';
    } else if (days.length > 0) {
      const mapDay = {
        segunda: 'Seg', terca: 'Ter', quarta: 'Qua', quinta: 'Qui',
        sexta: 'Sex', sabado: 'Sáb', domingo: 'Dom',
      };
      daysLabel = days.map((d) => mapDay[String(d).toLowerCase()] || d).join(', ');
    }
    return {
      days: daysLabel,
      time: `${bh.start} às ${bh.end}`,
      extra: null,
    };
  }

  if (bh.weekdays) {
    return {
      days: 'Segunda a Sexta',
      time: bh.weekdays,
      extra: bh.saturday ? `Sábado: ${bh.saturday}` : null,
    };
  }

  const values = Object.values(bh).filter((v) => typeof v === 'string');
  if (values.length > 0) {
    const parts = values[0].split('·').map((s) => s.trim());
    if (parts.length >= 2) {
      return { days: parts[0], time: parts[1], extra: values.length > 1 ? values.slice(1).join(' · ') : null };
    }
    return {
      days: null,
      time: values[0],
      extra: values.length > 1 ? values.slice(1).join(' · ') : null,
    };
  }

  return null;
}

export function formatBusinessHoursSummary(bh) {
  if (!bh || typeof bh !== 'object') return null;
  if (typeof bh === 'string' && bh.trim()) return bh.trim();
  if (Object.keys(bh).length === 0) return null;

  if (bh.start && bh.end) {
    const days = Array.isArray(bh.days) ? bh.days : [];
    let daysLabel = 'Todos os dias';
    if (days.length === 7) {
      daysLabel = 'Todos os dias';
    } else if (days.length === 6 && days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sábado';
    } else if (days.length === 5 && !days.includes('sabado') && !days.includes('domingo')) {
      daysLabel = 'Segunda a Sexta';
    } else if (days.length > 0) {
      const mapDay = {
        segunda: 'Seg',
        terca: 'Ter',
        quarta: 'Qua',
        quinta: 'Qui',
        sexta: 'Sex',
        sabado: 'Sáb',
        domingo: 'Dom',
      };
      daysLabel = days.map((d) => mapDay[String(d).toLowerCase()] || d).join(', ');
    }
    return `${daysLabel} · ${bh.start} às ${bh.end}`;
  }

  if (bh.weekdays) {
    return `Seg a Sex: ${bh.weekdays}${bh.saturday ? ` · Sáb: ${bh.saturday}` : ''}`;
  }

  const values = Object.values(bh).filter((v) => typeof v === 'string');
  if (values.length > 0) return values.join(' · ');

  return null;
}
