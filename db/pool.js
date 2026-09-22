// Пул підключень до PostgreSQL (Supabase). DATABASE_URL береться з .env
// (див. .env.example) — рядок підключення видає Supabase в Project Settings -> Database.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ПОМИЛКА: не встановлено DATABASE_URL у змінних середовища. Дивіться .env.example.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

module.exports = pool;
