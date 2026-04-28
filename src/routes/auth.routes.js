// src/routes/auth.routes.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const {
  loginEmail,
  loginPin,
  refreshToken,
  esqueciSenhaSupabase,
  redefinirSenhaSupabase,
} = require('../controllers/auth.controller');

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

router.post('/login', loginEmail);
router.post('/login-pin', loginPin);
router.post('/refresh', refreshToken);
// Password recovery via Supabase Auth (avoids Railway SMTP egress blocking)
router.post('/forgot-password', forgotLimiter, esqueciSenhaSupabase);
router.post('/reset-password', resetLimiter, redefinirSenhaSupabase);

module.exports = router;
