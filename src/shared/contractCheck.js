// src/shared/contractCheck.js

/** Início do dia local (00:00:00.000). */
function inicioDoDia(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Contrato vence no fim do dia de contractEndDate (dia inclusivo).
 * Ex.: fim em 07/08 → ainda válido o dia todo em 07/08; expirado a partir de 08/08 00:00.
 */
function isContractExpired(tenant) {
  // Sem período configurado = sem limite (clientes legados em produção)
  if (!tenant?.periodoContrato || !tenant?.contractEndDate) return false;
  const fim = inicioDoDia(tenant.contractEndDate);
  const hoje = inicioDoDia();
  return hoje > fim;
}

function contractExpiredPayload(tenant) {
  return {
    error: 'Contrato expirado. Entre em contato para renovar.',
    code: 'CONTRACT_EXPIRED',
    contractEndDate: tenant.contractEndDate,
    periodoContrato: tenant.periodoContrato,
  };
}

module.exports = { isContractExpired, contractExpiredPayload, inicioDoDia };
