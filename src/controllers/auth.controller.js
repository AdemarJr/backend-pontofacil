// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requestForgotByEmail, resetPasswordWithToken, sendConviteUsuario, changePasswordUsuario } = require('../services/passwordReset.service');

const prisma = require('../infra/prisma');
const { isContractExpired, contractExpiredPayload } = require('../shared/contractCheck');
const { lerFeaturesDoTenant } = require('../shared/tenantFeatures');
const { setRefreshCookie, clearRefreshCookie, readRefreshToken } = require('../shared/authCookies');

function enviarSessaoAutenticada(res, tokens, extra = {}) {
  setRefreshCookie(res, tokens.refreshToken);
  return res.json({
    accessToken: tokens.accessToken,
    ...extra,
  });
}

function handlePrismaAuthError(err, res, next) {
  if (err.code === 'P1001' || err.code === 'P1017') {
    console.error('[auth] DB indisponível:', err.message);
    return res.status(503).json({
      error: 'Banco de dados indisponível. Verifique DATABASE_URL / DIRECT_URL no Railway e se o Prisma rodou migrate deploy.',
    });
  }
  if (typeof err.code === 'string' && err.code.startsWith('P')) {
    console.error('[auth] Prisma:', err.code, err.message);
    const schemaOutdated = err.code === 'P2021' || err.code === 'P2022' || /does not exist/i.test(String(err.message || ''));
    return res.status(500).json({
      error: schemaOutdated
        ? 'Banco desatualizado para este backend. Rode o SQL baseline-completo-homolog.sql no Postgres e redeploy.'
        : 'Erro ao acessar o banco. Verifique DATABASE_URL no Railway e se o schema está alinhado (prisma migrate deploy).',
      code: schemaOutdated ? 'DB_SCHEMA_OUTDATED' : 'DB_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { prismaCode: err.code, detail: err.message }),
    });
  }
  return next(err);
}

function assertJwtConfig() {
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    const err = new Error('JWT_SECRET e JWT_REFRESH_SECRET devem estar definidos no servidor');
    err.status = 500;
    throw err;
  }
}

function gerarTokens(payload) {
  assertJwtConfig();
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
}

// Login do Admin/Colaborador (por email + senha)
async function loginEmail(req, res, next) {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Tenta Super Admin primeiro
    const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
    if (superAdmin) {
      const valido = await bcrypt.compare(senha, superAdmin.senhaHash);
      if (!valido) return res.status(401).json({ error: 'Credenciais inválidas' });

      const tokens = gerarTokens({ id: superAdmin.id, tipo: 'super_admin' });
      return enviarSessaoAutenticada(res, tokens, {
        usuario: { id: superAdmin.id, nome: superAdmin.nome, email: superAdmin.email, role: 'SUPER_ADMIN' },
      });
    }

    // Usuário comum
    const usuario = await prisma.usuario.findFirst({
      where: { email, ativo: true },
      include: {
        tenant: {
          select: {
            id: true,
            nomeFantasia: true,
            status: true,
            fotoObrigatoria: true,
            geofenceAtivo: true,
            permitirTotem: true,
            permitirMeuPonto: true,
            fusoHorario: true,
            periodoContrato: true,
            contractEndDate: true,
            features: { select: { payrollModuleEnabled: true } },
          },
        },
      }
    });

    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (usuario.tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Empresa com acesso suspenso' });
    }

    if (isContractExpired(usuario.tenant)) {
      return res.status(403).json(contractExpiredPayload(usuario.tenant));
    }

    if (usuario.senhaHash) {
      const valido = await bcrypt.compare(senha, usuario.senhaHash);
      if (!valido) return res.status(401).json({ error: 'Credenciais inválidas' });
    } else {
      // Primeiro acesso pendente: aceita PIN só até definir senha web pelo convite.
      const valido = await bcrypt.compare(senha, usuario.pinHash);
      if (!valido) {
        return res.status(401).json({
          error: 'Credenciais inválidas. Se ainda não definiu senha web, use o link enviado por e-mail.',
        });
      }
    }

    const features = await lerFeaturesDoTenant(usuario.tenantId);
    const tokens = gerarTokens({ id: usuario.id, tenantId: usuario.tenantId, role: usuario.role });
    return enviarSessaoAutenticada(res, tokens, {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        tenant: {
          ...usuario.tenant,
          features,
        },
      },
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

// Login do colaborador no TOTEM (por PIN numérico)
const PIN_LOGIN_MIN_DELAY_MS = 400;

async function loginPin(req, res, next) {
  const inicio = Date.now();
  try {
    const { pin, tenantId, deviceId } = req.body;
    if (!pin || !tenantId) {
      return res.status(400).json({ error: 'PIN e tenantId são obrigatórios' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        permitirTotem: true,
        periodoContrato: true,
        contractEndDate: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({
        error: 'Empresa não encontrada. Verifique o código da empresa no totem.',
        code: 'TENANT_NOT_FOUND',
      });
    }
    if (tenant.status === 'CANCELADO') {
      return res.status(403).json({
        error: 'Empresa cancelada. Entre em contato com o suporte.',
        code: 'TENANT_CANCELLED',
      });
    }
    if (tenant.status !== 'ATIVO') {
      return res.status(403).json({
        error: 'Empresa com acesso suspenso. Peça ao administrador para reativar no painel.',
        code: 'TENANT_SUSPENDED',
      });
    }
    if (isContractExpired(tenant)) {
      return res.status(403).json(contractExpiredPayload(tenant));
    }
    if (tenant.permitirTotem === false) {
      return res.status(403).json({ error: 'Registro por totem está desativado para esta empresa' });
    }

    // Busca colaboradores ativos do tenant e compara PIN (delay mínimo anti-timing)
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId, ativo: true, role: 'COLABORADOR' },
      select: { id: true, nome: true, pinHash: true, cargo: true, fotoPerfil: true },
    });

    let usuarioEncontrado = null;
    for (const u of usuarios) {
      if (!u.pinHash) continue;
      const match = await bcrypt.compare(String(pin), u.pinHash);
      if (match) {
        usuarioEncontrado = u;
        break;
      }
    }

    if (!usuarioEncontrado) {
      return res.status(401).json({ error: 'PIN inválido' });
    }

    assertJwtConfig();
    const totemToken = jwt.sign(
      { id: usuarioEncontrado.id, tenantId, tipo: 'totem' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    return res.json({
      totemToken,
      usuario: {
        id: usuarioEncontrado.id,
        nome: usuarioEncontrado.nome,
        cargo: usuarioEncontrado.cargo,
        fotoPerfil: usuarioEncontrado.fotoPerfil,
      },
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  } finally {
    const restante = PIN_LOGIN_MIN_DELAY_MS - (Date.now() - inicio);
    if (restante > 0) {
      await new Promise((resolve) => setTimeout(resolve, restante));
    }
  }
}

// Refresh de token — revalida usuário/tenant no banco (anti-sessão zumbi)
async function refreshToken(req, res, next) {
  try {
    const tokenBody = readRefreshToken(req);
    if (!tokenBody) return res.status(401).json({ error: 'Refresh token obrigatório' });

    const decoded = jwt.verify(tokenBody, process.env.JWT_REFRESH_SECRET);

    if (decoded.tipo === 'super_admin') {
      const superAdmin = await prisma.superAdmin.findUnique({ where: { id: decoded.id } });
      if (!superAdmin || !superAdmin.ativo) {
        return res.status(401).json({ error: 'Acesso negado' });
      }
      const tokens = gerarTokens({ id: superAdmin.id, tipo: 'super_admin' });
      return enviarSessaoAutenticada(res, tokens);
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.id },
      include: { tenant: true },
    });

    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado' });
    }
    if (usuario.tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Empresa com acesso suspenso' });
    }
    if (isContractExpired(usuario.tenant)) {
      return res.status(403).json(contractExpiredPayload(usuario.tenant));
    }

    const tokens = gerarTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      role: usuario.role,
    });
    return enviarSessaoAutenticada(res, tokens);
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }
}

