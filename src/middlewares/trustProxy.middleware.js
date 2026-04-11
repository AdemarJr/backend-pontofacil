/**
 * Deve ser chamado logo após `const app = express()`, **antes** de `express-rate-limit` e rotas.
 * Sem isso, atrás de Nginx/Caddy/Traefik/Railway o header `X-Forwarded-For` existe e o
 * express-rate-limit v6+ dispara: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
 *
 * @param {import('express').Express} app
 */
function aplicarTrustProxy(app) {
  const raw = process.env.TRUST_PROXY;
  if (raw === 'false' || raw === '0') {
    app.set('trust proxy', false);
    return;
  }
  if (raw === undefined || raw === '') {
    app.set('trust proxy', 1);
    return;
  }
  if (raw === 'true' || raw === '1') {
    app.set('trust proxy', 1);
    return;
  }
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && n >= 0) {
    app.set('trust proxy', n);
    return;
  }
  app.set('trust proxy', true);
}

module.exports = { aplicarTrustProxy };
