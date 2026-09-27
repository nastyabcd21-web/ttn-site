let token = sessionStorage.getItem('sd_token') || null;
let userName = sessionStorage.getItem('sd_name') || null;
let orders = [];

const STATUS_LABELS = { '3': 'На відправку', '11': 'Роздруковано' };

if (token) showApp();

function toggleAuthMode() {
  const showRegister = document.getElementById('registerForm').style.display === 'none';
  document.getElementById('registerForm').style.display = showRegister ? 'block' : 'none';
  document.getElementById('loginForm').style.display = showRegister ? 'none' : 'block';
  document.getElementById('authTitle').textContent = showRegister ? 'SalesDrive — реєстрація' : 'SalesDrive — вхід';
}

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Помилка сервера.');
  return data;
}

function onAuthSuccess(res) {
  token = res.token; userName = res.name;
  sessionStorage.setItem('sd_token', token);
  sessionStorage.setItem('sd_name', userName);
  showApp();
}

async function doLogin() {
  document.getElementById('loginError').textContent = '';
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        login: document.getElementById('loginInput').value,
        password: document.getElementById('passwordInput').value
      })
    });
    onAuthSuccess(res);
  } catch (err) {
    document.getElementById('loginError').textContent = err.message;
  }
}

async function doRegister() {
  document.getElementById('registerError').textContent = '';
  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        login: document.getElementById('regLoginInput').value,
        password: document.getElementById('regPasswordInput').value,
        displayName: document.getElementById('regNameInput').value
      })
    });
    onAuthSuccess(res);
  } catch (err) {
    document.getElementById('registerError').textContent = err.message;
  }
}

function doLogout() {
  sessionStorage.clear();
  location.reload();
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('userLabel').textContent = userName;
  loadOrders();
}

async function loadOrders() {
  try {
    orders = await api('/orders');
    renderOrders();
  } catch (err) {
    if (err.message.includes('Сесія')) { doLogout(); return; }
    alert('Помилка завантаження: ' + err.message);
  }
}

