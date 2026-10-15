const $ = (selector, root = document) => root.querySelector(selector);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let dashboard;
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}
function notify(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function initials(name) { return name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function renderInvoices(invoices) {
  const rows = $('#invoiceRows');
  const colors = ['','purple','amber','blue'];
  rows.innerHTML = invoices.map((invoice, i) => `<tr><td><div class="client-cell"><span class="client-avatar ${colors[i % colors.length]}">${escapeHTML(initials(invoice.client))}</span>${escapeHTML(invoice.client)}</div></td><td>${money(invoice.amount)}</td><td>${new Date(`${invoice.due}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td><td><span class="status-pill status-${escapeHTML(invoice.status)}">${invoice.status[0].toUpperCase()+invoice.status.slice(1)}</span></td><td>${invoice.status === 'paid' ? '' : `<button class="row-action mark-paid" data-id="${escapeHTML(invoice.id)}" title="Mark as paid" aria-label="Mark ${escapeHTML(invoice.code)} as paid">✓</button>`}</td></tr>`).join('') || '<tr><td colspan="5">No invoices yet. Create your first one above.</td></tr>';
  $('#invoiceTotal').textContent = invoices.length;
  rows.querySelectorAll('.mark-paid').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/api/invoices/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) }); await refresh(); notify('Invoice marked as paid. Nice.'); }
    catch (error) { notify(error.message); }
  }));
}
function renderTasks(tasks) {
  const open = tasks.filter(task => !task.done);
  $('#taskTotal').textContent = open.length;
  $('#taskList').innerHTML = tasks.map(task => `<div class="task-row ${task.done ? 'done' : ''}"><input class="check-task" type="checkbox" ${task.done ? 'checked' : ''} data-id="${escapeHTML(task.id)}" aria-label="Mark ${escapeHTML(task.title)} ${task.done ? 'incomplete' : 'complete'}"><span class="task-title">${escapeHTML(task.title)}</span><span class="task-due ${task.due === 'Today' ? 'today' : ''}">${escapeHTML(task.due)}</span><span class="mini-avatar" title="${escapeHTML(task.owner)}">${escapeHTML(task.initials)}</span></div>`).join('') || '<p class="empty-state">Nothing on your list. Add a task when you’re ready.</p>';
  $('#taskList').querySelectorAll('.check-task').forEach(box => box.addEventListener('change', async () => {
    try { await api(`/api/tasks/${encodeURIComponent(box.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ done: box.checked }) }); await refresh(); notify(box.checked ? 'Task complete. Keep that momentum.' : 'Task added back to your focus.'); }
    catch (error) { notify(error.message); }
  }));
}
function renderStock(items) {
  const low = items.filter(item => item.quantity <= item.threshold);
  $('#stockTotal').textContent = low.length;
  $('#stockList').innerHTML = items.map(item => {
    const isLow = item.quantity <= item.threshold;
    const pct = Math.min(100, Math.round(item.quantity / (item.threshold * 2) * 100));
    return `<div class="stock-row"><div><div class="stock-name">${escapeHTML(item.name)}</div><div class="stock-sku">${escapeHTML(item.sku)}</div></div><div class="stock-qty ${isLow ? '' : 'ok'}">${item.quantity} ${isLow ? 'left' : 'units'} <button class="stock-adjust" data-id="${escapeHTML(item.id)}" title="Adjust stock">↕</button></div><div class="stock-bar"><span class="${isLow ? '' : 'ok-bar'}" style="width:${pct}%"></span></div></div>`;
  }).join('');
}
function renderActivity(items) {
  $('#activityList').innerHTML = items.slice(0, 8).map(item => `<div class="activity-row"><span class="activity-icon ${item.icon === '!' ? 'warn' : ''}">${escapeHTML(item.icon)}</span><span class="activity-text">${escapeHTML(item.text)}</span><span class="activity-time">${escapeHTML(item.time)}</span></div>`).join('');
}
function renderExpenses(expenses) {
  const rows = $('#expenseRows'); if (!rows) return;
  rows.innerHTML = expenses.length ? expenses.map(expense => `<div class="expense-row"><div class="expense-identity"><strong>${escapeHTML(expense.vendor)}</strong><span>${escapeHTML(expense.category)} · ${escapeHTML(expense.date)}</span></div><strong class="expense-amount">${money(expense.amount)}</strong><button class="row-action expense-delete" data-id="${escapeHTML(expense.id)}" aria-label="Remove ${escapeHTML(expense.vendor)} expense" title="Remove expense">×</button></div>`).join('') : '<p class="search-hint">No expenses recorded yet.</p>';
  rows.querySelectorAll('.expense-delete').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Remove this expense from your records?')) return;
    try { await api(`/api/expenses/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' }); await refresh(); notify('Expense removed and cash flow recalculated.'); } catch (error) { notify(error.message); }
  }));
}
function renderCashFlow(series) {
  const svg = $('.cash-chart'); if (!svg || !series?.length) return;
  const max = Math.max(2000, ...series.flatMap(day => [day.incoming, day.outgoing])) * 1.12;
  const yLabels = $('.chart-y'); if (yLabels) yLabels.innerHTML = [1, .75, .5, .25, 0].map(scale => `<span>${scale ? `$${Math.max(1, Math.round(max * scale / 1000))}k` : '$0'}</span>`).join('');
  const coords = key => series.map((day, index) => `${(index / Math.max(1, series.length - 1)) * 700},${196 - (day[key] / max) * 180}`);
  const inPoints = coords('incoming'); const outPoints = coords('outgoing');
  const makeArea = points => `M${points[0]} L${points.slice(1).join(' L')} L700,210 L0,210 Z`;
  svg.querySelector('.line-in').setAttribute('d', `M${inPoints.join(' L')}`);
  svg.querySelector('.line-out').setAttribute('d', `M${outPoints.join(' L')}`);
  svg.querySelector('.area-in').setAttribute('d', makeArea(inPoints));
  svg.querySelector('.area-out').setAttribute('d', makeArea(outPoints));
  const peakIndex = series.reduce((best, day, index) => day.incoming > series[best].incoming ? index : best, 0);
  const peakPoint = inPoints[peakIndex].split(','); const dot = svg.querySelector('.chart-dot');
  dot.setAttribute('cx', peakPoint[0]); dot.setAttribute('cy', peakPoint[1]);
  const ticks = $('.chart-x');
  if (ticks) { const month = new Date().toLocaleString('en-US', { month: 'short' }); ticks.innerHTML = [1, Math.ceil(series.length * .25), Math.ceil(series.length * .5), Math.ceil(series.length * .75), series.length].map(day => `<span>${month} ${day}</span>`).join(''); }
}
function render(data) {
  dashboard = data;
  const s = data.summary;
  $('#cashIn').textContent = money(s.cashIn); $('#cashOut').textContent = money(s.cashOut);
  $('#outstanding').textContent = money(s.outstanding); $('#netCash').textContent = `+${money(s.netCash)}`;
  const cashNet = $('#cashNetInline'); if (cashNet) cashNet.textContent = `${s.netCash < 0 ? '−' : ''}${money(Math.abs(s.netCash))}`;
  const cashTrend = $('#cashTrend'); if (cashTrend) { cashTrend.textContent = s.netCash < 0 ? '↓ expenses exceed income' : '↗ from recorded activity'; cashTrend.className = `trend ${s.netCash < 0 ? 'warning' : 'positive'}`; }
  const runwayLabel = document.querySelector('#metrics .metric-card:nth-child(4) .metric-bottom span:nth-child(2)');
  if (runwayLabel) runwayLabel.textContent = `${s.runwayWeeks} weeks runway`;
  renderCashFlow(s.cashFlow);
  $('#overdueCount').textContent = `${s.overdueCount} invoice${s.overdueCount === 1 ? '' : 's'}`;
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });
  $('#metrics .metric-card:nth-child(1) .metric-top span:first-child').textContent = `Cash in · ${currentMonth}`;
  $('#metrics .metric-card:nth-child(2) .metric-top span:first-child').textContent = `Cash out · ${currentMonth}`;
  $('#metrics .metric-card:nth-child(3) .metric-bottom .trend').textContent = `${money(s.overdueAmount)} overdue`;
  $('#metrics .metric-card:nth-child(1) .metric-bottom .trend').textContent = 'Recorded invoices';
  $('#metrics .metric-card:nth-child(2) .metric-bottom .trend').textContent = 'Recorded expenses';
  const netTrend = $('#metrics .metric-card:nth-child(4) .metric-bottom .trend'); if (netTrend) { netTrend.textContent = s.netCash >= 0 ? 'Positive' : 'Negative'; netTrend.className = `trend ${s.netCash >= 0 ? 'positive' : 'warning'}`; }
  renderInvoices(data.invoices); renderExpenses(data.expenses || []); renderTasks(data.tasks); renderStock(data.inventory); renderActivity(data.activity);
  const score = s.pulseScore ?? 0; const scoreLabel = $('.pulse-ring strong'); if (scoreLabel) scoreLabel.textContent = score;
  const ring = $('.ring-value'); if (ring) ring.style.strokeDashoffset = String(302 - 3.02 * score);
  const pulseCaption = $('.pulse-caption strong'); if (pulseCaption) pulseCaption.textContent = score >= 75 ? 'Looking steady' : score >= 50 ? 'A few things need attention' : 'Time to focus on cash';
  const pulseDelta = $('.pulse-caption span'); if (pulseDelta) pulseDelta.textContent = 'Based on live workspace records';
  const pulseFactors = $('.pulse-factors');
  if (pulseFactors) {
    const factors = pulseFactors.querySelectorAll('div');
    factors[0].querySelector('strong').textContent = s.netCash > 0 ? 'Positive' : 'Under pressure';
    factors[1].querySelector('strong').textContent = s.overdueCount ? `${s.overdueCount} overdue` : 'On track';
    factors[2].querySelector('strong').textContent = s.tasksOpen <= 4 ? 'On track' : `${s.tasksOpen} open`;
  }
  if (s.overdueCount) {
    $('#signalText').textContent = `${money(s.overdueAmount)} is ready for a follow-up.`;
    $('#signalDetail').textContent = `${s.overdueCount} overdue invoice${s.overdueCount === 1 ? '' : 's'} could bring cash back into your week. Start with a friendly reminder.`;
  } else if (s.lowStock) {
    $('#signalText').textContent = 'Your shelves could use a little attention.';
    $('#signalDetail').textContent = `${s.lowStockItems.join(' and ')} ${s.lowStock === 1 ? 'is' : 'are'} below your restock threshold.`;
    $('#signalAction').textContent = 'Review stock  ↗'; $('#signalAction').onclick = () => location.hash = 'inventory';
  } else {
    $('#signalText').textContent = 'You’re clear to focus on the next big thing.';
    $('#signalDetail').textContent = 'Your payments and stock are in a good place. Keep the momentum going.';
  }
}
async function refresh() {
  try { render(await api('/api/dashboard')); }
  catch { notify('Can’t reach the workspace server. Start it with npm start.'); }
}
const info = (title, text) => { $('#infoTitle').textContent = title; $('#infoText').textContent = text; $('#infoModal').showModal(); };
function setup() {
  refresh();
  $('#createInvoiceBtn').addEventListener('click', () => $('#invoiceModal').showModal());
  $('#addTaskBtn').addEventListener('click', () => $('#taskModal').showModal());
  $('#invoiceForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api('/api/invoices', { method: 'POST', body: JSON.stringify({ client: form.get('client'), amount: form.get('amount'), due: form.get('due') }) }); event.currentTarget.reset(); $('#invoiceModal').close(); await refresh(); notify('Invoice added. Time to get paid.'); }
    catch (error) { notify(error.message); }
  });
  $('#taskForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: form.get('title') }) }); event.currentTarget.reset(); $('#taskModal').close(); await refresh(); notify('Task added to today’s focus.'); }
    catch (error) { notify(error.message); }
  });
  $('#signalAction').addEventListener('click', () => location.hash = 'invoices');
  $('#focusBtn').addEventListener('click', () => location.hash = 'invoices');
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#closeInfo').addEventListener('click', () => $('#infoModal').close()); $('#infoOkay').addEventListener('click', () => $('#infoModal').close());
  $('#searchBtn').addEventListener('click', () => { $('#workspaceSearch').value = ''; $('#searchResults').innerHTML = '<span class="search-hint">Search invoices, tasks, expenses, and products.</span>'; $('#searchModal').showModal(); $('#workspaceSearch').focus(); });
  $('#notificationBtn').addEventListener('click', () => { const s = dashboard?.summary; info(s?.overdueCount ? `${s.overdueCount} invoices need a follow-up` : s?.lowStock ? `${s.lowStock} products are low` : 'You’re all caught up', s?.overdueCount ? `${money(s.overdueAmount)} is past due. Review your invoice list to record payments.` : s?.lowStock ? `${s.lowStockItems.join(', ')} ${s.lowStock === 1 ? 'is' : 'are'} below the restock point.` : 'No payment or stock alerts need your attention today.'); });
  $('#reportsBtn').addEventListener('click', () => { const s = dashboard?.summary; info('Month-to-date report', s ? `Cash received: ${money(s.cashIn)} · Expenses recorded: ${money(s.cashOut)} · Net cash: ${money(s.netCash)} · Outstanding invoices: ${money(s.outstanding)} · Open tasks: ${s.tasksOpen} · Low-stock products: ${s.lowStock}.` : 'Your report is loading.'); });
  $('#settingsBtn').addEventListener('click', () => info('Workspace settings', 'Team, profile, and notification settings are coming into focus.'));
  $('#pulseDetails').addEventListener('click', () => info('Business pulse · 78/100', 'Cash health is strong and team capacity is on track. Following up on overdue invoices is the highest impact move this week.'));
  $('#periodBtn').addEventListener('click', () => notify('You’re viewing October to date.'));
  $('#exportBtn').addEventListener('click', () => {
    if (!dashboard) return notify('Workspace data is still loading.');
    const lines = [['Type','Name','Amount / Units','Status / Due'], ...dashboard.invoices.map(x => ['Invoice',x.client,x.amount,`${x.status} · ${x.due}`]), ...dashboard.expenses.map(x => ['Expense',x.vendor,x.amount,`${x.category} · ${x.date}`]), ...dashboard.tasks.map(x => ['Task',x.title,'',x.done ? 'complete' : `open · ${x.due}`]), ...dashboard.inventory.map(x => ['Stock',x.name,x.quantity,`${x.quantity <= x.threshold ? 'Restock' : 'In stock'} · ${x.sku}`])];
    const csv = lines.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); link.download = 'northstar-workspace.csv'; link.click(); URL.revokeObjectURL(link.href); notify('Your workspace export is ready.');
  });
  $('#viewInvoices').addEventListener('click', event => { event.preventDefault(); info('Invoice overview', `${dashboard?.invoices.length || 0} invoices in your workspace. Add an invoice or mark a client payment as received from this dashboard.`); });
  $('#viewTasks').addEventListener('click', () => info('Task overview', `${dashboard?.tasks.length || 0} tasks are in your workspace. Check off work as it gets done or add a new focus item.`));
  $('#inventoryDetails').addEventListener('click', () => info('Inventory overview', `${dashboard?.inventory.length || 0} products are tracked. ${dashboard?.summary.lowStock || 0} need a restock.`));
  $('#allActivity').addEventListener('click', () => info('Recent activity', 'This feed keeps a running record of payment, task, and stock updates.'));
  setupOperations();
  document.addEventListener('click', event => { if (event.target.closest('.nav-item[href]')) $('#sidebar').classList.remove('open'); });
}
function setupOperations() {
  const operationsStyle = document.createElement('link'); operationsStyle.rel = 'stylesheet'; operationsStyle.href = '/operations.css'; document.head.append(operationsStyle);
  const expenseStyle = document.createElement('link'); expenseStyle.rel = 'stylesheet'; expenseStyle.href = '/expenses.css'; document.head.append(expenseStyle);
  const dateText = document.querySelector('.eyebrow')?.childNodes[1];
  if (dateText) dateText.textContent = ` ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}`;
  const cashTools = $('.chart-legend');
  if (cashTools) { const button = document.createElement('button'); button.className = 'add-task expense-quick'; button.textContent = '＋ Expense'; button.addEventListener('click', () => $('#expenseModal').showModal()); cashTools.append(button); }
  const stockHeading = $('.inventory-panel .panel-heading');
  if (stockHeading) { const button = document.createElement('button'); button.className = 'add-task'; button.textContent = '＋ Product'; button.addEventListener('click', () => $('#stockModal').showModal()); stockHeading.append(button); }
  if (!$('#expenses')) { const panel = document.createElement('section'); panel.className = 'panel expenses-panel'; panel.id = 'expenses'; panel.innerHTML = '<div class="panel-heading"><div><div class="section-eyebrow">KEEP COSTS VISIBLE</div><h2>Recent expenses</h2></div><button class="add-task expense-panel-add">＋ Expense</button></div><div class="expense-list" id="expenseRows"></div>'; $('#invoices').after(panel); panel.querySelector('.expense-panel-add').addEventListener('click', () => $('#expenseModal').showModal()); }
  document.body.insertAdjacentHTML('beforeend', `<dialog class="modal" id="searchModal"><div class="modal-form"><button class="modal-close" type="button" data-close="searchModal">×</button><div class="section-eyebrow">FIND IT FAST</div><h2>Search workspace</h2><input id="workspaceSearch" type="search" placeholder="Type a name, SKU, task..." autocomplete="off"><div id="searchResults" class="search-results"></div></div></dialog><dialog class="modal" id="expenseModal"><form class="modal-form" id="expenseForm"><button class="modal-close" type="button" data-close="expenseModal">×</button><div class="section-eyebrow">KNOW WHERE IT GOES</div><h2>Record an expense</h2><p>Keep cash flow grounded in what your business actually spends.</p><label>Vendor or payee<input name="vendor" required maxlength="80" placeholder="e.g. Studio rent"></label><label>Category<select name="category"><option>Workspace</option><option>Materials</option><option>People</option><option>Software</option><option>Marketing</option><option>Travel</option><option>Other</option></select></label><label>Amount<input name="amount" type="number" required min="0.01" step="0.01" placeholder="0.00"></label><label>Date<input name="date" type="date"></label><label>Note<input name="note" maxlength="160" placeholder="Optional"></label><button class="button button-primary modal-submit">Save expense <span>↘</span></button></form></dialog><dialog class="modal" id="stockModal"><form class="modal-form" id="stockForm"><button class="modal-close" type="button" data-close="stockModal">×</button><div class="section-eyebrow">KEEP THE SHELVES READY</div><h2>Add a product</h2><p>Set a restock point so low stock shows up early.</p><label>Product name<input name="name" required maxlength="80" placeholder="Ceramic mug · Chalk"></label><label>SKU<input name="sku" required maxlength="32" placeholder="MUG-014"></label><div class="form-two"><label>Starting stock<input name="quantity" type="number" min="0" step="1" value="0" required></label><label>Restock below<input name="threshold" type="number" min="0" step="1" value="5" required></label></div><label>Unit cost<input name="cost" type="number" min="0" step="0.01" value="0"></label><button class="button button-primary modal-submit">Add to inventory <span>＋</span></button></form></dialog><dialog class="modal" id="quantityModal"><form class="modal-form" id="quantityForm"><button class="modal-close" type="button" data-close="quantityModal">×</button><div class="section-eyebrow">STOCK COUNT</div><h2>Update stock</h2><p id="quantityProduct">Adjust available quantity.</p><input type="hidden" name="id"><label>Available units<input name="quantity" type="number" min="0" step="1" required></label><button class="button button-primary modal-submit">Save count <span>✓</span></button></form></dialog>`);
  document.body.addEventListener('click', event => {
    const close = event.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
    const adjust = event.target.closest('.stock-adjust');
    if (adjust) { const item = dashboard.inventory.find(row => row.id === adjust.dataset.id); if (!item) return; const form = $('#quantityForm'); form.elements.id.value = item.id; form.elements.quantity.value = item.quantity; $('#quantityProduct').textContent = `${item.name} · ${item.sku}`; $('#quantityModal').showModal(); }
  });
  $('#workspaceSearch').addEventListener('input', event => {
    const term = event.target.value.trim().toLowerCase();
    if (!term) { $('#searchResults').innerHTML = '<span class="search-hint">Search invoices, tasks, expenses, and products.</span>'; return; }
    const records = [
      ...(dashboard?.invoices || []).map(x => ({ type: 'Invoice', name: `${x.client} · ${x.code}`, detail: `${money(x.amount)} · ${x.status}` })),
      ...(dashboard?.tasks || []).map(x => ({ type: 'Task', name: x.title, detail: `${x.done ? 'Complete' : 'Open'} · ${x.due}` })),
      ...(dashboard?.expenses || []).map(x => ({ type: 'Expense', name: `${x.vendor} · ${x.category}`, detail: `${money(x.amount)} · ${x.date}` })),
      ...(dashboard?.inventory || []).map(x => ({ type: 'Product', name: `${x.name} · ${x.sku}`, detail: `${x.quantity} in stock · restock at ${x.threshold}` }))
    ].filter(x => `${x.type} ${x.name} ${x.detail}`.toLowerCase().includes(term)).slice(0, 8);
    $('#searchResults').innerHTML = records.length ? records.map(x => `<div class="search-result"><span>${escapeHTML(x.type)}</span><strong>${escapeHTML(x.name)}</strong><small>${escapeHTML(x.detail)}</small></div>`).join('') : '<span class="search-hint">No matching workspace records.</span>';
  });
  $('#expenseForm').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/api/expenses', { method: 'POST', body: JSON.stringify(values) }); event.currentTarget.reset(); $('#expenseModal').close(); await refresh(); notify('Expense recorded. Cash flow is up to date.'); } catch (error) { notify(error.message); }
  });
  $('#stockForm').addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/api/inventory', { method: 'POST', body: JSON.stringify(values) }); event.currentTarget.reset(); $('#stockModal').close(); await refresh(); notify('Product added to inventory.'); } catch (error) { notify(error.message); }
  });
  $('#quantityForm').addEventListener('submit', async event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try { await api(`/api/inventory/${encodeURIComponent(values.get('id'))}`, { method: 'PATCH', body: JSON.stringify({ quantity: Number(values.get('quantity')) }) }); $('#quantityModal').close(); await refresh(); notify('Stock count updated.'); } catch (error) { notify(error.message); }
  });
}
document.addEventListener('DOMContentLoaded', setup);
