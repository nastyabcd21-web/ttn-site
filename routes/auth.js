const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function sign(user) {
  return jwt.sign({ id: user.id, login: user.login, name: user.display_name }, JWT_SECRET, { expiresIn: '12h' });
}

router.post('/register', async (req, res) => {
  try {
    const { login, password, displayName } = req.body;
    if (!login || !password || !displayName) return res.status(400).json({ error: 'Заповніть усі поля.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Пароль має містити щонайменше 6 символів.' });

    const existing = await pool.query('SELECT id FROM users WHERE login = $1', [login]);
    if (existing.rows.length) return res.status(400).json({ error: 'Такий логін вже зайнято.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (login, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, login, display_name',
      [login, hash, displayName]
    );
    const user = result.rows[0];
    res.json({ token: sign(user), name: user.display_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при реєстрації.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Невірний логін або пароль.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Невірний логін або пароль.' });
    res.json({ token: sign(user), name: user.display_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при вході.' });
  }
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Сесія недійсна або закінчилась. Увійдіть знову.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Сесія недійсна або закінчилась. Увійдіть знову.' });
  }
}

module.exports = { router, authMiddleware };
