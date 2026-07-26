// Rotas públicas de pagamento (webhook InfinitePay + confirmação de retorno)
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const {
  webhookInfinitipay,
  confirmarRetornoPagamento,
} = require('../controllers/pagamento.controller');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Limite de webhooks atingido. Tente novamente em instantes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const confirmarLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Muitas confirmações. Aguarde um momento.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/infinitipay', webhookLimiter, webhookInfinitipay);
router.get('/confirmar', confirmarLimiter, confirmarRetornoPagamento);

module.exports = router;
