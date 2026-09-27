const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { authMiddleware } = require('./auth');

const router = express.Router();

// ======================= ШРИФТИ ТА ТЕКСТИ ДЛЯ ГАРАНТІЙНИХ ТАЛОНІВ =======================

const FONT_REGULAR = path.join(__dirname, '..', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'DejaVuSans-Bold.ttf');
const ORDER_FOOTER_IMAGE = path.join(__dirname, '..', 'order_footer.png');

const WARRANTY_INTRO = 'Дякуємо, що обираєте наш магазин. У нас Ви можете придбати безліч товарів з підігрівом: Електропростирадла, електроковдри, електрогрілки різного розміру, устілки, шкарпетки з підігрівом, хімічні грілки (для ніг, рук та тіла), спальні мішки та одяг з підігрівом, і багато іншого. Щоб користуватись цим товаром із задоволенням, уважно прочитайте інструкцію.';
const WARRANTY_INTRO2 = 'Дотримуйтесь правил користування, і ця техніка служитиме вам довго та надійно.';

const WARRANTY_STEPS = [
  'Розташуйте електропростирадло на матрац нижче подушки, накрийте його звичайним простирадлом та ковдрою. Переконайтеся в тому, що електропростирадло розправлене по поверхні ліжка та під час застосування не буде згинатися та утворювати зморшки.',
  'Вставте штекер у розетку, та увімкніть на максимальний рівень температури. ВКАЗІВКА — ми наполегливо рекомендуємо увімкнути електропростирадло за 30 хвилин до сну і накрити його ковдрою, щоб уникнути втрати тепла.',
  'Лягаючи в ліжко, перемкніть перемикач в комфортний для Вас режим роботи.',
  'Після сну вимкніть електропростирадло і витягніть штекер з розетки.',
  'УВАГА! — Не вмикайте електропростирадло в складеному вигляді, не складайте електропростирадло в увімкненому стані в два чи більше разів, не використовуйте як ковдру або подушку, уникайте надмірного перегинання проводів усередині електропростирадла, уникайте проколів гострими предметами та попадання води.',
  'Заборонено використовувати людям зі зниженою чутливістю до тепла та особам, які потребують догляду, оскільки вони не можуть адекватно реагувати на перегрів.',
  'Електричне простирадло заборонено використовувати дітям до 3-х років.',
  'Заборонено самостійно використовувати дітям (3-8 років), за винятком випадків налаштування дорослими або навчання дитини безпечному використанню.',
  'Особам з кардіостимуляторами попередньо проконсультуйтесь зі своїм лікарем.',
  'Забороняється прати в пральній машині (окрім моделей з знімним перемикачем) та прасувати.',
  'Прилад має використовуватися тільки для нагрівання тіла на ліжках упродовж сну.',
  'Це електроприлад, тому не залишайте включений виріб без нагляду!'
];

