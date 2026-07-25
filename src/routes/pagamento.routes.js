// Rotas públicas de pagamento (webhook InfinitePay + confirmação de retorno)
const router = require('express').Router();
const {
  webhookInfinitipay,
  confirmarRetornoPagamento,
} = require('../controllers/pagamento.controller');

router.post('/infinitipay', webhookInfinitipay);
router.get('/confirmar', confirmarRetornoPagamento);

module.exports = router;
