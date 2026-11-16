const TIME_ZONE = 'America/Sao_Paulo';

function zonedParts(date, includeTime = false) {
  const options = {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
    options.hourCycle = 'h23';
  }
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function getSaoPauloDate(date = new Date()) {
  const parts = zonedParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Agenda a atualização da interface para a próxima meia-noite de Brasília.
// A conversão iterativa também acompanha eventuais mudanças futuras de fuso.
export function getMillisecondsUntilNextSaoPauloMidnight(now = new Date()) {
  const today = zonedParts(now);
  const tomorrow = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + 1));
  const target = {
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
  };
  const targetWallTime = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0);
  let targetTimestamp = targetWallTime;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zonedParts(new Date(targetTimestamp), true);
    const observedWallTime = Date.UTC(
      Number(local.year),
      Number(local.month) - 1,
      Number(local.day),
      Number(local.hour),
      Number(local.minute),
      Number(local.second),
    );
    targetTimestamp += targetWallTime - observedWallTime;
  }

  return Math.max(1000, targetTimestamp - now.getTime() + 100);
}
