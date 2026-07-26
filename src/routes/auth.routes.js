// src/routes/auth.routes.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const {
  loginEmail,
  loginPin,
  refreshToken,
  logout,
  esqueciSenha,
  redefinirSenha,
  enviarConviteGerente,
  alterarSenha,
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Totem: PIN curto — limite agressivo por IP */
const loginPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Muitas tentativas de PIN. Aguarde 15 minutos ou fale com o RH.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Muitas renovações de sessão. Tente novamente em instantes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de alteração de senha. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, loginEmail);
router.post('/login-pin', loginPinLimiter, loginPin);
router.post('/refresh', refreshLimiter, refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', forgotLimiter, esqueciSenha);
router.post('/reset-password', resetLimiter, redefinirSenha);
router.post('/change-password', autenticar, changePasswordLimiter, alterarSenha);
router.post('/send-manager-invite', autenticar, exigirAdmin, inviteLimiter, enviarConviteGerente);

module.exports = router;
