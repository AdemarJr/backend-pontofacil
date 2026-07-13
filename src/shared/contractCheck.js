// src/shared/contractCheck.js

function isContractExpired(tenant) {
  // Sem período configurado = sem limite (clientes legados em produção)
  if (!tenant?.periodoContrato || !tenant?.contractEndDate) return false;
  const end = new Date(tenant.contractEndDate);
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  return hoje > end;
}

function contractExpiredPayload(tenant) {
  return {
    error: 'Contrato expirado. Entre em contato para renovar.',
    code: 'CONTRACT_EXPIRED',
    contractEndDate: tenant.contractEndDate,
    periodoContrato: tenant.periodoContrato,
  };
}

module.exports = { isContractExpired, contractExpiredPayload };
