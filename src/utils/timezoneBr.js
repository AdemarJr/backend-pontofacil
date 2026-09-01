/**
 * Horário civil brasileiro (America/Sao_Paulo) para espelho, batidas e limites de dia.
 * Evita discrepância de ~3h quando o Node roda em UTC (ex.: Railway).
 */
const TZ_EMPRESA = 'America/Sao_Paulo';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getPartsInTz(date, timeZone = TZ_EMPRESA) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

/** YYYY-MM-DD no fuso da empresa. */
function fmtDateISOBr(d) {
  const parts = getPartsInTz(d);
  if (!parts) return '';
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** HH:mm no fuso da empresa. */
function fmtTimeBr(d) {
  if (!d) return '';
  const parts = getPartsInTz(d);
  if (!parts) return '';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Minutos desde meia-noite no fuso da empresa. */
function minutosDoDiaBr(dataHora) {
  const parts = getPartsInTz(dataHora);
  if (!parts) return 0;
  return parts.hour * 60 + parts.minute;
}

/**
 * Converte data/hora civil no fuso da empresa para instante UTC (Date).
 */
function zonedDateTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = TZ_EMPRESA
) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let i = 0; i < 4; i++) {
    const parts = getPartsInTz(new Date(utcMs), timeZone);
    if (!parts) break;

    const currentMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const wantedMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = wantedMs - currentMs;
    if (delta === 0) break;
    utcMs += delta;
  }

  return new Date(utcMs);
}

/** Início e fim do dia civil (00:00:00.000 – 23:59:59.999) no fuso da empresa. */
function inicioFimDoDiaBr(ref = new Date()) {
  const iso = fmtDateISOBr(ref);
  if (!iso) {
    const d = ref instanceof Date ? ref : new Date(ref);
    return {
      inicio: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
      fim: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
    };
  }

  const [y, m, day] = iso.split('-').map(Number);
  const inicio = zonedDateTimeToUtc({ year: y, month: m, day, hour: 0, minute: 0, second: 0 });
  const fim = zonedDateTimeToUtc({ year: y, month: m, day, hour: 23, minute: 59, second: 59 });
  fim.setMilliseconds(999);
  return { inicio, fim };
}

/** Mesmo dia civil no fuso da empresa. */
function isSameDayBr(a, b) {
  if (!a || !b) return false;
  return fmtDateISOBr(a) === fmtDateISOBr(b);
}

module.exports = {
  TZ_EMPRESA,
  fmtDateISOBr,
  fmtTimeBr,
  minutosDoDiaBr,
  inicioFimDoDiaBr,
  isSameDayBr,
  getPartsInTz,
  zonedDateTimeToUtc,
  pad2,
};
