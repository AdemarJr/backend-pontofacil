// src/controllers/usuario.controller.js
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encryptPin, decryptPin } = require('../utils/pinCrypto');
const { sendConviteUsuario } = require('../services/passwordReset.service');

const prisma = new PrismaClient();

async function listar(req, res, next) {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId: req.tenantId, role: { not: 'SUPER_ADMIN' } },
      select: {
        id: true, nome: true, email: true, cargo: true,
        departamento: true, role: true, ativo: true, createdAt: true,
        localRegistroId: true,
      },
      orderBy: { nome: 'asc' },
    });
    res.json(usuarios);
  } catch (err) { next(err); }
}

async function buscarPorId(req, res, next) {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      select: {
        id: true, nome: true, email: true, cargo: true,
        departamento: true, role: true, ativo: true, createdAt: true,
        escalas: true,
      },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(usuario);
  } catch (err) { next(err); }
}

async function criar(req, res, next) {
  try {
    const { nome, email, pin, cargo, departamento, role, localRegistroId, enviarConviteEmail } = req.body;

    if (!nome || !email || !pin) {
      return res.status(400).json({ error: 'Nome, email e PIN são obrigatórios' });
    }
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'PIN deve ter 4 a 6 dígitos numéricos' });
    }

    const emailNorm = String(email).trim().toLowerCase();

    const existente = await prisma.usuario.findFirst({
      where: { email: emailNorm, tenantId: req.tenantId }
    });
    if (existente) return res.status(409).json({ error: 'Email já cadastrado nesta empresa' });

    const pinHash = await bcrypt.hash(pin, 12);
    const pinEncrypted = encryptPin(pin);

    if (localRegistroId) {
      const loc = await prisma.localRegistro.findFirst({
        where: { id: localRegistroId, tenantId: req.tenantId, ativo: true },
      });
      if (!loc) return res.status(400).json({ error: 'Local de registro inválido' });
    }

    const usuario = await prisma.usuario.create({
      data: {
        tenantId: req.tenantId,
        nome, email: emailNorm, pinHash, pinEncrypted,
        cargo: cargo || null,
        departamento: departamento || null,
        role: role === 'ADMIN' ? 'ADMIN' : 'COLABORADOR',
        ...(localRegistroId && { localRegistroId }),
      },
      select: { id: true, nome: true, email: true, cargo: true, role: true, createdAt: true }
    });

    let conviteEmailEnviado = false;
    let conviteEmailMotivo = enviarConviteEmail === false ? 'desativado_pelo_admin' : null;
    if (enviarConviteEmail !== false) {
      const r = await sendConviteUsuario(usuario.id);
      conviteEmailEnviado = Boolean(r.ok && !r.skipped);
      if (!conviteEmailEnviado) {
        if (r.skipped) conviteEmailMotivo = r.reason || 'smtp_nao_configurado';
        else conviteEmailMotivo = r.reason || 'falha_envio';
      } else {
        conviteEmailMotivo = 'enviado';
      }
    }

    res.status(201).json({
      ...usuario,
      conviteEmailEnviado,
      ...(conviteEmailMotivo && { conviteEmailMotivo }),
    });
  } catch (err) { next(err); }
}

async function atualizar(req, res, next) {
  try {
    const { nome, email, cargo, departamento, ativo, pin, localRegistroId } = req.body;

    const dados = {
      ...(nome && { nome }),
      ...(email !== undefined && { email: String(email).trim().toLowerCase() }),
      ...(cargo !== undefined && { cargo }),
      ...(departamento !== undefined && { departamento }),
      ...(ativo !== undefined && { ativo: Boolean(ativo) }),
    };

    if (email !== undefined) {
      const emailNorm = String(email || '').trim().toLowerCase();
      if (!emailNorm) return res.status(400).json({ error: 'Email é obrigatório' });

      const dup = await prisma.usuario.findFirst({
        where: {
          tenantId: req.tenantId,
          email: emailNorm,
          NOT: { id: req.params.id },
        },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ error: 'Email já cadastrado nesta empresa' });
      dados.email = emailNorm;
    }

    if (localRegistroId !== undefined) {
      if (localRegistroId === null || localRegistroId === '') {
        dados.localRegistroId = null;
      } else {
        const loc = await prisma.localRegistro.findFirst({
          where: { id: localRegistroId, tenantId: req.tenantId, ativo: true },
        });
        if (!loc) return res.status(400).json({ error: 'Local de registro inválido' });
        dados.localRegistroId = localRegistroId;
      }
    }

    if (pin) {
      if (pin.length < 4 || !/^\d+$/.test(pin)) {
        return res.status(400).json({ error: 'PIN inválido' });
      }
      dados.pinHash = await bcrypt.hash(pin, 12);
      dados.pinEncrypted = encryptPin(pin);
    }

    const usuario = await prisma.usuario.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data: dados,
    });

    if (usuario.count === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ sucesso: true });
  } catch (err) { next(err); }
}

async function remover(req, res, next) {
  try {
    await prisma.usuario.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data: { ativo: false },
    });
    res.json({ sucesso: true });
  } catch (err) { next(err); }
}

async function obterPin(req, res, next) {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      select: { id: true, pinEncrypted: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!usuario.pinEncrypted) {
      return res.status(404).json({
        error:
          'PIN não disponível para exibição (usuário criado antes desta função). Use “Reset PIN” uma vez para armazenar o PIN criptografado.',
      });
    }
    const pin = decryptPin(usuario.pinEncrypted);
    if (!pin) return res.status(500).json({ error: 'Falha ao descriptografar PIN' });
    return res.json({ pin });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, remover, obterPin };
