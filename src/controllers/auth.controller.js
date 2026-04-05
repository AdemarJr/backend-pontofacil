// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function gerarTokens(payload) {
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
      include: { tenant: { select: { id: true, nomeFantasia: true, status: true, fotoObrigatoria: true, geofenceAtivo: true } } }
    });

    if (!usuario) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (usuario.tenant.status !== 'ATIVO') {
      return res.status(403).json({ error: 'Empresa com acesso suspenso' });
    }

    const valido = await bcrypt.compare(senha, usuario.pinHash);
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
  } catch (err) { next(err); }
}

// Login do colaborador no TOTEM (por PIN numérico)
async function loginPin(req, res, next) {
  try {
    const { pin, tenantId, deviceId } = req.body;
    if (!pin || !tenantId) {
      return res.status(400).json({ error: 'PIN e tenantId são obrigatórios' });
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
  } catch (err) { next(err); }
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

module.exports = { loginEmail, loginPin, refreshToken };
