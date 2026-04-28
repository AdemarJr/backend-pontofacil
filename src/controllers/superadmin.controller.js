// src/controllers/superadmin.controller.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { frontendBase } = require('../services/passwordReset.service');
const { sendPasswordResetEmail, ensureSupabaseUserExists } = require('../services/supabaseAuth.service');

const prisma = new PrismaClient();

async function listarTenants(req, res, next) {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: { select: { usuarios: true, registros: true } },
        usuarios: {
          where: { role: 'ADMIN' },
          select: { id: true, nome: true, email: true },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tenants);
  } catch (err) { next(err); }
}

async function criarTenant(req, res, next) {
  try {
    const {
      razaoSocial, nomeFantasia, cnpj, email, telefone, plano,
      adminNome, adminEmail, adminSenha,
    } = req.body;

    if (!razaoSocial || !nomeFantasia || !cnpj || !email) {
      return res.status(400).json({ error: 'Razão social, nome fantasia, CNPJ e e-mail da empresa são obrigatórios' });
    }
    if (!adminNome || !adminEmail) {
      return res.status(400).json({ error: 'Nome e e-mail do administrador da empresa são obrigatórios' });
    }
    const senhaStr = adminSenha != null ? String(adminSenha) : '';
    if (senhaStr.length > 0 && senhaStr.length < 6) {
      return res.status(400).json({
        error: 'Senha do administrador deve ter no mínimo 6 caracteres, ou deixe em branco para enviar o primeiro acesso por e-mail',
      });
    }

    const comSenha = senhaStr.length >= 6;
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

    const resultado = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          razaoSocial,
          nomeFantasia,
          cnpj,
          email,
          telefone: telefone || null,
          plano: plano || 'BASICO',
        },
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
    if (!comSenha) {
      try {
        // Garante que exista um usuário no Supabase Auth e dispara o e-mail de recuperação
        await ensureSupabaseUserExists(adminEmailNorm, {
          nome: resultado.admin.nome,
          role: 'ADMIN',
          tenantId: resultado.tenant.id,
        });
        const redirectTo = `${frontendBase()}/redefinir-senha`;
        await sendPasswordResetEmail(adminEmailNorm, redirectTo);
        conviteAdminEnviado = true;
      } catch (e) {
        console.error('[superadmin/criarTenant] Convite falhou (empresa já criada):', e?.message || e);
        conviteAdminEnviado = false;
      }
    }

    res.status(201).json({
      ...resultado.tenant,
      conviteAdminEnviado,
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
    const { razaoSocial, nomeFantasia, cnpj, email, telefone, plano } = req.body;

    const existente = await prisma.tenant.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Empresa não encontrada' });

    if (cnpj && cnpj !== existente.cnpj) {
      const dup = await prisma.tenant.findFirst({ where: { cnpj, NOT: { id } } });
      if (dup) return res.status(409).json({ error: 'CNPJ já cadastrado para outra empresa' });
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(razaoSocial !== undefined && { razaoSocial }),
        ...(nomeFantasia !== undefined && { nomeFantasia }),
        ...(cnpj !== undefined && { cnpj }),
        ...(email !== undefined && { email }),
        ...(telefone !== undefined && { telefone: telefone || null }),
        ...(plano !== undefined && { plano }),
      },
    });
    res.json(tenant);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'CNPJ ou e-mail já cadastrado' });
    }
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
    if (senhaStr.length > 0 && senhaStr.length < 6) {
      return res.status(400).json({
        error: 'Senha deve ter no mínimo 6 caracteres, ou deixe em branco para enviar o primeiro acesso por e-mail',
      });
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

    const comSenha = senhaStr.length >= 6;
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
    if (!comSenha) {
      try {
        await ensureSupabaseUserExists(usuario.email, {
          nome: usuario.nome,
          role: 'ADMIN',
          tenantId,
        });
        const redirectTo = `${frontendBase()}/redefinir-senha`;
        await sendPasswordResetEmail(usuario.email, redirectTo);
        conviteEmailEnviado = true;
      } catch (e) {
        console.error('[superadmin/criarAdmin] Convite falhou (admin já criado):', e?.message || e);
        conviteEmailEnviado = false;
      }
    }

    res.status(201).json({ ...usuario, conviteEmailEnviado, primeiroAcessoPorEmail: !comSenha });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'E-mail já cadastrado nesta empresa' });
    }
    next(err);
  }
}

/**
 * Resetar senha (PIN) de um ADMIN da empresa.
 * Dispara e-mail de recuperação via Supabase (Reset password).
 */
async function resetSenhaAdminTenant(req, res, next) {
  try {
    const { id: tenantId, adminId } = req.params;

    const usuario = await prisma.usuario.findFirst({
      where: { id: adminId, tenantId, role: 'ADMIN' },
      select: { id: true, nome: true, email: true, ativo: true },
    });
    if (!usuario) {
      return res.status(404).json({ error: 'Administrador não encontrado para esta empresa' });
    }

    try {
      await ensureSupabaseUserExists(usuario.email, {
        nome: usuario.nome,
        role: 'ADMIN',
        tenantId,
      });
      const redirectTo = `${frontendBase()}/redefinir-senha`;
      await sendPasswordResetEmail(usuario.email, redirectTo);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    return res.json({
      usuario,
      sucesso: true,
      emailEnviado: true,
    });
  } catch (err) {
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

module.exports = {
  listarTenants,
  criarTenant,
  criarAdminTenant,
  resetSenhaAdminTenant,
  atualizarTenant,
  atualizarStatus,
  stats,
  limparRegistrosTenant,
};
