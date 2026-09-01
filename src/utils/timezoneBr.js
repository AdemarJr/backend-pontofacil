/**
 * Fuso horário da empresa para espelho, batidas e limites de dia.
 * Evita discrepância quando o Node roda em UTC (ex.: Railway).
 */
const DEFAULT_TZ = 'America/Sao_Paulo';

/** Fusos oficiais do Brasil (IANA). */
const BRAZIL_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília — SP, RJ, MG, RS, DF, etc. (UTC−3)' },
  { value: 'America/Manaus', label: 'Amazonas, Roraima, Rondônia, etc. (UTC−4)' },
  { value: 'America/Rio_Branco', label: 'Acre (UTC−5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC−2)' },
];

const ALLOWED_TZ = new Set(BRAZIL_TIMEZONES.map((t) => t.value));

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeTimezone(tz) {
  const s = String(tz || '').trim();
  return ALLOWED_TZ.has(s) ? s : DEFAULT_TZ;
}

function getPartsInTz(date, timeZone = DEFAULT_TZ) {
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

function fmtDateISOInTz(d, timeZone = DEFAULT_TZ) {
  const parts = getPartsInTz(d, timeZone);
  if (!parts) return '';
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function fmtTimeInTz(d, timeZone = DEFAULT_TZ) {
  if (!d) return '';
  const parts = getPartsInTz(d, timeZone);
  if (!parts) return '';
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function minutosDoDiaInTz(dataHora, timeZone = DEFAULT_TZ) {
  const parts = getPartsInTz(dataHora, timeZone);
  if (!parts) return 0;
  return parts.hour * 60 + parts.minute;
}

function zonedDateTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = DEFAULT_TZ
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

function inicioFimDoDiaInTz(ref = new Date(), timeZone = DEFAULT_TZ) {
  const iso = fmtDateISOInTz(ref, timeZone);
  if (!iso) {
    const d = ref instanceof Date ? ref : new Date(ref);
    return {
      inicio: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
      fim: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
    };
  }

  const [y, m, day] = iso.split('-').map(Number);
  const inicio = zonedDateTimeToUtc({ year: y, month: m, day, hour: 0, minute: 0, second: 0 }, timeZone);
  const fim = zonedDateTimeToUtc({ year: y, month: m, day, hour: 23, minute: 59, second: 59 }, timeZone);
  fim.setMilliseconds(999);
  return { inicio, fim };
}

function isSameDayInTz(a, b, timeZone = DEFAULT_TZ) {
  if (!a || !b) return false;
  return fmtDateISOInTz(a, timeZone) === fmtDateISOInTz(b, timeZone);
}

/**
 * Converte "YYYY-MM-DDTHH:mm" (sem fuso) para instante UTC no fuso da empresa.
 */
function parseLocalDateTimeInput(value, timeZone = DEFAULT_TZ) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value ?? '').trim();
  if (!s) return null;

  const hasExplicitTz = /(Z|[+\-]\d{2}:?\d{2})$/.test(s);
  if (hasExplicitTz) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
  if (m) {
    return zonedDateTimeToUtc(
      {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: m[6] != null ? Number(m[6]) : 0,
      },
      timeZone
    );
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Helper com funções já vinculadas ao fuso da empresa. */
function createTimezoneHelper(timeZone) {
  const tz = normalizeTimezone(timeZone);
  return {
    timeZone: tz,
    fmtDateISO: (d) => fmtDateISOInTz(d, tz),
    fmtTime: (d) => fmtTimeInTz(d, tz),
    minutosDoDia: (d) => minutosDoDiaInTz(d, tz),
    inicioFimDoDia: (ref) => inicioFimDoDiaInTz(ref, tz),
    isSameDay: (a, b) => isSameDayInTz(a, b, tz),
    getPartsInTz: (d) => getPartsInTz(d, tz),
    zonedDateTimeToUtc: (parts) => zonedDateTimeToUtc(parts, tz),
    parseLocalInput: (value) => parseLocalDateTimeInput(value, tz),
  };
}

const defaultHelper = createTimezoneHelper(DEFAULT_TZ);

module.exports = {
  DEFAULT_TZ,
  TZ_EMPRESA: DEFAULT_TZ,
  BRAZIL_TIMEZONES,
  ALLOWED_TZ,
  normalizeTimezone,
  createTimezoneHelper,
  getPartsInTz,
  zonedDateTimeToUtc,
  parseLocalDateTimeInput,
  pad2,
  // Compat — usa Brasília por padrão
  fmtDateISOBr: defaultHelper.fmtDateISO,
  fmtTimeBr: defaultHelper.fmtTime,
  minutosDoDiaBr: defaultHelper.minutosDoDia,
  inicioFimDoDiaBr: defaultHelper.inicioFimDoDia,
  isSameDayBr: defaultHelper.isSameDay,
};
