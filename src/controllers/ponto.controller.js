// src/controllers/ponto.controller.js
const { PrismaClient } = require('@prisma/client');
const { uploadFoto, gerarUrlAssinada } = require('../services/s3.service');
const { validarGeofence, validarEmAlgumLocal } = require('../utils/geofence');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Registrar ponto (chamado pelo totem após foto)
async function registrar(req, res, next) {
  try {
    const { tipo, latitude, longitude, deviceId, fotoBase64 } = req.body;
    const usuarioId = req.usuario.id;
    const tenantId = req.tenantId || req.usuario.tenantId;

    const usuarioCompleto = await prisma.usuario.findFirst({
      where: { id: usuarioId, tenantId },
      select: { localRegistroId: true },
    });

    // Valida tipo de ponto
    const tiposValidos = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de ponto inválido' });
    }

    // Busca configurações do tenant
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    // Valida geofence se ativo (cerca única legada ou múltiplos locais)
    let dentroGeofence = null;
    if (tenant.geofenceAtivo) {
      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Localização obrigatória para este tenant' });
      }

      const locais = await prisma.localRegistro.findMany({
        where: { tenantId, ativo: true },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      });

      let permitido = false;
      if (locais.length > 0) {
        let alvo = locais;
        if (usuarioCompleto?.localRegistroId) {
          alvo = locais.filter((l) => l.id === usuarioCompleto.localRegistroId);
          if (alvo.length === 0) {
            return res.status(403).json({
              error: 'Seu cadastro está vinculado a um local que não está mais disponível. Fale com o RH.',
              code: 'LOCAL_INVALIDO',
            });
          }
        }
        const check = validarEmAlgumLocal(latitude, longitude, alvo);
        permitido = check.ok;
      } else if (tenant.geofenceLat != null && tenant.geofenceLng != null) {
        permitido = validarGeofence(
          latitude,
          longitude,
          tenant.geofenceLat,
          tenant.geofenceLng,
          tenant.geofenceRaio
        );
      } else {
        return res.status(400).json({
          error: 'Cerca virtual ativa: cadastre ao menos um local permitido ou coordenadas na empresa.',
        });
      }

      dentroGeofence = permitido;
      if (!permitido) {
        return res.status(403).json({
          error: 'Você não está dentro da área permitida para registro de ponto',
          code: 'FORA_GEOFENCE',
        });
      }
    }

    // Valida foto se obrigatória
    if (tenant.fotoObrigatoria && !fotoBase64) {
      return res.status(400).json({ error: 'Foto obrigatória para registro de ponto' });
    }

    // Upload da foto para S3
    let fotoUrl = null;
    let fotoKey = null;
    if (fotoBase64) {
      const resultado = await uploadFoto(fotoBase64, tenantId, usuarioId);
      fotoUrl = resultado.url;
      fotoKey = resultado.key;
    }

    // Hash do IP para auditoria sem expor IP real
    const ipHash = crypto
      .createHash('sha256')
      .update(req.ip || '')
      .digest('hex')
      .substring(0, 16);

    const origemBody = req.body.origem;
    let origem = 'TOTEM';
    if (origemBody === 'APP_INDIVIDUAL') {
      if (req.usuario.role !== 'COLABORADOR') {
        return res.status(403).json({ error: 'Registro pelo app é apenas para colaboradores' });
      }
      origem = 'APP_INDIVIDUAL';
    }

    // Registra no banco
    const registro = await prisma.registroPonto.create({
      data: {
        tenantId,
        usuarioId,
        tipo,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        dentroGeofence,
        fotoUrl,
        fotoKey,
        deviceId,
        ipHash,
        userAgent: req.headers['user-agent']?.substring(0, 200),
        origem,
      },
      include: {
        usuario: { select: { nome: true, cargo: true } }
      }
    });

    res.status(201).json({
      sucesso: true,
      registro: {
        id: registro.id,
        tipo: registro.tipo,
        dataHora: registro.dataHora,
        usuario: registro.usuario.nome,
      }
    });
  } catch (err) { next(err); }
}

// Listar registros (para o dashboard do gerente)
async function listar(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { usuarioId, dataInicio, dataFim, pagina = 1, limite = 50 } = req.query;

    const where = {
      tenantId,
      ...(usuarioId && { usuarioId }),
      ...(dataInicio && dataFim && {
        dataHora: {
          gte: new Date(dataInicio),
          lte: new Date(dataFim + 'T23:59:59'),
        }
      }),
    };

    const [registros, total] = await Promise.all([
      prisma.registroPonto.findMany({
        where,
        include: {
          usuario: { select: { nome: true, cargo: true, departamento: true } },
          ajuste: { select: { dataHoraNova: true, motivo: true } }
        },
        orderBy: { dataHora: 'desc' },
        skip: (pagina - 1) * limite,
        take: parseInt(limite),
      }),
      prisma.registroPonto.count({ where })
    ]);

    // Gera URLs assinadas para as fotos (expiram em 15 min)
    const registrosComFoto = await Promise.all(
      registros.map(async (r) => ({
        ...r,
        fotoUrl: r.fotoKey
          ? await gerarUrlAssinada(r.fotoKey)
          : (r.fotoUrl || null),
      }))
    );

    res.json({
      registros: registrosComFoto,
      total,
      paginas: Math.ceil(total / limite),
      paginaAtual: parseInt(pagina),
    });
  } catch (err) { next(err); }
}

// Buscar último ponto do colaborador (para mostrar no totem)
async function ultimoPonto(req, res, next) {
  try {
    if (req.isSuperAdmin) {
      return res.status(403).json({ error: 'Operação disponível apenas para usuários da empresa' });
    }

    const { usuarioId } = req.params;
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (req.usuario.role === 'COLABORADOR' && req.usuario.id !== usuarioId) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (req.usuario.role === 'ADMIN') {
      const alvo = await prisma.usuario.findFirst({
        where: { id: usuarioId, tenantId },
      });
      if (!alvo) return res.status(404).json({ error: 'Colaborador não encontrado' });
    }

    const ultimo = await prisma.registroPonto.findFirst({
      where: { usuarioId, tenantId },
      orderBy: { dataHora: 'desc' },
      select: { tipo: true, dataHora: true }
    });

    // Determina o próximo tipo esperado
    const proximoTipo = determinarProximoTipo(ultimo?.tipo);

    res.json({ ultimoPonto: ultimo, proximoTipo });
  } catch (err) { next(err); }
}

function determinarProximoTipo(ultimoTipo) {
  const sequencia = {
    null: 'ENTRADA',
    undefined: 'ENTRADA',
    ENTRADA: 'SAIDA_ALMOCO',
    SAIDA_ALMOCO: 'RETORNO_ALMOCO',
    RETORNO_ALMOCO: 'SAIDA',
    SAIDA: 'ENTRADA',
  };
  return sequencia[ultimoTipo] || 'ENTRADA';
}

module.exports = { registrar, listar, ultimoPonto };
