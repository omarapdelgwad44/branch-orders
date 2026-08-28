/**
 * Local request dispatcher = port of Code.gs doPost/ROUTES.
 * Returns the same envelope as the Apps Script HTTP API:
 *   { ok: true, data }  or  { ok: false, error: { code, message, details } }
 */
import { SheetsRepo, CONFIG } from './store.js';
import { Auth } from './auth.js';
import { Activity } from './activity.js';
import { Items, UsersService, BranchesService } from './catalog.js';
import { Orders } from './orders.js';
import { AdminMetrics } from './adminMetrics.js';
import { Reports } from './reports.js';
import { runSetup, createFirstAdmin, loadDemoData, exportDB, importDB, resetDB } from './bootstrap.js';
import { ApiError, USER_ROLES } from './constants.js';

var SERVICE_NAME = 'branch-orders';
var SERVICE_VERSION = '1.0.0';

function sysStatus(body, user) {
  runSetup();
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
function branchesList(body, user) { return { branches: BranchesService.list() }; }
function branchesCreate(body, user) { return BranchesService.create(body); }
function branchesUpdate(body, user) { return BranchesService.update(String(body.branch_id), body); }
function usersList(body, user) { return { users: UsersService.list() }; }
function usersCreate(body, user) { return UsersService.create(body); }
function usersUpdate(body, user) { return UsersService.update(String(body.user_id), body); }
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

/* local-only routes: first-admin + demo bootstrap + db backup/reset */
function setupFirstAdmin(body) {
  return createFirstAdmin(String(body.username || ''), String(body.password || ''), String(body.full_name || ''));
}
function setupDemo(body) {
  return loadDemoData();
}
function dbExport(body, user) {
  return exportDB();
}
function dbImport(body, user) {
  return importDB(body.doc);
}
function dbReset(body, user) {
  return resetDB();
}

var ROUTES = {
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
  'system.setup.demo': { guard: 'public', handler: setupDemo },
  'system.db.export': { guard: 'admin', handler: dbExport },
  'system.db.import': { guard: 'admin', handler: dbImport },
  'system.db.reset': { guard: 'admin', handler: dbReset }
};

export function dispatch(action, body) {
  var actionName = String(action || '');
  var token = String((body && body.token) || '');
  var route = ROUTES[actionName];
  if (!route) {
    return { ok: false, error: { code: 'unknown_action', message: 'Unknown action: ' + actionName } };
  }
  try {
    var user = null;
    if (route.guard === 'auth' || route.guard === 'admin') {
      user = Auth.requireUser(token);
      if (route.guard === 'admin') Auth.requireRole(user, USER_ROLES.ADMIN);
    }
    var data = route.handler(body || {}, user, token);
    return { ok: true, data: data };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: { code: err.code, message: err.message, details: err.details || {} } };
    }
    console.error('ERROR action=' + actionName, err);
    return { ok: false, error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } };
  }
}

export { ROUTES, SERVICE_NAME, SERVICE_VERSION };