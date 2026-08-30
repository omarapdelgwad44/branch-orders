/**
 * Admin views: dashboard metrics, order management/transitions, CRUD for
 * branches/users/items/availability, and reports with CSV export.
 */
import { t, fmtDate, fmtNum, errorText } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { badge, skeletons, qtyControl, attachQty, toast, confirmDialog, openModal, closeModal, numberCell, esc, fileDownload, debounce, STATUS_TYPES } from '../ui.js';

let branchesCache = [];
async function branches() {
  if (!branchesCache.length) branchesCache = (await api('admin.branches.list')).branches;
  return branchesCache;
}

const filtersState = { status: '', branch_id: '', from: '', to: '', search: '' };

export function render(type, view, ctx) {
  const map = {
    'admin.dashboard': dashboard,
    'admin.orders': orders,
    'admin.order': (v, c) => orderDetail(v, c.route.id, c),
    'admin.branches': manageBranches,
    'admin.users': manageUsers,
    'admin.items': manageItems,
    'admin.availability': availability,
    'admin.reports': reports
  };
  (map[type] || dashboard)(view, ctx);
}

function header(title, sub, extra) {
  return '<div class="page-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p class="page-sub">' + esc(sub) + '</p>' : '') + '</div>' + (extra || '') + '</div>';
}

function emptyState(msg) {
  return '<div class="state"><h2>' + esc(msg || t('msg.error')) + '</h2></div>';
}

