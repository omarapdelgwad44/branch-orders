/**
 * HTTP layer: JSON API used by the GitHub Pages frontend.
 * GET  /exec            → health check
 * POST /exec {action..} → JSON responses with CORS headers
 *
 * Route access is enforced on the server for every call:
 *   guard: 'public' | 'auth' | 'admin'
 */

var SERVICE_NAME = 'branch-orders';
var SERVICE_VERSION = '1.0.0';

function doGet(e) {
  var raw = e && e.parameter && (e.parameter.payload || e.parameter.q);
  if (raw) {
    try {
      return handleRequest_(JSON.parse(raw));
    } catch (err) {
      return jsonOut_({ ok: false, error: { code: 'bad_request', message: 'Invalid payload' } });
    }
  }
  return jsonOut_({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, time: nowIso() });
}

function doPost(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = {};
  }
  return handleRequest_(body);
}

function handleRequest_(body) {
  var action = String(body.action || '');
  var token = String(body.token || '');
  var route = ROUTES[action];
  if (!route) {
    return jsonOut_({ ok: false, error: { code: 'unknown_action', message: 'Unknown action: ' + action } });
  }
  try {
    var user = null;
    if (route.guard === 'auth' || route.guard === 'admin') {
      user = Auth.requireUser(token);
      if (route.guard === 'admin') Auth.requireRole(user, USER_ROLES.ADMIN);
    }
    var data = route.handler(body, user, token);
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonOut_({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
    }
    Logger.log('ERROR action=' + action + ' ' + err + ' ' + (err && err.stack));
    return jsonOut_({ ok: false, error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
  }
}

function jsonOut_(obj) {
  // TEXT (not JSON): browsers following Google's 302 otherwise get HTML / a GET health check.
  var out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.TEXT);
  try {
    out.setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  } catch (ignored) {}
  return out;
}

var ROUTES = (function () {
  function sysStatus(body, user) {
    ensureSetup_();
    return {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      needsSetup: SheetsRepo.repo('Users').readAll().length === 0,
      firstAdminCreated: SheetsRepo.getSetting('FIRST_ADMIN_CREATED', 'false') === 'true',
      demoLoaded: SheetsRepo.getSetting('DEMO_LOADED', 'false') === 'true'
    };
  }
  function sysConfig(body, user) {
    return {
      timezone: CONFIG.timezone(),
      allowDecimalQty: CONFIG.bool('ALLOW_DECIMAL_QTY'),
      requireApproval: CONFIG.bool('REQUIRE_APPROVAL'),
      sessionHours: CONFIG.int('SESSION_HOURS'),
      version: SERVICE_VERSION
    };
  }
  function me(body, user) {
    return { user: user, config: sysConfig() };
  }
  function login(body) {
    var r = Auth.login(String(body.username || ''), String(body.password || ''));
    Activity.log(r.user.user_id, 'login', 'user', r.user.user_id, { role: r.user.role });
    return { token: r.token, user: r.user, config: sysConfig() };
  }
  function logout(body, user, token) {
    Activity.log(user.user_id, 'logout', 'user', user.user_id, {});
    return { ok: Auth.logout(token) };
  }
  function changePassword(body, user) {
    var ok = Auth.changePassword(user.user_id, String(body.current_password || ''), String(body.new_password || ''));
    if (ok) Activity.log(user.user_id, 'password_changed', 'user', user.user_id, {});
    return { ok: true };
  }
  function catalog(body, user) {
    return {
      items: user.role === USER_ROLES.ADMIN ? Items.list(true).map(function (i) {
        return { item_id: i.item_id, active: i.active, item_code: i.item_code, item_name: i.item_name, category: i.category, unit: i.unit, sort_order: i.sort_order };
      }) : Items.catalogForBranch(user.branch_id),
      categories: Items.categories()
    };
  }
  function ordersCreate(body, user) {
    return Orders.createDraft(user, body.items, body.notes);
  }
  function ordersSave(body, user) {
    return Orders.saveDraft(user, String(body.order_id), body.items, body.notes);
  }
  function ordersSubmit(body, user) {
    return Orders.submit(user, String(body.order_id));
  }
  function ordersCancel(body, user) {
    return Orders.cancelByBranch(user, String(body.order_id), body.reason);
  }
  function ordersList(body, user) {
    return { orders: Orders.listForBranch(user, body.status || '') };
  }
  function ordersDetail(body, user) {
    return Orders.detail(user, String(body.order_id));
  }
  function ordersReceive(body, user) {
    return Orders.receive(user, String(body.order_id), body);
  }
  function adminOrders(body, user) {
    return Orders.listAll(body.filters || {}, body.page, body.page_size);
  }
  function adminOrderDetail(body, user) {
    return Orders.detail(user, String(body.order_id));
  }
  function adminTransition(body, user) {
    return Orders.adminTransition(user, String(body.order_id), String(body.to), body);
  }
  function adminReopen(body, user) {
    return Orders.reopen(user, String(body.order_id));
  }
  function adminMetrics(body, user) {
    return AdminMetrics.metrics(body.from || '', body.to || '');
  }
  function adminActivity(body, user) {
    return { logs: AdminMetrics.activityRecent(body.limit || 20) };
  }
  function branchesList(body, user) { return { branches: Branches.list() }; }
  function branchesCreate(body, user) { return Branches.create(body); }
  function branchesUpdate(body, user) { return Branches.update(String(body.branch_id), body); }
  function usersList(body, user) { return { users: Users.list() }; }
  function usersCreate(body, user) { return Users.create(body); }
  function usersUpdate(body, user) { return Users.update(String(body.user_id), body); }
  function itemsList(body, user) { return { items: Items.list(true) }; }
  function itemsCreate(body, user) { return Items.create(body); }
  function itemsUpdate(body, user) { return Items.update(String(body.item_id), body); }
  function branchItemsSave(body, user) {
    return Items.setBranchItems(String(body.branch_id), body.assignments || []);
  }
  function reportsOrders(body, user) { return { rows: Reports.ordersReport(body.filters || {}) }; }
  function reportsBranch(body, user) { return { rows: Reports.branchSummary(body.filters || {}) }; }
  function reportsItems(body, user) { return { rows: Reports.itemDemand(body.filters || {}) }; }
  function reportsShortages(body, user) { return { rows: Reports.shortageReport(body.filters || {}) }; }
  function reportsCsv(body, user) {
    return Reports.csv(String(body.kind || 'orders'), body.filters || {});
  }
  function setupFirstAdmin(body) {
    return createFirstAdmin(String(body.username || ''), String(body.password || ''), String(body.full_name || ''));
  }
  function setupDemo(body) {
    return loadDemoData();
  }

  return {
    'system.status': { guard: 'public', handler: sysStatus },
    'system.config': { guard: 'public', handler: sysConfig },
    'auth.login': { guard: 'public', handler: login },
    'auth.me': { guard: 'auth', handler: me },
    'auth.logout': { guard: 'auth', handler: logout },
    'auth.password': { guard: 'auth', handler: changePassword },
    'catalog.list': { guard: 'auth', handler: catalog },
    'orders.create': { guard: 'auth', handler: ordersCreate },
    'orders.save': { guard: 'auth', handler: ordersSave },
    'orders.submit': { guard: 'auth', handler: ordersSubmit },
    'orders.cancel': { guard: 'auth', handler: ordersCancel },
    'orders.list': { guard: 'auth', handler: ordersList },
    'orders.detail': { guard: 'auth', handler: ordersDetail },
    'orders.receive': { guard: 'auth', handler: ordersReceive },
    'admin.orders': { guard: 'admin', handler: adminOrders },
    'admin.orders.detail': { guard: 'admin', handler: adminOrderDetail },
    'admin.orders.transition': { guard: 'admin', handler: adminTransition },
    'admin.orders.reopen': { guard: 'admin', handler: adminReopen },
    'admin.metrics': { guard: 'admin', handler: adminMetrics },
    'admin.activity': { guard: 'admin', handler: adminActivity },
    'admin.branches.list': { guard: 'admin', handler: branchesList },
    'admin.branches.create': { guard: 'admin', handler: branchesCreate },
    'admin.branches.update': { guard: 'admin', handler: branchesUpdate },
    'admin.users.list': { guard: 'admin', handler: usersList },
    'admin.users.create': { guard: 'admin', handler: usersCreate },
    'admin.users.update': { guard: 'admin', handler: usersUpdate },
    'admin.items.list': { guard: 'admin', handler: itemsList },
    'admin.items.create': { guard: 'admin', handler: itemsCreate },
    'admin.items.update': { guard: 'admin', handler: itemsUpdate },
    'admin.branchItems.save': { guard: 'admin', handler: branchItemsSave },
    'reports.orders': { guard: 'admin', handler: reportsOrders },
    'reports.branches': { guard: 'admin', handler: reportsBranch },
    'reports.items': { guard: 'admin', handler: reportsItems },
    'reports.shortages': { guard: 'admin', handler: reportsShortages },
    'reports.csv': { guard: 'admin', handler: reportsCsv },
    'system.setup.firstAdmin': { guard: 'public', handler: setupFirstAdmin },
    'system.setup.demo': { guard: 'public', handler: setupDemo }
  };
})();