/** Encerra sessão — remove cookie HttpOnly do refresh token */
function logout(req, res) {
  clearRefreshCookie(res);
  res.json({ sucesso: true });
}

/** Esqueci minha senha — envia e-mail com link (não revela se o e-mail existe) */
async function esqueciSenha(req, res, next) {
  try {
    const { email, tenantId } = req.body;
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório.' });
    }

    try {
      await requestForgotByEmail(email.trim(), tenantId);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    res.json({
      mensagem:
        'Se encontrarmos uma conta para este e-mail, enviaremos instruções para redefinir a senha. Verifique a caixa de entrada e o spam.',
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

/** Redefinir senha pelo token recebido por e-mail */
async function redefinirSenha(req, res, next) {
  try {
    const { token, senha } = req.body;
    try {
      await resetPasswordWithToken(token, senha);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    res.json({ sucesso: true, mensagem: 'Senha atualizada. Você já pode entrar com a nova senha.' });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

async function enviarConviteGerente(req, res, next) {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório.' });
    }

    const usuario = await prisma.usuario.findFirst({
      where: { email: email.trim().toLowerCase(), ativo: true },
      select: { id: true, email: true },
    });
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado com este e-mail.' });
    }

    const r = await sendConviteUsuario(usuario.id);
    if (!r.ok) {
      const err = new Error(
        r.skipped
          ? 'Servidor sem SMTP configurado para envio de e-mails.'
          : 'Falha ao enviar convite por e-mail.'
      );
      err.status = r.skipped ? 503 : 502;
      throw err;
    }

    return res.json({
      sucesso: true,
      mensagem: `Convite enviado com sucesso para ${usuario.email}.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

/** Colaborador/admin logado: altera senha web (não altera PIN do totem). */
async function alterarSenha(req, res, next) {
  try {
    if (req.isSuperAdmin) {
      return res.status(403).json({ error: 'Use recuperação de senha no login do Super Admin.' });
    }
    const { senhaAtual, novaSenha } = req.body;
    try {
      await changePasswordUsuario(req.usuario.id, senhaAtual, novaSenha);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    clearRefreshCookie(res);
    res.json({
      sucesso: true,
      mensagem: 'Senha atualizada. Entre novamente com a nova senha.',
      requerLogin: true,
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

module.exports = {
  loginEmail,
  loginPin,
  refreshToken,
  logout,
  esqueciSenha,
  redefinirSenha,
  enviarConviteGerente,
  alterarSenha,
};
