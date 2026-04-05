// src/routes/ponto.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const { registrar, listar, ultimoPonto } = require('../controllers/ponto.controller');

router.post('/registrar', autenticar, registrar);
router.get('/', autenticar, exigirAdmin, listar);
router.get('/ultimo/:usuarioId', ultimoPonto); // público para o totem (valida token no body)

module.exports = router;
