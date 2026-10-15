const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Kolkata';
function todayISO() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dateAfter(days) { const date = new Date(`${todayISO()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

const seed = {
  invoices: [
    { id: 'inv-1', client: 'Orbit Studio', code: 'INV-2048', amount: 4850, due: '2026-10-19', status: 'due' },
    { id: 'inv-2', client: 'Morrow & Co.', code: 'INV-2047', amount: 2200, due: '2026-10-14', status: 'overdue' },
    { id: 'inv-3', client: 'Fieldwork Labs', code: 'INV-2046', amount: 7600, due: '2026-10-11', status: 'paid', paidAt: '2026-10-11' },
    { id: 'inv-4', client: 'Common Ground', code: 'INV-2045', amount: 1350, due: '2026-10-22', status: 'due' },
    { id: 'inv-5', client: 'Atelier West', code: 'INV-2044', amount: 4500, due: '2026-10-08', status: 'paid', paidAt: '2026-10-08' },
    { id: 'inv-6', client: 'Sunday Supply', code: 'INV-2043', amount: 6320, due: '2026-10-04', status: 'paid', paidAt: '2026-10-04' }
  ],
  expenses: [
    { id: 'exp-1', vendor: 'Workshop lease', category: 'Workspace', amount: 4900, date: '2026-10-02', note: 'October studio rent' },
    { id: 'exp-2', vendor: 'Clay & Co.', category: 'Materials', amount: 3120, date: '2026-10-07', note: 'Production materials' },
    { id: 'exp-3', vendor: 'Team payroll', category: 'People', amount: 4200, date: '2026-10-10', note: 'Weekly payroll' },
    { id: 'exp-4', vendor: 'Cloud tools', category: 'Software', amount: 460, date: '2026-10-13', note: 'Monthly subscriptions' }
  ],
  tasks: [
    { id: 'task-1', title: 'Send revised proposal', owner: 'Maya Chen', initials: 'MC', due: 'Today', priority: 'High', done: false },
    { id: 'task-2', title: 'Restock ceramic planters', owner: 'Alex Rivera', initials: 'AR', due: 'Today', priority: 'Medium', done: false },
    { id: 'task-3', title: 'Reconcile September expenses', owner: 'You', initials: 'YO', due: 'Tomorrow', priority: 'Low', done: false },
    { id: 'task-4', title: 'Approve print proofs', owner: 'Maya Chen', initials: 'MC', due: 'Oct 18', priority: 'Medium', done: true }
  ],
  inventory: [
    { id: 'stock-1', name: 'Studio planter · Sand', sku: 'PLT-042', quantity: 8, threshold: 12, cost: 18 },
    { id: 'stock-2', name: 'Linen notebook · Moss', sku: 'PPR-018', quantity: 24, threshold: 10, cost: 6 },
    { id: 'stock-3', name: 'Pour-over set · Cloud', sku: 'KIT-006', quantity: 3, threshold: 8, cost: 42 },
    { id: 'stock-4', name: 'Cotton tote · Ink', sku: 'BAG-025', quantity: 42, threshold: 15, cost: 9 }
  ],
  activity: [
    { id: 'act-1', text: 'Orbit Studio invoice sent', time: '12 min ago', icon: '↗' },
    { id: 'act-2', text: 'Maya completed “Update brand deck”', time: '1 hr ago', icon: '✓' },
    { id: 'act-3', text: 'Low stock detected: Pour-over set', time: '3 hrs ago', icon: '!' }
  ]
};

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2)); return structuredClone(seed); }
}
let data = loadData();
if (!Array.isArray(data.expenses)) data.expenses = structuredClone(seed.expenses);
if (!Array.isArray(data.inventory)) data.inventory = [];
if (!Array.isArray(data.activity)) data.activity = [];
for (const invoice of seed.invoices) if (!data.invoices.some(saved => saved.id === invoice.id)) data.invoices.push(structuredClone(invoice));
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 1e6) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}
function getSummary() {
  const today = todayISO();
  for (const invoice of data.invoices) if (invoice.status !== 'paid' && invoice.due < today) invoice.status = 'overdue';
  const open = data.invoices.filter(x => x.status !== 'paid');
  const overdue = open.filter(x => x.status === 'overdue');
  const lowStock = data.inventory.filter(x => x.quantity <= x.threshold);
  const month = today.slice(0, 7);
  const cashIn = data.invoices.filter(x => x.status === 'paid' && String(x.paidAt || x.due).startsWith(month)).reduce((sum, x) => sum + x.amount, 0);
  const cashOut = data.expenses.filter(x => String(x.date).startsWith(month)).reduce((sum, x) => sum + x.amount, 0);
  const weeklyBurn = cashOut / Math.max(1, (new Date().getDate() / 7));
  const days = Number(today.slice(8, 10));
  const cashFlow = Array.from({ length: days }, (_, i) => ({ day: i + 1, incoming: 0, outgoing: 0 }));
  for (const invoice of data.invoices) { const date = String(invoice.paidAt || invoice.due); if (invoice.status === 'paid' && date.startsWith(month)) { const index = Number(date.slice(8, 10)) - 1; if (cashFlow[index]) cashFlow[index].incoming += invoice.amount; } }
  for (const expense of data.expenses) { const date = String(expense.date); if (date.startsWith(month)) { const index = Number(date.slice(8, 10)) - 1; if (cashFlow[index]) cashFlow[index].outgoing += expense.amount; } }
  return {
    outstanding: open.reduce((sum, x) => sum + x.amount, 0),
    overdueAmount: overdue.reduce((sum, x) => sum + x.amount, 0),
    overdueCount: overdue.length,
    tasksOpen: data.tasks.filter(x => !x.done).length,
    lowStock: lowStock.length,
    lowStockItems: lowStock.map(x => x.name),
    cashIn,
    cashOut,
    netCash: cashIn - cashOut,
    runwayWeeks: weeklyBurn ? Math.max(0, Math.round((Math.max(cashIn - cashOut, 0) / weeklyBurn) * 10) / 10) : 0,
    cashFlow,
    pulseScore: Math.max(0, Math.min(100, Math.round(75 + (cashOut ? cashIn / cashOut * 10 : 10) - overdue.length * 4 - lowStock.length * 3)))
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  try {
    if (req.method === 'GET' && !route.startsWith('/api/')) {
      const requested = route === '/' ? 'index.html' : decodeURIComponent(route.slice(1));
      const file = path.resolve(PUBLIC, requested);
      if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html')) return send(res, 403, { error: 'Forbidden.' });
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (route === '/api/health') return send(res, 200, { ok: true });
    if (route === '/api/dashboard' && req.method === 'GET') { const summary = getSummary(); save(); return send(res, 200, { summary, invoices: data.invoices, expenses: data.expenses, tasks: data.tasks, inventory: data.inventory, activity: data.activity }); }
    if (route === '/api/expenses' && req.method === 'POST') {
      const body = await readBody(req); const amount = Number(body.amount);
      if (!body.vendor || !Number.isFinite(amount) || amount <= 0 || !body.category) return send(res, 400, { error: 'Add a vendor, category, and positive amount.' });
      const expense = { id: randomUUID(), vendor: String(body.vendor).trim().slice(0, 80), category: String(body.category).slice(0, 40), amount: Math.round(amount * 100) / 100, date: body.date || todayISO(), note: String(body.note || '').slice(0, 160) };
      data.expenses.unshift(expense); data.activity.unshift({ id: randomUUID(), text: `${expense.category} expense recorded · ${expense.vendor}`, time: 'Just now', icon: '↘' }); save(); return send(res, 201, expense);
    }
    const expenseMatch = route.match(/^\/api\/expenses\/([^/]+)$/);
    if (expenseMatch && req.method === 'DELETE') {
      const index = data.expenses.findIndex(x => x.id === expenseMatch[1]); if (index < 0) return send(res, 404, { error: 'Expense not found.' });
      const [expense] = data.expenses.splice(index, 1); data.activity.unshift({ id: randomUUID(), text: `${expense.category} expense removed · ${expense.vendor}`, time: 'Just now', icon: '×' }); save(); return send(res, 200, { deleted: expense.id });
    }
    if (route === '/api/inventory' && req.method === 'POST') {
      const body = await readBody(req); const quantity = Number(body.quantity); const threshold = Number(body.threshold ?? 5);
      if (!body.name || !body.sku || !Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(threshold) || threshold < 0) return send(res, 400, { error: 'Add a product, SKU, and non-negative whole-number stock levels.' });
      if (data.inventory.some(x => x.sku.toLowerCase() === String(body.sku).trim().toLowerCase())) return send(res, 409, { error: 'That SKU is already in inventory.' });
      const item = { id: randomUUID(), name: String(body.name).trim().slice(0, 80), sku: String(body.sku).trim().slice(0, 32), quantity, threshold, cost: Math.max(0, Number(body.cost) || 0) };
      data.inventory.unshift(item); data.activity.unshift({ id: randomUUID(), text: `${item.name} added to inventory`, time: 'Just now', icon: '＋' }); save(); return send(res, 201, item);
    }
    const stockMatch = route.match(/^\/api\/inventory\/([^/]+)$/);
    if (stockMatch && req.method === 'PATCH') {
      const item = data.inventory.find(x => x.id === stockMatch[1]); if (!item) return send(res, 404, { error: 'Product not found.' });
      const body = await readBody(req); const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) return send(res, 400, { error: 'Stock must be a non-negative whole number.' });
      item.quantity = quantity; data.activity.unshift({ id: randomUUID(), text: `${item.name} stock updated to ${quantity}`, time: 'Just now', icon: '⬡' }); save(); return send(res, 200, item);
    }
    if (stockMatch && req.method === 'DELETE') {
      const index = data.inventory.findIndex(x => x.id === stockMatch[1]); if (index < 0) return send(res, 404, { error: 'Product not found.' });
      const [item] = data.inventory.splice(index, 1); save(); return send(res, 200, { deleted: item.id });
    }
    if (route === '/api/invoices' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.client || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return send(res, 400, { error: 'Add a client and a positive amount.' });
      const invoice = { id: randomUUID(), client: String(body.client).trim().slice(0, 80), code: `INV-${Date.now().toString().slice(-6)}`, amount: Math.round(Number(body.amount) * 100) / 100, due: body.due || dateAfter(7), status: 'due' };
      data.invoices.unshift(invoice); data.activity.unshift({ id: randomUUID(), text: `${invoice.code} created for ${invoice.client}`, time: 'Just now', icon: '↗' }); save(); return send(res, 201, invoice);
    }
    const invoiceMatch = route.match(/^\/api\/invoices\/([^/]+)$/);
    if (invoiceMatch && req.method === 'PATCH') {
      const invoice = data.invoices.find(x => x.id === invoiceMatch[1]); if (!invoice) return send(res, 404, { error: 'Invoice not found.' });
      const body = await readBody(req); if (!['paid', 'due'].includes(body.status)) return send(res, 400, { error: 'Choose due or paid.' });
      invoice.status = body.status; if (body.status === 'paid') invoice.paidAt = todayISO(); else delete invoice.paidAt;
      data.activity.unshift({ id: randomUUID(), text: `${invoice.code} marked as ${body.status}`, time: 'Just now', icon: body.status === 'paid' ? '✓' : '↗' }); save(); return send(res, 200, invoice);
    }
    if (route === '/api/tasks' && req.method === 'POST') {
      const body = await readBody(req); if (!body.title || !String(body.title).trim()) return send(res, 400, { error: 'Add a task title.' });
      const task = { id: randomUUID(), title: String(body.title).trim().slice(0, 100), owner: 'You', initials: 'YO', due: 'Today', priority: 'Medium', done: false };
      data.tasks.unshift(task); data.activity.unshift({ id: randomUUID(), text: `New task: ${task.title}`, time: 'Just now', icon: '＋' }); save(); return send(res, 201, task);
    }
    const taskMatch = route.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'PATCH') {
      const task = data.tasks.find(x => x.id === taskMatch[1]); if (!task) return send(res, 404, { error: 'Task not found.' });
      const body = await readBody(req); if (typeof body.done !== 'boolean') return send(res, 400, { error: 'A done value is required.' });
      task.done = body.done; save(); return send(res, 200, task);
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (err) { return send(res, 500, { error: err.message || 'Server error.' }); }
});

server.on('clientError', (_err, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(PORT, HOST, () => console.log(`Northstar Business Hub running at http://localhost:${PORT}`));
