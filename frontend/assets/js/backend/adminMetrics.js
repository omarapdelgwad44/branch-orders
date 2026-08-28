/**
 * Admin metrics port of AdminService.gs.
 */
import { SheetsRepo } from './store.js';
import { ORDER_STATUS } from './constants.js';
import { Activity } from './activity.js';

function rangeFilter(dateStrFrom, dateStrTo) {
  return function (isoDate) {
    var vals = new Date(isoDate);
    if (isNaN(vals.getTime())) return true;
    if (dateStrFrom) {
      var f = new Date(dateStrFrom);
      if (vals < f) return false;
    }
    if (dateStrTo) {
      var t = new Date(dateStrTo + 'T23:59:59');
      if (vals > t) return false;
    }
    return true;
  };
}

function metrics(from, to) {
  var orders = SheetsRepo.repo('Orders').readAll();
  var inRange = rangeFilter(from, to);
  var orderItems = SheetsRepo.repo('Order_Items').readAll();
  var branches = {};
  SheetsRepo.repo('Branches').readAll().forEach(function (b) {
    if (branches[b.branch_id]) return;
    branches[b.branch_id] = { branch_id: b.branch_id, branch_code: b.branch_code, branch_name: b.branch_name, cnt: 0, orders: 0 };
  });

  var cards = {
    total: 0, drafts: 0, submitted: 0, processing: 0, sent: 0,
    received: 0, shortage: 0, cancelled: 0
  };
  var recent = [];
  orders.forEach(function (o) {
    if (!inRange(o.created_at)) return;
    var s = String(o.status);
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

  var byBranch = Object.keys(branches).map(function (k) { return branches[k]; })
    .filter(function (b) { return b.orders > 0; })
    .sort(function (a, b) { return b.orders - a.orders; });

  var itemStats = {};
  var itemsById = {};
  SheetsRepo.repo('Items').readAll().forEach(function (i) { itemsById[i.item_id] = i; });
  var orderByStatus = {};
  orders.forEach(function (o) { orderByStatus[o.order_id] = o.status; });
  orderItems.forEach(function (l) {
    var o = orderByStatus[l.order_id];
    if (o === ORDER_STATUS.DRAFT || o === ORDER_STATUS.CANCELLED) return;
    if (!itemStats[l.item_id]) {
      itemStats[l.item_id] = {
        item_id: l.item_id,
        item_name: (itemsById[l.item_id] && itemsById[l.item_id].item_name) || l.item_id,
        unit: (itemsById[l.item_id] && itemsById[l.item_id].unit) || 'pc',
        requested: 0, approved: 0, sent: 0, received: 0, shortage: 0
      };
    }
    var s = itemStats[l.item_id];
    s.requested += Number(l.requested_quantity) || 0;
    s.approved += Number(l.approved_quantity) || 0;
    s.sent += Number(l.sent_quantity) || 0;
    s.received += Number(l.received_quantity) || 0;
    s.shortage += Number(l.shortage_quantity) || 0;
  });
  var topItems = Object.keys(itemStats).map(function (k) { return itemStats[k]; })
    .filter(function (it) { return it.requested > 0; })
    .sort(function (a, b) { return b.requested - a.requested; })
    .slice(0, 10);

  var shortageTotal = 0;
  orderItems.forEach(function (l) { shortageTotal += Number(l.shortage_quantity) || 0; });

  recent.sort(function (a, b) {
    var c = String(b.created_at).localeCompare(String(a.created_at));
    return c !== 0 ? c : String(b.order_number).localeCompare(String(a.order_number));
  });

  var allOrdersTotal = cards.total;
  var flow = {
    submittedNow: cards.submitted,
    processingNow: cards.processing + cards.sent,
    receivedNow: cards.received
  };

  return {
    cards: Object.assign({}, cards, { shortage_total: shortageTotal, all: allOrdersTotal }),
    byBranch: byBranch,
    topItems: topItems,
    recentOrders: recent.slice(0, 8),
    flow: flow
  };
}

function activityRecent(limit) {
  return Activity.recent(limit || 20);
}

export var AdminMetrics = { metrics: metrics, activityRecent: activityRecent };