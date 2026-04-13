const router = require('express').Router();
const { autenticar, exigirAdmin, exigirColaborador } = require('../middlewares/auth.middleware');
const { listar, criar, atualizar, remover, minha } = require('../controllers/escala.controller');

router.use(autenticar);

// Colaborador: ver a própria escala (para Meu Ponto)
router.get('/minha', exigirColaborador, minha);

// Admin: CRUD de escalas
router.use(exigirAdmin);
router.get('/', listar);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', remover);

module.exports = router;
