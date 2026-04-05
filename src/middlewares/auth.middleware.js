// src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verifica JWT e injeta usuário + tenant no request
async function autenticar(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Busca usuário garantindo que está ativo
    if (decoded.tipo === 'super_admin') {
      const superAdmin = await prisma.superAdmin.findUnique({
        where: { id: decoded.id },
      });
      if (!superAdmin || !superAdmin.ativo) {
        return res.status(401).json({ error: 'Acesso negado' });
      }
      req.usuario = { ...superAdmin, role: 'SUPER_ADMIN' };
      req.isSuperAdmin = true;
    } else {
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

      req.usuario = usuario;
      req.tenantId = usuario.tenantId;
      req.tenant = usuario.tenant;
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Garante que é Admin da empresa ou Super Admin
function exigirAdmin(req, res, next) {
  if (req.isSuperAdmin) return next();
  if (req.usuario.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

// Garante que é Super Admin
function exigirSuperAdmin(req, res, next) {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso restrito ao Super Admin' });
  }
  next();
}

// Garante isolamento de tenant (colaborador só acessa seu próprio tenant)
function isolamentoTenant(req, res, next) {
  if (req.isSuperAdmin) return next();

  // Se a rota tem :tenantId, verifica que corresponde ao do usuário logado
  if (req.params.tenantId && req.params.tenantId !== req.tenantId) {
    return res.status(403).json({ error: 'Acesso negado a este tenant' });
  }
  next();
}

module.exports = { autenticar, exigirAdmin, exigirSuperAdmin, isolamentoTenant };
