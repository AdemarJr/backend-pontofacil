const bcrypt = require('bcryptjs');
const { assertSenhaForte } = require('./passwordPolicy');

/**
 * Impede que a senha web seja igual ao PIN do totem (apenas em senha NOVA forte).
 */
async function assertSenhaDiferenteDoPin(usuario, novaSenha) {
  if (!usuario?.pinHash) return;
  const igual = await bcrypt.compare(String(novaSenha), usuario.pinHash);
  if (igual) {
    const err = new Error('A senha de login não pode ser igual ao PIN do totem.');
    err.status = 400;
    throw err;
  }
}

/**
 * Valida senha ao definir/alterar:
 * - Repetir senha web já cadastrada → permitido (legado).
 * - Primeiro acesso sem senha web: repetir PIN → permitido (legado).
 * - Senha nova diferente → política forte + distinta do PIN.
 */
async function assertPoliticaNovaSenha({ novaSenha, senhaHashAtual, pinHashAtual }) {
  const s = String(novaSenha || '');
  if (s.length < 4) {
    const err = new Error('Senha deve ter no mínimo 4 caracteres.');
    err.status = 400;
    throw err;
  }

  if (senhaHashAtual) {
    const mesma = await bcrypt.compare(s, senhaHashAtual);
    if (mesma) return;
  } else if (pinHashAtual) {
    const igualPin = await bcrypt.compare(s, pinHashAtual);
    if (igualPin) return;
  }

  assertSenhaForte(s);
  if (pinHashAtual) {
    await assertSenhaDiferenteDoPin({ pinHash: pinHashAtual }, s);
  }
}

module.exports = { assertSenhaDiferenteDoPin, assertPoliticaNovaSenha };
