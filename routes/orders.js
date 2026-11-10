const express = require('express');
const fetch = require('node-fetch');
const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const pool = require('../db/pool');
const { authMiddleware } = require('./auth');
const assets = require('../assets');
const { getPromCookies } = require('../promAuth');

const router = express.Router();

// ===== Друк етикетки Rozetka Delivery для замовлень, створених на Prom.ua (TTN виду PRM-...) =====
// SalesDrive для таких замовлень друкує етикетку через внутрішній (недокументований)
// ендпоінт my.prom.ua, який працює лише з cookie-сесією авторизованого користувача,
// а не з API-токеном. Тому тут ми самі "заходимо" на prom.ua під логіном/паролем
// (через promAuth.js) і використовуємо отримані cookies для запиту етикетки.
async function fetchPromSticker(orderId, declarationId, cookies) {
  const url = `https://my.prom.ua/remote/delivery/rozetka_delivery/get_sticker?order_id=${encodeURIComponent(orderId)}&declaration_id=${encodeURIComponent(declarationId)}`;
  return fetch(url, { headers: { Cookie: cookies } });
}

function isPdfResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('pdf') || contentType.includes('octet-stream');
}

router.get('/rozetka-prom-sticker', async (req, res) => {
  const orderId = req.query.order_id;
  const declarationId = req.query.declaration_id;
  if (!orderId || !declarationId) {
    return res.status(400).json({ error: 'Треба передати order_id та declaration_id.' });
  }
  try {
    let cookies = await getPromCookies();
    let response = await fetchPromSticker(orderId, declarationId, cookies);

    // Якщо з кешованими cookies не вийшло (сесія застаріла) — заходимо на prom.ua ще раз.
    if (!response.ok || !isPdfResponse(response)) {
      cookies = await getPromCookies(true);
      response = await fetchPromSticker(orderId, declarationId, cookies);
    }

    if (!response.ok || !isPdfResponse(response)) {
      const text = await response.text().catch(() => '');
      console.error('Не вдалося отримати етикетку з prom.ua:', response.status, text.substring(0, 300));
      return res.status(502).json({ error: 'Prom.ua не повернув етикетку (можливо, змінилась структура сайту або сесія не пройшла).' });
    }

    const buf = await response.buffer();
    res.set('Content-Type', 'application/pdf');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка при отриманні етикетки з prom.ua: ' + err.message });
  }
});

// ======================= ШРИФТИ ТА ТЕКСТИ ДЛЯ ГАРАНТІЙНИХ ТАЛОНІВ =======================
// Шрифти (DejaVu Sans, підтримують кирилицю) та картинка зберігаються в assets.js
// у вигляді тексту (base64), щоб їх можна було завантажити на GitHub як звичайний .js файл.

const FONT_REGULAR = Buffer.from(assets.fontRegularBase64, 'base64');
const FONT_BOLD = Buffer.from(assets.fontBoldBase64, 'base64');
const ORDER_FOOTER_IMAGE = Buffer.from(assets.orderFooterImageBase64, 'base64');

// --- Текст гарантійного талону (взято з інструкції з експлуатації, наданої користувачем) ---
const WARRANTY_TITLE = 'ІНСТРУКЦІЯ З ЕКСПЛУАТАЦІЇ ТА БЕЗПЕКИ';
const WARRANTY_SUBTITLE = 'Електронагрівальні вироби (електропростирадла, електрогрілки)';
const WARRANTY_INTRO = 'Дякуємо, що обрали наш виріб! Ця інструкція створена для того, щоб ваш прилад служив довго, даруючи тепло та затишок. Будь ласка, ознайомтеся з цими рекомендаціями для комфортного та безпечного користування.';

// Кожен "буліт" — або звичайний рядок, або { lead, text } з жирним вступним словом.
const WARRANTY_SECTIONS = [
  {
    title: '1. ПІДГОТОВКА ДО РОБОТИ',
    bullets: [
      'Перевірте цілісність шнура, вилки та терморегулятора перед першим увімкненням.',
      'Виріб призначений виключно для побутового використання всередині приміщень.',
      'Підключайте прилад лише до справної електромережі з відповідною напругою.'
    ]
  },
  {
    title: '2. КОМФОРТНЕ ВИКОРИСТАННЯ',
    bullets: [
      'Використовуйте виріб у рівному, розправленому вигляді без зламів чи згортань.',
      'Не встромляйте голки, шпильки чи інші гострі предмети.',
      'Захищайте виріб від вологи та не використовуйте у мокрому стані.',
      'Не накривайте важкими недихаючими матеріалами під час активної роботи.'
    ]
  },
  {
    title: '3. РЕЖИМИ ТА ДОГЛЯД',
    bullets: [
      { lead: 'Прогрів і сон: ', text: 'Перед сном прогрійте ліжко на вищому режимі, а для нічного відпочинку переведіть на мінімальний режим (1–2) або таймер.' },
      { lead: 'Чистка: ', text: 'Делікатне ручне прання згідно з маркуванням (тільки після відключення від мережі та зняття пульта).' },
      { lead: 'Зберігання: ', text: "Зберігайте в сухому місці, згортаючи м'якими вільними рулонами після охолодження." }
    ]
  },
  {
    title: '4. УМОВИ ТА ВІДПОВІДАЛЬНІСТЬ',
    bullets: [
      'Виробник гарантує якість за умови дотримання правил цієї інструкції.',
      'Нічне використання дозволено виключно на мінімальних режимах. Заборонено залишати прилад без нагляду.',
      { lead: 'Повне зняття відповідальності: ', text: "Продавець та виробник не несуть жодної відповідальності за шкоду через порушення правил (зім'ятий стан, волога, перепади напруги, самостійний ремонт). Усі ризики покладаються на споживача!" }
    ]
  }
];

