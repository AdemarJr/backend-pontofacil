// src/controllers/usuario.controller.js
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encryptPin, decryptPin } = require('../utils/pinCrypto');
const { sendConviteUsuario, sendResetUsuarioEmail } = require('../services/passwordReset.service');
const { formatMailError } = require('../shared/smtpHints');

const prisma = require('../infra/prisma');
const { validarCpfOuPis } = require('../shared/documentoIdentificacao');
const { assertPodeAdicionarColaborador } = require('../shared/planLimits');

async function listar(req, res, next) {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { tenantId: req.tenantId, role: { not: 'SUPER_ADMIN' } },
      select: {
        id: true, nome: true, email: true, cargo: true,
        departamento: true, role: true, ativo: true, createdAt: true,
        senhaHash: true,
        localRegistroId: true,
        isentoGeofence: true,
        dataAdmissao: true,
        dataDemissao: true,
        cpf: true,
        pis: true,
        matricula: true,
        tipoContrato: true,
        salarioBase: true,
        categoriaProfissional: true,
        dependentesIrrf: true,
        contaBanco: true,
        contaAgencia: true,
        contaNumero: true,
        contaTipo: true,
        usaVt: true,
        valorVtMensal: true,
        descontoVaMensal: true,
        descontoPlanoSaudeMensal: true,
      },
      orderBy: { nome: 'asc' },
    });
    res.json(
      usuarios.map(({ senhaHash, ...u }) => ({
        ...u,
        senhaWebDefinida: Boolean(senhaHash),
      }))
    );
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
    const {
      nome, email, pin, cargo, departamento, role, localRegistroId, isentoGeofence,
      enviarConviteEmail, dataAdmissao, dataDemissao,
      cpf, pis, matricula, tipoContrato, salarioBase, categoriaProfissional,
      dependentesIrrf, contaBanco, contaAgencia, contaNumero, contaTipo,
      usaVt, valorVtMensal, descontoVaMensal, descontoPlanoSaudeMensal,
    } = req.body;

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

    try {
      await assertPodeAdicionarColaborador(req.tenantId, 1);
    } catch (e) {
      if (e.status) {
        return res.status(e.status).json({
          error: e.message,
          code: e.code,
          atual: e.atual,
          maxColaboradores: e.maxColaboradores,
        });
      }
      throw e;
    }

    const pinHash = await bcrypt.hash(pin, 12);
    const pinEncrypted = encryptPin(pin);

    if (localRegistroId) {
      const loc = await prisma.localRegistro.findFirst({
        where: { id: localRegistroId, tenantId: req.tenantId, ativo: true },
      });
      if (!loc) return res.status(400).json({ error: 'Local de registro inválido' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { exigirCpfPis: true },
    });
    const roleFinal = role === 'ADMIN' ? 'ADMIN' : 'COLABORADOR';
    let cpfNorm = null;
    let pisNorm = null;
    if (roleFinal === 'COLABORADOR' && tenant?.exigirCpfPis !== false) {
      const docVal = validarCpfOuPis({ cpf, pis, exigir: true });
      if (!docVal.ok) return res.status(400).json({ error: docVal.error });
      cpfNorm = docVal.cpf;
      pisNorm = docVal.pis;
    } else {
      const docVal = validarCpfOuPis({ cpf, pis, exigir: false });
      if (!docVal.ok) return res.status(400).json({ error: docVal.error });
      cpfNorm = docVal.cpf;
      pisNorm = docVal.pis;
    }

    const usuario = await prisma.usuario.create({
      data: {
        tenantId: req.tenantId,
        nome, email: emailNorm, pinHash, pinEncrypted,
        cargo: cargo || null,
        departamento: departamento || null,
        role: roleFinal,
        ...(localRegistroId && { localRegistroId }),
        isentoGeofence: Boolean(isentoGeofence),
        dataAdmissao: dataAdmissao ? new Date(String(dataAdmissao) + 'T12:00:00') : null,
        dataDemissao: dataDemissao ? new Date(String(dataDemissao) + 'T12:00:00') : null,
        cpf: cpfNorm,
        pis: pisNorm,
        matricula: matricula || null,
        tipoContrato: tipoContrato || 'CLT',
        salarioBase: salarioBase != null && salarioBase !== '' ? Number(salarioBase) : null,
        categoriaProfissional: categoriaProfissional || null,
        dependentesIrrf: dependentesIrrf != null ? Number(dependentesIrrf) : 0,
        contaBanco: contaBanco || null,
        contaAgencia: contaAgencia || null,
        contaNumero: contaNumero || null,
        contaTipo: contaTipo || null,
        usaVt: Boolean(usaVt),
        valorVtMensal: valorVtMensal != null && valorVtMensal !== '' ? Number(valorVtMensal) : null,
        descontoVaMensal: descontoVaMensal != null && descontoVaMensal !== '' ? Number(descontoVaMensal) : null,
        descontoPlanoSaudeMensal: descontoPlanoSaudeMensal != null && descontoPlanoSaudeMensal !== '' ? Number(descontoPlanoSaudeMensal) : null,
      },
      select: { id: true, nome: true, email: true, cargo: true, role: true, createdAt: true }
    });

    // Cadastro sempre persiste; e-mail é melhor esforço (não desfaz o usuário se falhar).
    if (enviarConviteEmail === false) {
      return res.status(201).json({
        ...usuario,
        conviteEmailEnviado: false,
        conviteEmailMotivo: 'desativado_pelo_admin',
      });
    }

    const CONVITE_TIMEOUT_MS = 12000;
    let conviteEmailEnviado = false;
    let conviteEmailMotivo = 'falha_envio';

    try {
      const r = await Promise.race([
        sendConviteUsuario(usuario.id),
        new Promise((_, reject) => {
          const err = new Error('timeout_convite');
          err.code = 'CONVITE_TIMEOUT';
          setTimeout(() => reject(err), CONVITE_TIMEOUT_MS);
        }),
      ]);

      if (r?.ok && !r?.skipped) {
        conviteEmailEnviado = true;
        conviteEmailMotivo = 'enviado';
      } else if (r?.skipped) {
        conviteEmailMotivo = r.reason || 'smtp_nao_configurado';
      } else {
        conviteEmailMotivo = r?.reason || 'falha_envio';
      }
    } catch (e) {
      if (e?.code === 'CONVITE_TIMEOUT') {
        conviteEmailMotivo = 'envio_em_segundo_plano';
        sendConviteUsuario(usuario.id)
          .then((r) => {
            if (r?.ok && !r?.skipped) {
              console.log('[usuarios/criar] Convite enviado (após timeout) para', usuario.email);
            } else {
              console.warn(
                '[usuarios/criar] Convite não enviado (após timeout):',
                r?.reason || 'desconhecido',
                r?.error || ''
              );
            }
          })
          .catch((err) => console.error('[usuarios/criar] Convite (após timeout):', err?.message || err));
      } else {
        conviteEmailMotivo = 'falha_envio';
        console.error('[usuarios/criar] Convite falhou:', e?.message || e);
      }
    }

    return res.status(201).json({
      ...usuario,
      conviteEmailEnviado,
      conviteEmailMotivo,
    });
  } catch (err) { next(err); }
}

