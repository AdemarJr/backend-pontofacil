// src/routes/auth.routes.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const {
  loginEmail,
  loginPin,
  refreshToken,
  esqueciSenhaSupabase,
  redefinirSenhaSupabase,
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

// Max 10 manager invites per hour per IP to prevent abuse
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
// Password recovery via Supabase Auth (avoids Railway SMTP egress blocking)
router.post('/forgot-password', forgotLimiter, esqueciSenhaSupabase);
router.post('/reset-password', resetLimiter, redefinirSenhaSupabase);
// Send welcome/invitation email to a new manager — requires authenticated admin
router.post('/send-manager-invite', autenticar, exigirAdmin, inviteLimiter, enviarConviteGerente);

module.exports = router;