const WARRANTY_TERMS_TITLE = 'ГАРАНТІЙНИЙ ТАЛОН';
// Другий пункт закінчується жирною фразою — задано через boldTail.
const WARRANTY_TERMS_BULLETS = [
  "Гарантійний термін вказано в полі з назвою товару та діє з дати придбання. В умови гарантії не входять поломки внаслідок: використання приладу з порушенням інструкції; використання в технічних умовах, які відрізняються від паспортних; короткого замикання або перепадів напруги; використання приладу не за призначенням або недбалого використання; спроб випрати, почистити або відремонтувати самостійно.",
  { lead: "У випадку браку магазин зобов'язується замінити виріб протягом 14 днів. ", boldTail: 'Товар приймається на ремонт лише в чистому вигляді!' }
];

const WARRANTY_CONTACTS_TEXT = 'Контакти служби підтримки: 097-680-27-79, 093-421-78-98, 095-248-13-19';
const WARRANTY_KEEP_TEXT = 'ЗБЕРІГАЙТЕ ДАНИЙ ТАЛОН ВПРОДОВЖ ТЕРМІНУ ДІЇ ГАРАНТІЇ!';

function formatDateUA(d) {
  const date = d ? new Date(d) : new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function randomDocNumber() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

// --- Малює (або, якщо draw=false, тільки вимірює висоту) список "булітів" в одній колонці. ---
function layoutBullets(doc, bullets, x, y, width, size, lineGap, draw) {
  const bulletPrefix = '•  ';
  let total = 0;
  for (const b of bullets) {
    doc.font('regular').fontSize(size);
    let h;
    if (typeof b === 'string') {
      const text = bulletPrefix + b;
      h = doc.heightOfString(text, { width });
      if (draw) doc.text(text, x, y + total, { width });
    } else if (b.boldTail) {
      const plain = bulletPrefix + b.lead + b.boldTail;
      h = doc.heightOfString(plain, { width });
      if (draw) {
        doc.font('regular').fontSize(size).text(bulletPrefix + b.lead, x, y + total, { width, continued: true });
        doc.font('bold').fontSize(size).text(b.boldTail);
      }
    } else {
      const plain = bulletPrefix + b.lead + b.text;
      h = doc.heightOfString(plain, { width });
      if (draw) {
        doc.font('bold').fontSize(size).text(bulletPrefix + b.lead, x, y + total, { width, continued: true });
        doc.font('regular').fontSize(size).text(b.text);
      }
    }
    total += h + lineGap;
  }
  return total;
}

// --- Висота (або малювання) одного блоку "заголовок + буліти" (одна колонка). ---
function layoutSection(doc, section, x, y, width, titleSize, bulletSize, titleGap, bulletGap, draw) {
  doc.font('bold').fontSize(titleSize);
  const titleH = doc.heightOfString(section.title, { width });
  if (draw) doc.text(section.title, x, y, { width });
  const bulletsH = layoutBullets(doc, section.bullets, x, y + titleH + titleGap, width, bulletSize, bulletGap, draw);
  return titleH + titleGap + bulletsH;
}

// --- Увесь гарантійний талон (інструкція + умови гарантії), з автопідбором розміру
// шрифту, щоб гарантовано вміститись у залишок сторінки. draw=false — лише порахувати
// потрібну висоту; draw=true — намалювати по-справжньому на ту саму висоту. ---
function layoutWarrantyTalon(doc, x, y, width, scale, draw) {
  const s = (n) => Math.round(n * scale * 10) / 10;
  const titleSize = s(13);
  const subtitleSize = s(9.5);
  const introSize = s(8.3);
  const sectionTitleSize = s(9.5);
  const bulletSize = s(8);
  const pad = s(7);
  const colGap = s(12);
  const boxGap = s(7);
  const titleGap = s(3);
  const bulletGap = s(2);

  let curY = y;

  doc.font('bold').fontSize(titleSize);
  const mainTitleH = doc.heightOfString(WARRANTY_TITLE, { width, align: 'center' });
  if (draw) doc.text(WARRANTY_TITLE, x, curY, { width, align: 'center' });
  curY += mainTitleH + s(2);

  doc.font('bold').fontSize(subtitleSize);
  const subtitleH = doc.heightOfString(WARRANTY_SUBTITLE, { width, align: 'center' });
  if (draw) doc.text(WARRANTY_SUBTITLE, x, curY, { width, align: 'center' });
  curY += subtitleH + s(5);

  // --- Бокс з вітальним текстом ---
  doc.font('regular').fontSize(introSize);
  const introH = doc.heightOfString(WARRANTY_INTRO, { width: width - pad * 2 });
  const introBoxH = introH + pad * 2;
  if (draw) {
    doc.rect(x, curY, width, introBoxH).stroke();
    doc.text(WARRANTY_INTRO, x + pad, curY + pad, { width: width - pad * 2 });
  }
  curY += introBoxH + boxGap;

  // --- Два ряди по дві секції (бокси однакової висоти в межах ряду) ---
  const boxWidth = (width - colGap) / 2;
  const colWidth = boxWidth - pad * 2;
  const rows = [[WARRANTY_SECTIONS[0], WARRANTY_SECTIONS[1]], [WARRANTY_SECTIONS[2], WARRANTY_SECTIONS[3]]];
  for (const [left, right] of rows) {
    const hLeft = layoutSection(doc, left, 0, 0, colWidth, sectionTitleSize, bulletSize, titleGap, bulletGap, false);
    const hRight = layoutSection(doc, right, 0, 0, colWidth, sectionTitleSize, bulletSize, titleGap, bulletGap, false);
    const rowBoxH = Math.max(hLeft, hRight) + pad * 2;
    if (draw) {
      doc.rect(x, curY, boxWidth, rowBoxH).stroke();
      doc.rect(x + boxWidth + colGap, curY, boxWidth, rowBoxH).stroke();
      layoutSection(doc, left, x + pad, curY + pad, colWidth, sectionTitleSize, bulletSize, titleGap, bulletGap, true);
      layoutSection(doc, right, x + boxWidth + colGap + pad, curY + pad, colWidth, sectionTitleSize, bulletSize, titleGap, bulletGap, true);
    }
    curY += rowBoxH + boxGap;
  }

  // --- Бокс "Гарантійний талон" ---
  doc.font('bold').fontSize(s(11));
  const termsTitleH = doc.heightOfString(WARRANTY_TERMS_TITLE, { width: width - pad * 2, align: 'center' });
  const termsBulletsH = layoutBullets(doc, WARRANTY_TERMS_BULLETS, 0, 0, width - pad * 2, bulletSize, bulletGap, false);
  const termsBoxH = termsTitleH + titleGap + termsBulletsH + pad * 2;
  if (draw) {
    doc.rect(x, curY, width, termsBoxH).stroke();
    doc.font('bold').fontSize(s(11)).text(WARRANTY_TERMS_TITLE, x + pad, curY + pad, { width: width - pad * 2, align: 'center' });
    layoutBullets(doc, WARRANTY_TERMS_BULLETS, x + pad, curY + pad + termsTitleH + titleGap, width - pad * 2, bulletSize, bulletGap, true);
  }
  curY += termsBoxH + boxGap;

  // --- Нижній ряд: контакти (зліва) + "зберігайте талон" (справа) ---
  doc.font('bold').fontSize(s(9));
  const contactsH = doc.heightOfString(WARRANTY_CONTACTS_TEXT, { width: colWidth });
  const keepH = doc.heightOfString(WARRANTY_KEEP_TEXT, { width: colWidth, align: 'center' });
  const bottomBoxH = Math.max(contactsH, keepH) + pad * 2;
  if (draw) {
    doc.rect(x, curY, boxWidth, bottomBoxH).stroke();
    doc.rect(x + boxWidth + colGap, curY, boxWidth, bottomBoxH).stroke();
    doc.font('bold').fontSize(s(9)).text(WARRANTY_CONTACTS_TEXT, x + pad, curY + pad, { width: colWidth });
    doc.font('bold').fontSize(s(9)).text(WARRANTY_KEEP_TEXT, x + boxWidth + colGap + pad, curY + pad, { width: colWidth, align: 'center' });
  }
  curY += bottomBoxH;

  return curY - y;
}

// --- Список товарів, для яких вручну позначено "друкувати гарантію" ---
async function getProductWarrantyMap() {
  const result = await pool.query('SELECT product_key, is_warranty FROM product_warranty');
  const map = {};
  for (const row of result.rows) map[row.product_key] = row.is_warranty;
  return map;
}

const SD_DOMAIN = process.env.SALESDRIVE_DOMAIN || 'https://ekvator.salesdrive.me';
const SD_FORM_API_KEY = process.env.SALESDRIVE_FORM_API_KEY;
const PULL_STATUS = process.env.SD_PULL_STATUS || '3';   // "На відправку"
const DONE_STATUS = process.env.SD_DONE_STATUS || '11';  // "Роздруковано"
const NOVAPOSHTA_API_KEY = process.env.NOVAPOSHTA_API_KEY;
const ROZETKA_API_TOKEN = process.env.ROZETKA_API_TOKEN;
const ROZETKA_API_BASE = process.env.ROZETKA_API_BASE || 'https://rz-delivery.rozetka.ua/api';

const AUTO_PRINT_CARRIERS = ['novaposhta', 'rozetkaDelivery'];
const CARRIER_LABELS = {
  novaposhta: 'Нова пошта',
  ukrposhta: 'Укрпошта',
  rozetkaDelivery: 'Rozetka Delivery',
  rozetkaDeliveryProm: 'Rozetka Delivery (Пром)',
  meest: 'Meest'
};

// ТТН з префіксом "PRM-" — замовлення, створені на сайті Prom.ua (інший обліковий
// запис у Rozetka Delivery, недоступний нашим ключем API). Для відображення/фільтрації
// в інтерфейсі трактуємо їх як окремого "перевізника" — carrierKey.
function carrierKeyFor(carrier, ttn) {
  if (carrier === 'rozetkaDelivery' && /^PRM-/i.test(String(ttn || '').trim())) return 'rozetkaDeliveryProm';
  return carrier;
}

router.use(authMiddleware);

// Технічна назва поля "Дроп" у SalesDrive — виявлена в коді, що створює замовлення.
// Імпортуємо тільки замовлення, де це поле ПУСТЕ.
const DROP_FIELD_NAME = 'dropsipping_2';

function isDropFieldEmpty(sdOrder) {
  let val = sdOrder[DROP_FIELD_NAME];
  // Деякі API SalesDrive кладуть кастомні поля у вкладений об'єкт data — перевіряємо і це на всяк випадок.
  if ((val === undefined || val === null) && sdOrder.data && typeof sdOrder.data === 'object') {
    val = sdOrder.data[DROP_FIELD_NAME];
  }
  if (val === undefined || val === null) return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'string') return val.trim() === '';
  if (typeof val === 'object') return Object.keys(val).length === 0;
  return false;
}

