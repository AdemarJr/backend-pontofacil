// src/controllers/ponto.controller.js
const { PrismaClient } = require('@prisma/client');
const { uploadFoto, gerarUrlAssinada } = require('../services/s3.service');
const { validarGeofence, validarEmAlgumLocal } = require('../utils/geofence');
const { calcularDia, pad2 } = require('../utils/espelhoCalculo');
const crypto = require('crypto');

const prisma = new PrismaClient();

const LIMITE_PENDENCIA_MODAL_HORAS = 12;
const LIMITE_TURNO_MAX_HORAS = 16;

// Avisos de "registro cedo demais" (não impedem se o usuário confirmar).
// Mantemos no backend para ficar consistente entre dispositivos.
const DEFAULT_MIN_TRABALHO_ANTES_SAIDA_MIN = 30; // ENTRADA->SAIDA_ALMOCO/SAIDA ou RETORNO->SAIDA
const DEFAULT_MIN_INTERVALO_ALMOCO_MIN = 30; // SAIDA_ALMOCO->RETORNO_ALMOCO

function diffHoras(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60 * 60);
}

function diffMinutos(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60);
}

function inicioFimDoDia(date = new Date()) {
  const d = new Date(date);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const fim = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { inicio, fim };
}

function fmtDiaISO(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function isSameLocalDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

async function pendenciasColaborador(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const dias = Math.min(60, Math.max(1, parseInt(req.query.dias || '14', 10)));

    const agora = new Date();
    const inicioJanela = new Date(agora);
    inicioJanela.setDate(inicioJanela.getDate() - dias + 1);
    inicioJanela.setHours(0, 0, 0, 0);

    const registros = await prisma.registroPonto.findMany({
      where: { tenantId, usuarioId, dataHora: { gte: inicioJanela, lte: agora } },
      include: { ajuste: true },
      orderBy: { dataHora: 'asc' },
    });

    const porDia = new Map();
    for (const r of registros) {
      const efetivo = r.ajuste?.dataHoraNova || r.dataHora;
      const dia = fmtDiaISO(efetivo);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push({ id: r.id, tipo: r.tipo, dataHora: efetivo });
    }

    const pendencias = [];
    for (const [dia, pontos] of porDia.entries()) {
      const calc = calcularDia(pontos, { dataRef: dia });
      if (!calc.flags?.faltandoMarcacao) continue;

      const missing = [];
      if (!calc.entrada) missing.push('ENTRADA');
      if (!calc.saida) missing.push('SAIDA');
      const temSaidaAlmoco = Boolean(calc.saidaAlmoco);
      const temRetorno = Boolean(calc.retornoAlmoco);
      if (temSaidaAlmoco !== temRetorno) {
        if (!temSaidaAlmoco) missing.push('SAIDA_ALMOCO');
        if (!temRetorno) missing.push('RETORNO_ALMOCO');
      }

      pendencias.push({
        dia,
        faltando: missing,
        minutosTrabalhados: calc.minutosTrabalhados,
        marcacoes: {
          entrada: calc.entrada,
          saidaAlmoco: calc.saidaAlmoco,
          retornoAlmoco: calc.retornoAlmoco,
          saida: calc.saida,
        },
      });
    }

    pendencias.sort((a, b) => (a.dia < b.dia ? 1 : -1));
    res.json({ dias, pendencias });
  } catch (err) {
    next(err);
  }
}

async function solicitarAjusteColaborador(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const usuarioId = req.usuario.id;
    const { dia, tipo, dataHoraSugerida, justificativa } = req.body || {};

    if (!dia || !tipo || !justificativa) {
      return res.status(400).json({ error: 'dia, tipo e justificativa são obrigatórios' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia))) {
      return res.status(400).json({ error: 'dia inválido (use YYYY-MM-DD)' });
    }
    const tiposValidos = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    const tipoUp = String(tipo).toUpperCase();
    if (!tiposValidos.includes(tipoUp)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    const just = String(justificativa || '').trim();
    if (!just) return res.status(400).json({ error: 'Justificativa obrigatória' });

    let dhSug = null;
    if (dataHoraSugerida) {
      const dt = new Date(dataHoraSugerida);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: 'dataHoraSugerida inválida' });
      }
      dhSug = dt;
    }

    const sol = await prisma.solicitacaoAjustePonto.create({
      data: {
        tenantId,
        usuarioId,
        dia: String(dia),
        tipo: tipoUp,
        dataHoraSugerida: dhSug,
        justificativa: just,
      },
    });

    return res.status(201).json({ sucesso: true, solicitacao: sol });
  } catch (err) {
    next(err);
  }
}