async function importOrders() {
  const btn = document.getElementById('importBtn');
  btn.disabled = true; btn.textContent = 'Завантаження…';
  try {
    const res = await api('/orders/import', { method: 'POST' });
    alert(res.message);
    await loadOrders();
  } catch (err) {
    alert('Помилка: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '⬇️ Завантажити зі SalesDrive';
  }
}

function sortedOrders() {
  const sortBy = document.getElementById('sortBy').value;
  const filterText = document.getElementById('filterText').value.trim().toLowerCase();
  const filterCarrier = document.getElementById('filterCarrier').value;

  let list = orders.slice();
  if (filterCarrier) list = list.filter((o) => (o.carrierKey || o.carrier) === filterCarrier);
  if (filterText) {
    list = list.filter((o) => {
      const clientStr = ((o.lastName || '') + ' ' + (o.firstName || '')).toLowerCase();
      const productsStr = o.products.map((p) => p.name).join(', ').toLowerCase();
      const ttnStr = String(o.ttn || '').toLowerCase();
      return clientStr.indexOf(filterText) !== -1 || productsStr.indexOf(filterText) !== -1 || ttnStr.indexOf(filterText) !== -1;
    });
  }

  if (sortBy === 'product') {
    list.sort((a, b) => ((a.products[0] && a.products[0].name) || '').localeCompare((b.products[0] && b.products[0].name) || '', 'uk'));
  } else if (sortBy === 'client') {
    list.sort((a, b) => ((a.lastName || '') + ' ' + (a.firstName || '')).trim().localeCompare(((b.lastName || '') + ' ' + (b.firstName || '')).trim(), 'uk'));
  } else if (sortBy === 'sum') {
    list.sort((a, b) => (b.sum || 0) - (a.sum || 0));
  }
  return list;
}

function toggleSelectAll() {
  const checked = document.getElementById('selectAllCheckbox').checked;
  document.querySelectorAll('.order-check').forEach((el) => { el.checked = checked; });
}

function renderOrders() {
  const body = document.getElementById('ordersBody');
  body.innerHTML = '';
  const list = sortedOrders();
  document.getElementById('emptyHint').style.display = list.length ? 'none' : 'block';
  document.getElementById('selectAllCheckbox').checked = false;

  list.forEach((o) => {
    const tr = document.createElement('tr');
    const productsStr = o.products.map((p) => p.name + ' ×' + p.qty).join(', ');
    const statusLabel = STATUS_LABELS[String(o.status)] || (o.status || '');

    let html = '<td class="checkbox-cell"><input type="checkbox" class="order-check" data-id="' + o.sdId + '"></td>';
    html += '<td>' + (o.lastName || '') + ' ' + (o.firstName || '') + '</td>';
    html += '<td>' + productsStr + '</td>';
    html += '<td>' + o.sum + '</td>';
    html += '<td>' + (o.ttn || '—') + '</td>';
    html += '<td>' + (o.carrierLabel || '—') + '</td>';
    html += '<td>' + statusLabel + '</td>';
    tr.innerHTML = html;
    body.appendChild(tr);
  });
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.order-check:checked')).map((el) => el.dataset.id);
}

async function printSelectedTtn() {
  const ids = getSelectedIds();
  if (!ids.length) { alert('Виберіть хоча б одне замовлення.'); return; }
  const format = document.getElementById('printFormat').value;
  const btn = document.getElementById('printTtnBtn');
  btn.disabled = true; btn.textContent = 'Готуємо PDF…';
  try {
    const res = await api('/orders/print-ttn', { method: 'POST', body: JSON.stringify({ sdIds: ids, format }) });
    if (res.pdfBase64) {
      const byteChars = atob(res.pdfBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
    if (res.manualMessage) alert(res.manualMessage);
  } catch (err) {
    alert('Помилка: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '🖨️ Друкувати ТТН (вибрані)';
  }
}

async function printWarranty() {
  const ids = getSelectedIds(); // у тому ж порядку, що й на екрані/у ТТН
  if (!ids.length) { alert('Виберіть хоча б одне замовлення.'); return; }
  const btn = document.getElementById('printWarrantyBtn');
  btn.disabled = true; btn.textContent = 'Готуємо PDF…';
  try {
    const res = await api('/orders/print-warranty', { method: 'POST', body: JSON.stringify({ sdIds: ids }) });
    if (res.pdfBase64) {
      const byteChars = atob(res.pdfBase64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  } catch (err) {
    alert('Помилка: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '🎫 Друкувати талони (вибрані)';
  }
}

async function openWarrantyModal() {
  document.getElementById('warrantyModalOverlay').classList.add('active');
  const listEl = document.getElementById('warrantyProductList');
  listEl.textContent = 'Завантаження…';
  try {
    const res = await api('/orders/products');
    const products = res.products || [];
    if (!products.length) {
      listEl.innerHTML = '<p style="color:#888;">Товарів поки немає — спочатку завантажте замовлення.</p>';
      return;
    }
    listEl.innerHTML = products.map((p, idx) => (
      '<label class="product-row-item">' +
        '<input type="checkbox" class="product-warranty-check" data-key="' + idx + '" ' + (p.isWarranty ? 'checked' : '') + '>' +
        '<span>' + p.key + '</span>' +
      '</label>'
    )).join('');
    listEl.dataset.productsJson = JSON.stringify(products.map((p) => p.key));
  } catch (err) {
    listEl.innerHTML = '<p style="color:#c00;">Помилка завантаження: ' + err.message + '</p>';
  }
}

function closeWarrantyModal() {
  document.getElementById('warrantyModalOverlay').classList.remove('active');
}

async function saveWarrantyProducts() {
  const listEl = document.getElementById('warrantyProductList');
  let keys = [];
  try { keys = JSON.parse(listEl.dataset.productsJson || '[]'); } catch (e) { keys = []; }
  const items = Array.from(document.querySelectorAll('.product-warranty-check')).map((cb) => ({
    key: keys[Number(cb.dataset.key)],
    isWarranty: cb.checked
  }));
  try {
    await api('/orders/products', { method: 'POST', body: JSON.stringify({ items }) });
    closeWarrantyModal();
  } catch (err) {
    alert('Помилка збереження: ' + err.message);
  }
}

async function finishSelected() {
  const ids = getSelectedIds();
  if (!ids.length) { alert('Виберіть хоча б одне замовлення.'); return; }
  if (!confirm('Надіслати статус у SalesDrive і видалити ' + ids.length + ' замовлень із цього списку?')) return;
  try {
    const res = await api('/orders/finish', { method: 'POST', body: JSON.stringify({ sdIds: ids }) });
    alert(res.message);
    await loadOrders();
  } catch (err) {
    alert('Помилка: ' + err.message);
  }
}
