const WHATSAPP_TIME_ZONE = 'America/Sao_Paulo';

function getHourInTimeZone(date: Date = new Date(), timeZone: string = WHATSAPP_TIME_ZONE): number {
  const hourPart = new Intl.DateTimeFormat('pt-BR', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour');

  return Number.parseInt(hourPart?.value || '0', 10);
}

export function getTimeBasedGreeting(
  date: Date = new Date(),
  timeZone: string = WHATSAPP_TIME_ZONE
): string {
  const hour = getHourInTimeZone(date, timeZone);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export { WHATSAPP_TIME_ZONE };
