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

module.exports = {
  MODOS,
  normalizarModo,
  determinarProximoTipo,
  tiposPermitidosRegistro,
  ultimoTipoFechaCiclo,
};
