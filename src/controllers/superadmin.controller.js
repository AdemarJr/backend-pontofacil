// src/controllers/superadmin.controller.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { sendConviteUsuario, sendResetUsuarioEmail } = require('../services/passwordReset.service');

const prisma = require('../infra/prisma');
const { resolverDadosContrato, diasAteExpiracao } = require('../shared/contractPeriod');
const { lerFeaturesDoTenant } = require('../shared/tenantFeatures');
const { normalizeTimezone } = require('../utils/timezoneBr');
const { mapearEnumPorMaxColaboradores } = require('../shared/planLimits');
const { validarSenhaForte } = require('../shared/passwordPolicy');

const MODOS_MARCACAO_VALIDOS = ['QUATRO_BATIDAS', 'DUAS_BATIDAS'];

function resolverModoMarcacao(val, { obrigatorio = false } = {}) {
  if (val == null || val === '') {
    if (obrigatorio) {
      return { erro: 'Modo de marcação inválido. Use QUATRO_BATIDAS ou DUAS_BATIDAS.' };
    }
    return { modo: 'QUATRO_BATIDAS' };
  }
  const modo = String(val).toUpperCase();
  if (!MODOS_MARCACAO_VALIDOS.includes(modo)) {
    return { erro: 'Modo de marcação inválido. Use QUATRO_BATIDAS ou DUAS_BATIDAS.' };
  }
  return { modo };
}

function responderErroSchemaPrisma(err, res) {
  const msg = String(err?.message || '');
  const schemaDesatualizado =
    err?.code === 'P2021' ||
    err?.code === 'P2022' ||
    /does not exist/i.test(msg);
  if (!schemaDesatualizado) return false;
  res.status(500).json({
    error:
      'Banco de dados desatualizado. Rode `npx prisma migrate deploy` no servidor e reinicie o backend.',
    code: 'DB_SCHEMA_OUTDATED',
  });
  return true;
}

async function listarTenants(req, res, next) {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        planoComercial: true,
        _count: { select: { usuarios: true, registros: true } },
        usuarios: {
          where: { role: 'ADMIN' },
          select: { id: true, nome: true, email: true },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tenantsComFeatures = await Promise.all(
      tenants.map(async (t) => ({
        ...t,
        features: await lerFeaturesDoTenant(t.id),
      }))
    );

    res.json(tenantsComFeatures);
  } catch (err) {
    if (responderErroSchemaPrisma(err, res)) return;
    next(err);
  }
}

async function criarTenant(req, res, next) {
  try {
    const {
      razaoSocial, nomeFantasia, cnpj, email, telefone, plano, planoComercialId,
      adminNome, adminEmail, adminSenha, modoMarcacao, fusoHorario,
    } = req.body;

    const modoResolvido = resolverModoMarcacao(modoMarcacao);
    if (modoResolvido.erro) {
      return res.status(400).json({ error: modoResolvido.erro });
    }

    if (!razaoSocial || !nomeFantasia || !cnpj || !email) {
      return res.status(400).json({ error: 'Razão social, nome fantasia, CNPJ e e-mail da empresa são obrigatórios' });
    }
    if (!adminNome || !adminEmail) {
      return res.status(400).json({ error: 'Nome e e-mail do administrador da empresa são obrigatórios' });
    }
    const senhaStr = adminSenha != null ? String(adminSenha) : '';
    if (senhaStr.length > 0) {
      const val = validarSenhaForte(senhaStr);
      if (!val.ok) return res.status(400).json({ error: val.error });
    }

    const comSenha = senhaStr.length > 0;
    let pinHash;
    let senhaHash = null;
    if (comSenha) {
      const hash = await bcrypt.hash(senhaStr, 12);
      pinHash = hash;
      senhaHash = hash;
    } else {
      pinHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    }

    const adminEmailNorm = String(adminEmail).trim().toLowerCase();

    let planoComercialResolved = null;
    if (planoComercialId) {
      planoComercialResolved = await prisma.planoComercial.findFirst({
        where: { id: planoComercialId, ativo: true },
      });
      if (!planoComercialResolved) {
        return res.status(400).json({ error: 'Plano comercial inválido ou inativo' });
      }
    }

    const enumPlano = planoComercialResolved
      ? mapearEnumPorMaxColaboradores(planoComercialResolved.maxColaboradores)
      : (plano || 'BASICO');

    const resultado = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          razaoSocial,
          nomeFantasia,
          cnpj,
          email,
          telefone: telefone || null,
          plano: enumPlano,
          planoComercialId: planoComercialResolved?.id || null,
          modoMarcacao: modoResolvido.modo,
          fusoHorario: normalizeTimezone(fusoHorario),
        },
      });
      await tx.tenantFeature.create({
        data: { tenantId: t.id, payrollModuleEnabled: false },
      });
      const u = await tx.usuario.create({
        data: {
          tenantId: t.id,
          nome: adminNome.trim(),
          email: adminEmailNorm,
          pinHash,
          senhaHash,
          cargo: 'Administrador',
          role: 'ADMIN',
        },
      });
      return { tenant: t, admin: u };
    });

    let conviteAdminEnviado = false;
    let conviteAdminErro = null;
    if (!comSenha) {
      try {
        const r = await sendConviteUsuario(resultado.admin.id);
        conviteAdminEnviado = Boolean(r.ok);
        if (!r.ok) {
          conviteAdminErro = r.skipped ? 'SMTP não configurado' : (r.reason || 'Falha ao enviar convite');
        }
      } catch (e) {
        console.error('[superadmin/criarTenant] Convite falhou (empresa já criada):', e?.message || e);
        conviteAdminEnviado = false;
        conviteAdminErro = e?.message ? String(e.message) : 'Falha ao enviar convite';
      }
    }

    res.status(201).json({
      ...resultado.tenant,
      conviteAdminEnviado,
      ...(conviteAdminErro ? { conviteAdminErro } : {}),
      primeiroAcessoPorEmail: !comSenha,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'CNPJ ou outro dado único já cadastrado' });
    }
    next(err);
  }
}

