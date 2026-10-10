export function groupAppointmentsByDay(appointments) {
  const groups = new Map();
  appointments
    .slice()
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .forEach((appointment) => {
      const day = appointment.startsAt
        ? new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(appointment.startsAt))
        : 'Sem data';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(appointment);
    });
  return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
}
