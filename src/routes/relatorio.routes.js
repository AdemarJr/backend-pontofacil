// src/routes/relatorio.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const {
  espelhoPonto,
  espelhoExport,
  bancoHorasResumo,
  resumoDia,
  ajustarPonto,
} = require('../controllers/relatorio.controller');

router.use(autenticar, exigirAdmin);
router.get('/espelho', espelhoPonto);
router.get('/espelho/export', espelhoExport); // ?format=csv|xlsx|pdf
router.get('/banco-horas', bancoHorasResumo);
router.get('/resumo-dia', resumoDia);
router.post('/ajuste', ajustarPonto);

module.exports = router;