// ======================= ІМПОРТ ЗАМОВЛЕНЬ ЗІ SALESDRIVE =======================

router.post('/import', async (req, res) => {
  try {
    if (!SD_FORM_API_KEY) return res.status(500).json({ error: 'Не встановлено SALESDRIVE_FORM_API_KEY на сервері.' });

    // SalesDrive повертає результати сторінками і, схоже, ігнорує наш параметр limit
    // (завжди віддає максимум ~100 на сторінку) — тому орієнтуємось не на розмір
    // запитаного ліміту, а тягнемо сторінки, поки не отримаємо ПОРОЖНЮ сторінку.
    const PAGE_LIMIT = 100;
    let page = 1;
    let sdOrders = [];
    // SalesDrive обмежує: не більше 10 запитів на хвилину до /api/order/list/ —
    // якщо сторінок багато, чекаємо між запитами, щоб не впертися в цей ліміт.
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    while (true) {
      if (page > 1) await sleep(6500);
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT), 'filter[statusId]': PULL_STATUS });
      const response = await fetch(`${SD_DOMAIN}/api/order/list/?${params.toString()}`, {
        method: 'GET',
        headers: { 'Form-Api-Key': SD_FORM_API_KEY }
      });
      const rawText = await response.text();
      if (!response.ok) return res.status(502).json({ error: `Помилка SalesDrive API: ${rawText.substring(0, 500)}` });

      let body;
      try { body = JSON.parse(rawText); } catch (e) {
        return res.status(502).json({ error: `SalesDrive повернув не-JSON: ${rawText.substring(0, 300)}` });
      }
      const pageOrders = body.data || body.orders || (Array.isArray(body) ? body : []);
      if (!Array.isArray(pageOrders)) {
        return res.status(502).json({ error: `Не знайдено масив замовлень. Ключі: ${Object.keys(body || {}).join(', ')}` });
      }

      if (pageOrders.length === 0) break; // порожня сторінка — дійшли до кінця

      sdOrders = sdOrders.concat(pageOrders);
      page++;
      if (page > 200) break; // запобіжник від нескінченного циклу
    }

    let addedRows = 0;
    let skippedDrop = 0;
    let removedDrop = 0;
    for (const sdOrder of sdOrders) {
      const sdId = String(sdOrder.id || sdOrder.orderId);

      // Якщо поле "Дроп" НЕ пусте — пропускаємо і, про всяк випадок,
      // видаляємо це замовлення з бази, якщо воно туди потрапило раніше (до появи фільтра).
      if (!isDropFieldEmpty(sdOrder)) {
        skippedDrop++;
        const del = await pool.query('DELETE FROM orders WHERE sd_id = $1', [sdId]);
        if (del.rowCount) removedDrop++;
        continue;
      }

      const mapped = mapSalesDriveOrder(sdOrder);
      // Пропускаємо замовлення, які вже завантажені (щоб не дублювати при повторному імпорті)
      const existing = await pool.query('SELECT id FROM orders WHERE sd_id = $1 LIMIT 1', [mapped.sdId]);
      if (existing.rows.length) continue;

      for (const item of mapped.products) {
        await pool.query(
          `INSERT INTO orders (sd_id, last_name, first_name, phone, product_name, doc_name, qty, price, ttn, carrier, status, comment, prom_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [mapped.sdId, mapped.lastName, mapped.firstName, mapped.phone, item.name, item.docName, item.qty, item.price, mapped.ttn, mapped.carrier, mapped.status, mapped.comment, mapped.promOrderId]
        );
        addedRows++;
      }
    }
    res.json({ message: `Завантажено замовлень зі SalesDrive: ${sdOrders.length} (сторінок: ${page}, пропущено через поле "Дроп": ${skippedDrop}, з них видалено зі списку (були завантажені раніше): ${removedDrop}, нових рядків товарів: ${addedRows}).` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при імпорті: ' + err.message });
  }
});

// ======================= ОНОВЛЕННЯ НАЗВ ТОВАРІВ ДЛЯ ВЖЕ ЗАВАНТАЖЕНИХ ЗАМОВЛЕНЬ =======================
// Якщо "Назву для документів" (чи звичайну назву) відредагували в SalesDrive ПІСЛЯ того,
// як замовлення вже потрапило на наш сайт — назва тут "застигає" такою, якою була на момент
// завантаження. Цей маршрут перетягує актуальні назви зі SalesDrive для замовлень, які вже
// є в нашому списку (без додавання нових замовлень і без дублювання рядків).

router.post('/refresh-names', async (req, res) => {
  try {
    if (!SD_FORM_API_KEY) return res.status(500).json({ error: 'Не встановлено SALESDRIVE_FORM_API_KEY на сервері.' });

    const idsResult = await pool.query('SELECT DISTINCT sd_id FROM orders');
    const remaining = new Set(idsResult.rows.map((r) => String(r.sd_id)));
    if (!remaining.size) return res.json({ message: 'У списку немає замовлень для оновлення.' });

    // SalesDrive обмежує: не більше 10 запитів на хвилину до /api/order/list/ —
    // тому чекаємо між сторінками. Зупиняємось раніше, якщо вже знайшли всі потрібні замовлення.
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const PAGE_LIMIT = 100;
    const MAX_PAGES = 40;
    let page = 1;
    let updatedOrders = 0;
    let updatedRows = 0;
    let skippedMismatch = 0;

    while (page <= MAX_PAGES && remaining.size > 0) {
      if (page > 1) await sleep(6500);
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
      const response = await fetch(`${SD_DOMAIN}/api/order/list/?${params.toString()}`, {
        method: 'GET',
        headers: { 'Form-Api-Key': SD_FORM_API_KEY }
      });
      const rawText = await response.text();
      if (!response.ok) break;
      let body;
      try { body = JSON.parse(rawText); } catch (e) { break; }
      const pageOrders = body.data || body.orders || (Array.isArray(body) ? body : []);
      if (!Array.isArray(pageOrders) || pageOrders.length === 0) break;

      for (const sdOrder of pageOrders) {
        const sdId = String(sdOrder.id || sdOrder.orderId);
        if (!remaining.has(sdId)) continue;
        remaining.delete(sdId);

        const mapped = mapSalesDriveOrder(sdOrder);
        const dbRows = await pool.query('SELECT id FROM orders WHERE sd_id = $1 ORDER BY id ASC', [sdId]);
        // Оновлюємо, тільки якщо кількість товарів співпадає — інакше ризикуємо
        // переплутати, який рядок якому товару відповідає.
        if (dbRows.rows.length !== mapped.products.length) { skippedMismatch++; continue; }

        for (let i = 0; i < dbRows.rows.length; i++) {
          await pool.query(
            'UPDATE orders SET product_name = $1, doc_name = $2, comment = $3, prom_order_id = $4 WHERE id = $5',
            [mapped.products[i].name, mapped.products[i].docName, mapped.comment, mapped.promOrderId, dbRows.rows[i].id]
          );
          updatedRows++;
        }
        updatedOrders++;
      }
      page++;
    }

    const parts = [`Оновлено назви для ${updatedOrders} замовлень (${updatedRows} рядків товарів).`];
    if (skippedMismatch) parts.push(`Пропущено (кількість товарів не збіглась): ${skippedMismatch}.`);
    if (remaining.size) parts.push(`Не знайдено серед переглянутих сторінок: ${remaining.size} замовлень.`);
    res.json({ message: parts.join(' ') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при оновленні назв: ' + err.message });
  }
});

function mapSalesDriveOrder(sdOrder) {
  let rawProducts = sdOrder.products || sdOrder.items || [];
  if (!Array.isArray(rawProducts) && typeof rawProducts === 'object') {
    rawProducts = Object.keys(rawProducts).map((k) => rawProducts[k]);
  }
  const products = rawProducts.map((p) => ({
    // Звичайна назва товару — НІКОЛИ не підставляємо сюди "Назву для документів",
    // навіть якщо основна назва порожня (щоб список "Гарантія по товарах" не змішувався).
    name: p.text || p.name || p.title || '',
    // "Назва для документів" у SalesDrive — саме її показуємо в гарантійних талонах.
    docName: p.documentName || p.text || p.name || p.title || '',
    qty: p.amount || p.qty || 1,
    price: p.price || p.costPerItem || 0
  }));
  if (!products.length) products.push({ name: '', docName: '', qty: 1, price: 0 });

  const contact = sdOrder.primaryContact || {};
  const phoneArr = contact.phone;
  const phone = Array.isArray(phoneArr) ? (phoneArr[0] || '') : (phoneArr || '');

  let deliveryData = sdOrder.ord_delivery_data;
  if (!Array.isArray(deliveryData)) deliveryData = [];
  const delivery = deliveryData[0] || {};
  const carrier = delivery.provider || sdOrder.shipping_method || '';
  const ttn = delivery.trackingNumber || sdOrder.ttn || '';
  // Внутрішній ID замовлення на самому Prom.ua — потрібен для друку етикетки
  // Rozetka Delivery через my.prom.ua (тільки для замовлень з Prom, TTN виду PRM-...).
  const promOrderId = delivery.orderExternalId || '';

  return {
    sdId: String(sdOrder.id || sdOrder.orderId),
    lastName: contact.lName || '',
    firstName: contact.fName || '',
    phone,
    ttn,
    carrier,
    promOrderId,
    status: String(sdOrder.statusId || sdOrder.status || PULL_STATUS),
    comment: sdOrder.comment || '',
    products
  };
}

// ======================= СПИСОК ЗАМОВЛЕНЬ (ДЛЯ ІНТЕРФЕЙСУ) =======================

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id ASC');
    const groups = {};
    const order = [];
    for (const row of result.rows) {
      if (!groups[row.sd_id]) {
        groups[row.sd_id] = {
          sdId: row.sd_id, lastName: row.last_name, firstName: row.first_name,
          ttn: row.ttn, carrier: row.carrier,
          carrierKey: carrierKeyFor(row.carrier, row.ttn),
          carrierLabel: CARRIER_LABELS[carrierKeyFor(row.carrier, row.ttn)] || row.carrier || '—',
          status: row.status, sum: 0, products: []
        };
        order.push(row.sd_id);
      }
      const g = groups[row.sd_id];
      const price = Number(row.price) || 0;
      const qty = Number(row.qty) || 0;
      g.sum += price * qty;
      g.products.push({ name: row.product_name, qty, price });
    }
    res.json(order.map((id) => groups[id]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при завантаженні списку.' });
  }
});

// ======================= ДРУК ТТН (НОВА ПОШТА) =======================

const NP_PRINT_METHODS = { invoice: 'printDocument', label100: 'printMarking100x100' };

// Об'єднує кілька готових PDF-файлів (як Buffer/Uint8Array) в один, зберігаючи порядок.
async function mergePdfBuffers(buffers) {
  const merged = await PDFLibDocument.create();
  for (const buf of buffers) {
    const src = await PDFLibDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

// Друк ТТН/етикетки Rozetka Delivery — правильний ендпоінт (з'ясовано через
// службову діагностику їхньої Swagger-документації): GET /track/label?id=...&id=...
// Приймає список номерів ЕН одним запитом і повертає готовий PDF (base64) в data.label.
// ОБМЕЖЕННЯ їхнього API: не більше 100 номерів "id" за один запит (arrayMaxSize: 100) —
// тому великі партії розбиваємо на частини по 100 і об'єднуємо готові PDF в один.
const ROZETKA_FETCH_TIMEOUT_MS = 20000;
const ROZETKA_CHUNK_SIZE = 100;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function fetchRozetkaLabelsBulk(ttns) {
  const params = new URLSearchParams();
  ttns.forEach((t) => params.append('id', t));
  const url = `${ROZETKA_API_BASE}/track/label?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROZETKA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ROZETKA_API_TOKEN}`,
        'Content-Language': 'uk'
      },
      signal: controller.signal
    });
    const rawText = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} — ${rawText.substring(0, 300)}` };
    }
    let body = null;
    try { body = JSON.parse(rawText); } catch (e) {
      return { ok: false, error: `Відповідь не JSON — ${rawText.substring(0, 300)}` };
    }
    const labelBase64 = body && body.data && body.data.label;
    if (!labelBase64) {
      return { ok: false, error: `Відповідь без поля data.label — ${JSON.stringify(body).substring(0, 300)}` };
    }
    return { ok: true, buffer: Buffer.from(labelBase64, 'base64') };
  } catch (e) {
    const reason = e.name === 'AbortError' ? `тайм-аут ${ROZETKA_FETCH_TIMEOUT_MS}мс` : e.message;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timeout);
  }
}

