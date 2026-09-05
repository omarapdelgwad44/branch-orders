import { fail, ORDER_STATUS, ORDERABLE_STATUSES, USER_ROLES, USER_STATUS } from './lib.mjs';

export function createOrders(store, cfg, ids, activity, Items) {
  let activeBranch_ = null;

  async function itemsMap() {
    const map = {};
    (await store.all('Items')).forEach((r) => { map[r.item_id] = r; });
    return map;
  }
  async function branchMap() {
    const map = {};
    (await store.all('Branches')).forEach((r) => { map[r.branch_id] = r; });
    return map;
  }

  function validateQty(q, allowDecimal) {
    if (q === null || q === undefined || q === '') return null;
    const n = Number(q);
    if (isNaN(n) || !isFinite(n)) return null;
    if (allowDecimal) return Math.round(n * 1000) / 1000;
    return Math.round(n);
  }

  function qtyMap(requested) {
    if (!requested) return {};
    if (Array.isArray(requested)) {
      const map = {};
      requested.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const id = row.item_id || row.itemId;
        if (!id) return;
        map[String(id)] = row.quantity ?? row.requested_quantity ?? row.qty;
      });
      return map;
    }
    return typeof requested === 'object' ? requested : {};
  }

  async function checkBranchState(branchId) {
    const b = await store.find('Branches', 'branch_id', branchId);
    if (!b) fail('validation', 'Branch not found.');
    if (String(b.status) !== USER_STATUS.ACTIVE) {
      fail('branch_inactive', 'Your branch is disabled. Contact your administrator.');
    }
  }

  function orderSummary(row, bm) {
    return {
      order_id: row.order_id,
      order_number: row.order_number,
      branch_id: String(row.branch_id || ''),
      branch_name: (bm && bm[row.branch_id] && bm[row.branch_id].branch_name) || '',
      branch_code: (bm && bm[row.branch_id] && bm[row.branch_id].branch_code) || '',
      status: row.status,
      notes: row.notes || '',
      admin_notes: row.admin_notes || '',
      cancel_reason: row.cancel_reason || '',
      created_at: row.created_at,
      submitted_at: row.submitted_at || '',
      processed_at: row.processed_at || '',
      sent_at: row.sent_at || '',
      received_at: row.received_at || '',
      updated_at: row.updated_at
    };
  }

  function numOrNull(v) {
    return v === '' || v === null || v === undefined ? null : Number(v);
  }

  async function withItems(order) {
    if (!order) return null;
    const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(order.order_id));
    const itm = await itemsMap();
    const items = lines.map((r) => {
      const m = itm[r.item_id] || {};
      return {
        order_item_id: r.order_item_id,
        item_id: r.item_id,
        item_name: m.item_name || r.item_id,
        item_code: m.item_code || '',
        unit: m.unit || 'pc',
        category: m.category || '',
        requested_quantity: Number(r.requested_quantity) || 0,
        approved_quantity: numOrNull(r.approved_quantity),
        sent_quantity: numOrNull(r.sent_quantity),
        received_quantity: numOrNull(r.received_quantity),
        shortage_quantity: numOrNull(r.shortage_quantity),
        shortage_reason: r.shortage_reason || ''
      };
    });
    order.items = items;
    let req = 0, sent = 0, recv = 0, short = 0;
    items.forEach((it) => {
      req += it.requested_quantity || 0;
      sent += it.sent_quantity || 0;
      recv += it.received_quantity || 0;
      short += it.shortage_quantity || 0;
    });
    order.total_requested = req;
    order.total_sent = sent;
    order.total_received = recv;
    order.total_shortage = short;
    return order;
  }

  async function saveItems(requested, allowDecimalQty, isDraft) {
    const itm = await itemsMap();
    const avail = {};
    if (isDraft) {
      (await store.all('Branch_Items')).forEach((r) => {
        if (String(r.branch_id) === String(activeBranch_)) {
          avail[r.item_id] = r.max_quantity === '' || r.max_quantity === null || r.max_quantity === undefined
            ? null
            : Number(r.max_quantity);
        }
      });
    }
    const qtyByItem = qtyMap(requested);
    const clean = [];
    for (const itemId of Object.keys(qtyByItem)) {
      const q = validateQty(qtyByItem[itemId], allowDecimalQty);
      if (q === null || q <= 0) continue;
      const m = itm[itemId];
      if (!m) fail('validation', 'Unknown item: ' + itemId);
      if (isDraft) {
        const cat = await Items.catalogForBranch(activeBranch_);
        if (!cat.some((c) => c.item_id === itemId)) fail('validation', 'This item is not available to your branch.');
        const cap = avail[itemId];
        if (cap !== null && cap !== undefined && !isNaN(cap) && q > cap) {
          fail('validation', 'Quantity exceeds the maximum allowed for this item.');
        }
      }
      clean.push({ item_id: itemId, quantity: q });
    }
    return clean;
  }

  async function withBranch(branchId, fn) {
    const prev = activeBranch_;
    activeBranch_ = branchId;
    try { return await fn(); } finally { activeBranch_ = prev; }
  }

  async function findOrder(orderId) {
    const o = await store.find('Orders', 'order_id', orderId);
    if (!o) fail('not_found', 'Order not found.');
    return o;
  }

  function assertDraft(row) {
    if (String(row.status) !== ORDER_STATUS.DRAFT) fail('not_draft', 'Only draft orders can be edited.');
  }

  async function createDraft(user, requested, notes) {
    const bm = await branchMap();
    if (!user.branch_id) fail('forbidden', 'No branch assigned.');
    await checkBranchState(user.branch_id);
    const id = await ids.orderId();
    const now = await cfg.now();
    const rec = await store.insert('Orders', {
      order_id: id,
      order_number: id,
      branch_id: user.branch_id,
      created_by: user.user_id,
      status: ORDER_STATUS.DRAFT,
      notes: String(notes || ''),
      admin_notes: '',
      cancel_reason: '',
      submitted_at: '',
      processed_at: '',
      sent_at: '',
      received_at: '',
      created_at: now,
      updated_at: now
    });
    const allowDec = await cfg.bool('ALLOW_DECIMAL_QTY');
    const clean = await withBranch(user.branch_id, () => saveItems(requested || {}, allowDec, true));
    for (const c of clean) {
      await store.insert('Order_Items', {
        order_item_id: await ids.lineId(),
        order_id: id,
        item_id: c.item_id,
        requested_quantity: c.quantity,
        approved_quantity: '',
        sent_quantity: '',
        received_quantity: '',
        shortage_quantity: '',
        shortage_reason: '',
        created_at: now,
        updated_at: now
      });
    }
    await activity.log(user.user_id, 'order_draft_created', 'order', id, { notes: String(notes || '').slice(0, 200) });
    return withItems(orderSummary(rec, bm));
  }

  async function saveDraft(user, orderId, requested, notes) {
    const bm = await branchMap();
    const row = await findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user or branch.');
    assertDraft(row);
    const now = await cfg.now();
    if (requested) {
      const allowDec = await cfg.bool('ALLOW_DECIMAL_QTY');
      const clean = await withBranch(user.branch_id, () => saveItems(requested, allowDec, true));
      const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(orderId));
      for (const r of lines) await store.update('Order_Items', r, { updated_at: now, requested_quantity: 0 });
      for (const c of clean) {
        const hit = (await store.all('Order_Items')).find((r) =>
          String(r.order_id) === String(orderId) && String(r.item_id) === c.item_id);
        if (hit) await store.update('Order_Items', hit, { requested_quantity: c.quantity, updated_at: now });
        else {
          await store.insert('Order_Items', {
            order_item_id: await ids.lineId(),
            order_id: orderId,
            item_id: c.item_id,
            requested_quantity: c.quantity,
            approved_quantity: '',
            sent_quantity: '',
            received_quantity: '',
            shortage_quantity: '',
            shortage_reason: '',
            created_at: now,
            updated_at: now
          });
        }
      }
    }
    const padded = await store.update('Orders', row, {
      notes: String(notes === undefined ? (row.notes || '') : (notes || '')).slice(0, 1000),
      updated_at: now
    });
    await activity.log(user.user_id, 'order_draft_saved', 'order', orderId, {});
    return withItems(orderSummary(padded, bm));
  }

  async function submit(user, orderId) {
    const bm = await branchMap();
    const row = await findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user.');
    assertDraft(row);
    const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(orderId));
    if (!lines.some((r) => Number(r.requested_quantity) > 0)) fail('empty_order', 'You cannot submit an empty order.');
    await checkBranchState(user.branch_id);
    const now = await cfg.now();
    const updated = await store.update('Orders', row, {
      status: ORDER_STATUS.SUBMITTED,
      submitted_at: now,
      updated_at: now
    });
    await activity.log(user.user_id, 'order_submitted', 'order', orderId, { lines: lines.length });
    return withItems(orderSummary(updated, bm));
  }

  async function cancelByBranch(user, orderId, reason) {
    const row = await findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user.');
    assertDraft(row);
    const updated = await store.update('Orders', row, {
      status: ORDER_STATUS.CANCELLED,
      cancel_reason: String(reason || '').slice(0, 500),
      updated_at: await cfg.now()
    });
    await activity.log(user.user_id, 'order_cancelled_by_branch', 'order', orderId, { reason: String(reason || '').slice(0, 200) });
    return withItems(orderSummary(updated, await branchMap()));
  }

  async function listForBranch(user, status) {
    const rows = (await store.all('Orders')).filter((r) => {
      if (String(r.branch_id) !== String(user.branch_id)) return false;
      if (status && String(r.status) !== String(status)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    const bm = await branchMap();
    const out = [];
    for (const r of rows) out.push(await withItems(orderSummary(r, bm)));
    return out;
  }

  async function applyFilters(rows, filters, bm) {
    const f = filters || {};
    const out = [];
    for (const r of rows) {
      if (f.status && String(r.status) !== String(f.status)) continue;
      if (f.branch_id && String(r.branch_id) !== String(f.branch_id)) continue;
      if (f.from) {
        const fd = new Date(String(f.from));
        if (!isNaN(fd.getTime()) && new Date(r.created_at) < fd) continue;
      }
      if (f.to) {
        const td = new Date(String(f.to) + 'T23:59:59');
        if (!isNaN(td.getTime()) && new Date(r.created_at) > td) continue;
      }
      if (f.search) {
        const s = String(f.search).toLowerCase();
        const br = (bm && bm[r.branch_id] && bm[r.branch_id].branch_name) || '';
        let hit = String(r.order_id).toLowerCase().indexOf(s) !== -1 ||
          String(r.order_number || '').toLowerCase().indexOf(s) !== -1 ||
          String(br).toLowerCase().indexOf(s) !== -1 ||
          String(r.status).toLowerCase().indexOf(s) !== -1;
        if (!hit) {
          const lines = (await store.all('Order_Items')).filter((l) => String(l.order_id) === String(r.order_id));
          const itm = await itemsMap();
          hit = lines.some((l) => String((itm[l.item_id] && itm[l.item_id].item_name) || '').toLowerCase().indexOf(s) !== -1);
        }
        if (!hit) continue;
      }
      out.push(r);
    }
    return out;
  }

  async function listAll(filters, page, pageSize) {
    const rows = await store.all('Orders');
    const bm = await branchMap();
    const list = await applyFilters(rows, filters, bm);
    list.sort((a, b) => {
      const c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    const total = list.length;
    const p = page || 1;
    const size = pageSize || 50;
    const slice = list.slice((p - 1) * size, (p - 1) * size + size);
    const orders = [];
    for (const r of slice) orders.push(await withItems(orderSummary(r, bm)));
    return { orders, total, page: p, page_size: size };
  }

  const TRANSITIONS = {
    draft: { submitted: true, cancelled: true },
    submitted: { approved: true, cancelled: true, processing: true },
    approved: { processing: true, cancelled: true },
    processing: { sent: true, cancelled: true },
    sent: { cancelled: true },
    received: { sent: true },
    partially_received: { sent: true },
    shortage_reported: { sent: true },
    cancelled: {}
  };

  async function applyQty(orderId, column, byItem, fallbackColumn) {
    const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(orderId));
    const now = await cfg.now();
    for (const l of lines) {
      const q = byItem && byItem[l.item_id];
      let value;
      if (q === undefined || q === null || q === '') {
        const fb = fallbackColumn || 'approved_quantity';
        let cand = l[fb];
        if (cand === '' || cand === null || cand === undefined) cand = l.requested_quantity;
        value = Math.max(0, Number(cand) || 0);
      } else {
        value = Math.max(0, Number(q));
      }
      const patch = { updated_at: now };
      patch[column] = value;
      await store.update('Order_Items', l, patch);
    }
  }

  async function adminTransition(user, orderId, to, payload) {
    payload = payload || {};
    const row = await findOrder(orderId);
    const current = String(row.status);
    const transitions = TRANSITIONS[current];
    if (!transitions || !transitions[to]) {
      fail('invalid_transition', 'This status change is not allowed from the current state.');
    }
    const patch = {
      updated_at: await cfg.now(),
      admin_notes: payload.notes === undefined ? (row.admin_notes || '') : String(payload.notes || '')
    };
    if (to === ORDER_STATUS.APPROVED) {
      patch.processed_at = await cfg.now();
      await applyQty(orderId, 'approved_quantity', payload.approved_qty);
    }
    if (to === ORDER_STATUS.PROCESSING) {
      if (String(current) === ORDER_STATUS.SUBMITTED) await applyQty(orderId, 'approved_quantity', payload.approved_qty);
      patch.processed_at = row.processed_at || await cfg.now();
    }
    if (to === ORDER_STATUS.SENT) {
      await applyQty(orderId, 'sent_quantity', payload.sent_qty, 'approved_quantity');
      patch.sent_at = await cfg.now();
    }
    if (to === ORDER_STATUS.CANCELLED) {
      patch.cancel_reason = String(payload.reason || (row.cancel_reason || '')).slice(0, 500);
    }
    patch.status = to;
    const updated = await store.update('Orders', row, patch);
    await activity.log(user.user_id, 'order_status_' + to, 'order', orderId, { from: current, to });
    return withItems(orderSummary(updated, await branchMap()));
  }

  async function reopen(user, orderId) {
    const row = await findOrder(orderId);
    const current = String(row.status);
    if (ORDERABLE_STATUSES.indexOf(current) !== -1) {
      fail('invalid_transition', 'Only received or shortage orders can be reopened.');
    }
    const now = await cfg.now();
    const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(orderId));
    for (const r of lines) {
      await store.update('Order_Items', r, {
        received_quantity: '',
        shortage_quantity: '',
        shortage_reason: '',
        updated_at: now
      });
    }
    const updated = await store.update('Orders', row, { status: ORDER_STATUS.SENT, received_at: '', updated_at: now });
    await activity.log(user.user_id, 'order_reopened', 'order', orderId, { from: current, to: ORDER_STATUS.SENT });
    return withItems(orderSummary(updated, await branchMap()));
  }

  async function receive(user, orderId, payload) {
    const bm = await branchMap();
    const row = await findOrder(orderId);
    if (String(row.branch_id) !== String(user.branch_id)) fail('forbidden', 'This order belongs to another branch.');
    if (String(row.status) !== ORDER_STATUS.SENT) fail('not_sent', 'This order is not ready to be received.');
    const quantities = (payload && payload.quantities && typeof payload.quantities === 'object') ? payload.quantities : (payload || {});
    const reasons = (payload && payload.reasons && typeof payload.reasons === 'object') ? payload.reasons : {};
    const lines = (await store.all('Order_Items')).filter((r) => String(r.order_id) === String(orderId));
    let allOk = true, anyShort = false, anyReason = false;
    const now = await cfg.now();
    for (const l of lines) {
      const base = l.sent_quantity === '' || l.sent_quantity === null || l.sent_quantity === undefined ? 0 : Number(l.sent_quantity);
      const raw = quantities[l.item_id];
      const inc = raw === undefined || raw === null || raw === '' ? base : Number(raw);
      if (isNaN(inc) || inc < 0) fail('invalid_received', 'Received quantities must be zero or positive.');
      if (inc > base) fail('invalid_received', 'Received quantity cannot exceed the quantity sent.');
      const shortage = Math.max(0, base - inc);
      const reason = String(reasons[l.item_id] || '').slice(0, 300);
      if (shortage > 0) { anyShort = true; if (reason) anyReason = true; }
      if (inc !== base) allOk = false;
      await store.update('Order_Items', l, {
        received_quantity: inc,
        shortage_quantity: shortage,
        shortage_reason: reason,
        updated_at: now
      });
    }
    let finalStatus;
    if (allOk && !anyShort) finalStatus = ORDER_STATUS.RECEIVED;
    else if (anyShort && anyReason) finalStatus = ORDER_STATUS.SHORTAGE_REPORTED;
    else if (anyShort) finalStatus = ORDER_STATUS.PARTIALLY_RECEIVED;
    else finalStatus = ORDER_STATUS.RECEIVED;
    const patched = await store.update('Orders', row, {
      status: finalStatus,
      received_at: now,
      updated_at: now
    });
    await activity.log(user.user_id, 'order_received', 'order', orderId, { result: finalStatus });
    return withItems(orderSummary(patched, bm));
  }

  async function detail(user, orderId) {
    const row = await findOrder(orderId);
    if (user.role !== USER_ROLES.ADMIN && String(row.branch_id) !== String(user.branch_id)) {
      fail('forbidden', 'This order belongs to another branch.');
    }
    return withItems(orderSummary(row, await branchMap()));
  }

  return {
    createDraft,
    saveDraft,
    submit,
    cancelByBranch,
    listForBranch,
    listAll,
    adminTransition,
    reopen,
    receive,
    detail
  };
}
