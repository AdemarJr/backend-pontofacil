const MODOS = {
  QUATRO_BATIDAS: 'QUATRO_BATIDAS',
  DUAS_BATIDAS: 'DUAS_BATIDAS',
};

const SEQUENCIA_QUATRO = {
  null: 'ENTRADA',
  undefined: 'ENTRADA',
  ENTRADA: 'SAIDA_ALMOCO',
  SAIDA_ALMOCO: 'RETORNO_ALMOCO',
  RETORNO_ALMOCO: 'SAIDA',
  SAIDA: 'ENTRADA',
};

const SEQUENCIA_DUAS = {
  null: 'ENTRADA',
  undefined: 'ENTRADA',
  ENTRADA: 'SAIDA',
  SAIDA: 'ENTRADA',
  SAIDA_ALMOCO: 'SAIDA',
  RETORNO_ALMOCO: 'SAIDA',
};

/** Limite padrão de duração de um turno aberto (inclui plantão noturno 12h). */
const LIMITE_TURNO_ABERTO_HORAS = 16;

function normalizarModo(modo) {
  return modo === MODOS.DUAS_BATIDAS ? MODOS.DUAS_BATIDAS : MODOS.QUATRO_BATIDAS;
}

function determinarProximoTipo(ultimoTipo, modoMarcacao = MODOS.QUATRO_BATIDAS) {
  const modo = normalizarModo(modoMarcacao);
  const seq = modo === MODOS.DUAS_BATIDAS ? SEQUENCIA_DUAS : SEQUENCIA_QUATRO;
  return seq[ultimoTipo] || 'ENTRADA';
}

function tiposPermitidosRegistro(modoMarcacao = MODOS.QUATRO_BATIDAS) {
  const modo = normalizarModo(modoMarcacao);
  if (modo === MODOS.DUAS_BATIDAS) {
    return ['ENTRADA', 'SAIDA'];
  }
  return ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
}

function ultimoTipoFechaCiclo(ultimoTipo, modoMarcacao = MODOS.QUATRO_BATIDAS) {
  const modo = normalizarModo(modoMarcacao);
  if (modo === MODOS.DUAS_BATIDAS) {
    return ultimoTipo === 'SAIDA';
  }
  return ultimoTipo === 'SAIDA';
}

function diffHorasEntre(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (1000 * 60 * 60);
}

/**
 * Indica se o último registro ainda mantém um turno aberto
 * (atravessa meia-noite — ex.: vigilante 18h→6h).
 */
function turnoAbertoContinua(ultimo, agora = new Date(), opts = {}) {
  const {
    modoMarcacao = MODOS.QUATRO_BATIDAS,
    limiteHoras = LIMITE_TURNO_ABERTO_HORAS,
  } = opts;
  if (!ultimo?.tipo || !ultimo?.dataHora) return false;
  if (ultimoTipoFechaCiclo(ultimo.tipo, modoMarcacao)) return false;
  return diffHorasEntre(agora, ultimo.dataHora) < limiteHoras;
}

/**
 * Próximo tipo considerando turno aberto cross-midnight.
 * Não reseta para ENTRADA só porque virou o dia civil.
 */
function resolverProximoTipo(ultimo, agora = new Date(), opts = {}) {
  const {
    modoMarcacao = MODOS.QUATRO_BATIDAS,
    limiteHoras = LIMITE_TURNO_ABERTO_HORAS,
  } = opts;
  if (!ultimo?.tipo) return 'ENTRADA';
  if (!turnoAbertoContinua(ultimo, agora, { modoMarcacao, limiteHoras })) {
    return 'ENTRADA';
  }
  return determinarProximoTipo(ultimo.tipo, modoMarcacao);
}

module.exports = {
  MODOS,
  LIMITE_TURNO_ABERTO_HORAS,
  normalizarModo,
  determinarProximoTipo,
  tiposPermitidosRegistro,
  ultimoTipoFechaCiclo,
  turnoAbertoContinua,
  resolverProximoTipo,
  diffHorasEntre,
};