router.post('/print-ttn', async (req, res) => {
  try {
    const { sdIds, format } = req.body;
    if (!Array.isArray(sdIds) || !sdIds.length) return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });

    const result = await pool.query(
      'SELECT DISTINCT ON (sd_id) sd_id, ttn, carrier, prom_order_id FROM orders WHERE sd_id = ANY($1)',
      [sdIds]
    );

    // SQL "WHERE sd_id = ANY(...)" НЕ гарантує порядок рядків — тому будуємо мапу
    // і потім проходимо по sdIds у ТОМУ порядку, в якому їх передав фронтенд
    // (тобто в порядку, як замовлення відсортовані/вибрані на екрані).
    const rowsBySdId = {};
    for (const row of result.rows) rowsBySdId[row.sd_id] = row;

    const npTtns = [];
    const rozetkaTtns = [];
    const promOrdersToFetch = []; // { sdId, ttn, promOrderId } — етикетка через логін на prom.ua
    const manualCarrierOrders = [];
    for (const sdId of sdIds) {
      const row = rowsBySdId[sdId];
      if (!row) continue;
      const ttnTrimmed = row.ttn ? String(row.ttn).trim() : '';
      // ТТН з префіксом "PRM-" — це замовлення, створені на сайті Prom.ua
      // (інший обліковий запис у Rozetka Delivery). Наш API-токен їх не бачить,
      // тому такі етикетки отримуємо через логін-автоматизацію на my.prom.ua,
      // а якщо не вдалось (немає prom_order_id або помилка) — у список "друкувати вручну".
      const isPromOrder = /^PRM-/i.test(ttnTrimmed);
      if (row.carrier === 'rozetkaDelivery' && isPromOrder) {
        if (row.prom_order_id) {
          promOrdersToFetch.push({ sdId: row.sd_id, ttn: ttnTrimmed, promOrderId: row.prom_order_id });
        } else {
          manualCarrierOrders.push(`${row.sd_id} (Rozetka Delivery через Prom.ua — невідомий ID замовлення на prom.ua, оновіть список)`);
        }
      } else if (AUTO_PRINT_CARRIERS.indexOf(row.carrier) === -1) {
        const label = CARRIER_LABELS[row.carrier] || row.carrier || 'невідомий перевізник';
        manualCarrierOrders.push(`${row.sd_id} (${label})`);
      } else if (ttnTrimmed && row.carrier === 'novaposhta') {
        npTtns.push(ttnTrimmed);
      } else if (ttnTrimmed && row.carrier === 'rozetkaDelivery') {
        rozetkaTtns.push(ttnTrimmed);
      }
    }

    if (!npTtns.length && !rozetkaTtns.length && !promOrdersToFetch.length && !manualCarrierOrders.length) {
      return res.status(400).json({ error: 'У вибраних замовленнях немає номерів ТТН.' });
    }

    if (npTtns.length && !NOVAPOSHTA_API_KEY) return res.status(500).json({ error: 'Не встановлено NOVAPOSHTA_API_KEY на сервері.' });
    if (rozetkaTtns.length && !ROZETKA_API_TOKEN) return res.status(500).json({ error: 'Не встановлено ROZETKA_API_TOKEN на сервері.' });

    let npBuffer = null;
    if (npTtns.length) {
      const npMethod = NP_PRINT_METHODS[format] || NP_PRINT_METHODS.invoice;
      const fetchUrl = format === 'label100'
        ? `https://my.novaposhta.ua/orders/printMarking100x100/orders/${npTtns.join(',')}/type/pdf/zebra/zebra/apiKey/${NOVAPOSHTA_API_KEY}`
        : `https://my.novaposhta.ua/orders/${npMethod}/orders/${npTtns.join(',')}/type/pdf/apiKey/${NOVAPOSHTA_API_KEY}`;

      const npResponse = await fetch(fetchUrl);
      if (!npResponse.ok) {
        const text = await npResponse.text();
        return res.status(502).json({ error: 'Помилка Нової пошти при друку ТТН: ' + text.substring(0, 300) });
      }
      npBuffer = await npResponse.buffer();
    }

    let rozetkaBuffer = null;
    let rozetkaError = '';
    if (rozetkaTtns.length) {
      const ttnChunks = chunkArray(rozetkaTtns, ROZETKA_CHUNK_SIZE);
      const rozetkaBuffers = [];
      const rozetkaErrors = [];
      for (const chunk of ttnChunks) {
        const result = await fetchRozetkaLabelsBulk(chunk);
        if (result.ok) {
          rozetkaBuffers.push(result.buffer);
        } else {
          rozetkaErrors.push(`ТТН ${chunk[0]}…${chunk[chunk.length - 1]} (${chunk.length} шт.): ${result.error}`);
        }
      }
      if (rozetkaBuffers.length === 1) {
        rozetkaBuffer = rozetkaBuffers[0];
      } else if (rozetkaBuffers.length > 1) {
        rozetkaBuffer = await mergePdfBuffers(rozetkaBuffers);
      }
      if (rozetkaErrors.length) rozetkaError = rozetkaErrors.join(' | ');
    }

    let promBuffer = null;
    let promError = '';
    if (promOrdersToFetch.length) {
      const promBuffers = [];
      const promErrors = [];
      let cookies = null;
      try {
        cookies = await getPromCookies();
      } catch (e) {
        promError = 'Не вдалося увійти на prom.ua: ' + e.message;
      }
      if (cookies) {
        for (const item of promOrdersToFetch) {
          try {
            let response = await fetchPromSticker(item.promOrderId, item.ttn, cookies);
            if (!response.ok || !isPdfResponse(response)) {
              cookies = await getPromCookies(true);
              response = await fetchPromSticker(item.promOrderId, item.ttn, cookies);
            }
            if (!response.ok || !isPdfResponse(response)) {
              promErrors.push(`${item.sdId} (ТТН ${item.ttn})`);
              continue;
            }
            promBuffers.push(await response.buffer());
          } catch (e) {
            promErrors.push(`${item.sdId} (ТТН ${item.ttn}: ${e.message})`);
          }
        }
      } else {
        promErrors.push(...promOrdersToFetch.map((item) => `${item.sdId} (ТТН ${item.ttn})`));
      }
      if (promBuffers.length === 1) {
        promBuffer = promBuffers[0];
      } else if (promBuffers.length > 1) {
        promBuffer = await mergePdfBuffers(promBuffers);
      }
      if (promErrors.length) {
        promError = (promError ? promError + ' | ' : '') + 'Не вдалося отримати етикетку через prom.ua для: ' + promErrors.join(', ');
      }
    }

    let pdfBase64 = '';
    const partsToMerge = [npBuffer, rozetkaBuffer, promBuffer].filter(Boolean);
    if (partsToMerge.length === 1) {
      pdfBase64 = partsToMerge[0].toString('base64');
    } else if (partsToMerge.length > 1) {
      const finalBuffer = await mergePdfBuffers(partsToMerge);
      pdfBase64 = finalBuffer.toString('base64');
    }

    const messages = [];
    if (manualCarrierOrders.length) {
      messages.push('Ці замовлення потрібно роздрукувати вручну в кабінеті перевізника: ' + manualCarrierOrders.join(', '));
    }
    if (rozetkaError) {
      messages.push(`ПОМИЛКА Rozetka Delivery: ` + rozetkaError);
    }
    if (promError) {
      messages.push(`ПОМИЛКА Rozetka Delivery (Prom.ua): ` + promError);
    }

    res.json({ pdfBase64, manualMessage: messages.join(' ') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при друку ТТН: ' + err.message });
  }
});

