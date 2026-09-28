// Логін на my.prom.ua через справжній браузер (Playwright), щоб отримати
// cookies авторизованої сесії. Внутрішній ендпоінт друку етикетки Rozetka
// Delivery (get_sticker) працює тільки з cookie-сесією, а не з API-токеном.
//
// Логін/пароль беруться зі змінних середовища на Render:
//   PROM_LOGIN, PROM_PASSWORD
//
// Cookies кешуються в пам'яті на COOKIE_TTL_MS, щоб не заходити на prom.ua
// заново при кожному запиті етикетки.

const { chromium } = require('playwright');

let cachedCookies = null;
let cachedAt = 0;
const COOKIE_TTL_MS = 20 * 60 * 1000; // 20 хвилин

async function loginToProm() {
  const login = process.env.PROM_LOGIN;
  const password = process.env.PROM_PASSWORD;
  if (!login || !password) {
    throw new Error('Не встановлено PROM_LOGIN / PROM_PASSWORD на сервері (Render → Environment).');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://my.prom.ua/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Структура форми логіну на prom.ua може відрізнятись — пробуємо кілька
    // типових варіантів полів.
    const loginSelectors = [
      'input[name="login"]', 'input[name="email"]', 'input[type="email"]',
      '#login', '#email', 'input[data-qaid="login_input"]'
    ];
    const passSelectors = [
      'input[name="password"]', 'input[type="password"]', '#password',
      'input[data-qaid="password_input"]'
    ];

    let loginFilled = false;
    for (const sel of loginSelectors) {
      const el = await page.$(sel);
      if (el) { await el.fill(login); loginFilled = true; break; }
    }
    if (!loginFilled) {
      throw new Error('Не знайдено поле логіну на сторінці входу prom.ua (структура сторінки змінилась).');
    }

    let passFilled = false;
    for (const sel of passSelectors) {
      const el = await page.$(sel);
      if (el) { await el.fill(password); passFilled = true; break; }
    }
    if (!passFilled) {
      throw new Error('Не знайдено поле пароля на сторінці входу prom.ua (структура сторінки змінилась).');
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.keyboard.press('Enter')
    ]);
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      throw new Error('Після спроби входу все ще на сторінці /login — можливо, невірний логін/пароль або потрібна додаткова перевірка (капча/SMS).');
    }

    const cookies = await context.cookies();
    if (!cookies || !cookies.length) {
      throw new Error('Не вдалося отримати cookies після входу на prom.ua.');
    }

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    cachedCookies = cookieHeader;
    cachedAt = Date.now();
    return cookieHeader;
  } finally {
    await browser.close();
  }
}

async function getPromCookies(forceRefresh = false) {
  if (!forceRefresh && cachedCookies && (Date.now() - cachedAt) < COOKIE_TTL_MS) {
    return cachedCookies;
  }
  return loginToProm();
}

module.exports = { getPromCookies };
