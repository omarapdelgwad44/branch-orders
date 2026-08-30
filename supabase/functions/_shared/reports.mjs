import { fail, ORDER_STATUS } from './lib.mjs';

export function createReports(store, cfg, activity) {
  async function itemsMap() {
    const map = {};
    (await store.all('Items')).forEach((r) => { map[r.item_id] = r; });
    return map;
  }
  async function branchesMap() {
    const map = {};
    (await store.all('Branches')).forEach((r) => { map[r.branch_id] = r; });
    return map;
  }

  function filterRange(createdAt, f) {
    const v = new Date(createdAt);
    if (isNaN(v.getTime())) return true;
    if (f.from && v < new Date(f.from)) return false;
    if (f.to && v > new Date(String(f.to) + 'T23:59:59')) return false;
    return true;
  }

  async function filteredOrders(filters) {
    const f = filters || {};
    const bm = await branchesMap();
    const im = await itemsMap();
    const allItems = await store.all('Order_Items');
    const rows = (await store.all('Orders')).filter((o) => {
      if (f.status && String(o.status) !== String(f.status)) return false;
      if (f.branch_id && String(o.branch_id) !== String(f.branch_id)) return false;
      if (!filterRange(o.created_at, f)) return false;
      if (f.search) {
        const s = String(f.search).toLowerCase();
        const br = (bm[o.branch_id] && bm[o.branch_id].branch_name) || '';
        let inline = String(o.order_id).toLowerCase().indexOf(s) !== -1 ||
          String(br).toLowerCase().indexOf(s) !== -1 ||
          String(o.order_number || '').toLowerCase().indexOf(s) !== -1;
        if (!inline) {
          inline = allItems.some((l) =>
            String(l.order_id) === String(o.order_id) &&
            String((im[l.item_id] && im[l.item_id].item_name) || '').toLowerCase().indexOf(s) !== -1);
        }
        if (!inline) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    return { rows, bm, im, allItems };
  }

  function withTotals(o, im, items) {
    let req = 0, appr = 0, sent = 0, recv = 0, short = 0;
    const names = [];
    items.forEach((l) => {
      req += Number(l.requested_quantity) || 0;
      appr += Number(l.approved_quantity) || 0;
      sent += Number(l.sent_quantity) || 0;
      recv += Number(l.received_quantity) || 0;
      short += Number(l.shortage_quantity) || 0;
      names.push((im[l.item_id] && im[l.item_id].item_name) || l.item_id);
    });
    return {
      order_id: o.order_id,
      order_number: o.order_number,
      branch_id: o.branch_id,
      status: o.status,
      created_at: o.created_at,
      submitted_at: o.submitted_at,
      sent_at: o.sent_at,
      received_at: o.received_at,
      notes: o.notes || '',
      items_list: names.join(', ').slice(0, 500),
      total_requested: req,
      total_approved: appr,
      total_sent: sent,
      total_received: recv,
      total_shortage: short
    };
  }

  async function ordersReport(filters) {
    const r = await filteredOrders(filters);
    return r.rows.map((o) => {
      const rec = withTotals(o, r.im, r.allItems.filter((l) => String(l.order_id) === String(o.order_id)));
      const br = r.bm[o.branch_id] || {};
      rec.branch_code = br.branch_code || '';
      rec.branch_name = br.branch_name || '';
      return rec;
    });
  }

  async function branchSummary(filters) {
    const r = await filteredOrders(filters);
    const agg = {};
    r.rows.forEach((o) => {
      const lines = r.allItems.filter((l) => String(l.order_id) === String(o.order_id));
      if (!agg[o.branch_id]) {
        const br = r.bm[o.branch_id] || {};
        agg[o.branch_id] = {
          branch_id: o.branch_id,
          branch_name: br.branch_name || o.branch_id,
          branch_code: br.branch_code || '',
          orders: 0, submitted: 0, sent: 0, received: 0, shortage_orders: 0,
          requested_total: 0, sent_total: 0, shortage_total: 0
        };
      }
      const a = agg[o.branch_id];
      a.orders++;
      if (o.status === ORDER_STATUS.SUBMITTED) a.submitted++;
      if (o.status === ORDER_STATUS.SENT) a.sent++;
      if ([ORDER_STATUS.RECEIVED, ORDER_STATUS.PARTIALLY_RECEIVED].indexOf(o.status) !== -1) a.received++;
      if (o.status === ORDER_STATUS.SHORTAGE_REPORTED) a.shortage_orders++;
      lines.forEach((l) => {
        a.requested_total += Number(l.requested_quantity) || 0;
        a.sent_total += Number(l.sent_quantity) || 0;
        a.shortage_total += Number(l.shortage_quantity) || 0;
      });
    });
    return Object.keys(agg).map((k) => agg[k]).sort((a, b) => b.orders - a.orders);
  }

  async function itemDemand(filters) {
    const r = await filteredOrders(filters);
    const map = {};
    r.rows.forEach((o) => {
      if (String(o.status) === ORDER_STATUS.DRAFT) return;
      r.allItems.filter((l) => String(l.order_id) === String(o.order_id)).forEach((l) => {
        if (!map[l.item_id]) {
          const it = r.im[l.item_id] || {};
          map[l.item_id] = {
            item_id: l.item_id,
            item_name: it.item_name || l.item_id,
            item_code: it.item_code || '',
            unit: it.unit || 'pc',
            category: it.category || '',
            requested: 0, approved: 0, sent: 0, received: 0, shortage: 0
          };
        }
        const x = map[l.item_id];
        x.requested += Number(l.requested_quantity) || 0;
        x.approved += Number(l.approved_quantity) || 0;
        x.sent += Number(l.sent_quantity) || 0;
        x.received += Number(l.received_quantity) || 0;
        x.shortage += Number(l.shortage_quantity) || 0;
      });
    });
    return Object.keys(map).map((k) => map[k]).filter((x) => x.requested > 0)
      .sort((a, b) => b.requested - a.requested);
  }

  async function shortageReport(filters) {
    const r = await filteredOrders(filters);
    const out = [];
    r.rows.forEach((o) => {
      if (o.status !== ORDER_STATUS.SHORTAGE_REPORTED && o.status !== ORDER_STATUS.PARTIALLY_RECEIVED) return;
      const br = r.bm[o.branch_id] || {};
      r.allItems.filter((l) => String(l.order_id) === String(o.order_id) && l.shortage_quantity > 0).forEach((l) => {
        const it = r.im[l.item_id] || {};
        out.push({
          order_number: o.order_number,
          branch_name: br.branch_name || o.branch_id,
          item_name: it.item_name || l.item_id,
          unit: it.unit || 'pc',
          sent_quantity: Number(l.sent_quantity) || 0,
          received_quantity: Number(l.received_quantity) || 0,
          shortage_quantity: Number(l.shortage_quantity) || 0,
          shortage_reason: l.shortage_reason || '',
          received_at: o.received_at || ''
        });
      });
    });
    return out;
  }

  function csvCell(value) {
    let s = String(value === undefined || value === null ? '' : value);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(headers, rows) {
    const lines = [headers.map((h) => csvCell(h)).join(',')];
    rows.forEach((r) => { lines.push(headers.map((h) => csvCell(r[h])).join(',')); });
    return lines.join('\r\n');
  }

  async function csv(kind, filters) {
    let cols, rows;
    if (kind === 'orders') {
      cols = ['order_id', 'order_number', 'branch_code', 'branch_name', 'status', 'created_at', 'submitted_at', 'sent_at', 'received_at', 'items_list', 'total_requested', 'total_approved', 'total_sent', 'total_received', 'total_shortage', 'notes'];
      rows = await ordersReport(filters);
    } else if (kind === 'branches') {
      cols = ['branch_id', 'branch_code', 'branch_name', 'orders', 'submitted', 'sent', 'received', 'shortage_orders', 'requested_total', 'sent_total', 'shortage_total'];
      rows = await branchSummary(filters);
    } else if (kind === 'items') {
      cols = ['item_id', 'item_code', 'item_name', 'category', 'unit', 'requested', 'approved', 'sent', 'received', 'shortage'];
      rows = await itemDemand(filters);
    } else if (kind === 'shortages') {
      cols = ['order_number', 'branch_name', 'item_name', 'unit', 'sent_quantity', 'received_quantity', 'shortage_quantity', 'shortage_reason', 'received_at'];
      rows = await shortageReport(filters);
    } else {
      fail('validation', 'Unknown report type.');
    }
    return {
      filename: kind + '-' + await cfg.stamp() + '.csv',
      csv: toCsv(cols, rows)
    };
  }

  function rangeFilter(dateStrFrom, dateStrTo) {
    return function (isoDate) {
      const vals = new Date(isoDate);
      if (isNaN(vals.getTime())) return true;
      if (dateStrFrom) {
        const f = new Date(dateStrFrom);
        if (vals < f) return false;
      }
      if (dateStrTo) {
        const t = new Date(dateStrTo + 'T23:59:59');
        if (vals > t) return false;
      }
      return true;
    };
  }

  async function metrics(from, to) {
    const orders = await store.all('Orders');
    const inRange = rangeFilter(from, to);
    const orderItems = await store.all('Order_Items');
    const branches = {};
    (await store.all('Branches')).forEach((b) => {
      if (branches[b.branch_id]) return;
      branches[b.branch_id] = { branch_id: b.branch_id, branch_code: b.branch_code, branch_name: b.branch_name, cnt: 0, orders: 0 };
    });
    const cards = {
      total: 0, drafts: 0, submitted: 0, processing: 0, sent: 0,
      received: 0, shortage: 0, cancelled: 0
    };
    const recent = [];
    orders.forEach((o) => {
      if (!inRange(o.created_at)) return;
      const s = String(o.status);
      cards.total++;
      if (s === ORDER_STATUS.DRAFT) cards.drafts++;
      if (s === ORDER_STATUS.SUBMITTED) cards.submitted++;
      if (s === ORDER_STATUS.APPROVED || s === ORDER_STATUS.PROCESSING) cards.processing++;
      if (s === ORDER_STATUS.SENT) cards.sent++;
      if (s === ORDER_STATUS.RECEIVED || s === ORDER_STATUS.PARTIALLY_RECEIVED) cards.received++;
      if (s === ORDER_STATUS.SHORTAGE_REPORTED) cards.shortage++;
      if (s === ORDER_STATUS.CANCELLED) cards.cancelled++;
      if (branches[o.branch_id]) branches[o.branch_id].orders++;
      recent.push({
        order_id: o.order_id,
        order_number: o.order_number,
        branch_id: o.branch_id,
        branch_name: (branches[o.branch_id] && branches[o.branch_id].branch_name) || '',
        status: s,
        created_at: o.created_at,
        updated_at: o.updated_at
      });
    });
    const byBranch = Object.keys(branches).map((k) => branches[k])
      .filter((b) => b.orders > 0)
      .sort((a, b) => b.orders - a.orders);
    const itemStats = {};
    const itemsById = {};
    (await store.all('Items')).forEach((i) => { itemsById[i.item_id] = i; });
    const orderByStatus = {};
    orders.forEach((o) => { orderByStatus[o.order_id] = o.status; });
    orderItems.forEach((l) => {
      const o = orderByStatus[l.order_id];
      if (o === ORDER_STATUS.DRAFT || o === ORDER_STATUS.CANCELLED) return;
      if (!itemStats[l.item_id]) {
        itemStats[l.item_id] = {
          item_id: l.item_id,
          item_name: (itemsById[l.item_id] && itemsById[l.item_id].item_name) || l.item_id,
          unit: (itemsById[l.item_id] && itemsById[l.item_id].unit) || 'pc',
          requested: 0, approved: 0, sent: 0, received: 0, shortage: 0
        };
      }
      const s = itemStats[l.item_id];
      s.requested += Number(l.requested_quantity) || 0;
      s.approved += Number(l.approved_quantity) || 0;
      s.sent += Number(l.sent_quantity) || 0;
      s.received += Number(l.received_quantity) || 0;
      s.shortage += Number(l.shortage_quantity) || 0;
    });
    const topItems = Object.keys(itemStats).map((k) => itemStats[k])
      .filter((it) => it.requested > 0)
      .sort((a, b) => b.requested - a.requested)
      .slice(0, 10);
    let shortageTotal = 0;
    orderItems.forEach((l) => { shortageTotal += Number(l.shortage_quantity) || 0; });
    recent.sort((a, b) => {
      const c = String(b.created_at).localeCompare(String(a.created_at));
      return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
    });
    return {
      cards: Object.assign({}, cards, { shortage_total: shortageTotal, all: cards.total }),
      byBranch,
      topItems,
      recentOrders: recent.slice(0, 8),
      flow: {
        submittedNow: cards.submitted,
        processingNow: cards.processing + cards.sent,
        receivedNow: cards.received
      }
    };
  }

  async function activityRecent(limit) {
    return activity.recent(limit || 20);
  }

  return {
    ordersReport,
    branchSummary,
    itemDemand,
    shortageReport,
    csv,
    metrics,
    activityRecent
  };
}

export function createActivity(store, cfg, ids) {
  return {
    async log(actorUserId, action, entityType, entityId, details) {
      await store.insert('Activity_Log', {
        log_id: await ids.logId(),
        actor_user_id: actorUserId || '',
        action,
        entity_type: entityType || '',
        entity_id: entityId || '',
        details_json: details ? JSON.stringify(details).slice(0, 4000) : '{}',
        created_at: await cfg.now()
      });
      return true;
    },
    async recent(limit) {
      const rows = (await store.all('Activity_Log')).slice().reverse();
      return rows.slice(0, limit || 50).map((r) => {
        let d = {};
        try { d = JSON.parse(r.details_json || '{}'); } catch (e) { d = {}; }
        return {
          log_id: r.log_id,
          actor_user_id: r.actor_user_id,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          details: d,
          created_at: r.created_at
        };
      });
    }
  };
}
