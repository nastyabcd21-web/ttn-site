const express = require('express');
const fetch = require('node-fetch');
const pool = require('../db/pool');
const { authMiddleware } = require('./auth');

const router = express.Router();

const SD_DOMAIN = process.env.SALESDRIVE_DOMAIN || 'https://ekvator.salesdrive.me';
const SD_FORM_API_KEY = process.env.SALESDRIVE_FORM_API_KEY;
const PULL_STATUS = process.env.SD_PULL_STATUS || '3';   // "На відправку"
const DONE_STATUS = process.env.SD_DONE_STATUS || '11';  // "Роздруковано"
const NOVAPOSHTA_API_KEY = process.env.NOVAPOSHTA_API_KEY;

const AUTO_PRINT_CARRIERS = ['novaposhta'];
const CARRIER_LABELS = { novaposhta: 'Нова пошта', ukrposhta: 'Укрпошта', rozetka_delivery: 'Rozetka Delivery', meest: 'Meest' };

router.use(authMiddleware);

// Технічна назва поля "Дроп" у SalesDrive — виявлена в коді, що створює замовлення.
// Імпортуємо тільки замовлення, де це поле ПУСТЕ.
const DROP_FIELD_NAME = 'dropsipping2';

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
    while (true) {
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
    for (const sdOrder of sdOrders) {
      // Пропускаємо замовлення, де поле "Дроп" НЕ пусте.
      if (!isDropFieldEmpty(sdOrder)) { skippedDrop++; continue; }

      const mapped = mapSalesDriveOrder(sdOrder);
      // Пропускаємо замовлення, які вже завантажені (щоб не дублювати при повторному імпорті)
      const existing = await pool.query('SELECT id FROM orders WHERE sd_id = $1 LIMIT 1', [mapped.sdId]);
      if (existing.rows.length) continue;

      for (const item of mapped.products) {
        await pool.query(
          `INSERT INTO orders (sd_id, last_name, first_name, product_name, qty, price, ttn, carrier, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [mapped.sdId, mapped.lastName, mapped.firstName, item.name, item.qty, item.price, mapped.ttn, mapped.carrier, mapped.status]
        );
        addedRows++;
      }
    }
    res.json({ message: `Завантажено замовлень зі SalesDrive: ${sdOrders.length} (сторінок: ${page}, пропущено через поле "Дроп": ${skippedDrop}, нових рядків товарів: ${addedRows}).` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера при імпорті: ' + err.message });
  }
});

function mapSalesDriveOrder(sdOrder) {
  let rawProducts = sdOrder.products || sdOrder.items || [];
  if (!Array.isArray(rawProducts) && typeof rawProducts === 'object') {
    rawProducts = Object.keys(rawProducts).map((k) => rawProducts[k]);
  }
  const products = rawProducts.map((p) => ({
    name: p.text || p.documentName || p.name || p.title || '',
    qty: p.amount || p.qty || 1,
    price: p.price || p.costPerItem || 0
  }));
  if (!products.length) products.push({ name: '', qty: 1, price: 0 });

  const contact = sdOrder.primaryContact || {};
  const phoneArr = contact.phone;
  const phone = Array.isArray(phoneArr) ? (phoneArr[0] || '') : (phoneArr || '');

  let deliveryData = sdOrder.ord_delivery_data;
  if (!Array.isArray(deliveryData)) deliveryData = [];
  const delivery = deliveryData[0] || {};
  const carrier = delivery.provider || sdOrder.shipping_method || '';
  const ttn = delivery.trackingNumber || sdOrder.ttn || '';

  return {
    sdId: String(sdOrder.id || sdOrder.orderId),
    lastName: contact.lName || '',
    firstName: contact.fName || '',
    phone,
    ttn,
    carrier,
    status: String(sdOrder.statusId || sdOrder.status || PULL_STATUS),
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
          ttn: row.ttn, carrier: row.carrier, carrierLabel: CARRIER_LABELS[row.carrier] || row.carrier || '—',
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

router.post('/print-ttn', async (req, res) => {
  try {
    if (!NOVAPOSHTA_API_KEY) return res.status(500).json({ error: 'Не встановлено NOVAPOSHTA_API_KEY на сервері.' });
    const { sdIds, format } = req.body;
    if (!Array.isArray(sdIds) || !sdIds.length) return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });

    const result = await pool.query(
      'SELECT DISTINCT ON (sd_id) sd_id, ttn, carrier FROM orders WHERE sd_id = ANY($1)',
      [sdIds]
    );

    const ttns = [];
    const manualCarrierOrders = [];
    for (const row of result.rows) {
      if (AUTO_PRINT_CARRIERS.indexOf(row.carrier) === -1) {
        manualCarrierOrders.push(`${row.sd_id} (${CARRIER_LABELS[row.carrier] || row.carrier || 'невідомий перевізник'})`);
      } else if (row.ttn) {
        ttns.push(String(row.ttn).trim());
      }
    }

    if (!ttns.length && !manualCarrierOrders.length) {
      return res.status(400).json({ error: 'У вибраних замовленнях немає номерів ТТН.' });
    }

    let pdfBase64 = '';
    if (ttns.length) {
      const npMethod = NP_PRINT_METHODS[format] || NP_PRINT_METHODS.invoice;
      const fetchUrl = format === 'label100'
        ? `https://my.novaposhta.ua/orders/printMarking100x100/orders/${ttns.join(',')}/type/pdf/zebra/zebra/apiKey/${NOVAPOSHTA_API_KEY}`
        : `https://my.novaposhta.ua/orders/${npMethod}/orders/${ttns.join(',')}/type/pdf/apiKey/${NOVAPOSHTA_API_KEY}`;

      const npResponse = await fetch(fetchUrl);
      if (!npResponse.ok) {
        const text = await npResponse.text();
        return res.status(502).json({ error: 'Помилка Нової пошти при друку ТТН: ' + text.substring(0, 300) });
      }
      const buffer = await npResponse.buffer();
      pdfBase64 = buffer.toString('base64');
    }

    res.json({
      pdfBase64,
      manualMessage: manualCarrierOrders.length
        ? 'Ці замовлення потрібно роздрукувати вручну в кабінеті перевізника: ' + manualCarrierOrders.join(', ')
        : ''
    });
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

module.exports = router;
