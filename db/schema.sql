-- Схема бази даних для сайту обробки замовлень SalesDrive.
-- Виконується автоматично через npm run migrate (db/migrate.js),
-- або можна виконати вручну в SQL-редакторі Supabase.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  sd_id TEXT NOT NULL,                 -- ID замовлення в SalesDrive
  last_name TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  doc_name TEXT DEFAULT '',            -- "Назва для документів" — використовується в гарантійних талонах
  qty INTEGER DEFAULT 1,
  price NUMERIC DEFAULT 0,
  ttn TEXT DEFAULT '',
  carrier TEXT DEFAULT '',             -- novaposhta / ukrposhta / rozetkaDelivery / meest
  status TEXT DEFAULT '',
  comment TEXT DEFAULT '',             -- коментар до замовлення зі SalesDrive
  prom_order_id TEXT DEFAULT '',       -- внутрішній ID замовлення на Prom.ua (для друку етикетки Rozetka Delivery)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Додаються безпечно і для вже існуючої бази даних (не видаляють наявні дані).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS doc_name TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prom_order_id TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_orders_sd_id ON orders(sd_id);

CREATE TABLE IF NOT EXISTS warranty_config (
  id SERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  months INTEGER NOT NULL,
  terms TEXT DEFAULT ''
);

-- Постійний список: для яких товарів друкувати повний "Гарантійний талон"
-- замість сторінки "Замовлення". product_key = "Назва для документів" товару
-- (або звичайна назва товару, якщо "Назва для документів" не заповнена).
CREATE TABLE IF NOT EXISTS product_warranty (
  product_key TEXT PRIMARY KEY,
  is_warranty BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);
