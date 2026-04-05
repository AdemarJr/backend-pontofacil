// src/controllers/usuario.controller.js
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function listar(req, res, next) {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId: req.tenantId, role: { not: 'SUPER_ADMIN' } },
      select: {
        id: true, nome: true, email: true, cargo: true,
        departamento: true, role: true, ativo: true, createdAt: true,
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
    const { nome, email, pin, cargo, departamento, role } = req.body;

    if (!nome || !email || !pin) {
      return res.status(400).json({ error: 'Nome, email e PIN são obrigatórios' });
    }
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'PIN deve ter 4 a 6 dígitos numéricos' });
    }

    const existente = await prisma.usuario.findFirst({
      where: { email, tenantId: req.tenantId }
    });
    if (existente) return res.status(409).json({ error: 'Email já cadastrado nesta empresa' });

    const pinHash = await bcrypt.hash(pin, 12);
    const usuario = await prisma.usuario.create({
      data: {
        tenantId: req.tenantId,
        nome, email, pinHash,
        cargo: cargo || null,
        departamento: departamento || null,
        role: role === 'ADMIN' ? 'ADMIN' : 'COLABORADOR',
      },
      select: { id: true, nome: true, email: true, cargo: true, role: true, createdAt: true }
    });

    res.status(201).json(usuario);
  } catch (err) { next(err); }
}

async function atualizar(req, res, next) {
  try {
    const { nome, cargo, departamento, ativo, pin } = req.body;

    const dados = {
      ...(nome && { nome }),
      ...(cargo !== undefined && { cargo }),
      ...(departamento !== undefined && { departamento }),
      ...(ativo !== undefined && { ativo: Boolean(ativo) }),
    };

    if (pin) {
      if (pin.length < 4 || !/^\d+$/.test(pin)) {
        return res.status(400).json({ error: 'PIN inválido' });
      }
      dados.pinHash = await bcrypt.hash(pin, 12);
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

module.exports = { listar, buscarPorId, criar, atualizar, remover };
