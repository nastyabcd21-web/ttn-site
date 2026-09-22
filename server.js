require('dotenv').config();
const express = require('express');
const path = require('path');
const { router: authRouter } = require('./routes/auth');
const ordersRouter = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту ${PORT}`);
});
