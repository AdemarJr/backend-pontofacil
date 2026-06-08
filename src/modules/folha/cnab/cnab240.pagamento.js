// src/modules/folha/cnab/cnab240.pagamento.js — Bradesco/Itaú layout simplificado v1

function padLeft(str, len, char = '0') {
  return String(str || '').slice(0, len).padStart(len, char);
}

function padRight(str, len, char = ' ') {
  return String(str || '').slice(0, len).padEnd(len, char);
}

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

function fmtDate(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

/**
 * Gera arquivo CNAB 240 simplificado para pagamento de salários.
 * @param {object} opts
 * @param {object} opts.empresa { cnpj, razaoSocial, bancoCodigo, bancoAgencia, bancoConta, bancoConvenio }
 * @param {Array} opts.pagamentos [{ nome, cpf, banco, agencia, conta, valor, contaTipo }]
 */
function gerarCnab240({ empresa, pagamentos, sequencial = 1 }) {
  const linhas = [];
  const cnpj = onlyDigits(empresa.cnpj);
  const banco = padLeft(empresa.bancoCodigo || '237', 3);
  const lote = padLeft(sequencial, 4);
  const dataGeracao = fmtDate();

  // Header arquivo
  linhas.push(
    `${banco}00000         2${padLeft(cnpj, 14)}${padRight(empresa.bancoConvenio, 20)}${padLeft(empresa.bancoAgencia, 5)} ${padLeft(onlyDigits(empresa.bancoConta), 12)} ${padLeft('', 1)}${padRight(empresa.razaoSocial, 30)}${padRight('BANCO', 30)}${padLeft('', 10)}1${dataGeracao}${padLeft('', 6)}000001000001${padLeft('', 159)}`
  );

  // Header lote
  linhas.push(
    `${banco}${lote}1C2030 2${padLeft(cnpj, 14)}${padRight(empresa.bancoConvenio, 20)}${padLeft(empresa.bancoAgencia, 5)} ${padLeft(onlyDigits(empresa.bancoConta), 12)} ${padLeft('', 1)}${padRight(empresa.razaoSocial, 30)}${padLeft('', 40)}${padRight('', 30)}${padLeft('', 8)}${dataGeracao}00000000${padLeft('', 33)}`
  );

  let seq = 1;
  let total = 0;
  for (const p of pagamentos) {
    if (!p.valor || p.valor <= 0) continue;
    total += p.valor;
    const valorCent = padLeft(Math.round(p.valor * 100), 15);
    const cpf = padLeft(onlyDigits(p.cpf), 11);
    const nome = padRight(p.nome, 30);
    const ag = padLeft(onlyDigits(p.agencia), 5);
    const cc = padLeft(onlyDigits(p.conta), 12);
    const bco = padLeft(onlyDigits(p.banco), 3);

    // Segmento A (simplificado)
    linhas.push(
      `${banco}${lote}3${padLeft(seq++, 5)}A000009${ag} ${cc} ${bco}${ag} ${cc} ${nome}${valorCent}${padRight('', 75)}`
    );
    // Segmento B
    linhas.push(
      `${banco}${lote}3${padLeft(seq++, 5)}B   1${cpf}${padRight('', 135)}`
    );
  }

  const qtdReg = pagamentos.filter((p) => p.valor > 0).length * 2 + 2;
  linhas.push(
    `${banco}${lote}5         ${padLeft(qtdReg, 6)}${padLeft(Math.round(total * 100), 18)}${padLeft('', 199)}`
  );
  linhas.push(
    `${banco}99999         ${padLeft(1, 6)}${padLeft(qtdReg + 2, 6)}${padLeft('', 211)}`
  );

  return linhas.join('\r\n') + '\r\n';
}

module.exports = { gerarCnab240 };
