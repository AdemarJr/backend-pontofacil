// src/shared/contractPeriod.js — vigência SaaS por período (sem n8n)

const PERIODOS_VALIDOS = ['MENSAL', 'SEMESTRAL', 'ANUAL'];

function mesesDoPeriodo(periodo) {
  if (periodo === 'MENSAL') return 1;
  if (periodo === 'SEMESTRAL') return 6;
  if (periodo === 'ANUAL') return 12;
  return 0;
}

/**
 * Calcula a data de término inclusiva do contrato.
 * Ex.: início 15/01 + MENSAL → término 14/02 23:59:59
 */
function calcularContractEndDate(contractStartDate, periodoContrato) {
  if (!contractStartDate || !periodoContrato) return null;
  if (!PERIODOS_VALIDOS.includes(periodoContrato)) return null;

  const inicio = new Date(contractStartDate);
  if (Number.isNaN(inicio.getTime())) return null;
  inicio.setHours(0, 0, 0, 0);

  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + mesesDoPeriodo(periodoContrato));
  fim.setDate(fim.getDate() - 1);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

/**
 * Normaliza payload do Super Admin para gravar no tenant.
 * periodoContrato null = sem limite de vigência (clientes legados / produção).
 */
function resolverDadosContrato({ contractStartDate, periodoContrato }) {
  if (!periodoContrato || periodoContrato === 'SEM_LIMITE') {
    return {
      periodoContrato: null,
      contractStartDate: null,
      contractEndDate: null,
    };
  }

  if (!PERIODOS_VALIDOS.includes(periodoContrato)) {
    throw new Error('Período de contrato inválido. Use MENSAL, SEMESTRAL ou ANUAL.');
  }

  if (!contractStartDate) {
    throw new Error('Informe a data de início do contrato.');
  }

  const start = new Date(contractStartDate);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Data de início do contrato inválida.');
  }
  start.setHours(0, 0, 0, 0);

  return {
    periodoContrato,
    contractStartDate: start,
    contractEndDate: calcularContractEndDate(start, periodoContrato),
  };
}

function diasAteExpiracao(contractEndDate) {
  if (!contractEndDate) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fim = new Date(contractEndDate);
  fim.setHours(0, 0, 0, 0);
  return Math.ceil((fim - hoje) / (1000 * 60 * 60 * 24));
}

module.exports = {
  PERIODOS_VALIDOS,
  calcularContractEndDate,
  resolverDadosContrato,
  diasAteExpiracao,
};
