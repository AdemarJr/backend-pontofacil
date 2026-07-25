// src/routes/tenant.routes.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const prisma = require('../infra/prisma');
const { lerFeaturesDoTenant } = require('../shared/tenantFeatures');
const { registrarAuditoria, ipHashFromReq } = require('../shared/auditoria.service');

function isOutdatedSchemaError(err) {
  // Prisma: P2022 = column does not exist
  if (err?.code === 'P2022') return true;
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && msg.includes('column');
}

router.get('/meu/features', autenticar, async (req, res, next) => {
  try {
    const features = await lerFeaturesDoTenant(req.tenantId);
    res.json(features);
  } catch (err) {
    next(err);
  }
});

router.get('/meu', autenticar, async (req, res, next) => {
  try {
    const [tenant, features] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: {
          id: true, razaoSocial: true, nomeFantasia: true, cnpj: true,
          plano: true, status: true, geofenceLat: true, geofenceLng: true,
          geofenceRaio: true,
          geofenceAtivo: true,
          fotoObrigatoria: true,
          permitirTotem: true,
          permitirMeuPonto: true,
          toleranciaMinutos: true,
          trabalhoMinimoAntesSaidaMinutos: true,
          intervaloMinimoAlmocoMinutos: true,
          periodoContrato: true,
          contractStartDate: true,
          contractEndDate: true,
          modoMarcacao: true,
          modoInviolavel: true,
          exigirCpfPis: true,
        },
      }),
      lerFeaturesDoTenant(req.tenantId),
    ]);
    res.json({
      ...tenant,
      features,
    });
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
      permitirTotem,
      permitirMeuPonto,
      geofenceLat,
      geofenceLng,
      geofenceRaio,
      geofenceAtivo,
      fotoObrigatoria,
      toleranciaMinutos,
      trabalhoMinimoAntesSaidaMinutos,
      intervaloMinimoAlmocoMinutos,
      modoMarcacao,
      modoInviolavel,
      exigirCpfPis,
    } = req.body;

    const antes = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        modoMarcacao: true,
        modoInviolavel: true,
        exigirCpfPis: true,
        permitirTotem: true,
        permitirMeuPonto: true,
        geofenceAtivo: true,
        fotoObrigatoria: true,
      },
    });

    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(permitirTotem !== undefined && { permitirTotem: Boolean(permitirTotem) }),
        ...(permitirMeuPonto !== undefined && { permitirMeuPonto: Boolean(permitirMeuPonto) }),
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
        ...(modoMarcacao !== undefined && { modoMarcacao: String(modoMarcacao) }),
        ...(modoInviolavel !== undefined && { modoInviolavel: Boolean(modoInviolavel) }),
        ...(exigirCpfPis !== undefined && { exigirCpfPis: Boolean(exigirCpfPis) }),
      },
    });

    await registrarAuditoria({
      tenantId: req.tenantId,
      entidade: 'Tenant',
      entidadeId: req.tenantId,
      acao: 'TENANT_CONFIG',
      payloadAntes: antes,
      payloadDepois: {
        modoMarcacao,
        modoInviolavel,
        exigirCpfPis,
        permitirTotem,
        permitirMeuPonto,
        geofenceAtivo,
        fotoObrigatoria,
      },
      actorId: req.usuario.id,
      actorRole: req.usuario.role,
      ipHash: ipHashFromReq(req),
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
      select: {
        id: true,
        nomeFantasia: true,
        fotoObrigatoria: true,
        geofenceAtivo: true,
        permitirTotem: true,
        permitirMeuPonto: true,
      }
    });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(tenant);
  } catch (err) { next(err); }
});

module.exports = router;
