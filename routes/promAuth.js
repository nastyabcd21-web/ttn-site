// Логін на my.prom.ua через справжній браузер (Playwright), щоб отримати
// cookies авторизованої сесії. Внутрішній ендпоінт друку етикетки Rozetka
// Delivery (get_sticker) працює тільки з cookie-сесією, а не з API-токеном.
//
// Логін/пароль беруться зі змінних середовища на Render:
//   PROM_LOGIN, PROM_PASSWORD
//
// Cookies кешуються в пам'яті на COOKIE_TTL_MS, щоб не заходити на prom.ua
// заново при кожному запиті етикетки.

const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');

// Якщо браузер Chromium не був встановлений під час збірки на Render,
// завантажуємо його самі при першому запиті (один раз, потім він лишається на диску).
let installPromise = null;
function installChromium() {
  if (!installPromise) {
    installPromise = new Promise((resolve, reject) => {
      const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      execFile(process.execPath, [cli, 'install', 'chromium'], { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          installPromise = null; // дозволяємо повторну спробу пізніше
          return reject(new Error('Не вдалося завантажити браузер: ' + (stderr || err.message).toString().slice(-300)));
        }
        resolve();
      });
    });
  }
  return installPromise;
}

async function launchBrowser() {
  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(String(e.message))) throw e;
    await installChromium();
    return chromium.launch(opts);
  }
}

let cachedCookies = null;
let cachedAt = 0;
const COOKIE_TTL_MS = 20 * 60 * 1000; // 20 хвилин

// Збирає опис сторінки (адреса, заголовок, поля вводу, початок тексту) — щоб у разі
// невдачі помилка показала, що саме відкрилось, і можна було підлаштувати код.
async function describePage(page) {
  try {
    const info = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, button')).slice(0, 15).map((el) => {
        const r = el.getBoundingClientRect();
        const vis = r.width > 0 && r.height > 0;
        return `${el.tagName.toLowerCase()}[type=${el.type || ''},name=${el.name || ''},id=${el.id || ''},ph=${el.placeholder || ''},vis=${vis}]`;
      });
      const text = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 250);
      return { title: document.title, inputs, text };
    });
    return `URL: ${page.url()} | Заголовок: ${info.title} | Елементи: ${info.inputs.join(' ')} | Текст: ${info.text}`;
  } catch (e) {
    return `URL: ${page.url()} (не вдалося прочитати сторінку: ${e.message})`;
  }
}

// Шукає перше ВИДИМЕ поле вводу за переліком селекторів.
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    const handles = await page.$$(sel);
    for (const h of handles) {
      if (await h.isVisible().catch(() => false)) return h;
    }
  }
  return null;
}

const LOGIN_SELECTORS = [
  'input[name="login"]', 'input[name="email"]', 'input[name="username"]', 'input[type="email"]',
  'input[type="tel"]', 'input[autocomplete="username"]', 'input[autocomplete="email"]',
  '#login', '#email', 'input[data-qaid*="login"]', 'input[data-qaid*="email"]',
  'input[type="text"]:not([type="hidden"])'
];
const PASS_SELECTORS = [
  'input[type="password"]', 'input[name="password"]', '#password', 'input[data-qaid*="password"]'
];

async function loginToProm() {
  const login = process.env.PROM_LOGIN;
  const password = process.env.PROM_PASSWORD;
  if (!login || !password) {
    throw new Error('Не встановлено PROM_LOGIN / PROM_PASSWORD на сервері (Render → Environment).');
  }

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: 'uk-UA',
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto('https://my.prom.ua/login', { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Сторінка входу може домальовуватись скриптами — чекаємо, поки з'явиться хоч одне поле.
    await page.waitForSelector('input', { state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const loginEl = await findVisible(page, LOGIN_SELECTORS);
    if (!loginEl) {
      throw new Error('Не знайдено поле логіну на сторінці входу prom.ua. ' + (await describePage(page)));
    }
    await loginEl.fill(login);

    // Пароль може бути на цій же сторінці, або з'явитись другим кроком після логіну.
    let passEl = await findVisible(page, PASS_SELECTORS);
    if (!passEl) {
      await page.keyboard.press('Enter');
      await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 }).catch(() => {});
      passEl = await findVisible(page, PASS_SELECTORS);
    }
    if (!passEl) {
      throw new Error('Не знайдено поле пароля на сторінці входу prom.ua. ' + (await describePage(page)));
    }
    await passEl.fill(password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.keyboard.press('Enter')
    ]);
    await page.waitForTimeout(3000);

    if (/\/login|\/sign|\/auth/i.test(page.url()) && (await findVisible(page, PASS_SELECTORS))) {
      throw new Error('Вхід не вдався (невірний логін/пароль або капча/SMS-підтвердження). ' + (await describePage(page)));
    }

    const cookies = (await context.cookies()).filter((c) => /prom\.ua$/i.test(c.domain.replace(/^\./, '')));
    if (!cookies.length) {
      throw new Error('Не вдалося отримати cookies після входу на prom.ua. ' + (await describePage(page)));
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
