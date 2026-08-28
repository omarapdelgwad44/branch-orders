/**
 * Reports + CSV port of ReportingService.gs.
 */
import { SheetsRepo } from './store.js';
import { fail, formatStamp, ORDER_STATUS } from './constants.js';

var ordersRepo = function () { return SheetsRepo.repo('Orders').ensure(); };
var itemsRepo = function () { return SheetsRepo.repo('Order_Items').ensure(); };

function itemsMap() {
  var map = {};
  SheetsRepo.repo('Items').readAll().forEach(function (r) { map[r.item_id] = r; });
  return map;
}
function branchesMap() {
  var map = {};
  SheetsRepo.repo('Branches').readAll().forEach(function (r) { map[r.branch_id] = r; });
  return map;
}

function filterRange(createdAt, f) {
  var v = new Date(createdAt);
  if (isNaN(v.getTime())) return true;
  if (f.from && v < new Date(f.from)) return false;
  if (f.to && v > new Date(String(f.to) + 'T23:59:59')) return false;
  return true;
}

function filteredOrders(filters) {
  var f = filters || {};
  var bm = branchesMap();
  var im = itemsMap();
  var rows = ordersRepo().readAll().filter(function (o) {
    if (f.status && String(o.status) !== String(f.status)) return false;
    if (f.branch_id && String(o.branch_id) !== String(f.branch_id)) return false;
    if (!filterRange(o.created_at, f)) return false;
    if (f.search) {
      var s = String(f.search).toLowerCase();
      var br = (bm[o.branch_id] && bm[o.branch_id].branch_name) || '';
      var inline = String(o.order_id).toLowerCase().indexOf(s) !== -1 ||
        String(br).toLowerCase().indexOf(s) !== -1 ||
        String(o.order_number || '').toLowerCase().indexOf(s) !== -1;
      if (!inline) {
        inline = itemsRepo().readAll().some(function (l) {
          return String(l.order_id) === String(o.order_id) &&
            String((im[l.item_id] && im[l.item_id].item_name) || '').toLowerCase().indexOf(s) !== -1;
        });
      }
      if (!inline) return false;
    }
    return true;
  });
  rows.sort(function (a, b) {
    var c = String(b.created_at).localeCompare(String(a.created_at));
    return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
  });
  return { rows: rows, bm: bm, im: im };
}