const WARRANTY_NOTE = "Пам'ятайте, ЕЛЕКТРОПРОСТИРАДЛО це не батарея, воно випромінює ПОМІРНЕ тепло, щоб не створювати додаткове навантаження на серцево-судинну систему людини.";
const WARRANTY_SAFE = 'При правильному використанні воно абсолютно безпечне і нешкідливе!';
const WARRANTY_TERMS_INTRO = 'Гарантійний термін вказано в полі з назвою товару та діє з дати придбання. В умови гарантії не входять поломки внаслідок:';
const WARRANTY_TERMS_LIST = [
  'використання приладу з порушенням інструкції;',
  'використання в технічних умовах, які відрізняються від паспортних;',
  'короткого замикання або перепадів напруги;',
  'використання приладу не за призначенням або недбалого використання;',
  'спроб виправити, почистити або відремонтувати самостійно.'
];
const WARRANTY_REPAIR = "У випадку браку магазин зобов'язується замінити виріб протягом 14 днів. Товар приймається на ремонт лише в чистому вигляді!";
const WARRANTY_KEEP = 'ЗБЕРІГАЙТЕ ДАНИЙ ТАЛОН ВПРОДОВЖ ТЕРМІНУ ДІЇ ГАРАНТІЇ';
const WARRANTY_CONTACTS_INTRO = 'Якщо виникла проблема, зверніться за номерами телефонів:';
const WARRANTY_CONTACTS = 'Контакти: 0976802779, 0934217898, 0952481319';

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
          `INSERT INTO orders (sd_id, last_name, first_name, phone, product_name, doc_name, qty, price, ttn, carrier, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [mapped.sdId, mapped.lastName, mapped.firstName, mapped.phone, item.name, item.docName, item.qty, item.price, mapped.ttn, mapped.carrier, mapped.status]
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

function mapSalesDriveOrder(sdOrder) {
  let rawProducts = sdOrder.products || sdOrder.items || [];
  if (!Array.isArray(rawProducts) && typeof rawProducts === 'object') {
    rawProducts = Object.keys(rawProducts).map((k) => rawProducts[k]);
  }
  const products = rawProducts.map((p) => ({
    name: p.text || p.documentName || p.name || p.title || '',
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

    // SQL "WHERE sd_id = ANY(...)" НЕ гарантує порядок рядків — тому будуємо мапу
    // і потім проходимо по sdIds у ТОМУ порядку, в якому їх передав фронтенд
    // (тобто в порядку, як замовлення відсортовані/вибрані на екрані).
    const rowsBySdId = {};
    for (const row of result.rows) rowsBySdId[row.sd_id] = row;

    const ttns = [];
    const manualCarrierOrders = [];
    for (const sdId of sdIds) {
      const row = rowsBySdId[sdId];
      if (!row) continue;
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

// ======================= ГЕНЕРАЦІЯ ГАРАНТІЙНИХ ТАЛОНІВ / ЗАМОВЛЕНЬ (PDF) =======================
// items: [{ sdId, isWarranty }] — у ТОМУ Ж порядку, що й вибрані/відсортовані замовлення на екрані.
// isWarranty=true  -> повний "Гарантійний талон" з інструкцією
// isWarranty=false -> сторінка "Замовлення" з рекламним блоком магазину

router.post('/print-warranty', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Виберіть хоча б одне замовлення.' });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false });
    doc.registerFont('regular', FONT_REGULAR);
    doc.registerFont('bold', FONT_BOLD);

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const donePromise = new Promise((resolve) => doc.on('end', resolve));

    for (const item of items) {
      const sdId = item.sdId;
      const isWarranty = !!item.isWarranty;

      const result = await pool.query(
        'SELECT last_name, first_name, phone, ttn, product_name, doc_name, qty, price, created_at FROM orders WHERE sd_id = $1 ORDER BY id ASC',
        [sdId]
      );
      if (!result.rows.length) continue;

      const first = result.rows[0];
      let totalQty = 0;
      const products = result.rows.map((r) => {
        const qty = Number(r.qty) || 0;
        totalQty += qty;
        return { name: r.doc_name || r.product_name || '', qty, price: Number(r.price) || 0 };
      });

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

      if (isWarranty) {
        doc.font('bold').fontSize(15).text('Шановний покупець!', marginLeft, y, { width: tableWidth, align: 'center' });
        y = doc.y + 8;
        doc.font('regular').fontSize(9).text(WARRANTY_INTRO, marginLeft, y, { width: tableWidth });
        y = doc.y + 4;
        doc.text(WARRANTY_INTRO2, marginLeft, y, { width: tableWidth });
        y = doc.y + 8;

        doc.font('bold').fontSize(11).text('Інструкція з використання:', marginLeft, y, { width: tableWidth, align: 'center' });
        y = doc.y + 4;
        doc.font('regular').fontSize(9);
        WARRANTY_STEPS.forEach((step, idx) => {
          doc.text(`${idx + 1}. ${step}`, marginLeft, y, { width: tableWidth });
          y = doc.y + 3;
        });

        y += 2;
        doc.text(WARRANTY_NOTE, marginLeft, y, { width: tableWidth });
        y = doc.y + 6;
        doc.font('bold').fontSize(11).text(WARRANTY_SAFE, marginLeft, y, { width: tableWidth, align: 'center' });
        y = doc.y + 8;

        doc.font('bold').fontSize(12).text('Гарантійний талон', marginLeft, y, { width: tableWidth, align: 'center' });
        y = doc.y + 6;
        doc.font('regular').fontSize(9).text(WARRANTY_TERMS_INTRO, marginLeft, y, { width: tableWidth });
        y = doc.y + 3;
        WARRANTY_TERMS_LIST.forEach((line) => {
          doc.text(`•  ${line}`, marginLeft, y, { width: tableWidth });
          y = doc.y + 2;
        });
        y += 3;
        doc.text(WARRANTY_REPAIR, marginLeft, y, { width: tableWidth });
        y = doc.y + 8;

        doc.font('bold').fontSize(11).text(WARRANTY_KEEP, marginLeft, y, { width: tableWidth, align: 'center' });
        y = doc.y + 8;
        doc.font('regular').fontSize(9).text(WARRANTY_CONTACTS_INTRO, marginLeft, y, { width: tableWidth });
        y = doc.y + 5;
        doc.font('bold').fontSize(11).text(WARRANTY_CONTACTS, marginLeft, y, { width: tableWidth, align: 'center' });
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
