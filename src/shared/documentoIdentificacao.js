function apenasDigitos(val) {
  return String(val || '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(d[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(d[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(d[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(d[10], 10);
}

function pisValido(pis) {
  const d = apenasDigitos(pis);
  if (d.length !== 11) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(d[i], 10) * pesos[i];
  const resto = soma % 11;
  const dig = resto < 2 ? 0 : 11 - resto;
  return dig === parseInt(d[10], 10);
}

function normalizarCpfPis(val) {
  const d = apenasDigitos(val);
  return d.length ? d : null;
}

function usuarioTemDocumento(usuario) {
  const cpf = normalizarCpfPis(usuario?.cpf);
  const pis = normalizarCpfPis(usuario?.pis);
  return Boolean(cpf || pis);
}

function validarCpfOuPis({ cpf, pis, exigir = true }) {
  const cpfN = normalizarCpfPis(cpf);
  const pisN = normalizarCpfPis(pis);
  if (!cpfN && !pisN) {
    if (exigir) return { ok: false, error: 'Informe CPF ou PIS (11 dígitos).' };
    return { ok: true, cpf: null, pis: null };
  }
  if (cpfN && !cpfValido(cpfN)) {
    return { ok: false, error: 'CPF inválido.' };
  }
  if (pisN && !pisValido(pisN)) {
    return { ok: false, error: 'PIS inválido.' };
  }
  return { ok: true, cpf: cpfN, pis: pisN };
}

function documentoParaExport(usuario) {
  return normalizarCpfPis(usuario?.cpf) || normalizarCpfPis(usuario?.pis) || '';
}

module.exports = {
  apenasDigitos,
  cpfValido,
  pisValido,
  normalizarCpfPis,
  usuarioTemDocumento,
  validarCpfOuPis,
  documentoParaExport,
};
