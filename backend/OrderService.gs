/**
 * Order lifecycle: drafts, submission, admin transitions, receiving,
 * shortages. Every status change is validated, locked, and logged.
 */

var Orders = (function () {
  var ordersRepo = function () { return SheetsRepo.repo('Orders').ensure(); };
  var itemsRepo = function () { return SheetsRepo.repo('Order_Items').ensure(); };

  function itemsMap() {
    var map = {};
    SheetsRepo.repo('Items').readAll().forEach(function (r) {
      map[r.item_id] = r;
    });
    return map;
  }

  function branchMap() {
    var map = {};
    SheetsRepo.repo('Branches').readAll().forEach(function (r) { map[r.branch_id] = r; });
    return map;
  }

  function validateQty(q, allowDecimal) {
    if (q === null || q === undefined || q === '') return null;
    var n = Number(q);
    if (isNaN(n) || !isFinite(n)) return null;
    if (allowDecimal) return Math.round(n * 1000) / 1000;
    return Math.round(n);
  }

  function checkBranchState(branchId) {
    var b = SheetsRepo.repo('Branches').find('branch_id', branchId);
    if (!b) fail('validation', 'Branch not found.');
    if (String(b.status) !== USER_STATUS.ACTIVE) failed_inactive('Your branch is disabled. Contact your administrator.');
  }
  function failed_inactive(msg) { fail('branch_inactive', msg); }

  function orderSummary(row, branchMap_, itmMap) {
    return {
      order_id: row.order_id,
      order_number: row.order_number,
      branch_id: String(row.branch_id || ''),
      branch_name: (branchMap_ && branchMap_[row.branch_id] && branchMap_[row.branch_id].branch_name) || '',
      branch_code: (branchMap_ && branchMap_[row.branch_id] && branchMap_[row.branch_id].branch_code) || '',
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

  function withItems(order) {
    if (!order) return null;
    var lines = itemsRepo().readAll().filter(function (r) { return String(r.order_id) === String(order.order_id); });
    var itm = itemsMap();
    var items = lines.map(function (r) {
      var m = itm[r.item_id] || {};
      return {
        order_item_id: r.order_item_id,
        item_id: r.item_id,
        item_name: m.item_name || r.item_id,
        item_code: m.item_code || '',
        unit: m.unit || 'pc',
        category: m.category || '',
        requested_quantity: Number(r.requested_quantity) || 0,
        approved_quantity: r.approved_quantity === '' || r.approved_quantity === null ? null : Number(r.approved_quantity),
        sent_quantity: r.sent_quantity === '' || r.sent_quantity === null ? null : Number(r.sent_quantity),
        received_quantity: r.received_quantity === '' || r.received_quantity === null ? null : Number(r.received_quantity),
        shortage_quantity: r.shortage_quantity === '' || r.shortage_quantity === null ? null : Number(r.shortage_quantity),
        shortage_reason: r.shortage_reason || ''
      };
    });
    order.items = items;
    var req = 0, sent = 0, recv = 0, short = 0;
    items.forEach(function (it) {
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

  function saveItems(orderId, requested, allowDecimalQty, isDraft) {
    var itm = itemsMap();
    var avail = {};
    if (isDraft) {
      SheetsRepo.repo('Branch_Items').readAll().forEach(function (r) {
        if (String(r.branch_id) === String(activeBranch_)) avail[r.item_id] = r.max_quantity === '' || r.max_quantity === null ? null : Number(r.max_quantity);
      });
    }
    var clean = [];
    Object.keys(requested).forEach(function (itemId) {
      var q = validateQty(requested[itemId], allowDecimalQty);
      if (q === null || q <= 0) return;
      var m = itm[itemId];
      if (!m) fail('validation', 'Unknown item: ' + itemId);
      if (isDraft) {
        var cat = Items.catalogForBranch(activeBranch_);
        var found = cat.some(function (c) { return c.item_id === itemId; });
        if (!found) fail('validation', 'This item is not available to your branch.');
        var cap = avail[itemId];
        if (cap !== null && cap !== undefined && !isNaN(cap) && q > cap) {
          fail('validation', 'Quantity exceeds the maximum allowed for this item.');
        }
      }
      clean.push({ item_id: itemId, quantity: q });
    });
    return clean;
  }

  var activeBranch_ = null; // used only internally within draft validation
  function withBranch_(branchId, fn) {
    var prev = activeBranch_;
    activeBranch_ = branchId;
    try { return fn(); } finally { activeBranch_ = prev; }
  }

  function findOrder(orderId) {
    var o = ordersRepo().find('order_id', orderId);
    if (!o) fail('not_found', 'Order not found.');
    return o;
  }

  function assertDraft(row) {
    if (String(row.status) !== ORDER_STATUS.DRAFT) {
      fail('not_draft', 'Only draft orders can be edited.');
    }
  }

  function createDraft(user, requested, notes) {
    var bm = branchMap();
    if (!user.branch_id) fail('forbidden', 'No branch assigned.');
    checkBranchState(user.branch_id);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var id = Ids.orderId();
      var rec = ordersRepo().insert({
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
        created_at: nowIso(),
        updated_at: nowIso()
      });
      var allowDec = CONFIG.bool('ALLOW_DECIMAL_QTY');
      var clean = withBranch_(user.branch_id, function () {
        return saveItems(id, requested || {}, allowDec, true);
      });
      var repoItems = itemsRepo().ensure();
      clean.forEach(function (c) {
        repoItems.insert({
          order_item_id: Ids.lineId(),
          order_id: id,
          item_id: c.item_id,
          requested_quantity: c.quantity,
          approved_quantity: '',
          sent_quantity: '',
          received_quantity: '',
          shortage_quantity: '',
          shortage_reason: '',
          created_at: nowIso(),
          updated_at: nowIso()
        });
      });
      Activity.log(user.user_id, 'order_draft_created', 'order', id, { notes: String(notes || '').slice(0, 200) });
      return withItems(orderSummary(rec, bm));
    } finally {
      lock.releaseLock();
    }
  }

  function saveDraft(user, orderId, requested, notes) {
    var bm = branchMap();
    var row = findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user or branch.');
    assertDraft(row);
    var allowDec = CONFIG.bool('ALLOW_DECIMAL_QTY');
    if (requested) {
      var clean = withBranch_(user.branch_id, function () {
        return saveItems(orderId, requested, allowDec, true);
      });
      var repoItems = itemsRepo();
      repoItems.filterAll(function (r) { return String(r.order_id) === String(orderId); }).forEach(function (r) {
        repoItems.update(r, { updated_at: nowIso(), requested_quantity: 0 });
      });
      clean.forEach(function (c) {
        var hit = repoItems.filterAll(function (r) { return String(r.order_id) === String(orderId) && String(r.item_id) === c.item_id; })[0];
        if (hit) repoItems.update(hit, { requested_quantity: c.quantity, updated_at: nowIso() });
        else repoItems.insert({
          order_item_id: Ids.lineId(),
          order_id: orderId,
          item_id: c.item_id,
          requested_quantity: c.quantity,
          approved_quantity: '',
          sent_quantity: '',
          received_quantity: '',
          shortage_quantity: '',
          shortage_reason: '',
          created_at: nowIso(),
          updated_at: nowIso()
        });
      });
      repoItems.filterAll(function (r) { return String(r.order_id) === String(orderId) && r.requested_quantity <= 0; }).forEach(function (r) {});
    }
    var padded = ordersRepo().update(row, {
      notes: String(notes === undefined ? (row.notes || '') : (notes || '')).slice(0, 1000),
      updated_at: nowIso()
    });
    Activity.log(user.user_id, 'order_draft_saved', 'order', orderId, {});
    return withItems(orderSummary(padded, bm));
  }

  function submit(user, orderId) {
    var bm = branchMap();
    var row = findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user.');
    assertDraft(row);
    var lines = itemsRepo().readAll().filter(function (r) { return String(r.order_id) === String(orderId); });
    var hasQty = lines.some(function (r) { return Number(r.requested_quantity) > 0; });
    if (!hasQty) fail('empty_order', 'You cannot submit an empty order.');
    checkBranchState(user.branch_id);
    var updated = ordersRepo().update(row, {
      status: ORDER_STATUS.SUBMITTED,
      submitted_at: nowIso(),
      updated_at: nowIso()
    });
    Activity.log(user.user_id, 'order_submitted', 'order', orderId, { lines: lines.length });
    return withItems(orderSummary(updated, bm));
  }

  function cancelByBranch(user, orderId, reason) {
    var row = findOrder(orderId);
    if (String(row.created_by) !== user.user_id) fail('forbidden', 'This order belongs to another user.');
    assertDraft(row);
    var updated = ordersRepo().update(row, {
      status: ORDER_STATUS.CANCELLED,
      cancel_reason: String(reason || '').slice(0, 500),
      updated_at: nowIso()
    });
    Activity.log(user.user_id, 'order_cancelled_by_branch', 'order', orderId, { reason: String(reason || '').slice(0, 200) });
    return withItems(orderSummary(updated, branchMap()));
  }

  function listForBranch(user, status) {
    var rows = ordersRepo().readAll().filter(function (r) {
      if (String(r.branch_id) !== String(user.branch_id)) return false;
      if (status && String(r.status) !== String(status)) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    var bm = branchMap();
    return rows.map(function (r) { return withItems(orderSummary(r, bm)); });
  }

  function listAll(filters, page, pageSize) {
    var rows = ordersRepo().readAll();
    var bm = branchMap();
    var apply = applyFilters(rows, filters, bm);
    apply.list.sort(function (a, b) {
      var c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    var total = apply.list.length;
    var p = page || 1;
    var size = pageSize || 50;
    var start = (p - 1) * size;
    var slice = apply.list.slice(start, start + size).map(function (r) { return withItems(orderSummary(r, bm, null)); });
    return { orders: slice, total: total, page: p, page_size: size };
  }

  function applyFilters(rows, filters, bm) {
    var f = filters || {};
    var out = rows.filter(function (r) {
      if (f.status && String(r.status) !== String(f.status)) return false;
      if (f.branch_id && String(r.branch_id) !== String(f.branch_id)) return false;
      if (f.from) {
        var fd = new Date(String(f.from));
        if (!isNaN(fd.getTime()) && new Date(r.created_at) < fd) return false;
      }
      if (f.to) {
        var td = new Date(String(f.to) + 'T23:59:59');
        if (!isNaN(td.getTime()) && new Date(r.created_at) > td) return false;
      }
      if (f.search) {
        var s = String(f.search).toLowerCase();
        var br = (bm && bm[r.branch_id] && bm[r.branch_id].branch_name) || '';
        var hit = String(r.order_id).toLowerCase().indexOf(s) !== -1 ||
          String(r.order_number || '').toLowerCase().indexOf(s) !== -1 ||
          String(br).toLowerCase().indexOf(s) !== -1 ||
          String(r.status).toLowerCase().indexOf(s) !== -1;
        if (!hit) {
          var lines = itemsRepo().readAll().filter(function (l) { return String(l.order_id) === String(r.order_id); });
          var itm = itemsMap();
          hit = lines.some(function (l) {
            return String((itm[l.item_id] && itm[l.item_id].item_name) || '').toLowerCase().indexOf(s) !== -1;
          });
        }
        if (!hit) return false;
      }
      return true;
    });
    return { list: out };
  }

  var TRANSITIONS = {
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

  function adminTransition(user, orderId, to, payload) {
    var row = findOrder(orderId);
    var current = String(row.status);
    var transitions = TRANSITIONS[current];
    if (!transitions || !transitions[to]) {
      fail('invalid_transition', 'This status change is not allowed from the current state.');
    }
    var patch = { updated_at: nowIso(), admin_notes: payload.notes === undefined ? (row.admin_notes || '') : String(payload.notes || '') };

    if (to === ORDER_STATUS.APPROVED) {
      patch.processed_at = '';
      applyQty_(orderId, 'approved_quantity', payload.approved_qty);
    }
    if (to === ORDER_STATUS.PROCESSING) {
      if (String(current) === ORDER_STATUS.SUBMITTED) applyQty_(orderId, 'approved_quantity', payload.approved_qty);
      patch.processed_at = row.processed_at || nowIso();
    }
    if (to === ORDER_STATUS.SENT) {
      applyQty_(orderId, 'sent_quantity', payload.sent_qty, 'approved_quantity');
      patch.sent_at = nowIso();
    }
    if (to === ORDER_STATUS.CANCELLED) {
      patch.cancel_reason = String(payload.reason || (row.cancel_reason || '')).slice(0, 500);
    }
    patch.status = to;
    var updated = ordersRepo().update(row, patch);
    Activity.log(user.user_id, 'order_status_' + to, 'order', orderId, { from: current, to: to });
    return withItems(orderSummary(updated, branchMap()));
  }

  function reopen(user, orderId) {
    var row = findOrder(orderId);
    var current = String(row.status);
    if (ORDERABLE_STATUSES.indexOf(current) !== -1) fail('invalid_transition', 'Only received or shortage orders can be reopened.');
    var repoItems = itemsRepo();
    repoItems.filterAll(function (r) { return String(r.order_id) === String(orderId); }).forEach(function (r) {
      repoItems.update(r, {
        received_quantity: '',
        shortage_quantity: '',
        shortage_reason: '',
        updated_at: nowIso()
      });
    });
    var updated = ordersRepo().update(row, { status: ORDER_STATUS.SENT, received_at: '', updated_at: nowIso() });
    Activity.log(user.user_id, 'order_reopened', 'order', orderId, { from: current, to: ORDER_STATUS.SENT });
    return withItems(orderSummary(updated, branchMap()));
  }

  function applyQty_(orderId, column, byItem, fallbackColumn) {
    var repoItems = itemsRepo();
    var lines = repoItems.readAll().filter(function (r) { return String(r.order_id) === String(orderId); });
    lines.forEach(function (l) {
      var q = byItem && byItem[l.item_id];
      var value;
      if (q === undefined || q === null || q === '') {
        var fb = fallbackColumn || 'approved_quantity';
        var cand = l[fb];
        if (cand === '' || cand === null || cand === undefined) cand = l.requested_quantity;
        value = Math.max(0, Number(cand) || 0);
      } else {
        value = Math.max(0, Number(q));
      }
      var patch = { updated_at: nowIso() };
      patch[column] = value;
      repoItems.update(l, patch);
    });
  }

  function receive(user, orderId, payload) {
    var bm = branchMap();
    var row = findOrder(orderId);
    if (String(row.branch_id) !== String(user.branch_id)) fail('forbidden', 'This order belongs to another branch.');
    if (String(row.status) !== ORDER_STATUS.SENT) fail('not_sent', 'This order is not ready to be received.');
    var quantities = (payload && payload.quantities && typeof payload.quantities === 'object') ? payload.quantities : (payload || {});
    var reasons = (payload && payload.reasons && typeof payload.reasons === 'object') ? payload.reasons : {};
    var repoItems = itemsRepo();
    var lines = repoItems.readAll().filter(function (r) { return String(r.order_id) === String(orderId); });
    var allOk = true;
    var anyShort = false;
    var anyReason = false;
    lines.forEach(function (l) {
      var base = l.sent_quantity === '' || l.sent_quantity === null ? 0 : Number(l.sent_quantity);
      var raw = quantities[l.item_id];
      var inc = raw === undefined || raw === null || raw === '' ? base : Number(raw);
      if (isNaN(inc) || inc < 0) fail('invalid_received', 'Received quantities must be zero or positive.');
      if (inc > base) fail('invalid_received', 'Received quantity cannot exceed the quantity sent.');
      var shortage = Math.max(0, base - inc);
      var reason = String(reasons[l.item_id] || '').slice(0, 300);
      if (shortage > 0) { anyShort = true; if (reason) anyReason = true; }
      if (inc !== base) allOk = false;
      repoItems.update(l, {
        received_quantity: inc,
        shortage_quantity: shortage,
        shortage_reason: reason,
        updated_at: nowIso()
      });
    });
    var finalStatus;
    if (allOk && !anyShort) finalStatus = ORDER_STATUS.RECEIVED;
    else if (anyShort && anyReason) finalStatus = ORDER_STATUS.SHORTAGE_REPORTED;
    else if (anyShort) finalStatus = ORDER_STATUS.PARTIALLY_RECEIVED;
    else finalStatus = ORDER_STATUS.RECEIVED;
    var patched = ordersRepo().update(row, {
      status: finalStatus,
      received_at: nowIso(),
      updated_at: nowIso()
    });
    Activity.log(user.user_id, 'order_received', 'order', orderId, { result: finalStatus });
    return withItems(orderSummary(patched, bm));
  }

  /**
   * Receiving supports two payload shapes:
   *   { quantities: {itemId: n}, reasons: {itemId: 'text'} }  (clean shape)
   *   { itemId: n }                                           (flat shape)
   */

  function detail(user, orderId) {
    var row = findOrder(orderId);
    var isAdmin = user.role === USER_ROLES.ADMIN;
    if (!isAdmin && String(row.branch_id) !== String(user.branch_id)) {
      fail('forbidden', 'This order belongs to another branch.');
    }
    return withItems(orderSummary(row, branchMap()));
  }

  return {
    createDraft: createDraft,
    saveDraft: saveDraft,
    submit: submit,
    cancelByBranch: cancelByBranch,
    listForBranch: listForBranch,
    listAll: listAll,
    adminTransition: adminTransition,
    reopen: reopen,
    receive: receive,
    detail: detail,
    status: ORDER_STATUS
  };
})();