/* ================= dashboard ================= */
async function dashboard(view) {
  view.innerHTML = skeletons(3, 3);
  try {
    const m = await api('admin.metrics');
    const branchRows = m.byBranch || [];
    const kpis = [
      { key: 'admin.totalOrders', val: m.cards.total, ic: 'receipt', cls: 'slate' },
      { key: 'admin.submitted', val: m.cards.submitted, ic: 'clock', cls: 'amber' },
      { key: 'admin.sent', val: m.cards.sent, ic: 'truck', cls: 'cyan' },
      { key: 'admin.shortages', val: m.cards.shortage, ic: 'alert', cls: 'red' },
      { key: 'admin.received', val: m.cards.received, ic: 'check', cls: 'green' },
      { key: 'dashboard.totalShortage', val: m.cards.shortage_total, ic: 'minus', cls: 'teal' }
    ];
    const flow = ['submitted', 'approved', 'processing', 'sent', 'partially_received', 'shortage_reported', 'received'];
    const flowCounts = {};
    flow.forEach(s => flowCounts[s] = 0);
    m.recentOrders.forEach(o => { if (flowCounts[o.status] !== undefined) flowCounts[o.status]++; });
    const maxFlow = Math.max(1, ...flow.map(s => flowCounts[s]));
    const flowHtml = '<div class="flow-bar">' + flow.map(s => {
      const pct = Math.round((flowCounts[s] / maxFlow) * 100);
      const safe = Math.max(flowCounts[s] ? 8 : 0, 4);
      return '<div class="flow-col"><span class="flow-num">' + flowCounts[s] + '</span>' +
        '<div class="flow-track"><div class="flow-fill f-' + (STATUS_TYPES[s] || 'slate') + '" style="height:' + safe + '%"></div></div>' +
        '<span class="flow-label">' + esc(t('status.' + s)) + '</span></div>';
    }).join('') + '</div>';

    view.innerHTML = header(t('nav.adminDashboard')) +
      '<div class="kpi-row">' + kpis.map(k =>
        '<div class="kpi"><span class="kpi-ic kpi-' + k.cls + '">' + icon(k.ic, 20) + '</span>' +
        '<span class="kpi-meta"><b>' + fmtNum(k.val) + '</b><em>' + esc(t(k.key)) + '</em></span></div>').join('') + '</div>' +
      '<div class="grid-2">' +
      '<div class="card"><div class="card-head"><h3>' + esc(t('admin.byBranch')) + '</h3></div>' +
      (branchRows.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('manage.branchName')) + '</th><th class="center">' + esc(t('admin.totalOrders')) + '</th></tr></thead><tbody>' +
        branchRows.map(b => '<tr><td><b>' + esc(b.branch_name) + '</b><div class="sub">' + esc(b.branch_code || '') + '</div></td><td class="center">' + fmtNum(b.orders) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty small">' + esc(t('reports.noData')) + '</div>') + '</div>' +
      '<div class="card"><div class="card-head"><h3>' + esc(t('admin.topItems')) + '</h3></div>' +
      (m.topItems.length ? '<div class="top-items">' + m.topItems.map((it, i) =>
        '<div class="top-item"><span class="rank">' + (i + 1) + '</span><span class="ti-name"><b>' + esc(it.item_name) + '</b><em>' + fmtNum(it.requested) + ' ' + esc(it.unit) + '</em></span>' +
        '<span class="ti-short">' + fmtNum(it.shortage) + '</span></div>').join('') + '</div>' : '<div class="empty small">' + esc(t('reports.noData')) + '</div>') + '</div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h3>' + esc(t('admin.recent')) + '</h3><a class="link" href="#/admin/orders">' + esc(t('dashboard.viewAll')) + '</a></div>' +
      (m.recentOrders.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('order.number')) + '</th><th>' + esc(t('order.branch')) + '</th><th>' + esc(t('order.status')) + '</th><th>' + esc(t('order.createdAt')) + '</th><th></th></tr></thead><tbody>' +
        m.recentOrders.map(o => '<tr><td><b class="mono">' + esc(o.order_number || o.order_id) + '</b></td><td>' + esc(o.branch_name) + '</td><td>' + badge(o.status) + '</td><td>' + esc(fmtDate(o.created_at)) + '</td>' +
        '<td><a class="btn btn-ghost btn-sm" href="#/admin/orders/' + esc(o.order_id) + '">' + esc(t('order.view')) + '</a></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty small">' + esc(t('reports.noData')) + '</div>') + '</div>' +
      '<div class="card"><div class="card-head"><h3>' + esc(t('admin.activity')) + '</h3></div>' +
      '<div class="activity-list">' + (m.flow ? '' : '') + '</div></div>';

    const actList = document.querySelector('.activity-list');
    try {
      const act = await api('admin.activity', { limit: 12 });
      actList.innerHTML = act.logs.length ? act.logs.map(l =>
        '<div class="act-item"><span class="act-ic">' + icon(actionIcon(l.action), 15) + '</span><span>' + esc(actionLabel(l.action)) + '</span><span class="muted">' + esc(fmtDate(l.created_at)) + '</span></div>').join('') : '<div class="empty small">' + esc(t('reports.noData')) + '</div>';
    } catch (e) { /* silent */ }

    const flowWrap = '<div class="card"><div class="card-head"><h3>' + esc(t('dashboard.overview')) + '</h3></div>' + flowHtml + '</div>';
    view.insertAdjacentHTML('beforeend', flowWrap);
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

function actionIcon(a) {
  if (a.indexOf('login') !== -1) return 'eye';
  if (a.indexOf('submitted') !== -1) return 'send';
  if (a.indexOf('received') !== -1) return 'check';
  if (a.indexOf('status_') !== -1) return 'chevR';
  if (a.indexOf('created') !== -1) return 'plus';
  if (a.indexOf('updated') !== -1) return 'edit';
  return 'clock';
}
function actionLabel(a) {
  const map = {
    login: 'login',
    logout: 'logout',
    order_submitted: t('order.submit'),
    order_received: t('msg.received'),
    order_status_sent: t('order.sentAt'),
    order_status_approved: t('admin.approve'),
    order_status_processing: t('admin.process'),
    order_status_cancelled: t('admin.cancel'),
    order_reopened: t('admin.reopen'),
    order_draft_created: t('order.saveDraft'),
    first_admin_created: 'setup'
  };
  return map[a] || a;
}

/* ================= orders list ================= */
async function orders(view) {
  view.innerHTML = skeletons(2, 5);
  let bs = [];
  try { bs = await branches(); } catch (e) { /* continue */ }
  const statuses = ['draft', 'submitted', 'approved', 'processing', 'sent', 'partially_received', 'shortage_reported', 'received', 'cancelled'];

  view.innerHTML = header(t('nav.adminOrders')) +
    '<div class="card filters-card"><div class="filters">' +
    '<select class="input" id="f-status"><option value="">' + esc(t('admin.status')) + '</option>' +
    statuses.map(s => '<option value="' + s + '">' + esc(t('status.' + s)) + '</option>').join('') + '</select>' +
    '<select class="input" id="f-branch"><option value="">' + esc(t('admin.branch')) + '</option>' +
    bs.map(b => '<option value="' + esc(b.branch_id) + '">' + esc(b.branch_name) + '</option>').join('') + '</select>' +
    '<label class="date-in"><span>' + esc(t('admin.from')) + '</span><input class="input" type="date" id="f-from"></label>' +
    '<label class="date-in"><span>' + esc(t('admin.to')) + '</span><input class="input" type="date" id="f-to"></label>' +
    '<div class="search-box grow">' + icon('search', 16) + '<input class="input plain" id="f-search" placeholder="' + esc(t('admin.search')) + '"></div>' +
    '<button class="btn btn-primary" id="f-apply">' + esc(t('admin.apply')) + '</button>' +
    '<button class="btn btn-ghost" id="f-reset">' + esc(t('admin.reset')) + '</button>' +
    '</div></div>' +
    '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
    ['order.number', 'order.branch', 'order.status', 'order.createdAt', 'order.sentAt', 'order.total', 'common.actions'].map(k => '<th>' + esc(t(k)) + '</th>').join('') +
    '</tr></thead><tbody id="tableBody">' + skeletons(1, 5) + '</tbody></table></div>' +
    '<div class="pager"><span id="pageInfo"></span><div>' +
    '<button class="btn btn-ghost btn-sm" id="prevPage">‹</button><button class="btn btn-ghost btn-sm" id="nextPage">›</button></div></div></div>';

  let page = 1;
  const tbody = document.getElementById('tableBody');
  const load = async () => {
    tbody.innerHTML = skeletons(1, 5);
    try {
      const res = await api('admin.orders', { filters: { ...filtersState }, page, page_size: 25 });
      document.getElementById('pageInfo').textContent = res.total + ' · ' + t('order.all');
      tbody.innerHTML = res.orders.length ? res.orders.map(o =>
        '<tr><td><b class="mono">' + esc(o.order_number || o.order_id) + '</b></td><td>' + esc(o.branch_name) + '</td>' +
        '<td>' + badge(o.status) + '</td><td>' + esc(fmtDate(o.created_at)) + '</td><td>' + esc(fmtDate(o.sent_at)) + '</td>' +
        '<td>' + numberCell(o.total_requested) + '</td>' +
        '<td><a class="btn btn-ghost btn-sm" href="#/admin/orders/' + esc(o.order_id) + '">' + esc(t('order.view')) + '</a></td></tr>').join('') :
        '<tr><td colspan="7"><div class="empty small">' + esc(t('dashboard.noOrders')) + '</div></td></tr>';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty small">' + esc(errorText(e)) + '</div></td></tr>';
    }
  };

  const applyFilters = () => {
    filtersState.status = document.getElementById('f-status').value;
    filtersState.branch_id = document.getElementById('f-branch').value;
    filtersState.from = document.getElementById('f-from').value;
    filtersState.to = document.getElementById('f-to').value;
    filtersState.search = document.getElementById('f-search').value;
    page = 1;
    load();
  };
  document.getElementById('f-apply').addEventListener('click', applyFilters);
  document.getElementById('f-reset').addEventListener('click', () => {
    ['f-status', 'f-branch', 'f-from', 'f-to'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-search').value = '';
    filtersState.status = filtersState.branch_id = filtersState.from = filtersState.to = filtersState.search = '';
    page = 1;
    load();
  });
  document.getElementById('f-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  document.getElementById('f-search').addEventListener('input', debounce(() => {
    filtersState.search = document.getElementById('f-search').value;
    page = 1; load();
  }, 450));
  document.getElementById('prevPage').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  document.getElementById('nextPage').addEventListener('click', () => { page++; load(); });
  load();
}

/* ================= order detail (admin) ================= */
async function orderDetail(view, orderId, ctx) {
  view.innerHTML = skeletons(1, 6);
  try {
    const order = await api('admin.orders.detail', { order_id: orderId });
    const st = order.status;
    const rows = order.items.map(it =>
      '<tr><td><b>' + esc(it.item_name) + '</b><div class="sub">' + esc(it.item_code || '') + '</div></td>' +
      '<td class="center">' + numberCell(it.requested_quantity, it.unit) + '</td>' +
      '<td class="center">' + numberCell(it.approved_quantity, it.unit) + '</td>' +
      '<td class="center">' + numberCell(it.sent_quantity, it.unit) + '</td>' +
      '<td class="center">' + numberCell(it.received_quantity, it.unit) + '</td>' +
      '<td class="center">' + (it.shortage_quantity !== null ? numberCell(it.shortage_quantity, it.unit) : t('common.none')) + '</td>' +
      (st === 'shortage_reported' || st === 'partially_received' ? '<td>' + esc(it.shortage_reason || '') + '</td>' : '') +
      '</tr>').join('');

    const meta =
      '<div class="card"><div class="card-head"><h3 class="mono">' + esc(order.order_number) + '</h3>' + badge(order.status) + '</div>' +
      '<div class="meta-grid">' +
      [[t('order.branch'), order.branch_name], [t('order.createdAt'), fmtDate(order.created_at)], [t('order.submittedAt'), fmtDate(order.submitted_at)], [t('order.sentAt'), fmtDate(order.sent_at)], [t('order.receivedAt'), fmtDate(order.received_at)]]
        .map(([k, v]) => '<div class="meta"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('') +
      '</div></div>';

    const itemsCard =
      '<div class="card"><div class="card-head"><h3>' + esc(t('order.items')) + '</h3></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['manage.itemName', 'order.requested', 'order.approved', 'order.sent', 'order.received', 'order.shortage'].map(k => '<th class="center">' + esc(t(k)) + '</th>').join('') +
      (st === 'shortage_reported' || st === 'partially_received' ? '<th>' + esc(t('order.shortageReason')) + '</th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    const notesCard =
      '<div class="card"><div class="card-head"><h3>' + esc(t('order.adminNotes')) + '</h3></div>' +
      '<div class="notes-view">' +
      (order.notes ? '<div class="note-box"><b>' + esc(t('order.notes')) + '</b><p>' + esc(order.notes) + '</p></div>' : '') +
      (order.admin_notes ? '<div class="note-box accent"><b>' + esc(t('order.adminNotes')) + '</b><p>' + esc(order.admin_notes) + '</p></div>' : '') +
      (order.cancel_reason ? '<div class="note-box danger"><b>' + esc(t('order.cancelReason')) + '</b><p>' + esc(order.cancel_reason) + '</p></div>' : '') +
      '</div></div>';

    const actions = [];
    if (st === 'submitted') actions.push({ act: 'approved', label: t('admin.approve'), ic: 'check', cls: 'btn-primary' });
    if (st === 'approved') actions.push({ act: 'processing', label: t('admin.process'), ic: 'layers', cls: 'btn-primary' });
    if (st === 'processing') actions.push({ act: 'sent', label: t('admin.send'), ic: 'truck', cls: 'btn-primary' });
    if (['received', 'partially_received', 'shortage_reported'].indexOf(st) !== -1) actions.push({ act: 'reopen', label: t('admin.reopen'), ic: 'clock', cls: 'btn-ghost' });
    if (['draft', 'submitted', 'approved', 'processing', 'sent'].indexOf(st) !== -1) actions.push({ act: 'cancelled', label: t('admin.cancel'), ic: 'x', cls: 'btn-danger' });

    const actionRow = actions.length ? '<div class="form-actions">' + actions.map(a =>
      '<button class="btn ' + a.cls + '" data-act="' + a.act + '">' + icon(a.ic, 15) + ' ' + esc(a.label) + '</button>').join('') + '</div>' : '';

    view.innerHTML =
      '<div class="page-head"><div><a class="btn btn-ghost" href="#/admin/orders">' + icon('chevL', 16, 'flip-rtl') + ' ' + esc(t('common.back')) + '</a>' +
      '<button class="btn btn-ghost" id="printBtn">' + icon('file', 15) + ' ' + esc(t('common.print')) + '</button></div></div>' +
      '<div class="detail-grid">' + meta + itemsCard + '</div>' + notesCard +
      '<div class="detail-grid">' + timeline(order) + actionCards(order) + '</div>' + actionRow;

    if (document.getElementById('printBtn')) document.getElementById('printBtn').addEventListener('click', () => window.print());

    view.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => transition(order, btn.dataset.act, ctx.render));
    });
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

function actionCards(order) {
  const st = order.status;
  if (!order.items.length) return '<div class="card"><div class="card-head"><h3>' + esc(t('dashboard.overview')) + '</h3></div><div class="empty small">' + esc(t('reports.noData')) + '</div></div>';
  return '<div class="card"><div class="card-head"><h3>' + esc(t('dashboard.overview')) + '</h3></div>' +
    '<div class="mini-stat">' +
    '<div class="ms"><span>' + esc(t('order.requested')) + '</span><b>' + fmtNum(order.total_requested) + '</b></div>' +
    '<div class="ms"><span>' + esc(t('order.sent')) + '</span><b>' + fmtNum(order.total_sent) + '</b></div>' +
    '<div class="ms"><span>' + esc(t('order.received')) + '</span><b>' + fmtNum(order.total_received) + '</b></div>' +
    '<div class="ms danger-ms"><span>' + esc(t('order.shortage')) + '</span><b>' + fmtNum(order.total_shortage) + '</b></div>' +
    '</div></div>';
}

function timeline(order) {
  const steps = [
    ['draft', order.created_at],
    ['submitted', order.submitted_at],
    ['approved', order.processed_at],
    ['processing', order.processed_at],
    ['sent', order.sent_at],
    ['received', order.received_at]
  ];
  let lastReached = -1;
  steps.forEach(([s, ts], i) => { if (ts) lastReached = i; });
  if (['partially_received', 'shortage_reported'].indexOf(order.status) !== -1 && order.received_at) lastReached = 5;
  if (order.status === 'cancelled') lastReached = 6;

  return '<div class="card"><div class="card-head"><h3>' + esc(t('admin.timeline')) + '</h3></div>' +
    '<div class="tl">' + steps.map(([s, ts], i) => {
      const done = i <= lastReached;
      return '<div class="tl-step ' + (done ? 'done' : '') + '"><span class="tl-dot"></span>' +
        '<span class="tl-lab"><b>' + esc(t('status.' + s)) + '</b><em>' + esc(fmtDate(ts)) + '</em></span></div>';
    }).join('') +
    (order.status === 'cancelled' ? '<div class="tl-step done danger-st"><span class="tl-dot"></span><span class="tl-lab"><b>' + esc(t('status.cancelled')) + '</b><em>' + esc(fmtDate(order.updated_at)) + '</em></span></div>' : '') +
    '</div></div>';
}

async function transition(order, act, render) {
  if (act === 'reopen') {
    const ok = await confirmDialog({ title: t('admin.reopen'), message: t('admin.reopen.warn'), confirmLabel: t('admin.reopen') });
    if (!ok) return;
    try { await api('admin.orders.reopen', { order_id: order.order_id }); toast(t('msg.statusUpdated'), 'success'); render(); } catch (e) { toast(errorText(e), 'error'); }
    return;
  }
  if (act === 'cancelled') {
    const node = openModal({ title: t('admin.cancel'), body: '<label class="field"><span class="field-label">' + esc(t('order.cancelReason')) + '</span><textarea class="input" rows="3" id="cancelReason"></textarea></label>', footer: '' });
    node.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button><button class="btn btn-danger" id="doCancel">' + esc(t('common.confirm')) + '</button>';
    node.querySelector('[data-cancel]').addEventListener('click', closeModal);
    document.getElementById('doCancel').addEventListener('click', async () => {
      const reason = document.getElementById('cancelReason').value.trim();
      try { await api('admin.orders.transition', { order_id: order.order_id, to: 'cancelled', reason }); toast(t('msg.statusUpdated'), 'success'); closeModal(); render(); } catch (e) { toast(errorText(e), 'error'); }
    });
    return;
  }
  qtyTransition(order, act, render);
}

function qtyTransition(order, act, render) {
  const col = act === 'approved' ? 'approved_quantity' : act === 'sent' ? 'sent_quantity' : null;
  const prefill = act === 'sent' ? (it => it.approved_quantity !== null ? it.approved_quantity : it.requested_quantity)
    : (it => it.requested_quantity);
  const body = '<p class="modal-msg">' + (act === 'sent' ? esc(t('admin.transition.warn.sent')) : esc(t('admin.transition.warn.approve'))) + '</p>' +
    '<div class="qty-modal-list">' + order.items.map(it =>
      '<div class="recv-item" data-id="' + esc(it.item_id) + '">' +
      '<div class="recv-info"><b>' + esc(it.item_name) + '</b><em>' + esc(it.unit) + '</em></div>' +
      '<div data-stepper>' + qtyControl(prefill(it), null) + '</div></div>').join('') + '</div>' +
    '<label class="field"><span class="field-label">' + esc(t('admin.notes')) + '</span><textarea class="input" rows="2" id="qtyNotes" placeholder="optional"></textarea></label>';
  const node = openModal({ title: act === 'sent' ? t('admin.send') : t('admin.approve'), body, footer: '' });
  node.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button><button class="btn btn-primary" id="doTransition">' + esc(t('common.confirm')) + '</button>';
  attachQty(node);
  node.querySelector('[data-cancel]').addEventListener('click', closeModal);
  document.getElementById('doTransition').addEventListener('click', async () => {
    const byItem = {};
    node.querySelectorAll('.recv-item').forEach(r => {
      const val = parseFloat(r.querySelector('.qty-val').value);
      byItem[r.dataset.id] = !isNaN(val) ? val : prefill(order.items.filter(i => i.item_id === r.dataset.id)[0]);
    });
    const payload = { order_id: order.order_id, to: act, notes: (document.getElementById('qtyNotes').value || '') };
    payload[act === 'approved' ? 'approved_qty' : 'sent_qty'] = byItem;
    document.getElementById('doTransition').disabled = true;
    try {
      await api('admin.orders.transition', payload);
      toast(t('msg.statusUpdated'), 'success');
      closeModal();
      render();
    } catch (e) { toast(errorText(e), 'error'); document.getElementById('doTransition').disabled = false; }
  });
}

/* ================= CRUD: branches ================= */
async function manageBranches(view) {
  view.innerHTML = skeletons(1, 4);
  try {
    const data = await api('admin.branches.list');
    view.innerHTML = header(t('manage.branches'), '', '<button class="btn btn-primary" id="addBranch">' + icon('plus', 15) + ' ' + esc(t('manage.newBranch')) + '</button>') +
      '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['manage.branchCode', 'manage.branchName', 'manage.location', 'common.actions'].map(k => '<th>' + esc(t(k)) + '</th>').join('') + '<th></th>' +
      '</tr></thead><tbody>' +
      data.branches.map(b => '<tr><td><b class="mono">' + esc(b.branch_code) + '</b></td><td>' + esc(b.branch_name) + '</td><td>' + esc(b.location || '') + '</td>' +
        '<td><span class="badge ' + (b.status === 'active' ? 'badge-green' : 'badge-gray') + '">' + esc(t(b.status === 'active' ? 'manage.active' : 'manage.inactive')) + '</span></td>' +
        '<td><button class="btn btn-ghost btn-sm" data-edit="' + esc(b.branch_id) + '">' + icon('edit', 14) + '</button></td></tr>').join('') +
      '</tbody></table></div></div>';

    document.getElementById('addBranch').addEventListener('click', () => branchForm(null));
    view.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      const b = data.branches.filter(x => x.branch_id === btn.dataset.edit)[0];
      branchForm(b);
    }));
    function branchForm(b) {
      const node = openModal({ title: b ? b.branch_name : t('manage.newBranch'), body: form(b), footer: '' });
      node.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button><button class="btn btn-primary" id="saveBranch">' + esc(t('common.save')) + '</button>';
      node.querySelector('[data-cancel]').addEventListener('click', closeModal);
      document.getElementById('saveBranch').addEventListener('click', async () => {
        const payload = {
          branch_name: document.getElementById('bn').value.trim(),
          location: document.getElementById('bl').value.trim(),
          status: document.getElementById('bs').value
        };
        const bc = document.getElementById('bc');
        if (bc) payload.branch_code = bc.value.trim();
        if (!payload.branch_name) { toast(t('err.required'), 'error'); return; }
        try {
          if (b) await api('admin.branches.update', { branch_id: b.branch_id, ...payload });
          else await api('admin.branches.create', payload);
          branchesCache = [];
          toast(t('msg.saved'), 'success'); closeModal(); manageBranches(view);
        } catch (e) { toast(errorText(e), 'error'); }
      });
    }
    function form(branch) {
      const v = branch || {};
      const codeField = branch
        ? '<label class="field"><span class="field-label">' + esc(t('manage.branchCode')) + '</span><input class="input" id="bc" value="' + esc(v.branch_code || '') + '"></label>'
        : '<p class="muted">' + esc(t('manage.branchCodeAuto')) + '</p><input type="hidden" id="bc" value="">';
      return codeField +
        '<label class="field"><span class="field-label">' + esc(t('manage.branchName')) + '</span><input class="input" id="bn" value="' + esc(v.branch_name || '') + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.location')) + '</span><input class="input" id="bl" value="' + esc(v.location || '') + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('admin.status')) + '</span><select class="input" id="bs"><option value="active" ' + (v.status !== 'inactive' ? 'selected' : '') + '>' + esc(t('manage.active')) + '</option><option value="inactive" ' + (v.status === 'inactive' ? 'selected' : '') + '>' + esc(t('manage.inactive')) + '</option></select></label>';
    }
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

/* ================= CRUD: users ================= */
async function manageUsers(view, ctx) {
  view.innerHTML = skeletons(1, 4);
  try {
    const [du, bs] = await Promise.all([api('admin.users.list'), branches()]);
    const noBranches = !bs.length;
    view.innerHTML = header(t('manage.users'), noBranches ? t('setupError.title') : '', '<button class="btn btn-primary" id="addUser">' + icon('plus', 15) + ' ' + esc(t('manage.newUser')) + '</button>') +
      '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['manage.fullName', 'manage.username', 'manage.role', 'manage.branchName', 'common.actions'].map(k => '<th>' + esc(t(k)) + '</th>').join('') + '<th></th>' +
      '</tr></thead><tbody>' +
      du.users.map(u => '<tr><td><b>' + esc(u.full_name || u.username) + '</b></td><td>' + esc(u.username) + '</td>' +
        '<td>' + (u.role === 'admin' ? esc(t('manage.roleAdmin')) : esc(t('manage.roleBranch'))) + '</td>' +
        '<td>' + esc(u.branch_name || t('common.none')) + '</td>' +
        '<td><span class="badge ' + (u.status === 'active' ? 'badge-green' : 'badge-gray') + '">' + esc(t(u.status === 'active' ? 'manage.active' : 'manage.inactive')) + '</span></td>' +
        '<td><button class="btn btn-ghost btn-sm" data-edit="' + esc(u.user_id) + '">' + icon('edit', 14) + '</button></td></tr>').join('') +
      '</tbody></table></div></div>';

    document.getElementById('addUser').addEventListener('click', () => userForm(null));
    view.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      userForm(du.users.filter(x => x.user_id === btn.dataset.edit)[0]);
    }));
    function userForm(u) {
      const v = u || {};
      const node = openModal({ title: u ? v.full_name || v.username : t('manage.newUser'), body: '', footer: '' });
      const body = node.querySelector('.modal-body');
      body.innerHTML = '<label class="field"><span class="field-label">' + esc(t('manage.fullName')) + '</span><input class="input" id="ufn" value="' + esc(v.full_name || '') + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.username')) + '</span><input class="input" id="uun" value="' + esc(v.username || '') + '"' + (u ? ' readonly' : '') + '></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.email')) + '</span><input class="input" id="uem" value="' + esc(v.email || '') + '"></label>' +
        '<label class="field"><span class="field-label">' + (u ? esc(t('manage.newPassword')) : esc(t('manage.password'))) + '</span><input class="input" type="password" id="upw" placeholder="' + (u ? '••••••' : '') + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.role')) + '</span><select class="input" id="urole">' +
        '<option value="branch_user" ' + (v.role !== 'admin' ? 'selected' : '') + '>' + esc(t('manage.roleBranch')) + '</option>' +
        '<option value="admin" ' + (v.role === 'admin' ? 'selected' : '') + '>' + esc(t('manage.roleAdmin')) + '</option></select></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.branchName')) + '</span><select class="input" id="ubr">' +
        '<option value="">' + esc(t('common.none')) + '</option>' +
        bs.map(br => '<option value="' + esc(br.branch_id) + '" ' + (v.branch_id === br.branch_id ? 'selected' : '') + '>' + esc(br.branch_name) + '</option>').join('') +
        '</select></label>' +
        '<label class="field"><span class="field-label">' + esc(t('admin.status')) + '</span><select class="input" id="ust">' +
        '<option value="active" ' + (v.status !== 'inactive' ? 'selected' : '') + '>' + esc(t('manage.active')) + '</option>' +
        '<option value="inactive" ' + (v.status === 'inactive' ? 'selected' : '') + '>' + esc(t('manage.inactive')) + '</option></select></label>';
      node.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button><button class="btn btn-primary" id="saveUser">' + esc(t('common.save')) + '</button>';
      node.querySelector('[data-cancel]').addEventListener('click', closeModal);
      document.getElementById('saveUser').addEventListener('click', async () => {
        const payload = {
          full_name: document.getElementById('ufn').value,
          username: u ? undefined : document.getElementById('uun').value,
          email: document.getElementById('uem').value,
          role: document.getElementById('urole').value,
          branch_id: document.getElementById('ubr').value,
          status: document.getElementById('ust').value
        };
        const pw = document.getElementById('upw').value;
        if (pw) payload.new_password = pw;
        if (!u) payload.password = pw;
        if (!u && !pw) { toast(t('err.required'), 'error'); return; }
        try {
          if (u) await api('admin.users.update', { user_id: u.user_id, ...payload });
          else await api('admin.users.create', payload);
          toast(t('msg.saved'), 'success'); closeModal(); manageUsers(view, ctx);
        } catch (e) { toast(errorText(e), 'error'); }
      });
    }
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

