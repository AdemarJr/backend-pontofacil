const prisma = require('../../infra/prisma');
const { alocarNsr } = require('./nsr.service');
const { registrarAuditoria } = require('../../shared/auditoria.service');

/**
 * Cria registro de ponto com NSR e dataHoraUtc (REP-P).
 */
async function criarRegistroPonto({
  tenantId,
  usuarioId,
  tipo,
  dataHora,
  dataHoraUtc = new Date(),
  latitude = null,
  longitude = null,
  dentroGeofence = null,
  fotoUrl = null,
  fotoKey = null,
  deviceId = null,
  ipHash = null,
  userAgent = null,
  origem = 'TOTEM',
  clientRequestId = null,
  validado = true,
  actorId = null,
  actorRole = null,
  acaoAuditoria = 'REGISTRO_CRIADO',
}) {
  return prisma.$transaction(async (tx) => {
    const nsr = await alocarNsr(tenantId, tx);
    const registro = await tx.registroPonto.create({
      data: {
        tenantId,
        usuarioId,
        tipo,
        dataHora,
        dataHoraUtc,
        nsr,
        latitude,
        longitude,
        dentroGeofence,
        fotoUrl,
        fotoKey,
        deviceId,
        ipHash,
        userAgent,
        origem,
        clientRequestId,
        validado,
      },
      include: {
        usuario: { select: { nome: true, cargo: true, cpf: true, pis: true } },
      },
    });

    await registrarAuditoria({
      tenantId,
      entidade: 'RegistroPonto',
      entidadeId: registro.id,
      acao: acaoAuditoria,
      payloadDepois: {
        id: registro.id,
        nsr: registro.nsr,
        tipo: registro.tipo,
        dataHora: registro.dataHora,
        dataHoraUtc: registro.dataHoraUtc,
        origem: registro.origem,
        usuarioId: registro.usuarioId,
      },
      actorId,
      actorRole,
      ipHash,
      tx,
    });

    return registro;
  });
}

module.exports = { criarRegistroPonto };
