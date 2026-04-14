// src/routes/tenant.routes.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const prisma = new PrismaClient();

function isOutdatedSchemaError(err) {
  // Prisma: P2022 = column does not exist
  if (err?.code === 'P2022') return true;
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && msg.includes('column');
}

router.get('/meu', autenticar, async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true, razaoSocial: true, nomeFantasia: true, cnpj: true,
        plano: true, status: true, geofenceLat: true, geofenceLng: true,
        geofenceRaio: true,
        geofenceAtivo: true,
        fotoObrigatoria: true,
        toleranciaMinutos: true,
        trabalhoMinimoAntesSaidaMinutos: true,
        intervaloMinimoAlmocoMinutos: true,
      }
    });
    res.json(tenant);
  } catch (err) {
    if (isOutdatedSchemaError(err)) {
      return res.status(500).json({
        error:
          'Banco de dados desatualizado para este backend. Aplique as migrations do Prisma (migrate deploy) e tente novamente.',
        code: 'DB_SCHEMA_OUTDATED',
      });
    }
    next(err);
  }
});

router.put('/meu', autenticar, exigirAdmin, async (req, res, next) => {
  try {
    const {
      geofenceLat,
      geofenceLng,
      geofenceRaio,
      geofenceAtivo,
      fotoObrigatoria,
      toleranciaMinutos,
      trabalhoMinimoAntesSaidaMinutos,
      intervaloMinimoAlmocoMinutos,
    } = req.body;
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(geofenceLat !== undefined && { geofenceLat: parseFloat(geofenceLat) }),
        ...(geofenceLng !== undefined && { geofenceLng: parseFloat(geofenceLng) }),
        ...(geofenceRaio !== undefined && { geofenceRaio: parseInt(geofenceRaio) }),
        ...(geofenceAtivo !== undefined && { geofenceAtivo: Boolean(geofenceAtivo) }),
        ...(fotoObrigatoria !== undefined && { fotoObrigatoria: Boolean(fotoObrigatoria) }),
        ...(toleranciaMinutos !== undefined && { toleranciaMinutos: parseInt(toleranciaMinutos) }),
        ...(trabalhoMinimoAntesSaidaMinutos !== undefined && {
          trabalhoMinimoAntesSaidaMinutos: parseInt(trabalhoMinimoAntesSaidaMinutos),
        }),
        ...(intervaloMinimoAlmocoMinutos !== undefined && {
          intervaloMinimoAlmocoMinutos: parseInt(intervaloMinimoAlmocoMinutos),
        }),
      }
    });
    res.json({ sucesso: true });
  } catch (err) {
    if (isOutdatedSchemaError(err)) {
      return res.status(500).json({
        error:
          'Banco de dados desatualizado para este backend. Aplique as migrations do Prisma (migrate deploy) e tente novamente.',
        code: 'DB_SCHEMA_OUTDATED',
      });
    }
    next(err);
  }
});

router.get('/:tenantId/info', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.tenantId, status: 'ATIVO' },
      select: { id: true, nomeFantasia: true, fotoObrigatoria: true, geofenceAtivo: true }
    });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(tenant);
  } catch (err) { next(err); }
});

module.exports = router;
