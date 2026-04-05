// src/routes/relatorio.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const { espelhoPonto, resumoDia, ajustarPonto } = require('../controllers/relatorio.controller');

router.use(autenticar, exigirAdmin);
router.get('/espelho', espelhoPonto);
router.get('/resumo-dia', resumoDia);
router.post('/ajuste', ajustarPonto);

module.exports = router;