// ======================= ЗАВЕРШЕННЯ ЗАМОВЛЕНЬ =======================

router.post('/finish', async (req, res) => {
  try {
    if (!SD_FORM_API_KEY) return res.status(500).json({ error: 'Не встановлено SALESDRIVE_FORM_API_KEY на сервері.' });
    const { sdIds } = req.body;
    if (!Array.isArray(sdIds) || !sdIds.length) return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });

    for (const sdId of sdIds) {
      const response = await fetch(`${SD_DOMAIN}/api/order/update/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: SD_FORM_API_KEY, id: sdId, data: { statusId: DONE_STATUS } })
      });
      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({ error: `Не вдалося оновити статус у SalesDrive для замовлення ${sdId}: ${text.substring(0, 300)}` });
      }
    }

    await pool.query('DELETE FROM orders WHERE sd_id = ANY($1)', [sdIds]);
    res.json({ message: `Завершено та видалено замовлень: ${sdIds.length}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при завершенні: ' + err.message });
  }
});

// ======================= ОЧИЩЕННЯ СПИСКУ (БЕЗ ЗМІНИ СТАТУСУ В SALESDRIVE) =======================
// На відміну від "Завершити" — тут НЕ звертаємось до SalesDrive і НЕ міняємо там статус,
// просто прибираємо замовлення з нашого локального списку (наприклад, якщо його не можна
// надрукувати звідси і воно просто заважає в списку).