async function atualizarTenant(req, res, next) {
  try {
    const { id } = req.params;
    const {
      razaoSocial, nomeFantasia, cnpj, email, telefone, plano, planoComercialId,
      payrollModuleEnabled, contractStartDate, periodoContrato, modoMarcacao, fusoHorario,
    } = req.body;

    let modoMarcacaoAtualizado;
    if (modoMarcacao !== undefined) {
      const modoResolvido = resolverModoMarcacao(modoMarcacao, { obrigatorio: true });
      if (modoResolvido.erro) {
        return res.status(400).json({ error: modoResolvido.erro });
      }
      modoMarcacaoAtualizado = modoResolvido.modo;
    }

    const existente = await prisma.tenant.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Empresa não encontrada' });

    if (cnpj && cnpj !== existente.cnpj) {
      const dup = await prisma.tenant.findFirst({ where: { cnpj, NOT: { id } } });
      if (dup) return res.status(409).json({ error: 'CNPJ já cadastrado para outra empresa' });
    }

    let dadosContrato;
    const atualizaContrato =
      periodoContrato !== undefined || contractStartDate !== undefined;
    if (atualizaContrato) {
      try {
        dadosContrato = resolverDadosContrato({
          contractStartDate: periodoContrato && periodoContrato !== 'SEM_LIMITE'
            ? contractStartDate
            : null,
          periodoContrato: !periodoContrato || periodoContrato === 'SEM_LIMITE'
            ? null
            : periodoContrato,
        });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    let planoPatch = {};
    if (planoComercialId !== undefined) {
      if (planoComercialId === null || planoComercialId === '') {
        planoPatch = { planoComercialId: null };
      } else {
        const pc = await prisma.planoComercial.findFirst({
          where: { id: planoComercialId, ativo: true },
        });
        if (!pc) return res.status(400).json({ error: 'Plano comercial inválido ou inativo' });
        planoPatch = {
          planoComercialId: pc.id,
          plano: mapearEnumPorMaxColaboradores(pc.maxColaboradores),
        };
      }
    } else if (plano !== undefined) {
      planoPatch = { plano };
    }

    const tenant = await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(razaoSocial !== undefined && { razaoSocial }),
          ...(nomeFantasia !== undefined && { nomeFantasia }),
          ...(cnpj !== undefined && { cnpj }),
          ...(email !== undefined && { email }),
          ...(telefone !== undefined && { telefone: telefone || null }),
          ...planoPatch,
          ...(modoMarcacaoAtualizado !== undefined && { modoMarcacao: modoMarcacaoAtualizado }),
          ...(fusoHorario !== undefined && { fusoHorario: normalizeTimezone(fusoHorario) }),
          ...(dadosContrato && dadosContrato),
        },
      });

      if (payrollModuleEnabled !== undefined) {
        const agora = new Date();
        await tx.tenantFeature.upsert({
          where: { tenantId: id },
          create: {
            tenantId: id,
            payrollModuleEnabled: Boolean(payrollModuleEnabled),
            updatedAt: agora,
          },
          update: {
            payrollModuleEnabled: Boolean(payrollModuleEnabled),
            updatedAt: agora,
          },
        });
      }

      return tx.tenant.findUnique({ where: { id }, include: { planoComercial: true } });
    });

    tenant.features = await lerFeaturesDoTenant(id);

    if (tenant.status === 'SUSPENSO' && tenant.periodoContrato && tenant.contractEndDate) {
      const dias = diasAteExpiracao(tenant.contractEndDate);
      if (dias != null && dias >= 0) {
        await prisma.tenant.update({ where: { id }, data: { status: 'ATIVO' } });
        tenant.status = 'ATIVO';
      }
    }

    res.json(tenant);
  } catch (err) {
    if (responderErroSchemaPrisma(err, res)) return;
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'CNPJ ou e-mail já cadastrado' });
    }
    next(err);
  }
}

