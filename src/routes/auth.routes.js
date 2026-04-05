// src/routes/auth.routes.js
const router = require('express').Router();
const { loginEmail, loginPin, refreshToken } = require('../controllers/auth.controller');

router.post('/login', loginEmail);
router.post('/login-pin', loginPin);
router.post('/refresh', refreshToken);

module.exports = router;