/* ================= CRUD: items ================= */
async function manageItems(view, ctx) {
  view.innerHTML = skeletons(1, 4);
  try {
    const data = await api('admin.items.list');
    const cats = [...new Set(data.items.map(i => i.category).filter(Boolean))].sort();
    view.innerHTML = header(t('manage.items'), '', '<button class="btn btn-primary" id="addItem">' + icon('plus', 15) + ' ' + esc(t('manage.newItem')) + '</button>') +
      '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      ['manage.itemCode', 'manage.itemName', 'order.category', 'manage.unit', 'manage.sort', 'common.actions'].map(k => '<th>' + esc(t(k)) + '</th>').join('') + '<th></th>' +
      '</tr></thead><tbody>' +
      data.items.sort((a, b) => (a.sort_order - b.sort_order) || a.item_name.localeCompare(b.item_name)).map(i =>
        '<tr><td><b class="mono">' + esc(i.item_code || '') + '</b></td><td>' + esc(i.item_name) + '</td><td>' + esc(i.category || t('common.none')) + '</td>' +
        '<td>' + esc(i.unit) + '</td><td>' + (i.sort_order || 0) + '</td>' +
        '<td><span class="badge ' + (i.active ? 'badge-green' : 'badge-gray') + '">' + esc(t(i.active ? 'manage.active' : 'manage.inactive')) + '</span></td>' +
        '<td><button class="btn btn-ghost btn-sm" data-edit="' + esc(i.item_id) + '">' + icon('edit', 14) + '</button></td></tr>').join('') +
      '</tbody></table></div></div>';

    document.getElementById('addItem').addEventListener('click', () => itemForm(null));
    view.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      itemForm(data.items.filter(i => i.item_id === btn.dataset.edit)[0]);
    }));
    function itemForm(i) {
      const v = i || {};
      const node = openModal({ title: i ? v.item_name : t('manage.newItem'), body: '', footer: '' });
      const body = node.querySelector('.modal-body');
      body.innerHTML = '<label class="field"><span class="field-label">' + esc(t('manage.itemName')) + '</span><input class="input" id="iName" value="' + esc(v.item_name || '') + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.itemCode')) + '</span><input class="input" id="iCode" value="' + esc(v.item_code || '') + '"></label>' +
        '<div class="grid-2">' +
        '<label class="field"><span class="field-label">' + esc(t('order.category')) + '</span><input class="input" id="iCat" list="catList" value="' + esc(v.category || '') + '"><datalist id="catList">' + cats.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
        '<label class="field"><span class="field-label">' + esc(t('manage.unit')) + '</span><input class="input" id="iUnit" list="unitList" value="' + esc(v.unit || 'pc') + '"><datalist id="unitList">' + ['pc', 'box', 'carton', 'bottle', 'bag', 'pack', 'kg', 'liter'].map(u => '<option value="' + u + '">').join('') + '</datalist></label>' +
        '</div>' +
        '<div class="grid-2">' +
        '<label class="field"><span class="field-label">' + esc(t('manage.sort')) + '</span><input class="input" type="number" id="iSort" value="' + (v.sort_order || 0) + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('admin.status')) + '</span><select class="input" id="iActive"><option value="true"' + (v.active === false ? '' : ' selected') + '>' + esc(t('manage.active')) + '</option><option value="false"' + (v.active === false ? ' selected' : '') + '>' + esc(t('manage.inactive')) + '</option></select></label>' +
        '</div>';
      node.querySelector('.modal-foot').innerHTML = '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button><button class="btn btn-primary" id="saveItem">' + esc(t('common.save')) + '</button>';
      node.querySelector('[data-cancel]').addEventListener('click', closeModal);
      document.getElementById('saveItem').addEventListener('click', async () => {
        const payload = {
          item_name: document.getElementById('iName').value.trim(),
          item_code: document.getElementById('iCode').value.trim(),
          category: document.getElementById('iCat').value.trim(),
          unit: document.getElementById('iUnit').value.trim() || 'pc',
          sort_order: parseInt(document.getElementById('iSort').value, 10) || 0,
          active: document.getElementById('iActive').value === 'true'
        };
        if (!payload.item_name) return;
        try {
          if (i) await api('admin.items.update', { item_id: i.item_id, ...payload });
          else await api('admin.items.create', payload);
          toast(t('msg.saved'), 'success'); closeModal(); manageItems(view, ctx);
        } catch (e) { toast(errorText(e), 'error'); }
      });
    }
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