async function atualizar(req, res, next) {
  try {
    const {
      nome, email, cargo, departamento, ativo, pin, localRegistroId, isentoGeofence,
      dataAdmissao, dataDemissao,
      cpf, pis, matricula, tipoContrato, salarioBase, categoriaProfissional,
      dependentesIrrf, contaBanco, contaAgencia, contaNumero, contaTipo,
      usaVt, valorVtMensal, descontoVaMensal, descontoPlanoSaudeMensal,
    } = req.body;

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

    if (isentoGeofence !== undefined) {
      dados.isentoGeofence = Boolean(isentoGeofence);
    }

    if (cpf !== undefined || pis !== undefined) {
      const alvo = await prisma.usuario.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        select: { cpf: true, pis: true, role: true },
      });
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: { exigirCpfPis: true },
      });
      const cpfEff = cpf !== undefined ? cpf : alvo?.cpf;
      const pisEff = pis !== undefined ? pis : alvo?.pis;
      const docVal = validarCpfOuPis({
        cpf: cpfEff,
        pis: pisEff,
        exigir: alvo?.role === 'COLABORADOR' && tenant?.exigirCpfPis !== false,
      });
      if (!docVal.ok) return res.status(400).json({ error: docVal.error });
      if (cpf !== undefined) dados.cpf = docVal.cpf;
      if (pis !== undefined) dados.pis = docVal.pis;
    }
    if (matricula !== undefined) dados.matricula = matricula || null;
    if (tipoContrato !== undefined) dados.tipoContrato = tipoContrato;
    if (salarioBase !== undefined) {
      dados.salarioBase = salarioBase == null || salarioBase === '' ? null : Number(salarioBase);
    }
    if (categoriaProfissional !== undefined) dados.categoriaProfissional = categoriaProfissional || null;
    if (dependentesIrrf !== undefined) dados.dependentesIrrf = Number(dependentesIrrf) || 0;
    if (contaBanco !== undefined) dados.contaBanco = contaBanco || null;
    if (contaAgencia !== undefined) dados.contaAgencia = contaAgencia || null;
    if (contaNumero !== undefined) dados.contaNumero = contaNumero || null;
    if (contaTipo !== undefined) dados.contaTipo = contaTipo || null;
    if (usaVt !== undefined) dados.usaVt = Boolean(usaVt);
    if (valorVtMensal !== undefined) {
      dados.valorVtMensal = valorVtMensal == null || valorVtMensal === '' ? null : Number(valorVtMensal);
    }
    if (descontoVaMensal !== undefined) {
      dados.descontoVaMensal = descontoVaMensal == null || descontoVaMensal === '' ? null : Number(descontoVaMensal);
    }
    if (descontoPlanoSaudeMensal !== undefined) {
      dados.descontoPlanoSaudeMensal = descontoPlanoSaudeMensal == null || descontoPlanoSaudeMensal === '' ? null : Number(descontoPlanoSaudeMensal);
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

async function reenviarConvite(req, res, next) {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, ativo: true },
      select: { id: true, nome: true, email: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    const r = await sendConviteUsuario(usuario.id);
    if (!r?.ok) {
      const err = new Error(
        r?.skipped
          ? (r.reason === 'smtp_sem_senha'
              ? 'SMTP_PASS não configurado no servidor.'
              : 'Servidor sem SMTP configurado para envio de e-mails.')
          : formatMailError(r)
      );
      err.status = r?.skipped ? 503 : 502;
      throw err;
    }

    return res.json({
      sucesso: true,
      emailEnviado: true,
      mensagem: `Convite enviado para ${usuario.email}.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function resetSenhaEmail(req, res, next) {
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, ativo: true },
      include: { tenant: { select: { nomeFantasia: true } } },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    const r = await sendResetUsuarioEmail(usuario);
    if (!r?.ok) {
      const err = new Error(
        r?.skipped
          ? (r.reason === 'smtp_sem_senha'
              ? 'SMTP_PASS não configurado no servidor.'
              : 'Servidor sem SMTP configurado para envio de e-mails.')
          : formatMailError(r)
      );
      err.status = r?.skipped ? 503 : 502;
      throw err;
    }

    return res.json({
      sucesso: true,
      emailEnviado: true,
      mensagem: `Link de redefinição enviado para ${usuario.email}.`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover,
  excluirDefinitivo,
  obterPin,
  reenviarConvite,
  resetSenhaEmail,
};
