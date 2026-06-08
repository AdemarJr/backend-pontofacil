// src/modules/folha/payroll.dsr.js

/**
 * DSR sobre horas extras: (total HE / dias úteis) * domingos e feriados do mês.
 * Retorna valor em R$ do reflexo DSR.
 */
function calcularDSR({ totalHEMin, diasUteis, domingosEFeriados, valorHora }) {
  if (!diasUteis || diasUteis <= 0 || totalHEMin <= 0) return 0;
  const horasHE = totalHEMin / 60;
  const horasDSR = (horasHE / diasUteis) * domingosEFeriados;
  return Math.round(horasDSR * valorHora * 100) / 100;
}

module.exports = { calcularDSR };
