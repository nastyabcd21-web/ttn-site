// Одноразовий запуск: створює таблиці в базі даних, якщо їх ще немає.
// Виклик: npm run migrate  (локально або як разова команда на Render/Supabase)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Готово: таблиці створено (або вже існували).');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Помилка міграції:', err);
  process.exit(1);
});
