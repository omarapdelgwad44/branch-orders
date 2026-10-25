import {
  ApiError,
  SERVICE_NAME,
  SERVICE_VERSION,
  USER_ROLES,
  createConfig,
  createIds,
  nowIso
} from './lib.mjs';
import { createAuth } from './auth.mjs';
import { createCatalog } from './catalog.mjs';
import { createOrders } from './orders.mjs';
import { createReports, createActivity } from './reports.mjs';
import { createSetup } from './setup.mjs';

export function createApp(store) {
  const cfg = createConfig(store);
  const ids = createIds(store);
  const activity = createActivity(store, cfg, ids);
  const auth = createAuth(store, cfg, activity);
  const catalog = createCatalog(store, cfg, ids, activity, auth);
  const orders = createOrders(store, cfg, ids, activity, catalog.Items);
  const reports = createReports(store, cfg, activity);
  const setup = createSetup(store, cfg, ids, activity, auth);

  async function sysStatus() {
    await setup.setupSystem();
    const users = await store.all('Users');
    return {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      needsSetup: users.length === 0,
      firstAdminCreated: (await store.getSetting('FIRST_ADMIN_CREATED', 'false')) === 'true',
      demoLoaded: (await store.getSetting('DEMO_LOADED', 'false')) === 'true'
    };
  }

  async function sysConfig() {
    return {
      timezone: await cfg.timezone(),
      allowDecimalQty: await cfg.bool('ALLOW_DECIMAL_QTY'),
      requireApproval: await cfg.bool('REQUIRE_APPROVAL'),
      sessionHours: await cfg.int('SESSION_HOURS'),
      version: SERVICE_VERSION
    };
  }

  const ROUTES = {
    'system.status': { guard: 'public', handler: () => sysStatus() },
    'system.config': { guard: 'public', handler: () => sysConfig() },
    'auth.login': {
      guard: 'public',
      handler: async (body) => {
        const r = await auth.login(String(body.username || ''), String(body.password || ''));
        await activity.log(r.user.user_id, 'login', 'user', r.user.user_id, { role: r.user.role });
        return { token: r.token, user: r.user, config: await sysConfig() };
      }
    },
    'auth.me': { guard: 'auth', handler: async (body, user) => ({ user, config: await sysConfig() }) },
    'auth.logout': {
      guard: 'auth',
      handler: async (body, user, token) => {
        await activity.log(user.user_id, 'logout', 'user', user.user_id, {});
        return { ok: await auth.logout(token) };
      }
    },
    'auth.password': {
      guard: 'auth',
      handler: async (body, user) => {
        const ok = await auth.changePassword(user.user_id, String(body.current_password || ''), String(body.new_password || ''));
        if (ok) await activity.log(user.user_id, 'password_changed', 'user', user.user_id, {});
        return { ok: true };
      }
    },
    'catalog.list': {
      guard: 'auth',
      handler: async (body, user) => {
        const items = user.role === USER_ROLES.ADMIN
          ? (await catalog.Items.list()).map((i) => ({
            item_id: i.item_id, active: i.active, item_code: i.item_code, item_name: i.item_name,
            category: i.category, unit: i.unit, sort_order: i.sort_order
          }))
          : await catalog.Items.catalogForBranch(user.branch_id);
        return { items, categories: await catalog.Items.categories() };
      }
    },
    'orders.create': { guard: 'auth', handler: (body, user) => orders.createDraft(user, body.items, body.notes) },
    'orders.save': { guard: 'auth', handler: (body, user) => orders.saveDraft(user, String(body.order_id), body.items, body.notes) },
    'orders.submit': { guard: 'auth', handler: (body, user) => orders.submit(user, String(body.order_id)) },
    'orders.cancel': { guard: 'auth', handler: (body, user) => orders.cancelByBranch(user, String(body.order_id), body.reason) },
    'orders.list': { guard: 'auth', handler: (body, user) => orders.listForBranch(user, body.status || '').then((list) => ({ orders: list })) },
    'orders.detail': { guard: 'auth', handler: (body, user) => orders.detail(user, String(body.order_id)) },
    'orders.receive': { guard: 'auth', handler: (body, user) => orders.receive(user, String(body.order_id), body) },
    'admin.orders': { guard: 'admin', handler: (body) => orders.listAll(body.filters || {}, body.page, body.page_size) },
    'admin.orders.detail': { guard: 'admin', handler: (body, user) => orders.detail(user, String(body.order_id)) },
    'admin.orders.transition': { guard: 'admin', handler: (body, user) => orders.adminTransition(user, String(body.order_id), String(body.to), body) },
    'admin.orders.reopen': { guard: 'admin', handler: (body, user) => orders.reopen(user, String(body.order_id)) },
    'admin.metrics': { guard: 'admin', handler: (body) => reports.metrics(body.from || '', body.to || '') },
    'admin.activity': { guard: 'admin', handler: async (body) => ({ logs: await reports.activityRecent(body.limit || 20) }) },
    'admin.branches.list': { guard: 'admin', handler: async () => ({ branches: await catalog.Branches.list() }) },
    'admin.branches.create': { guard: 'admin', handler: (body) => catalog.Branches.create(body) },
    'admin.branches.update': { guard: 'admin', handler: (body) => catalog.Branches.update(String(body.branch_id), body) },
    'admin.users.list': { guard: 'admin', handler: async () => ({ users: await catalog.Users.list() }) },
    'admin.users.create': { guard: 'admin', handler: (body) => catalog.Users.create(body) },
    'admin.users.update': { guard: 'admin', handler: (body) => catalog.Users.update(String(body.user_id), body) },
    'admin.items.list': { guard: 'admin', handler: async () => ({ items: await catalog.Items.list() }) },
    'admin.items.create': { guard: 'admin', handler: (body) => catalog.Items.create(body) },
    'admin.items.update': { guard: 'admin', handler: (body) => catalog.Items.update(String(body.item_id), body) },
    'admin.branchItems.save': { guard: 'admin', handler: (body) => catalog.Items.setBranchItems(String(body.branch_id), body.assignments || []) },
    'admin.branchItems.list': { guard: 'admin', handler: async (body) => ({ assignments: await catalog.Items.branchAssignments(String(body.branch_id || '')) }) },
    'reports.orders': { guard: 'admin', handler: async (body) => ({ rows: await reports.ordersReport(body.filters || {}) }) },
    'reports.branches': { guard: 'admin', handler: async (body) => ({ rows: await reports.branchSummary(body.filters || {}) }) },
    'reports.items': { guard: 'admin', handler: async (body) => ({ rows: await reports.itemDemand(body.filters || {}) }) },
    'reports.shortages': { guard: 'admin', handler: async (body) => ({ rows: await reports.shortageReport(body.filters || {}) }) },
    'reports.csv': { guard: 'admin', handler: (body) => reports.csv(String(body.kind || 'orders'), body.filters || {}) },
    'system.setup.firstAdmin': {
      guard: 'public',
      handler: (body) => setup.createFirstAdmin(String(body.username || ''), String(body.password || ''), String(body.full_name || ''))
    },
    'system.setup.demo': { guard: 'public', handler: () => setup.loadDemoData() }
  };

  async function handle(body) {
    const action = String((body && body.action) || '');
    const token = String((body && body.token) || '');
    const route = ROUTES[action];
    if (!route) {
      return { ok: false, error: { code: 'unknown_action', message: 'Unknown action: ' + action } };
    }
    try {
      let user = null;
      if (route.guard === 'auth' || route.guard === 'admin') {
        user = await auth.requireUser(token);
        if (route.guard === 'admin') auth.requireRole(user, USER_ROLES.ADMIN);
      }
      const data = await route.handler(body || {}, user, token);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
      }
      console.error('ERROR action=' + action, err && err.stack ? err.stack : err);
      return { ok: false, error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } };
    }
  }

  function health() {
    return { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION, time: nowIso() };
  }

  return {
    handle,
    health,
    direct: {
      setupSystem: () => setup.setupSystem(),
      createFirstAdmin: (u, p, n) => setup.createFirstAdmin(u, p, n),
      loadDemoData: () => setup.loadDemoData()
    },
    store
  };
}

export function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };
}

export async function dispatchHttp(app, method, url, rawBody) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET') {
    const href = String(url || '');
    const match = /[?&]payload=([^&]*)/.exec(href);
    if (match) {
      try {
        return await app.handle(JSON.parse(decodeURIComponent(match[1])));
      } catch (e) {
        return { ok: false, error: { code: 'bad_request', message: 'Invalid payload' } };
      }
    }
    return app.health();
  }
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (e) { body = {}; }
  return app.handle(body);
}
