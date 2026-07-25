// src/routes/auth.routes.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const {
  loginEmail,
  loginPin,
  refreshToken,
  esqueciSenha,
  redefinirSenha,
  enviarConviteGerente,
} = require('../controllers/auth.controller');
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: { error: 'Muitas solicitações. Tente novamente em cerca de 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: 'Muitas tentativas. Aguarde e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Limite de convites atingido. Tente novamente em cerca de 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginEmail);
router.post('/login-pin', loginPin);
router.post('/refresh', refreshToken);
router.post('/forgot-password', forgotLimiter, esqueciSenha);
router.post('/reset-password', resetLimiter, redefinirSenha);
router.post('/send-manager-invite', autenticar, exigirAdmin, inviteLimiter, enviarConviteGerente);

module.exports = router;