/* ================= availability ================= */
async function availability(view) {
  view.innerHTML = skeletons(1, 6);
  try {
    const [bs, its] = await Promise.all([branches(), api('admin.items.list')]);
    const activeItems = its.items.filter(i => i.active);
    let currentBranch = bs.length ? bs[0].branch_id : '';
    let assignments = {};
    const loadAssign = async () => {
      if (!currentBranch) return;
      view.querySelector('#avTable').innerHTML = skeletons(1, 5);
      try {
        const full = await api('catalog.list');
        assignments = {};
        full.items.forEach(i => assignments[i.item_id] = { available: i.active !== false, max: '' });
        view.querySelector('#avTable').innerHTML = activeItems.map(i =>
          '<tr><td><b>' + esc(i.item_name) + '</b></td><td>' + esc(i.unit) + '</td>' +
          '<td><label class="switch"><input type="checkbox" data-toggle="' + esc(i.item_id) + '"' + (availSafe(i.item_id) ? ' checked' : '') + '><span class="slider"></span></label></td>' +
          '<td><input class="input plain small-input" type="number" min="0" data-max="' + esc(i.item_id) + '" value="' + esc(maxSafe(i.item_id) || '') + '" placeholder="âˆž"></td></tr>').join('') ||
          '<tr><td colspan="4"><div class="empty small">' + esc(t('reports.noData')) + '</div></td></tr>';
        bindTable();
      } catch (e) { view.querySelector('#avTable').innerHTML = '<tr><td colspan="4"><div class="empty small">' + esc(errorText(e)) + '</div></td></tr>'; }
    };
    function availSafe(id) { return assignments[id] ? assignments[id].available !== false : true; }
    function maxSafe(id) { return assignments[id] && assignments[id].max ? assignments[id].max : ''; }
    function bindTable() {
      view.querySelectorAll('[data-toggle]').forEach(tg => {
        tg.addEventListener('change', () => { assignments[tg.dataset.toggle].available = tg.checked; });
      });
      view.querySelectorAll('[data-max]').forEach(inp => {
        inp.addEventListener('input', () => { assignments[inp.dataset.max].max = inp.value; });
      });
    }

    view.innerHTML = header(t('manage.availability')) +
      '<div class="card"><div class="card-head"><h3>' + esc(t('manage.branchName')) + '</h3>' +
      '<select class="input" id="branchSel">' + bs.map(b => '<option value="' + esc(b.branch_id) + '">' + esc(b.branch_name) + '</option>').join('') + '</select></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('manage.itemName')) + '</th><th>' + esc(t('manage.unit')) + '</th><th>' + esc(t('manage.available')) + '</th><th>' + esc(t('manage.maxQty')) + '</th></tr></thead>' +
      '<tbody id="avTable"></tbody></table></div>' + '</div>' +
      '<div class="form-actions"><button class="btn btn-primary" id="saveAv">' + icon('check', 15) + ' ' + esc(t('common.save')) + '</button></div>';

    if (currentBranch) loadAssign();
    document.getElementById('branchSel').addEventListener('change', (e) => {
      currentBranch = e.target.value;
      loadAssign();
    });
    document.getElementById('saveAv').addEventListener('click', async () => {
      if (!currentBranch) return;
      const assignmentsArr = activeItems.map(i => ({ item_id: i.item_id, is_available: availSafe(i.item_id), max_quantity: maxSafe(i.item_id) || '' }));
      try { await api('admin.branchItems.save', { branch_id: currentBranch, assignments: assignmentsArr }); toast(t('msg.saved'), 'success'); } catch (e) { toast(errorText(e), 'error'); }
    });
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

/* ================= reports ================= */
async function reports(view) {
  view.innerHTML = skeletons(2, 5);
  let bs = [];
  try { bs = await branches(); } catch (e) { /* ignore */ }
  const repFilters = { status: '', branch_id: '', from: '', to: '', search: '' };
  const kinds = ['orders', 'branches', 'items', 'shortages'];
  let current = 'orders';

  view.innerHTML = header(t('reports.title'), t('reports.applyFiltersHint')) +
    '<div class="card filters-card"><div class="filters">' +
    '<select class="input" id="r-status"><option value="">' + esc(t('admin.status')) + '</option>' +
    ['draft', 'submitted', 'approved', 'processing', 'sent', 'partially_received', 'shortage_reported', 'received', 'cancelled'].map(s => '<option value="' + s + '">' + esc(t('status.' + s)) + '</option>').join('') + '</select>' +
    '<select class="input" id="r-branch"><option value="">' + esc(t('admin.branch')) + '</option>' +
    bs.map(b => '<option value="' + esc(b.branch_id) + '">' + esc(b.branch_name) + '</option>').join('') + '</select>' +
    '<label class="date-in"><span>' + esc(t('admin.from')) + '</span><input class="input" type="date" id="r-from"></label>' +
    '<label class="date-in"><span>' + esc(t('admin.to')) + '</span><input class="input" type="date" id="r-to"></label>' +
    '<div class="search-box grow">' + icon('search', 16) + '<input class="input plain" id="r-search" placeholder="' + esc(t('admin.search')) + '"></div>' +
    '<button class="btn btn-primary" id="r-apply">' + esc(t('admin.apply')) + '</button>' +
    '<button class="btn btn-ghost" id="r-reset">' + esc(t('admin.reset')) + '</button>' +
    '</div></div>' +
    '<div class="chips" id="repTabs">' + kinds.map(k => '<button class="chip-btn' + (k === 'orders' ? ' active' : '') + '" data-k="' + k + '">' + esc(t('reports.' + k)) + '</button>').join('') + '</div>' +
    '<div class="card"><div class="card-head" id="repTitle"><h3></h3><button class="btn btn-primary btn-sm" id="repCsv">' + icon('download', 15) + ' ' + esc(t('reports.download')) + '</button></div>' +
    '<div id="repBody"></div></div>';

  const gather = () => {
    repFilters.status = document.getElementById('r-status').value;
    repFilters.branch_id = document.getElementById('r-branch').value;
    repFilters.from = document.getElementById('r-from').value;
    repFilters.to = document.getElementById('r-to').value;
    repFilters.search = document.getElementById('r-search').value;
  };

  async function loadTable() {
    gather();
    document.getElementById('repBody').innerHTML = skeletons(1, 5);
    try {
      const data = await api('reports.' + current, { filters: repFilters });
      document.getElementById('repTitle').querySelector('h3').textContent = t('reports.' + current);
      document.getElementById('repBody').innerHTML = tableFor(current, data.rows);
    } catch (e) { document.getElementById('repBody').innerHTML = emptyState(errorText(e)); }
  }

  document.getElementById('repTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-k]');
    if (!btn) return;
    document.querySelectorAll('#repTabs .chip-btn').forEach(b2 => b2.classList.remove('active'));
    btn.classList.add('active');
    current = btn.dataset.k;
    loadTable();
  });
  document.getElementById('repCsv').addEventListener('click', async () => {
    gather();
    try {
      const res = await api('reports.csv', { kind: current, filters: repFilters });
      fileDownload(res.filename, res.csv, 'text/csv');
    } catch (e) { toast(errorText(e), 'error'); }
  });
  document.getElementById('r-apply').addEventListener('click', loadTable);
  document.getElementById('r-reset').addEventListener('click', () => {
    ['r-status', 'r-branch', 'r-from', 'r-to'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('r-search').value = '';
    repFilters.status = repFilters.branch_id = repFilters.from = repFilters.to = repFilters.search = '';
    loadTable();
  });
  document.getElementById('r-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTable(); });
  loadTable();
}

function tableFor(kind, rows) {
  const headers = {
    orders: ['order.number', 'order.branch', 'order.status', 'order.createdAt', 'order.sentAt', 'order.receivedAt', 'order.total', 'order.shortage'],
    branches: ['manage.branchName', 'admin.totalOrders', 'admin.drafts', 'admin.submitted', 'admin.sent', 'admin.received', 'admin.shortages', 'dashboard.totalShortage'],
    items: ['manage.itemName', 'order.category', 'manage.unit', 'order.requested', 'order.approved', 'order.sent', 'order.received', 'order.shortage'],
    shortages: ['order.number', 'manage.branchName', 'manage.itemName', 'order.sent', 'order.received', 'order.shortage', 'order.shortageReason', 'order.receivedAt']
  };
  const h = headers[kind];
  if (!rows.length) return '<div class="empty">' + esc(t('reports.noData')) + '</div>';
  const render = {
    orders: r => `<tr><td><b class="mono">${esc(r.order_number)}</b></td><td>${esc(r.branch_name)}</td><td>${badge(r.status)}</td><td>${esc(fmtDate(r.created_at))}</td><td>${esc(fmtDate(r.sent_at))}</td><td>${esc(fmtDate(r.received_at))}</td><td>${numberCell(r.total_requested)}</td><td>${numberCell(r.total_shortage)}</td></tr>`,
    branches: r => `<tr><td><b>${esc(r.branch_name)}</b></td><td class="center">${fmtNum(r.orders)}</td><td class="center">${fmtNum(r.drafts || 0)}</td><td class="center">${fmtNum(r.submitted)}</td><td class="center">${fmtNum(r.sent)}</td><td class="center">${fmtNum(r.received)}</td><td class="center">${fmtNum(r.shortage_orders)}</td><td class="center">${fmtNum(r.shortage_total)}</td></tr>`,
    items: r => `<tr><td><b>${esc(r.item_name)}</b></td><td>${esc(r.category)}</td><td>${esc(r.unit)}</td><td class="center">${fmtNum(r.requested)}</td><td class="center">${fmtNum(r.approved)}</td><td class="center">${fmtNum(r.sent)}</td><td class="center">${fmtNum(r.received)}</td><td class="center">${fmtNum(r.shortage)}</td></tr>`,
    shortages: r => `<tr><td><b class="mono">${esc(r.order_number)}</b></td><td>${esc(r.branch_name)}</td><td>${esc(r.item_name)}</td><td class="center">${fmtNum(r.sent_quantity)}</td><td class="center">${fmtNum(r.received_quantity)}</td><td class="center">${fmtNum(r.shortage_quantity)}</td><td>${esc(r.shortage_reason || '')}</td><td>${esc(fmtDate(r.received_at))}</td></tr>`
  }[kind];
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' + h.map(k => '<th>' + esc(t(k)) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(render).join('') + '</tbody></table></div>';
}