router.post('/clear', async (req, res) => {
  try {
    const { sdIds } = req.body;
    if (!Array.isArray(sdIds) || !sdIds.length) return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });

    const result = await pool.query('DELETE FROM orders WHERE sd_id = ANY($1)', [sdIds]);
    res.json({ message: `Прибрано зі списку: ${sdIds.length} замовлень (рядків видалено: ${result.rowCount}). Статус у SalesDrive НЕ змінювався.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при очищенні: ' + err.message });
  }
});

// ======================= СПИСОК ТОВАРІВ: НА ЯКІ ДРУКУВАТИ ГАРАНТІЮ =======================
// Позначається один раз на товар; якщо в замовленні є хоч один такий товар —
// для всього замовлення друкується повний "Гарантійний талон".

router.get('/products', async (req, res) => {
  try {
    // У цьому списку й для позначення "друкувати гарантію" ЗАВЖДИ використовуємо звичайну
    // назву товару (product_name), а НЕ "Назву для документів" — щоб список був однорідним.
    // "Назва для документів" (якщо є) використовується тільки в самому тексті талону/замовлення.
    const result = await pool.query(
      `SELECT DISTINCT product_name AS product_key
       FROM orders
       WHERE product_name <> ''
       ORDER BY product_key ASC`
    );
    const warrantyMap = await getProductWarrantyMap();
    const products = result.rows.map((r) => ({ key: r.product_key, isWarranty: !!warrantyMap[r.product_key] }));
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при завантаженні списку товарів.' });
  }
});

router.post('/products', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Некоректні дані.' });
    for (const item of items) {
      await pool.query(
        `INSERT INTO product_warranty (product_key, is_warranty, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (product_key) DO UPDATE SET is_warranty = EXCLUDED.is_warranty, updated_at = now()`,
        [item.key, !!item.isWarranty]
      );
    }
    res.json({ message: 'Збережено.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при збереженні списку товарів.' });
  }
});

// ======================= ГЕНЕРАЦІЯ ГАРАНТІЙНИХ ТАЛОНІВ / ЗАМОВЛЕНЬ (PDF) =======================
// sdIds — у ТОМУ Ж порядку, що й вибрані/відсортовані замовлення на екрані.
// Тип талону (гарантія чи замовлення) визначається АВТОМАТИЧНО за списком товарів вище.

router.post('/print-warranty', async (req, res) => {
  try {
    const { sdIds } = req.body;
    if (!Array.isArray(sdIds) || !sdIds.length) {
      return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });
    }

    const warrantyMap = await getProductWarrantyMap();

    const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false });
    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const donePromise = new Promise((resolve) => doc.on('end', resolve));

    for (const sdId of sdIds) {
      const result = await pool.query(
        'SELECT last_name, first_name, phone, ttn, product_name, doc_name, qty, price, created_at, comment FROM orders WHERE sd_id = $1 ORDER BY id ASC',
        [sdId]
      );
      if (!result.rows.length) continue;

      const first = result.rows[0];
      let totalQty = 0;
      const products = result.rows.map((r) => {
        const qty = Number(r.qty) || 0;
        totalQty += qty;
        // "key" — звичайна назва товару, саме нею позначено "друкувати гарантію" у списку товарів.
        // "name" — те, що друкується на бланку: "Назва для документів", якщо заповнена, інакше звичайна назва.
        return { key: r.product_name || '', name: r.doc_name || r.product_name || '', qty, price: Number(r.price) || 0 };
      });
      // Якщо серед товарів замовлення є хоч один, позначений у списку як "гарантійний" —
      // друкуємо повний гарантійний талон; інакше — сторінку "Замовлення".
      const isWarranty = products.some((p) => warrantyMap[p.key] === true);

      doc.addPage();
      const pageWidth = doc.page.width;
      const marginLeft = 40;
      const tableWidth = pageWidth - marginLeft * 2;

      // --- Верхній блок: дата, номер замовлення, ТТН, талон/замовлення №, клієнт ---
      doc.font('regular').fontSize(13);
      doc.text(`Дата: ${formatDateUA(first.created_at)}     ${sdId}`, marginLeft, 40);
      doc.font('bold').fontSize(14).text(`ТТН ${first.ttn || '—'}`, marginLeft, 60);
      doc.font('regular').fontSize(13).text(
        isWarranty ? `Гарантійний талон № ${randomDocNumber()}` : `Замовлення №  ${randomDocNumber()}`,
        marginLeft, 82
      );
      doc.text(`${first.last_name || ''} ${first.first_name || ''} ${first.phone || ''}`.trim(), marginLeft, 102);

      // --- Величезна цифра — загальна кількість товарів у замовленні (жирна, мінімум 3 см) ---
      doc.font('bold').fontSize(130);
      doc.text(String(totalQty), 0, 15, { width: pageWidth - 40, align: 'right' });

      // --- Таблиця товарів ---
      let y = 190;
      const colProduct = marginLeft;
      const colQty = pageWidth - 220;
      const colPrice = pageWidth - 160;
      const colSum = pageWidth - 90;
      const productColWidth = colQty - colProduct - 10;

      doc.font('bold').fontSize(11);
      doc.text('Товари', colProduct, y, { width: productColWidth });
      doc.text('К-ть', colQty, y, { width: 40 });
      doc.text('Ціна, грн', colPrice, y, { width: 60 });
      doc.text('Сума, грн', colSum, y, { width: 60 });
      y += 16;
      doc.moveTo(marginLeft, y).lineTo(pageWidth - marginLeft, y).stroke();
      y += 6;

      doc.font('regular').fontSize(11);
      for (const p of products) {
        const sum = p.qty * p.price;
        const nameHeight = doc.heightOfString(p.name, { width: productColWidth });
        doc.text(p.name, colProduct, y, { width: productColWidth });
        doc.text(String(p.qty), colQty, y, { width: 40 });
        doc.text(p.price.toFixed(2), colPrice, y, { width: 60 });
        doc.text(sum.toFixed(2), colSum, y, { width: 60 });
        y += Math.max(nameHeight, 14) + 6;
      }
      doc.moveTo(marginLeft, y).lineTo(pageWidth - marginLeft, y).stroke();
      y += 20;

      // --- Коментар до замовлення зі SalesDrive (якщо є) ---
      const orderComment = (first.comment || '').trim();
      if (orderComment) {
        doc.font('bold').fontSize(10).text('Коментар:', marginLeft, y, { width: tableWidth });
        y = doc.y + 2;
        doc.font('regular').fontSize(10).text(orderComment, marginLeft, y, { width: tableWidth });
        y = doc.y + 14;
      }

      if (isWarranty) {
        // Автопідбір розміру шрифту, щоб увесь гарантійний талон
        // гарантовано вмістився на залишок ЦІЄЇ сторінки (без переносу на другу).
        const availableHeight = doc.page.height - doc.page.margins.bottom - y;
        let scale = 1;
        let neededHeight = layoutWarrantyTalon(doc, marginLeft, y, tableWidth, scale, false);
        while (neededHeight > availableHeight && scale > 0.5) {
          scale = Math.round((scale - 0.05) * 100) / 100;
          neededHeight = layoutWarrantyTalon(doc, marginLeft, y, tableWidth, scale, false);
        }
        layoutWarrantyTalon(doc, marginLeft, y, tableWidth, scale, true);
      } else {
        try {
          doc.image(ORDER_FOOTER_IMAGE, marginLeft, y, { width: tableWidth });
        } catch (imgErr) {
          console.error('Помилка вставки зображення замовлення:', imgErr);
        }
      }
    }

    doc.end();
    await donePromise;
    const pdfBuffer = Buffer.concat(chunks);
    res.json({ pdfBase64: pdfBuffer.toString('base64') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при генерації талонів: ' + err.message });
  }
});

module.exports = router;