// Registrar ponto (chamado pelo totem após foto)
async function registrar(req, res, next) {
  try {
    const { tipo, latitude, longitude, deviceId, fotoBase64, forcarNovoTurno, confirmarRegistroCurto } =
      req.body;
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

    // ---- REGRA ANTI-DUPLICIDADE (um tipo por dia) ----
    // Evita problemas no relatório: não pode ter 2 entradas ou 2 saídas no mesmo dia, etc.
    // (admin pode corrigir ajustando horário do registro existente)
    {
      const { inicio, fim } = inicioFimDoDia(new Date());
      const jaExiste = await prisma.registroPonto.findFirst({
        where: {
          tenantId,
          usuarioId,
          tipo,
          dataHora: { gte: inicio, lte: fim },
        },
        select: { id: true, dataHora: true, tipo: true },
      });
      if (jaExiste) {
        return res.status(409).json({
          error: 'Já existe uma marcação deste tipo para este colaborador hoje.',
          code: 'DUPLICADO_DIA',
          registroId: jaExiste.id,
          tipo: jaExiste.tipo,
          dataHora: jaExiste.dataHora,
        });
      }
    }

    // ---- PAREAMENTO / ESQUECIMENTO DE SAÍDA ----
    // Regras:
    // - Fluxo normal: o tipo deve ser o próximo esperado pela sequência.
    // - Se o último registro "abre" um ciclo e já se passaram >= 16h, assume saída esquecida:
    //   marca o último como não validado e força uma nova ENTRADA (gera pendência para ajuste).
    // - Se o colaborador explicitamente escolher "iniciar novo turno", permitimos ENTRADA mesmo fora da sequência.
    const ultimo = await prisma.registroPonto.findFirst({
      where: { tenantId, usuarioId },
      orderBy: { dataHora: 'desc' },
      select: { id: true, tipo: true, dataHora: true, validado: true },
    });

    const agora = new Date();
    const ultimoEhHoje = Boolean(ultimo) && isSameLocalDay(ultimo.dataHora, agora);
    // A sequência que controla o "tipo esperado" deve ser por dia:
    // - se não há registro hoje, o esperado é ENTRADA (mesmo que ontem tenha ficado "aberto").
    // - se há registro hoje, segue a sequência normal baseada no último de hoje.
    const proximoEsperado = ultimoEhHoje ? determinarProximoTipo(ultimo?.tipo) : 'ENTRADA';
    const ultimoAbreCiclo = Boolean(ultimo) && ultimo.tipo !== 'SAIDA';
    const horasDesdeUltimo = ultimo ? diffHoras(agora, ultimo.dataHora) : 0;

    // Se virou o dia e ontem ficou "em aberto", permitimos iniciar o dia normalmente (ENTRADA),
    // mas sinalizamos pendência para o administrativo ajustar o dia anterior.
    // Observação: a regra anti-duplicidade por tipo/dia (acima) impede 2 ENTRADAS no mesmo dia.
    if (!forcarNovoTurno && tipo === 'ENTRADA' && !ultimoEhHoje && ultimoAbreCiclo && ultimo?.id) {
      await prisma.registroPonto.update({
        where: { id: ultimo.id },
        data: { validado: false },
      });
    }

    if (ultimoAbreCiclo && horasDesdeUltimo >= LIMITE_TURNO_MAX_HORAS) {
      // Saída do ciclo anterior provavelmente foi esquecida.
      // Força nova entrada e abre pendência no registro anterior (não validado).
      await prisma.registroPonto.update({
        where: { id: ultimo.id },
        data: { validado: false },
      });

      const registro = await prisma.registroPonto.create({
        data: {
          tenantId,
          usuarioId,
          tipo: 'ENTRADA',
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
          usuario: { select: { nome: true, cargo: true } },
        },
      });

      return res.status(201).json({
        sucesso: true,
        aviso: {
          code: 'PENDENCIA_SAIDA_ESQUECIDA',
          message:
            'Detectamos uma marcação anterior em aberto há muito tempo. Iniciamos um novo turno e sinalizamos pendência para ajuste.',
          pendencia: {
            registroId: ultimo.id,
            ultimoTipo: ultimo.tipo,
            ultimoEm: ultimo.dataHora,
            horasAberto: Math.round(horasDesdeUltimo * 10) / 10,
            limiteHoras: LIMITE_TURNO_MAX_HORAS,
          },
        },
        registro: {
          id: registro.id,
          tipo: registro.tipo,
          dataHora: registro.dataHora,
          usuario: registro.usuario.nome,
        },
        proximoTipo: determinarProximoTipo(registro.tipo),
      });
    }

    // Se o usuário escolheu "iniciar novo turno", permite ENTRADA fora da sequência
    if (forcarNovoTurno === true) {
      if (tipo !== 'ENTRADA') {
        return res.status(400).json({ error: 'Para iniciar um novo turno, o tipo deve ser ENTRADA.' });
      }
      if (ultimoAbreCiclo && ultimo?.id) {
        await prisma.registroPonto.update({
          where: { id: ultimo.id },
          data: { validado: false },
        });
      }
    } else {
      // Fluxo normal: exige o tipo esperado
      if (tipo !== proximoEsperado) {
        return res.status(409).json({
          error: 'Tipo de ponto inesperado para a sequência atual.',
          code: 'TIPO_INESPERADO',
          esperado: proximoEsperado,
        });
      }
    }

    // ---- AVISO: registro muito cedo (sequencial) ----
    // Ex.: tentou retornar do almoço com 5 min, ou tentar sair com poucos minutos de trabalho.
    // O colaborador pode confirmar para prosseguir mesmo assim.
    if (!forcarNovoTurno && confirmarRegistroCurto !== true) {
      const minTrabalhoAntesSaidaMin =
        tenant?.trabalhoMinimoAntesSaidaMinutos ?? DEFAULT_MIN_TRABALHO_ANTES_SAIDA_MIN;
      const minIntervaloAlmocoMin =
        tenant?.intervaloMinimoAlmocoMinutos ?? DEFAULT_MIN_INTERVALO_ALMOCO_MIN;

      const { inicio, fim } = inicioFimDoDia(agora);
      const ultimoHoje = await prisma.registroPonto.findFirst({
        where: { tenantId, usuarioId, dataHora: { gte: inicio, lte: fim } },
        orderBy: { dataHora: 'desc' },
        select: { id: true, tipo: true, dataHora: true },
      });

      if (ultimoHoje?.id) {
        const minutos = diffMinutos(agora, ultimoHoje.dataHora);

        // SAIDA_ALMOCO ou SAIDA logo após ENTRADA/RETORNO
        if (
          (tipo === 'SAIDA_ALMOCO' || tipo === 'SAIDA') &&
          (ultimoHoje.tipo === 'ENTRADA' || ultimoHoje.tipo === 'RETORNO_ALMOCO') &&
          minutos < minTrabalhoAntesSaidaMin
        ) {
          return res.status(409).json({
            error:
              'Você ainda não completou o tempo mínimo de trabalho para este registro. Se for necessário, confirme para registrar mesmo assim.',
            code: 'REGISTRO_MUITO_CEDO',
            regra: 'MIN_TRABALHO',
            tipoTentado: tipo,
            ultimoTipo: ultimoHoje.tipo,
            ultimoEm: ultimoHoje.dataHora,
            minutosDecorridos: Math.round(minutos),
            minimoMinutos: minTrabalhoAntesSaidaMin,
          });
        }

        // RETORNO_ALMOCO logo após SAIDA_ALMOCO
        if (tipo === 'RETORNO_ALMOCO' && ultimoHoje.tipo === 'SAIDA_ALMOCO' && minutos < minIntervaloAlmocoMin) {
          return res.status(409).json({
            error:
              'O intervalo ainda não completou o tempo mínimo. Se for necessário, confirme para registrar mesmo assim.',
            code: 'REGISTRO_MUITO_CEDO',
            regra: 'MIN_INTERVALO',
            tipoTentado: tipo,
            ultimoTipo: ultimoHoje.tipo,
            ultimoEm: ultimoHoje.dataHora,
            minutosDecorridos: Math.round(minutos),
            minimoMinutos: minIntervaloAlmocoMin,
          });
        }
      }
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

    // Se marcou pendência por virada de dia (ontem em aberto), devolve aviso para o frontend mostrar ao colaborador.
    const avisoViradaDia =
      !forcarNovoTurno && tipo === 'ENTRADA' && !ultimoEhHoje && ultimoAbreCiclo && ultimo?.id
        ? {
            code: 'PENDENCIA_DIA_ANTERIOR',
            message:
              'Detectamos um registro do dia anterior que ficou em aberto. O dia de hoje seguirá normalmente, e o administrativo deve ajustar o dia anterior.',
            pendencia: {
              registroId: ultimo.id,
              ultimoTipo: ultimo.tipo,
              ultimoEm: ultimo.dataHora,
            },
          }
        : null;

    res.status(201).json({
      sucesso: true,
      ...(avisoViradaDia ? { aviso: avisoViradaDia } : {}),
      registro: {
        id: registro.id,
        tipo: registro.tipo,
        dataHora: registro.dataHora,
        usuario: registro.usuario.nome,
      },
      proximoTipo: determinarProximoTipo(registro.tipo),
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
      select: { id: true, tipo: true, dataHora: true, validado: true }
    });

    const agora = new Date();
    const ultimoEhHoje = Boolean(ultimo) && isSameLocalDay(ultimo.dataHora, agora);
    // Próximo tipo esperado por dia:
    // - se não há registro hoje, começa por ENTRADA
    // - se há registro hoje, segue a sequência baseada no último de hoje
    const proximoTipo = ultimoEhHoje ? determinarProximoTipo(ultimo?.tipo) : 'ENTRADA';

    // Pendência (check-in antigo): entrada/ciclo aberto há tempo demais
    const pendenciaCheckin = (() => {
      if (!ultimo) return { aberta: false };
      if (ultimo.tipo === 'SAIDA') return { aberta: false };
      const horas = diffHoras(new Date(), ultimo.dataHora);
      // Se virou o dia e ficou aberto, já considera pendência (mesmo com < 12h),
      // porque o colaborador deve seguir o fluxo do dia atual e o administrativo ajusta o anterior.
      if (!ultimoEhHoje) {
        return {
          aberta: true,
          registroId: ultimo.id,
          ultimoTipo: ultimo.tipo,
          ultimoEm: ultimo.dataHora,
          horasAberto: Math.round(horas * 10) / 10,
          modalLimiteHoras: LIMITE_PENDENCIA_MODAL_HORAS,
          maxHorasAntesNovoTurno: LIMITE_TURNO_MAX_HORAS,
          sugerirNovoTurno: true,
          motivo: 'DIA_ANTERIOR_EM_ABERTO',
        };
      }
      if (horas < LIMITE_PENDENCIA_MODAL_HORAS) return { aberta: false };
      return {
        aberta: true,
        registroId: ultimo.id,
        ultimoTipo: ultimo.tipo,
        ultimoEm: ultimo.dataHora,
        horasAberto: Math.round(horas * 10) / 10,
        modalLimiteHoras: LIMITE_PENDENCIA_MODAL_HORAS,
        maxHorasAntesNovoTurno: LIMITE_TURNO_MAX_HORAS,
        sugerirNovoTurno: horas >= LIMITE_TURNO_MAX_HORAS,
      };
    })();

    res.json({ ultimoPonto: ultimo, proximoTipo, pendenciaCheckin });
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

module.exports = {
  registrar,
  listar,
  ultimoPonto,
  pendenciasColaborador,
  solicitarAjusteColaborador,
};
