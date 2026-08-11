/**
 * Regras CLT de jornada (Art. 7º CF / Consolidação).
 * Usado no espelho de ponto e validação de escalas.
 */

const JORNADA_DIARIA_MAX_MIN = 8 * 60;
const JORNADA_SEMANAL_MAX_MIN = 44 * 60;
const HORAS_MENSAIS_DIVISOR = 220;

/**
 * Intervalo intrajornada mínimo conforme duração da jornada contratual do dia.
 * @param {number} jornadaContratualMin minutos da jornada esperada (não o trabalhado)
 * @param {{ intervaloCCTMinutos?: number }} opts intervaloCCTMinutos: 30–60 (convenção coletiva)
 */
function intervaloMinimoLegal(jornadaContratualMin, opts = {}) {
  const cct = opts.intervaloCCTMinutos ?? 60;
  const intervaloCCT = Math.max(30, Math.min(60, cct));
  const horas = jornadaContratualMin / 60;
  if (horas > 6) return intervaloCCT;
  if (horas >= 4) return 15;
  return 0;
}

function horasNormaisDiaMin(minutosTrabalhados, limiteDiarioMin = JORNADA_DIARIA_MAX_MIN) {
  return Math.min(Math.max(0, minutosTrabalhados), limiteDiarioMin);
}

function heDiariaLegalMin(minutosTrabalhados, limiteDiarioMin = JORNADA_DIARIA_MAX_MIN) {
  return Math.max(0, minutosTrabalhados - limiteDiarioMin);
}

/** Segunda-feira da semana ISO (YYYY-MM-DD) */
function semanaISOKey(dataRef) {
  const d = new Date(`${dataRef}T12:00:00`);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const day = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * HE semanal: soma das horas normais na semana acima de 44h.
 * @param {Record<string, number>} normaisPorSemana chave = semanaISOKey, valor = minutos normais
 */
function calcularHeSemanal(normaisPorSemana) {
  let totalHeSemanalMin = 0;
  const porSemana = {};
  for (const [semana, normaisMin] of Object.entries(normaisPorSemana)) {
    const he = Math.max(0, normaisMin - JORNADA_SEMANAL_MAX_MIN);
    porSemana[semana] = { normaisMin, heSemanalMin: he };
    totalHeSemanalMin += he;
  }
  return { totalHeSemanalMin, porSemana };
}

/**
 * Opções CLT derivadas do tenant (sem migration — usa campos existentes).
 */
function cltOptsFromTenant(tenant) {
  const intervaloCCT = tenant?.intervaloMinimoAlmocoMinutos != null
    ? Math.max(30, Math.min(60, Number(tenant.intervaloMinimoAlmocoMinutos)))
    : 60;
  return {
    ativo: tenant?.aplicarRegrasCLT !== false,
    limiteDiarioMin: JORNADA_DIARIA_MAX_MIN,
    limiteSemanalMin: JORNADA_SEMANAL_MAX_MIN,
    intervaloCCTMinutos: intervaloCCT,
  };
}

function validarEscalaCLT(
  cargaHorariaDiaria,
  diasSemana,
  intervaloMinutos,
  intervaloCCTMinutos = 60,
  { overnight = false } = {}
) {
  const carga = Number(cargaHorariaDiaria) || 8;
  const dias = Array.isArray(diasSemana) ? diasSemana.length : 0;
  const maxDiaria = overnight ? 12 : 8;
  if (carga > maxDiaria) {
    return overnight
      ? 'Carga horária diária em turno noturno não pode exceder 12 horas.'
      : 'Carga horária diária não pode exceder 8 horas (limite CLT).';
  }
  if (carga * dias > 44) {
    return `Jornada semanal da escala (${(carga * dias).toFixed(1)}h) excede 44 horas (limite CLT).`;
  }
  if (overnight && Number(intervaloMinutos) === 0) {
    return null;
  }
  const minIntervalo = intervaloMinimoLegal(Math.round(carga * 60), { intervaloCCTMinutos });
  if (intervaloMinutos != null && minIntervalo > 0 && Number(intervaloMinutos) < minIntervalo) {
    return `Intervalo mínimo para jornada de ${carga}h é ${minIntervalo} minutos (CLT).`;
  }
  return null;
}

module.exports = {
  JORNADA_DIARIA_MAX_MIN,
  JORNADA_SEMANAL_MAX_MIN,
  HORAS_MENSAIS_DIVISOR,
  intervaloMinimoLegal,
  horasNormaisDiaMin,
  heDiariaLegalMin,
  semanaISOKey,
  calcularHeSemanal,
  cltOptsFromTenant,
  validarEscalaCLT,
};