function withTotals(o, im, items) {
  var req = 0, appr = 0, sent = 0, recv = 0, short = 0;
  var names = [];
  items.forEach(function (l) {
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

function ordersReport(filters) {
  var r = filteredOrders(filters);
  var allItems = itemsRepo().readAll();
  return r.rows.map(function (o) {
    var lines = allItems.filter(function (l) { return String(l.order_id) === String(o.order_id); });
    var rec = withTotals(o, r.im, lines);
    var br = r.bm[o.branch_id] || {};
    rec.branch_code = br.branch_code || '';
    rec.branch_name = br.branch_name || '';
    return rec;
  });
}

function branchSummary(filters) {
  var r = filteredOrders(filters);
  var allItems = itemsRepo().readAll();
  var agg = {};
  r.rows.forEach(function (o) {
    var lines = allItems.filter(function (l) { return String(l.order_id) === String(o.order_id); });
    if (!agg[o.branch_id]) {
      var br = r.bm[o.branch_id] || {};
      agg[o.branch_id] = {
        branch_id: o.branch_id,
        branch_name: br.branch_name || o.branch_id,
        branch_code: br.branch_code || '',
        orders: 0, submitted: 0, sent: 0, received: 0, shortage_orders: 0,
        requested_total: 0, sent_total: 0, shortage_total: 0
      };
    }
    var a = agg[o.branch_id];
    a.orders++;
    if (o.status === ORDER_STATUS.SUBMITTED) a.submitted++;
    if (o.status === ORDER_STATUS.SENT) a.sent++;
    if ([ORDER_STATUS.RECEIVED, ORDER_STATUS.PARTIALLY_RECEIVED].indexOf(o.status) !== -1) a.received++;
    if (o.status === ORDER_STATUS.SHORTAGE_REPORTED) a.shortage_orders++;
    lines.forEach(function (l) {
      a.requested_total += Number(l.requested_quantity) || 0;
      a.sent_total += Number(l.sent_quantity) || 0;
      a.shortage_total += Number(l.shortage_quantity) || 0;
    });
  });
  return Object.keys(agg).map(function (k) { return agg[k]; })
    .sort(function (a, b) { return b.orders - a.orders; });
}

function itemDemand(filters) {
  var r = filteredOrders(filters);
  var allItems = itemsRepo().readAll();
  var map = {};
  r.rows.forEach(function (o) {
    if (String(o.status) === ORDER_STATUS.DRAFT) return;
    allItems.filter(function (l) { return String(l.order_id) === String(o.order_id); }).forEach(function (l) {
      if (!map[l.item_id]) {
        var it = r.im[l.item_id] || {};
        map[l.item_id] = {
          item_id: l.item_id,
          item_name: it.item_name || l.item_id,
          item_code: it.item_code || '',
          unit: it.unit || 'pc',
          category: it.category || '',
          requested: 0, approved: 0, sent: 0, received: 0, shortage: 0
        };
      }
      var x = map[l.item_id];
      x.requested += Number(l.requested_quantity) || 0;
      x.approved += Number(l.approved_quantity) || 0;
      x.sent += Number(l.sent_quantity) || 0;
      x.received += Number(l.received_quantity) || 0;
      x.shortage += Number(l.shortage_quantity) || 0;
    });
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .filter(function (x) { return x.requested > 0; })
    .sort(function (a, b) { return b.requested - a.requested; });
}

function shortageReport(filters) {
  var r = filteredOrders(filters);
  var allItems = itemsRepo().readAll();
  var out = [];
  r.rows.forEach(function (o) {
    if (o.status !== ORDER_STATUS.SHORTAGE_REPORTED && o.status !== ORDER_STATUS.PARTIALLY_RECEIVED) return;
    var br = r.bm[o.branch_id] || {};
    allItems.filter(function (l) { return String(l.order_id) === String(o.order_id) && l.shortage_quantity > 0; })
      .forEach(function (l) {
        var it = r.im[l.item_id] || {};
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
  var s = String(value === undefined || value === null ? '' : value);
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  var lines = [headers.map(function (h) { return csvCell(h); }).join(',')];
  rows.forEach(function (r) {
    lines.push(headers.map(function (h) { return csvCell(r[h]); }).join(','));
  });
  return lines.join('\r\n');
}

function csv(kind, filters) {
  var cols, rows;
  if (kind === 'orders') {
    cols = ['order_id', 'order_number', 'branch_code', 'branch_name', 'status', 'created_at', 'submitted_at', 'sent_at', 'received_at', 'items_list', 'total_requested', 'total_approved', 'total_sent', 'total_received', 'total_shortage', 'notes'];
    rows = ordersReport(filters);
  } else if (kind === 'branches') {
    cols = ['branch_id', 'branch_code', 'branch_name', 'orders', 'submitted', 'sent', 'received', 'shortage_orders', 'requested_total', 'sent_total', 'shortage_total'];
    rows = branchSummary(filters);
  } else if (kind === 'items') {
    cols = ['item_id', 'item_code', 'item_name', 'category', 'unit', 'requested', 'approved', 'sent', 'received', 'shortage'];
    rows = itemDemand(filters);
  } else if (kind === 'shortages') {
    cols = ['order_number', 'branch_name', 'item_name', 'unit', 'sent_quantity', 'received_quantity', 'shortage_quantity', 'shortage_reason', 'received_at'];
    rows = shortageReport(filters);
  } else {
    fail('validation', 'Unknown report type.');
  }
  var stamp = formatStamp(new Date());
  return {
    filename: kind + '-' + stamp + '.csv',
    csv: toCsv(cols, rows)
  };
}

export var Reports = { ordersReport: ordersReport, branchSummary: branchSummary, itemDemand: itemDemand, shortageReport: shortageReport, csv: csv };