// @ts-check

const WHATSAPP_TIME_ZONE = 'America/Sao_Paulo';

/**
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {number}
 */
function getHourInTimeZone(date = new Date(), timeZone = WHATSAPP_TIME_ZONE) {
  const hourPart = new Intl.DateTimeFormat('pt-BR', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour');

  return Number.parseInt(hourPart?.value || '0', 10);
}

/**
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function getTimeBasedGreeting(date = new Date(), timeZone = WHATSAPP_TIME_ZONE) {
  const hour = getHourInTimeZone(date, timeZone);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export { WHATSAPP_TIME_ZONE };
