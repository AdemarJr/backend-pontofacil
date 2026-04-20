// src/routes/ferias.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin, exigirColaborador } = require('../middlewares/auth.middleware');
const { contarPendentes, listar, listarMinhas, solicitar, criar, decidir, atualizar, remover } = require('../controllers/ferias.controller');

router.get('/minhas', autenticar, exigirColaborador, listarMinhas);
router.post('/solicitar', autenticar, exigirColaborador, solicitar);

router.use(autenticar, exigirAdmin);
router.get('/pendentes-contagem', contarPendentes);
router.get('/', listar);
router.post('/', criar);
router.post('/:id/decidir', decidir);
router.put('/:id', atualizar);
router.delete('/:id', remover);

module.exports = router;
