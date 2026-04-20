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
        dataAdmissao: true,
        dataDemissao: true,
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
        dataAdmissao: true,
        dataDemissao: true,
      },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(usuario);
  } catch (err) { next(err); }
}

async function criar(req, res, next) {
  try {
    const { nome, email, pin, cargo, departamento, role, localRegistroId, enviarConviteEmail, dataAdmissao, dataDemissao } = req.body;

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
        dataAdmissao: dataAdmissao ? new Date(String(dataAdmissao) + 'T12:00:00') : null,
        dataDemissao: dataDemissao ? new Date(String(dataDemissao) + 'T12:00:00') : null,
      },
      select: { id: true, nome: true, email: true, cargo: true, role: true, createdAt: true }
    });

    // Convite por SMTP pode demorar ou travar — responde na hora e envia em segundo plano (evita timeout no cliente).
    if (enviarConviteEmail === false) {
      return res.status(201).json({
        ...usuario,
        conviteEmailEnviado: false,
        conviteEmailMotivo: 'desativado_pelo_admin',
      });
    }

    res.status(201).json({
      ...usuario,
      conviteEmailEnviado: false,
      conviteEmailMotivo: 'envio_em_segundo_plano',
    });

    sendConviteUsuario(usuario.id)
      .then((r) => {
        if (r?.ok && !r?.skipped) {
          console.log('[usuarios/criar] Convite enviado (segundo plano) para', usuario.email);
        } else {
          console.warn(
            '[usuarios/criar] Convite não enviado (segundo plano):',
            r?.reason || 'desconhecido',
            r?.error || '',
            r?.skipped ? '(skipped)' : ''
          );
        }
      })
      .catch((e) => console.error('[usuarios/criar] Convite (segundo plano):', e?.message || e));

    return;
  } catch (err) { next(err); }
}

async function atualizar(req, res, next) {
  try {
    const { nome, email, cargo, departamento, ativo, pin, localRegistroId, dataAdmissao, dataDemissao } = req.body;

    const dados = {
      ...(nome && { nome }),
      ...(email !== undefined && { email: String(email).trim().toLowerCase() }),
      ...(cargo !== undefined && { cargo }),
      ...(departamento !== undefined && { departamento }),
      ...(ativo !== undefined && { ativo: Boolean(ativo) }),
    };

    if (dataAdmissao !== undefined) {
      if (dataAdmissao === null || String(dataAdmissao).trim() === '') dados.dataAdmissao = null;
      else {
        const dt = new Date(String(dataAdmissao) + 'T12:00:00');
        if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'dataAdmissao inválida (use YYYY-MM-DD)' });
        dados.dataAdmissao = dt;
      }
    }
    if (dataDemissao !== undefined) {
      if (dataDemissao === null || String(dataDemissao).trim() === '') dados.dataDemissao = null;
      else {
        const dt = new Date(String(dataDemissao) + 'T12:00:00');
        if (Number.isNaN(dt.getTime())) return res.status(400).json({ error: 'dataDemissao inválida (use YYYY-MM-DD)' });
        dados.dataDemissao = dt;
      }
    }

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

/** Remove o usuário do banco e dados vinculados (registros, escalas, ajustes no tenant). Irreversível. */
async function excluirDefinitivo(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.tenantId) {
      return res.status(403).json({ error: 'Exclusão só pode ser feita no contexto da empresa' });
    }
    if (id === req.usuario.id) {
      return res.status(400).json({ error: 'Não é possível excluir o próprio usuário logado' });
    }

    const alvo = await prisma.usuario.findFirst({
      where: { id, tenantId: req.tenantId },
      select: { id: true, role: true },
    });
    if (!alvo) return res.status(404).json({ error: 'Usuário não encontrado' });

    const tenantId = req.tenantId;

    await prisma.$transaction(async (tx) => {
      const registros = await tx.registroPonto.findMany({
        where: { usuarioId: id, tenantId },
        select: { id: true },
      });
      const registroIds = registros.map((r) => r.id);
      if (registroIds.length > 0) {
        await tx.ajustePonto.deleteMany({
          where: { registroId: { in: registroIds } },
        });
      }
      await tx.registroPonto.deleteMany({ where: { usuarioId: id, tenantId } });
      await tx.escala.deleteMany({ where: { usuarioId: id, tenantId } });
      await tx.ajustePonto.deleteMany({ where: { adminId: id, tenantId } });
      const removed = await tx.usuario.deleteMany({ where: { id, tenantId } });
      if (removed.count === 0) throw new Error('Falha ao excluir usuário');
    });

    res.json({ sucesso: true });
  } catch (err) {
    next(err);
  }
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

module.exports = { listar, buscarPorId, criar, atualizar, remover, excluirDefinitivo, obterPin };
