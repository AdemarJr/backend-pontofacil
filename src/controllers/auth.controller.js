// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requestForgotByEmail, resetPasswordWithToken } = require('../services/passwordReset.service');

const prisma = new PrismaClient();

function handlePrismaAuthError(err, res, next) {
  if (err.code === 'P1001' || err.code === 'P1017') {
    console.error('[auth] DB indisponível:', err.message);
    return res.status(503).json({
      error: 'Banco de dados indisponível. Verifique DATABASE_URL / DIRECT_URL no Railway e se o Prisma rodou migrate deploy.',
    });
  }
  if (typeof err.code === 'string' && err.code.startsWith('P')) {
    console.error('[auth] Prisma:', err.code, err.message);
    return res.status(500).json({
      error:
        'Erro ao acessar o banco. Rode `npx prisma migrate deploy` e, se necessário, `node prisma/seed.js` no ambiente com DATABASE_URL.',
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
      return res.json({
        ...tokens,
        usuario: { id: superAdmin.id, nome: superAdmin.nome, email: superAdmin.email, role: 'SUPER_ADMIN' }
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
          },
        },
      }
    });

    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (usuario.tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Empresa com acesso suspenso' });
    }

    const hashLogin = usuario.senhaHash || usuario.pinHash;
    const valido = await bcrypt.compare(senha, hashLogin);
    if (!valido) return res.status(401).json({ error: 'Credenciais inválidas' });

    const tokens = gerarTokens({ id: usuario.id, tenantId: usuario.tenantId, role: usuario.role });
    return res.json({
      ...tokens,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        tenant: usuario.tenant,
      }
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

// Login do colaborador no TOTEM (por PIN numérico)
async function loginPin(req, res, next) {
  try {
    const { pin, tenantId, deviceId } = req.body;
    if (!pin || !tenantId) {
      return res.status(400).json({ error: 'PIN e tenantId são obrigatórios' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, permitirTotem: true },
    });
    if (!tenant || tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Empresa com acesso suspenso' });
    }
    if (tenant.permitirTotem === false) {
      return res.status(403).json({ error: 'Registro por totem está desativado para esta empresa' });
    }

    // Busca todos os colaboradores ativos do tenant e compara PIN
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId, ativo: true },
      select: { id: true, nome: true, pinHash: true, cargo: true, fotoPerfil: true }
    });

    let usuarioEncontrado = null;
    for (const u of usuarios) {
      const match = await bcrypt.compare(pin, u.pinHash);
      if (match) { usuarioEncontrado = u; break; }
    }

    if (!usuarioEncontrado) {
      return res.status(401).json({ error: 'PIN inválido' });
    }

    // Token de curta duração para o totem (apenas registrar ponto)
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
      }
    });
  } catch (err) {
    return handlePrismaAuthError(err, res, next);
  }
}

// Refresh de token
async function refreshToken(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token obrigatório' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokens = gerarTokens({ id: decoded.id, tenantId: decoded.tenantId, role: decoded.role, tipo: decoded.tipo });
    res.json(tokens);
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }
}

/** Esqueci minha senha — envia e-mail com link (não revela se o e-mail existe) */
async function esqueciSenha(req, res, next) {
  try {
    const { email, tenantId } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

    try {
      await requestForgotByEmail(email, tenantId);
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

module.exports = { loginEmail, loginPin, refreshToken, esqueciSenha, redefinirSenha };
