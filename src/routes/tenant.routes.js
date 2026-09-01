// src/routes/tenant.routes.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const prisma = require('../infra/prisma');
const { lerFeaturesDoTenant } = require('../shared/tenantFeatures');
const { registrarAuditoria, ipHashFromReq } = require('../shared/auditoria.service');
const { BRAZIL_TIMEZONES, normalizeTimezone } = require('../utils/timezoneBr');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const tenantInfoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Muitas consultas. Tente novamente em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function isOutdatedSchemaError(err) {
  // Prisma: P2022 = column does not exist
  if (err?.code === 'P2022') return true;
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && msg.includes('column');
}

router.get('/fusos-horarios', autenticar, (_req, res) => {
  res.json(BRAZIL_TIMEZONES);
});

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
          fusoHorario: true,
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
      fusoHorario,
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
        ...(fusoHorario !== undefined && { fusoHorario: normalizeTimezone(fusoHorario) }),
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
        fusoHorario,
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

router.get('/:tenantId/info', tenantInfoLimiter, async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    if (!UUID_RE.test(tenantId)) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId, status: 'ATIVO' },
      select: {
        id: true,
        nomeFantasia: true,
        fotoObrigatoria: true,
        geofenceAtivo: true,
        permitirTotem: true,
        permitirMeuPonto: true,
      },
    });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
    res.json(tenant);
  } catch (err) { next(err); }
});

module.exports = router;
