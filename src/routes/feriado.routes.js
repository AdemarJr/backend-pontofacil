// src/routes/feriado.routes.js
const router = require('express').Router();
const { autenticar, exigirAdmin } = require('../middlewares/auth.middleware');
const { listar, criar, atualizar, remover } = require('../controllers/feriado.controller');

router.use(autenticar, exigirAdmin);

router.get('/', listar);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', remover);

module.exports = router;

