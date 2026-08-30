/**
 * Branch user views: dashboard, order history, detail, create/edit order,
 * and the receiving workflow for sent orders.
 */
import { t, fmtDate, fmtNum, errorText } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { badge, skeletons, qtyControl, attachQty, toast, confirmDialog, openModal, closeModal, numberCell, esc } from '../ui.js';

const catalogCache = { at: 0, items: [] };

async function catalog() {
  const now = Date.now();
  if (!catalogCache.items.length || now - catalogCache.at > 60000) {
    catalogCache.items = (await api('catalog.list')).items;
    catalogCache.at = now;
  }
  return catalogCache.items;
}

export function render(type, view, ctx) {
  const map = {
    'branch.dashboard': dashboard,
    'branch.new': newOrder,
    'branch.detail': (v, c) => orderDetail(v, c.route.id, c),
    'branch.history': orders
  };
  (map[type] || dashboard)(view, ctx);
}

function cell(keys) {
  return keys.map(k => '<th>' + esc(t(k)) + '</th>').join('');
}

function emptyState(msg) {
  return '<div class="state"><h2>' + esc(msg || t('common.notFound')) + '</h2></div>';
}

/* ---------------- dashboard ---------------- */
async function dashboard(view, ctx) {
  view.innerHTML = skeletons(2, 4);
  try {
    const data = await api('orders.list');
    const items = await catalog();
    let html = header(ctx);
    const orders = data.orders;
    const active = orders.filter(o => ['draft', 'submitted', 'approved', 'processing', 'sent'].indexOf(o.status) !== -1);
    const drafts = orders.filter(o => o.status === 'draft');
    const awaitReceive = orders.filter(o => o.status === 'sent');
    const shortages = orders.filter(o => ['shortage_reported', 'partially_received'].indexOf(o.status) !== -1);

    const kpis = [
      { key: 'dashboard.activeOrders', val: active.length, ic: 'inbox', cls: 'teal' },
      { key: 'dashboard.drafts', val: drafts.length, ic: 'edit', cls: 'slate' },
      { key: 'dashboard.waitingReceive', val: awaitReceive.length, ic: 'truck', cls: 'cyan' },
      { key: 'dashboard.shortages', val: shortages.length, ic: 'alert', cls: 'amber' }
    ];
    html += '<div class="kpi-row">' + kpis.map(k =>
      '<div class="kpi"><span class="kpi-ic kpi-' + k.cls + '">' + icon(k.ic, 20) + '</span>' +
      '<span class="kpi-meta"><b>' + k.val + '</b><em>' + esc(t(k.key)) + '</em></span></div>').join('') + '</div>';

    const recent = orders.slice(0, 6);
    html += '<div class="card"><div class="card-head"><h3>' + esc(t('dashboard.overview')) + '</h3>' +
      '<a class="link" href="#/orders">' + esc(t('dashboard.viewAll')) + '</a></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' + cell(['order.number', 'order.createdAt', 'order.status', 'order.total', 'common.actions']) +
      '</tr></thead><tbody>' + (recent.length ? recent.map(rowHtml).join('') : emptyRow(t('dashboard.noOrders'))) +
      '</tbody></table></div></div>';

    if (items.length) {
      html += '<div class="card"><div class="card-head"><h3>' + esc(t('dashboard.whatsNew')) + '</h3></div>' +
        '<div class="mini-cat">' + items.slice(0, 10).map(i =>
          '<span class="chip">' + esc(i.item_name) + ' <em>' + esc(i.unit) + '</em></span>').join('') + '</div></div>';
    }
    view.innerHTML = html;
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

function header(ctx) {
  const u = ctx.user;
  const sub = u.branch ? t('dashboard.branchLabel').split('{{branch}}').join(esc(u.branch.branch_name)) : '';
  return '<div class="page-head">' +
    '<div><h2>' + esc(t('dashboard.welcome').split('{{name}}').join(u.full_name || u.username)) + '</h2>' +
    '<p class="page-sub">' + sub + '</p></div>' +
    '<a class="btn btn-primary btn-lg" href="#/order/new">' + icon('plus', 16) + ' ' + esc(t('dashboard.newOrder')) + '</a>' +
    '</div>';
}

function rowHtml(o) {
  return '<tr data-id="' + esc(o.order_id) + '">' +
    '<td><b class="mono">' + esc(o.order_number) + '</b></td>' +
    '<td>' + esc(fmtDate(o.created_at)) + '</td>' +
    '<td>' + badge(o.status) + '</td>' +
    '<td>' + numberCell(o.total_requested) + '</td>' +
    '<td><a class="btn btn-ghost btn-sm" href="#/order/' + esc(o.order_id) + '">' + esc(t('order.view')) + '</a></td></tr>';
}

function emptyRow(msg) {
  return '<tr><td colspan="5"><div class="empty small">' + esc(msg) + '</div></td></tr>';
}

/* ---------------- order history ---------------- */
async function orders(view) {
  view.innerHTML = skeletons(2, 4);
  try {
    const data = await api('orders.list');
    const all = data.orders;
    const statuses = ['draft', 'submitted', 'approved', 'processing', 'sent', 'partially_received', 'shortage_reported', 'received', 'cancelled'];
    view.innerHTML =
      '<div class="page-head"><div><h2>' + esc(t('nav.orders')) + '</h2></div>' +
      '<a class="btn btn-primary" href="#/order/new">' + icon('plus', 16) + ' ' + esc(t('dashboard.newOrder')) + '</a></div>' +
      '<div class="chips" id="chips"><button class="chip-btn active" data-s="">' + esc(t('order.all')) + '</button>' +
      statuses.map(s => '<button class="chip-btn" data-s="' + s + '">' + badge(s) + '</button>').join('') + '</div>' +
      '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      cell(['order.number', 'order.createdAt', 'order.status', 'order.total', 'common.actions']) +
      '</tr></thead><tbody id="tbody">' + historyRows(all) + '</tbody></table></div></div>';
    document.getElementById('chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-s]');
      if (!btn) return;
      document.querySelectorAll('#chips .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const list = btn.dataset.s ? all.filter(o => o.status === btn.dataset.s) : all;
      document.getElementById('tbody').innerHTML = historyRows(list);
    });
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

function historyRows(list) {
  if (!list.length) return '<tr><td colspan="5"><div class="empty small">' + esc(t('dashboard.noOrders')) + '</div></td></tr>';
  return list.map(rowHtml).join('');
}

/* ---------------- new order ---------------- */
async function newOrder(view, ctx) {
  const editId = ctx.route.source ? (new URLSearchParams(ctx.route.source || '')).get('edit') : null;
  let order = null;
  if (editId) {
    try { order = await api('orders.detail', { order_id: editId }); } catch (e) { /* fall through to blank */ }
  }
  let itemsData;
  try {
    itemsData = await catalog();
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
    return;
  }
  const categories = [...new Set(itemsData.map(i => i.category).filter(Boolean))];
  const byId = {};
  itemsData.forEach(i => { byId[i.item_id] = i; });

  const selected = {};
  (order ? order.items : []).forEach(it => {
    if (it.requested_quantity > 0 && byId[it.item_id]) selected[it.item_id] = it.requested_quantity;
  });
  let notes = (order && order.notes) || '';
  let q = '';
  let cat = '';

  function draw() {
    const filtered = itemsData.filter(i => {
      if (cat && i.category !== cat) return false;
      if (q && (i.item_name + ' ' + (i.item_code || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const rows = filtered.map(i =>
      '<div class="pick-row" data-id="' + esc(i.item_id) + '">' +
      '<div class="pick-info"><b>' + esc(i.item_name) + '</b>' +
      '<span class="pick-meta">' + esc(i.category) + ' · ' + esc(i.unit) +
      (i.max_quantity ? ' · max ' + fmtNum(i.max_quantity) : '') + '</span></div>' +
      '<div data-stepper>' + qtyControl(selected[i.item_id] || '', i.max_quantity) + '</div>' +
      '</div>').join('');

    view.innerHTML =
      '<div class="page-head"><div><h2>' + esc(order ? ('#' + order.order_number) : t('nav.newOrder')) + '</h2>' +
      '<p class="page-sub">' + esc(t('order.noSelection')) + '</p></div></div>' +
      '<div class="order-layout">' +
      '<div class="card catalog-card">' +
      '<div class="catalog-tools">' +
      '<div class="search-box">' + icon('search', 16) +
      '<input class="input plain" id="itemSearch" value="' + esc(q) + '" placeholder="' + esc(t('order.searchItems')) + '"></div>' +
      '<select class="input plain" id="catFilter"><option value="">' + esc(t('order.filterCategory')) + '</option>' +
      categories.map(c => '<option value="' + esc(c) + '"' + (cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '</select></div>' +
      '<div class="pick-list" id="pickList">' + (rows || '<div class="empty small">' + esc(t('order.noCatalog')) + '</div>') + '</div>' +
      '</div>' +
      '<div class="card order-card">' +
      '<h3>' + esc(t('order.items')) + '</h3><div class="summary" id="summary"></div>' +
      '<label class="field"><span class="field-label">' + esc(t('order.notes')) + '</span>' +
      '<textarea class="input" id="notes" rows="3" placeholder="optional">' + esc(notes) + '</textarea></label>' +
      '<div class="form-actions">' +
      '<button class="btn btn-primary" id="btnSubmit">' + icon('send', 15) + ' ' + esc(t('order.submit')) + '</button>' +
      '<button class="btn btn-ghost" id="btnDraft">' + esc(t('order.saveDraft')) + '</button>' +
      '</div></div></div>';

    const list = document.getElementById('pickList');
    const summary = document.getElementById('summary');

    const redrawSummary = () => {
      const entries = Object.entries(selected).filter(([, v]) => Number(v) > 0);
      if (!entries.length) { summary.innerHTML = '<div class="empty small">' + esc(t('order.noSelection')) + '</div>'; return; }
      let total = 0;
      summary.innerHTML = entries.map(([id, v]) => {
        total += Number(v);
        const it = byId[id];
        return '<div class="sum-row"><span>' + esc(it.item_name) + '</span><b>' + fmtNum(v) + ' ' + esc(it.unit) + '</b></div>';
      }).join('') + '<div class="sum-total"><span>' + esc(t('order.total')) + '</span><b>' + fmtNum(total) + '</b></div>';
    };
    attachQty(view);
    list.addEventListener('input', (e) => {
      if (!e.target.classList.contains('qty-val')) return;
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const val = parseFloat(e.target.value);
      selected[row.dataset.id] = !isNaN(val) && val > 0 ? val : '';
      redrawSummary();
    });
    document.getElementById('itemSearch').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); draw(); });
    document.getElementById('catFilter').addEventListener('change', (e) => { cat = e.target.value; draw(); });
    document.getElementById('notes').addEventListener('input', (e) => { notes = e.target.value; });

    document.getElementById('btnDraft').addEventListener('click', () => saveDraft(order));
    document.getElementById('btnSubmit').addEventListener('click', () => submitOrder(order));
    redrawSummary();

    async function saveDraft(current) {
      const payload = buildPayload().items;
      try {
        if (current) await api('orders.save', { order_id: current.order_id, items: payload, notes });
        else await api('orders.create', { items: payload, notes });
        toast(t('msg.saved'), 'success');
      } catch (e) { toast(errorText(e), 'error'); }
    }

    function buildPayload() {
      const items = {};
      Object.entries(selected).forEach(([id, v]) => {
        if (Number(v) > 0) items[id] = Math.round(Number(v) * 100) / 100;
      });
      return { items, notes };
    }

    async function submitOrder(current) {
      if (!Object.keys(selected).some(k => Number(selected[k]) > 0)) {
        toast(t('err.empty_order'), 'error');
        return;
      }
      const ok = await confirmDialog({
        title: t('common.confirm'),
        message: t('order.confirmSubmit'),
        confirmLabel: t('order.submit')
      });
      if (!ok) return;
      try {
        let id = current ? current.order_id : null;
        if (!id) id = (await api('orders.create', { items: buildPayload().items, notes })).order_id;
        else await api('orders.save', { order_id: id, items: buildPayload().items, notes });
        await api('orders.submit', { order_id: id });
        toast(t('msg.submitted'), 'success');
        location.hash = '#/orders';
      } catch (e) { toast(errorText(e), 'error'); }
    }
  }
  draw();
}

/* ---------------- order detail ---------------- */
async function orderDetail(view, orderId, ctx) {
  view.innerHTML = skeletons(1, 6);
  try {
    const order = await api('orders.detail', { order_id: orderId });
    const u = ctx.user;
    const canEdit = order.status === 'draft' && order.branch_id === u.branch_id;

    const info = [
      [t('order.branch'), order.branch_name || ''],
      [t('order.createdAt'), fmtDate(order.created_at)],
      [t('order.submittedAt'), fmtDate(order.submitted_at)],
      [t('order.sentAt'), fmtDate(order.sent_at)],
      [t('order.receivedAt'), fmtDate(order.received_at)]
    ];
    const isStatement = ['sent', 'partially_received', 'shortage_reported', 'received'].indexOf(order.status) !== -1;

    const rows = order.items.map(it =>
      '<tr><td><b>' + esc(it.item_name) + '</b><div class="sub">' + esc(it.item_code || '') + '</div></td>' +
      '<td class="center">' + numberCell(it.requested_quantity, it.unit) + '</td>' +
      '<td class="center">' + numberCell(it.sent_quantity, it.unit) + '</td>' +
      '<td class="center">' + numberCell(it.received_quantity, it.unit) + '</td>' +
      '<td class="center">' + (it.shortage_quantity !== null ? numberCell(it.shortage_quantity, it.unit) : t('common.none')) + '</td>' +
      (isStatement ? '<td>' + esc(it.shortage_reason || '') + '</td>' : '') +
      '</tr>').join('');

    const meta =
      '<div class="card"><div class="card-head"><h3 class="mono">' + esc(order.order_number) + '</h3>' + badge(order.status) + '</div>' +
      '<div class="meta-grid">' + info.map(([k, v]) =>
        '<div class="meta"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>').join('') + '</div>' +
      (order.notes ? '<div class="note-box"><b>' + esc(t('order.notes')) + '</b><p>' + esc(order.notes) + '</p></div>' : '') +
      (order.admin_notes ? '<div class="note-box accent"><b>' + esc(t('order.adminNotes')) + '</b><p>' + esc(order.admin_notes) + '</p></div>' : '') +
      (order.cancel_reason ? '<div class="note-box danger"><b>' + esc(t('order.cancelReason')) + '</b><p>' + esc(order.cancel_reason) + '</p></div>' : '') +
      '</div>';

    const breakdown =
      '<div class="card"><div class="card-head"><h3>' + esc(t('order.items')) + '</h3></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>' + esc(t('manage.itemName')) + '</th>' +
      '<th class="center">' + esc(t('order.requested')) + '</th>' +
      '<th class="center">' + esc(t('order.sent')) + '</th>' +
      '<th class="center">' + esc(t('order.received')) + '</th>' +
      '<th class="center">' + esc(t('order.shortage')) + '</th>' +
      (isStatement ? '<th>' + esc(t('order.shortageReason')) + '</th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    let actions = '';
    if (canEdit || (order.status === 'sent' && order.branch_id === u.branch_id)) {
      if (canEdit) {
        actions = '<div class="form-actions"><a class="btn btn-primary" href="#/order/new?edit=' + esc(order.order_id) + '">' +
          icon('edit', 15) + ' ' + esc(t('order.edit')) + '</a>' +
          '<button class="btn btn-danger" id="cancelDraft">' + esc(t('order.cancel')) + '</button></div>';
      } else {
        actions = '<div class="form-actions"><button class="btn btn-primary" id="btnReceive">' +
          icon('check', 15) + ' ' + esc(t('receiving.confirm')) + '</button></div>';
      }
    }

    view.innerHTML =
      '<div class="page-head"><a class="btn btn-ghost" href="#/orders">' + icon('chevL', 16, 'flip-rtl') + ' ' + esc(t('common.back')) + '</a></div>' +
      '<div class="detail-grid">' + meta + breakdown + '</div>' + actions;

    if (document.getElementById('btnReceive')) {
      document.getElementById('btnReceive').addEventListener('click', () => receivingModal(order, ctx.render));
    }
    if (document.getElementById('cancelDraft')) {
      document.getElementById('cancelDraft').addEventListener('click', () => cancelDraft(order, ctx.render));
    }
  } catch (e) {
    view.innerHTML = emptyState(errorText(e));
  }
}

async function cancelDraft(order, render) {
  const reason = prompt(t('order.cancelReason') || 'Reason');
  if (reason === null) return;
  const ok = await confirmDialog({ title: t('common.confirm'), message: t('order.confirmCancel'), danger: true });
  if (!ok) return;
  try {
    await api('orders.cancel', { order_id: order.order_id, reason });
    toast(t('msg.statusUpdated'), 'success');
    render();
  } catch (e) { toast(errorText(e), 'error'); }
}

function receivingModal(order, render) {
  const body = '<p class="modal-msg">' + esc(t('receiving.perItemNote')) + '</p>' +
    '<div class="recv-list">' + order.items.map(it =>
      '<div class="recv-item" data-id="' + esc(it.item_id) + '">' +
      '<div class="recv-info"><b>' + esc(it.item_name) + '</b>' +
      '<em>' + esc(t('order.sent')) + ': ' + fmtNum(it.sent_quantity || 0) + ' ' + esc(it.unit) + '</em></div>' +
      '<div data-stepper>' + qtyControl(it.sent_quantity || 0, (it.sent_quantity || 0)) + '</div>' +
      '<input class="input plain small-input" data-reason type="text" placeholder="' + esc(t('order.shortageReason')) + '">' +
      '</div>').join('') + '</div>';

  const node = openModal({ title: t('receiving.title'), body, footer: '' });
  node.querySelector('.modal-foot').innerHTML =
    '<button class="btn btn-ghost" data-cancel>' + esc(t('common.cancel')) + '</button>' +
    '<button class="btn btn-primary" id="recvConfirm">' + esc(t('receiving.confirm')) + '</button>';
  attachQty(node);
  node.querySelector('[data-cancel]').addEventListener('click', closeModal);

  document.getElementById('recvConfirm').addEventListener('click', async () => {
    const quantities = {};
    const reasons = {};
    node.querySelectorAll('.recv-item').forEach(r => {
      const id = r.dataset.id;
      const sent = parseFloat(r.querySelector('.recv-info em').textContent.replace(/[^0-9.-]/g, ''));
      const val = parseFloat(r.querySelector('.qty-val').value);
      quantities[id] = (!isNaN(val) && val !== sent) ? val : sent;
      const reason = r.querySelector('[data-reason]').value.trim();
      if (reason) reasons[id] = reason;
    });
    document.getElementById('recvConfirm').disabled = true;
    try {
      await api('orders.receive', { order_id: order.order_id, quantities, reasons });
      toast(t('msg.received'), 'success');
      closeModal();
      render();
    } catch (e) {
      toast(errorText(e), 'error');
      document.getElementById('recvConfirm').disabled = false;
    }
  });
}