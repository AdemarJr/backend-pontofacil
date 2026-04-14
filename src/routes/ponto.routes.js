// src/routes/ponto.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin, exigirColaborador } = require('../middlewares/auth.middleware');
const {
  registrar,
  listar,
  ultimoPonto,
  pendenciasColaborador,
  solicitarAjusteColaborador,
} = require('../controllers/ponto.controller');

router.post('/registrar', autenticar, registrar);
router.get('/', autenticar, exigirAdmin, listar);
router.get('/ultimo/:usuarioId', autenticar, ultimoPonto);
router.get('/pendencias', autenticar, exigirColaborador, pendenciasColaborador);
router.post('/solicitacoes-ajuste', autenticar, exigirColaborador, solicitarAjusteColaborador);

module.exports = router;
