const { toNumber, rubrica, round2 } = require('./payroll.shared');

/**
 * Adiantamento salarial (meio do mês).
 * MVP: % do salário base, sem INSS/IRRF no pagamento (tributação na folha mensal).
 */
function calcularAdiantamentoSalarial({ usuario, percent = 40 }) {
  const salario = toNumber(usuario.salarioBase);
  if (!salario || salario <= 0) return { erro: 'Salário base não configurado' };

  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  if (pct <= 0) return { erro: 'Percentual de adiantamento inválido' };

  const valor = round2((salario * pct) / 100);

  return {
    proventos: [rubrica('106', 'Adiantamento salarial', `${pct}% do salário`, valor)],
    descontos: [],
    bases: { inss: 0, irrf: 0, fgts: 0 },
    liquido: valor,
    percent: pct,
  };
}

module.exports = { calcularAdiantamentoSalarial };
