const bcrypt = require('bcryptjs');

/**
 * Impede que a senha web seja igual ao PIN do totem (mesmo hash ou texto).
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

module.exports = { assertSenhaDiferenteDoPin };