async function atualizarFeatures(req, res, next) {
  try {
    const { id: tenantId } = req.params;
    const { payrollModuleEnabled } = req.body;

    if (payrollModuleEnabled === undefined) {
      return res.status(400).json({ error: 'Informe payrollModuleEnabled (true ou false)' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });

    const habilitado = payrollModuleEnabled === true || payrollModuleEnabled === 'true';
    const agora = new Date();

    await prisma.$executeRaw`
      INSERT INTO "tenant_features" ("tenantId", "payrollModuleEnabled", "updatedAt")
      VALUES (${tenantId}, ${habilitado}, ${agora})
      ON CONFLICT ("tenantId")
      DO UPDATE SET
        "payrollModuleEnabled" = ${habilitado},
        "updatedAt" = ${agora}
    `;

    const features = await prisma.tenantFeature.findUnique({
      where: { tenantId },
      select: { tenantId: true, payrollModuleEnabled: true, updatedAt: true },
    });

    if (!features || features.payrollModuleEnabled !== habilitado) {
      return res.status(500).json({
        error: 'Falha ao gravar módulo de folha. Tente novamente ou contate o suporte.',
        code: 'FEATURE_SAVE_FAILED',
        esperado: habilitado,
        gravado: features?.payrollModuleEnabled ?? null,
      });
    }

    res.json(features);
  } catch (err) {
    if (responderErroSchemaPrisma(err, res)) return;
    next(err);
  }
}

async function atualizarContrato(req, res, next) {
  try {
    const { id } = req.params;
    const { contractStartDate, periodoContrato } = req.body;

    let dadosContrato;
    try {
      dadosContrato = resolverDadosContrato({ contractStartDate, periodoContrato });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const existente = await prisma.tenant.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Empresa não encontrada' });

    const tenant = await prisma.tenant.update({
      where: { id },
      data: dadosContrato,
    });

    // Se reativou contrato e empresa estava suspensa só por vencimento, reativa
    if (tenant.status === 'SUSPENSO' && tenant.periodoContrato && tenant.contractEndDate) {
      const dias = diasAteExpiracao(tenant.contractEndDate);
      if (dias != null && dias >= 0) {
        await prisma.tenant.update({ where: { id }, data: { status: 'ATIVO' } });
        tenant.status = 'ATIVO';
      }
    }

    res.json(tenant);
  } catch (err) {
    if (responderErroSchemaPrisma(err, res)) return;
    next(err);
  }
}

/** Cadastra um usuário ADMIN em uma empresa já existente (login: e-mail + senha no /login) */
async function criarAdminTenant(req, res, next) {
  try {
    const { id: tenantId } = req.params;
    const { nome, email, senha } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    }
    const senhaStr = senha != null ? String(senha) : '';
    if (senhaStr.length > 0) {
      const val = validarSenhaForte(senhaStr);
      if (!val.ok) return res.status(400).json({ error: val.error });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
    if (tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Só é possível cadastrar administrador em empresa ativa' });
    }

    const duplicado = await prisma.usuario.findFirst({
      where: { tenantId, email: String(email).trim() },
    });
    if (duplicado) {
      return res.status(409).json({ error: 'Já existe usuário com este e-mail nesta empresa' });
    }

    const comSenha = senhaStr.length > 0;
    let pinHash;
    let senhaHash = null;
    if (comSenha) {
      const hash = await bcrypt.hash(senhaStr, 12);
      pinHash = hash;
      senhaHash = hash;
    } else {
      pinHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    }

    const usuario = await prisma.usuario.create({
      data: {
        tenantId,
        nome: nome.trim(),
        email: String(email).trim().toLowerCase(),
        pinHash,
        senhaHash,
        cargo: 'Administrador',
        role: 'ADMIN',
      },
      select: { id: true, nome: true, email: true, role: true },
    });

    let conviteEmailEnviado = false;
    let conviteEmailErro = null;
    if (!comSenha) {
      try {
        const r = await sendConviteUsuario(usuario.id);
        conviteEmailEnviado = Boolean(r.ok);
        if (!r.ok) {
          conviteEmailErro = r.skipped ? 'SMTP não configurado' : (r.reason || 'Falha ao enviar convite');
        }
      } catch (e) {
        console.error('[superadmin/criarAdmin] Convite falhou (admin já criado):', e?.message || e);
        conviteEmailEnviado = false;
        conviteEmailErro = e?.message ? String(e.message) : 'Falha ao enviar convite';
      }
    }

    res.status(201).json({
      ...usuario,
      conviteEmailEnviado,
      ...(conviteEmailErro ? { conviteEmailErro } : {}),
      primeiroAcessoPorEmail: !comSenha,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa' });
    }
    next(err);
  }
}

/**
 * Resetar senha de um ADMIN da empresa — envia link por e-mail (SMTP).
 */
async function resetSenhaAdminTenant(req, res, next) {
  try {
    const { id: tenantId, adminId } = req.params;

    const usuario = await prisma.usuario.findFirst({
      where: { id: adminId, tenantId, role: 'ADMIN' },
      include: { tenant: { select: { nomeFantasia: true } } },
    });
    if (!usuario) {
      return res.status(404).json({ error: 'Administrador não encontrado para esta empresa' });
    }

    const r = await sendResetUsuarioEmail(usuario);
    if (!r?.ok) {
      const err = new Error(
        r?.skipped
          ? 'Servidor sem SMTP configurado para envio de e-mails.'
          : 'Falha ao enviar e-mail de recuperação.'
      );
      err.status = r?.skipped ? 503 : 502;
      throw err;
    }

    return res.json({
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, ativo: usuario.ativo },
      sucesso: true,
      emailEnviado: true,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function atualizarStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ATIVO', 'SUSPENSO', 'CANCELADO'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    await prisma.tenant.update({ where: { id }, data: { status } });
    res.json({ sucesso: true });
  } catch (err) { next(err); }
}

async function stats(req, res, next) {
  try {
    const [totalTenants, totalUsuarios, totalRegistros] = await Promise.all([
      prisma.tenant.count(),
      prisma.usuario.count({ where: { ativo: true } }),
      prisma.registroPonto.count(),
    ]);
    res.json({ totalTenants, totalUsuarios, totalRegistros });
  } catch (err) { next(err); }
}

/** Remove todos os registros de ponto e ajustes de um tenant (irreversível). */
async function limparRegistrosTenant(req, res, next) {
  try {
    const { id } = req.params;
    const { confirmarNomeFantasia } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });

    if (!confirmarNomeFantasia || String(confirmarNomeFantasia).trim() !== tenant.nomeFantasia) {
      return res.status(400).json({
        error: 'Confirmação inválida. Envie confirmarNomeFantasia igual ao nome fantasia cadastrado.',
      });
    }

    const delAjustes = await prisma.ajustePonto.deleteMany({ where: { tenantId: id } });
    const delRegistros = await prisma.registroPonto.deleteMany({ where: { tenantId: id } });

    res.json({
      sucesso: true,
      removidosAjustes: delAjustes.count,
      removidosRegistros: delRegistros.count,
    });
  } catch (err) {
    next(err);
  }
}

/** Reenviar convite de primeiro acesso por e-mail (SMTP) para um ADMIN */
async function reenviarConviteAdminTenant(req, res, next) {
  try {
    const { id: tenantId, adminId } = req.params;
    const u = await prisma.usuario.findFirst({
      where: { id: adminId, tenantId, role: 'ADMIN', ativo: true },
      select: { id: true, nome: true, email: true },
    });
    if (!u) return res.status(404).json({ error: 'Administrador não encontrado para esta empresa' });

    const r = await sendConviteUsuario(u.id);
    if (!r.ok) {
      const err = new Error(
        r.skipped
          ? 'Servidor sem SMTP configurado para envio de e-mails.'
          : 'Falha ao enviar convite por e-mail.'
      );
      err.status = r.skipped ? 503 : 502;
      throw err;
    }

    return res.json({ sucesso: true, emailEnviado: true, usuario: u });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

module.exports = {
  listarTenants,
  criarTenant,
  criarAdminTenant,
  resetSenhaAdminTenant,
  reenviarConviteAdminTenant,
  atualizarTenant,
  atualizarFeatures,
  atualizarContrato,
  atualizarStatus,
  stats,
  limparRegistrosTenant,
};
