const { createTimezoneHelper } = require('../utils/timezoneBr');

async function loadTenantTimezone(prisma, tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { fusoHorario: true },
  });
  return createTimezoneHelper(tenant?.fusoHorario);
}

module.exports = {
  loadTenantTimezone,
};
