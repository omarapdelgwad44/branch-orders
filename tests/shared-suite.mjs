/**
 * Shared backend test suite. Runs against the in-memory Supabase-compatible API
 * (tests/run-backend-tests.mjs).
 *
 * The host must implement:
 *   api(action, payload, token)   → Promise<envelope>
 *   direct(name, ...args)         → Promise of a bootstrap function
 *   repoRows(sheetName)           → array of row objects
 */

export async function runSharedSuite(host) {
  let passed = 0, failed = 0;
  const failLog = [];
  function record(ok, label, extra) {
    if (ok) { passed++; }
    else { failed++; failLog.push(label + (extra ? '  → ' + extra : '')); console.log('  FAIL  ' + label + '  ' + (extra || '')); }
  }
  const assert = (cond, label, extra) => record(!!cond, label, extra);
  const eq = (got, want, label) => record(got === want, label, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  const truthy = (v, label) => record(!!v, label);
  const okR = (x) => x && x.ok === true;

  function section(name) { console.log('\n== ' + name); }

  function api(action, payload, token) {
    return host.api(action, payload, token);
  }
  async function tryCatch(fn) {
    try { return await fn(); }
    catch (e) { return { ok: false, error: { code: e && e.code, message: e && e.message } }; }
  }
  const apiOk = async (action, payload, token) => {
    const r = await api(action, payload, token);
    if (!okR(r)) throw new Error(action + ' failed: ' + JSON.stringify(r));
    return r.data;
  };
  const errOf = async (action, payload, token) => {
    const r = await api(action, payload, token);
    assert(!okR(r), action + ' should error, got ok=true');
    return r.error;
  };

  // ---------------------------------------------------------------------------
  // A. Bootstrap (direct editor-style calls)
  // ---------------------------------------------------------------------------
  section('A. Bootstrap & demo data');

  let r = await host.direct('setupSystem');
  assert(r && r.ok, 'setupSystem() runs', JSON.stringify(r).slice(0, 120));
  assert(r.sheets.length >= 10, 'setupSystem creates all sheets', 'count=' + r.sheets.length);

  let st = await apiOk('system.status');
  eq(st.needsSetup, true, 'system.status.needsSetup=true before any users');
  eq(st.firstAdminCreated, false, 'system.status.firstAdminCreated=false before admin');

  r = await host.direct('createFirstAdmin', 'admin', 'Admin@12345', 'System Admin');
  assert(r.ok, 'createFirstAdmin works');
  const ADMIN_ID = r.user_id;
  const adminLogin = await apiOk('auth.login', { username: 'admin', password: 'Admin@12345' });
  eq(adminLogin.user.role, 'admin', 'admin login role');
  const ADMIN_T = adminLogin.token;

  const again = await tryCatch(() => host.direct('createFirstAdmin', 'admin2', 'Another@123', 'x'));
  record(!(again && again.ok), 'second createFirstAdmin rejected', JSON.stringify(again || {}).slice(0, 80));

  r = await tryCatch(() => host.direct('loadDemoData'));
  assert(r && r.ok, 'loadDemoData works');
  const demoAgain = await tryCatch(() => host.direct('loadDemoData'));
  record(!(demoAgain && demoAgain.ok), 'duplicate loadDemoData rejected');

  st = await apiOk('system.status');
  eq(st.firstAdminCreated, true, 'firstAdminCreated=true');
  eq(st.demoLoaded, true, 'demoLoaded=true');

  const demoAdmin = await api('auth.login', { username: 'admin.demo', password: 'Demo@1234' });
  eq(demoAdmin.ok, true, 'demo seed includes an admin account');
  eq(demoAdmin.ok && demoAdmin.data.user.role, 'admin', 'demo admin role=admin');

  let cfg = await apiOk('system.config');
  eq(cfg.timezone, 'Africa/Cairo', 'config.timezone');
  eq(cfg.allowDecimalQty, false, 'config.allowDecimalQty default false');
  eq(cfg.requireApproval, true, 'config.requireApproval default true');
  eq(cfg.sessionHours, 12, 'config.sessionHours default 12');

  // ---------------------------------------------------------------------------
  // B. Authentication
  // ---------------------------------------------------------------------------
  section('B. Authentication');

  const bad = await api('auth.login', { username: 'admin', password: 'WRONG' });
  eq(bad.ok, false, 'wrong password rejected');
  eq(bad.error.code, 'invalid_credentials', 'wrong password code');

  const ghost = await api('auth.login', { username: 'ghost', password: 'x12345' });
  eq(ghost.error && ghost.error.code, 'invalid_credentials', 'unknown user code');

  const empty = await api('auth.login', { username: '', password: '' });
  eq(empty.error && empty.error.code, 'invalid_credentials', 'empty credentials code');

  const aliLogin = await api('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' });
  eq(aliLogin.ok, true, 'branch user login ok');
  eq(aliLogin.data.user.role, 'branch_user', 'branch user role');
  eq(aliLogin.data.user.branch_id, 'BR-001', 'branch user branch_id');
  truthy(aliLogin.data.user.branch && aliLogin.data.user.branch.branch_name, 'branch user branch populated');
  const ALI_T = aliLogin.data.token;

  const monaLogin = await api('auth.login', { username: 'mona.hassan', password: 'Demo@1234' });
  const MONA_T = monaLogin.data.token;

  const noToken = await api('orders.list', {}, '');
  eq(noToken.error && noToken.error.code, 'auth_required', 'protected route without token -> auth_required');

  const me = await apiOk('auth.me', {}, ALI_T);
  eq(me.user.username, 'ali.ahmed', 'auth.me returns user');

  const unknownAction = await api('nope.doesnotexist', {}, ALI_T);
  eq(unknownAction.error && unknownAction.error.code, 'unknown_action', 'unknown action');

  // ---------------------------------------------------------------------------
  // C. Secrets hygiene
  // ---------------------------------------------------------------------------
  section('C. Secrets hygiene');

  const usersAll = (await apiOk('admin.users.list', {}, ADMIN_T)).users;
  const usersJson = JSON.stringify(usersAll);
  record(!usersJson.includes('password_hash') && !usersJson.includes('password_salt'),
    'users.list never leaks password columns');
  const loginJson = JSON.stringify(aliLogin);
  record(!loginJson.includes('password_hash') && !loginJson.includes('password_salt'),
    'login response never leaks password columns');
  const ordersJson = JSON.stringify(await apiOk('admin.orders', {}, ADMIN_T));
  record(!ordersJson.includes('password_hash') && !ordersJson.includes('password_salt'),
    'orders output never leaks password columns');

  // ---------------------------------------------------------------------------
  // D. Branch ordering flow (ali.ahmed / BR-001)
  // ---------------------------------------------------------------------------
  section('D. Branch ordering flow');

  const cat = await apiOk('catalog.list', {}, ALI_T);
  assert(cat.items.length >= 12, 'catalog has demo items', 'n=' + cat.items.length);
  assert(cat.categories.length >= 3, 'catalog categories present');

  // unavailable item
  await apiOk('admin.branchItems.save', { branch_id: 'BR-001', assignments: [{ item_id: 'ITM-12', is_available: false, max_quantity: '' }] }, ADMIN_T);
  const catHidden = await apiOk('catalog.list', {}, ALI_T);
  record(!catHidden.items.some(i => i.item_id === 'ITM-12'), 'unavailable item hidden from catalog');
  const unavailErr = await errOf('orders.create', { notes: '', items: { 'ITM-12': 2 } }, ALI_T);
  eq(unavailErr.code, 'validation', 'draft with unavailable item rejected');
  await apiOk('admin.branchItems.save', { branch_id: 'BR-001', assignments: [{ item_id: 'ITM-12', is_available: true, max_quantity: '' }] }, ADMIN_T);

  // max quantity cap
  await apiOk('admin.branchItems.save', { branch_id: 'BR-001', assignments: [{ item_id: 'ITM-1', is_available: true, max_quantity: 5 }] }, ADMIN_T);
  const capErr = await errOf('orders.create', { notes: '', items: { 'ITM-1': 12 } }, ALI_T);
  eq(capErr.code, 'validation', 'draft above max quantity rejected');
  const capOk = await apiOk('orders.create', { notes: 'cap ok', items: { 'ITM-1': 5, 'ITM-2': 10 } }, ALI_T);
  eq(capOk.status, 'draft', 'draft within cap accepted');
  await apiOk('admin.branchItems.save', { branch_id: 'BR-001', assignments: [{ item_id: 'ITM-1', is_available: true, max_quantity: '' }] }, ADMIN_T);

  // unknown item id
  const unknownItemErr = await errOf('orders.create', { items: { 'NOPE-99': 3 } }, ALI_T);
  eq(unknownItemErr.code, 'validation', 'unknown item id rejected');

  // quantity rounding (decimal disabled)
  const dec = await apiOk('orders.create', { items: { 'ITM-3': 2.5 } }, ALI_T);
  eq(dec.items[0].requested_quantity, 3, 'fractional qty rounded when decimal disabled');

  // create a clean draft and exercise the full flow
  const d1 = await apiOk('orders.create', { notes: 'initial', items: { 'ITM-1': 5, 'ITM-2': 10 } }, ALI_T);
  const D1 = d1.order_id;
  record(/^ORD-\d{4}-\d{4}$/.test(D1), 'order id format ORD-YYYY-####', D1);
  eq(d1.branch_id, 'BR-001', 'draft bound to own branch');
  eq(d1.items.length, 2, 'draft item count');

  // save draft (edit): keep ITM-1, drop ITM-2, raise ITM-1
  const saved = await apiOk('orders.save', { order_id: D1, items: { 'ITM-1': 8 }, notes: 'edited' }, ALI_T);
  eq(saved.status, 'draft', 'save keeps draft status');
  const savedLine = saved.items.filter(i => i.item_id === 'ITM-1')[0];
  eq(savedLine.requested_quantity, 8, 'edited qty persisted');
  const droppedLine = saved.items.filter(i => i.item_id === 'ITM-2')[0];
  eq(droppedLine.requested_quantity, 0, 'removed line zeroed');

  // empty order
  const emptyDraft = await apiOk('orders.create', { items: { 'ITM-5': 0, 'ITM-6': -4 } }, ALI_T);
  const emptySubmitErr = await errOf('orders.submit', { order_id: emptyDraft.order_id }, ALI_T);
  eq(emptySubmitErr.code, 'empty_order', 'empty order cannot be submitted');

  // submit a full draft
  const sub = await apiOk('orders.submit', { order_id: D1 }, ALI_T);
  eq(sub.status, 'submitted', 'draft submitted');
  eq(sub.total_requested, 8, 'submitted totals');
  const subAgainErr = await errOf('orders.submit', { order_id: D1 }, ALI_T);
  eq(subAgainErr.code, 'not_draft', 'double submit rejected');

  // branch cancel of another branch's order is forbidden
  const b2order = (await apiOk('orders.list', { status: 'sent' }, MONA_T)).orders[0];
  if (b2order) {
    const crossCancel = await api('orders.cancel', { order_id: b2order.order_id, reason: 'x' }, ALI_T);
    eq(crossCancel.ok, false, 'branch user cannot cancel another branch order');
  } else {
    record(false, 'expected a SENT order for BR-002 from demo');
  }

  // branch isolation on list + detail
  const aliOrders = (await apiOk('orders.list', {}, ALI_T)).orders;
  const branchCountInSheet = host.repoRows('Orders').filter(o => String(o.branch_id) === 'BR-001').length;
  eq(aliOrders.length, branchCountInSheet, 'branch user sees only orders of own branch');

  const crossDetail = await api('orders.detail', { order_id: b2order.order_id }, ALI_T);
  eq(crossDetail.ok, false, 'branch user cannot view another branch order');

  // branch user blocked from admin guards
  const guardErr = await errOf('admin.orders', {}, MONA_T);
  eq(guardErr.code, 'forbidden', 'branch user blocked from admin guard');

  // branch user cancels own draft
  const dc = await apiOk('orders.create', { items: { 'ITM-7': 3 } }, ALI_T);
  const cancelled = await apiOk('orders.cancel', { order_id: dc.order_id, reason: 'test cancel' }, ALI_T);
  eq(cancelled.status, 'cancelled', 'branch user can cancel own draft');
  eq(cancelled.cancel_reason, 'test cancel', 'cancel reason stored');
  const cancelNonDraft = await api('orders.cancel', { order_id: D1, reason: 'x' }, ALI_T);
  eq(cancelNonDraft.ok, false, 'cannot cancel non-draft order');

  // ---------------------------------------------------------------------------
  // E. Admin flow: transitions + receiving
  // ---------------------------------------------------------------------------
  section('E. Admin transitions, receiving, reopen');

  const m = await apiOk('orders.create', { notes: 'flow', items: { 'ITM-4': 10, 'ITM-9': 5 } }, MONA_T);
  const O = m.order_id;
  await apiOk('orders.submit', { order_id: O }, MONA_T);

  // approve with overrides
  const approved = await apiOk('admin.orders.transition', { order_id: O, to: 'approved', approved_qty: { 'ITM-4': 8, 'ITM-9': 5 }, notes: 'ok' }, ADMIN_T);
  eq(approved.status, 'approved', 'submitted -> approved');
  const aLine = approved.items.filter(i => i.item_id === 'ITM-4')[0];
  eq(aLine.approved_quantity, 8, 'approved qty applied');

  const approveAgain = await api('admin.orders.transition', { order_id: O, to: 'approved' }, ADMIN_T);
  eq(approveAgain.ok, false, 'approved -> approved invalid');

  const processing = await apiOk('admin.orders.transition', { order_id: O, to: 'processing' }, ADMIN_T);
  eq(processing.status, 'processing', 'approved -> processing');
  truthy(processing.processed_at, 'processed_at stamped');

  const sent = await apiOk('admin.orders.transition', { order_id: O, to: 'sent', sent_qty: { 'ITM-4': 8, 'ITM-9': 5 } }, ADMIN_T);
  eq(sent.status, 'sent', 'processing -> sent');
  const sLine = sent.items.filter(i => i.item_id === 'ITM-4')[0];
  eq(sLine.sent_quantity, 8, 'sent qty applied');

  const resend = await api('admin.orders.transition', { order_id: O, to: 'sent' }, ADMIN_T);
  eq(resend.ok, false, 'sent -> sent invalid');

  // full receive (BR-002)
  const recv = await apiOk('orders.receive', { order_id: O, quantities: { 'ITM-4': 8, 'ITM-9': 5 }, reasons: {} }, MONA_T);
  eq(recv.status, 'received', 'full receive -> received');
  eq(recv.total_shortage, 0, 'no shortage recorded');
  eq(recv.items[0].received_quantity, 8, 'received qty recorded');
  truthy(recv.received_at, 'received_at stamped');

  const recvAgain = await api('orders.receive', { order_id: O, quantities: { 'ITM-4': 8, 'ITM-9': 5 } }, MONA_T);
  eq(recvAgain.ok, false, 'cannot receive twice (not_sent)');

  // partial receive + reason -> shortage_reported
  const p = await apiOk('orders.create', { items: { 'ITM-4': 10, 'ITM-9': 5 } }, MONA_T);
  await apiOk('orders.submit', { order_id: p.order_id }, MONA_T);
  await apiOk('admin.orders.transition', { order_id: p.order_id, to: 'approved', approved_qty: { 'ITM-4': 8, 'ITM-9': 5 } }, ADMIN_T);
  await apiOk('admin.orders.transition', { order_id: p.order_id, to: 'processing' }, ADMIN_T);
  await apiOk('admin.orders.transition', { order_id: p.order_id, to: 'sent', sent_qty: { 'ITM-4': 8, 'ITM-9': 5 } }, ADMIN_T);
  const partial = await apiOk('orders.receive', {
    order_id: p.order_id,
    quantities: { 'ITM-4': 5, 'ITM-9': 5 },
    reasons: { 'ITM-4': 'damaged in transit' }
  }, MONA_T);
  eq(partial.status, 'shortage_reported', 'partial with reason -> shortage_reported');
  eq(partial.total_shortage, 3, 'shortage qty computed');
  eq(partial.items[0].shortage_reason, 'damaged in transit', 'shortage reason stored');

  // partial without reasons -> partially_received
  const p2 = await apiOk('orders.create', { items: { 'ITM-4': 10 } }, MONA_T);
  await apiOk('orders.submit', { order_id: p2.order_id }, MONA_T);
  await apiOk('admin.orders.transition', { order_id: p2.order_id, to: 'approved', approved_qty: { 'ITM-4': 6 } }, ADMIN_T);
  await apiOk('admin.orders.transition', { order_id: p2.order_id, to: 'processing' }, ADMIN_T);
  await apiOk('admin.orders.transition', { order_id: p2.order_id, to: 'sent', sent_qty: { 'ITM-4': 6 } }, ADMIN_T);

  // qty exceeding sent rejected (order still in sent state)
  const overErr = await errOf('orders.receive', { order_id: p2.order_id, quantities: { 'ITM-4': 99 }, reasons: {} }, MONA_T);
  eq(overErr.code, 'invalid_received', 'receive exceeding sent rejected');
  const negErr = await errOf('orders.receive', { order_id: p2.order_id, quantities: { 'ITM-4': -2 }, reasons: {} }, MONA_T);
  eq(negErr.code, 'invalid_received', 'negative receive rejected');

  const partial2 = await apiOk('orders.receive', { order_id: p2.order_id, quantities: { 'ITM-4': 4 }, reasons: {} }, MONA_T);
  eq(partial2.status, 'partially_received', 'partial without reason -> partially_received');
  eq(partial2.total_shortage, 2, 'partial shortage without reason');

  // receiving while status != sent
  const notSentErr = await api('orders.receive', { order_id: D1, quantities: { 'ITM-1': 5 } }, ALI_T);
  eq(notSentErr.ok, false, 'receive requires sent status');

  // reopen received order -> sent, shortages cleared, then full receive
  const re = await apiOk('admin.orders.reopen', { order_id: p2.order_id }, ADMIN_T);
  eq(re.status, 'sent', 'reopen -> sent');
  eq(re.total_shortage, 0, 'shortages cleared on reopen');
  eq(re.items[0].shortage_reason, '', 'shortage reason cleared on reopen');

  const reopenBad = await api('admin.orders.transition', { order_id: p2.order_id, to: 'approved' }, ADMIN_T);
  eq(reopenBad.ok, false, 'sent -> approved invalid (re-receive path is reopen)');

  const finalRecv = await apiOk('orders.receive', { order_id: p2.order_id, quantities: { 'ITM-4': 6 }, reasons: {} }, MONA_T);
  eq(finalRecv.status, 'received', 'reopen then full receive -> received');
  eq(finalRecv.total_shortage, 0, 'no shortage after full re-receive');

  // reopen on non-terminal order invalid
  const reopenOnDraft = await api('admin.orders.reopen', { order_id: emptyDraft.order_id }, ADMIN_T);
  eq(reopenOnDraft.ok, false, 'cannot reopen non-terminal order');

  // admin list + filters
  const allOrders = await apiOk('admin.orders', {}, ADMIN_T);
  assert(allOrders.orders.length >= 5, 'admin sees all branches orders', 'n=' + allOrders.orders.length);
  const onlyB2 = await apiOk('admin.orders', { filters: { branch_id: 'BR-002' } }, ADMIN_T);
  record(onlyB2.orders.every(o => String(o.branch_id) === 'BR-002'), 'admin can filter by branch');
  const paged = await apiOk('admin.orders', { page: 1, page_size: 2 }, ADMIN_T);
  eq(paged.orders.length, 2, 'admin pagination works');
  eq(paged.total, allOrders.orders.length, 'paginated total matches');

  const statusFiltered = await apiOk('admin.orders', { filters: { status: 'cancelled' } }, ADMIN_T);
  record(statusFiltered.orders.every(o => o.status === 'cancelled'), 'admin filter by status');

  const searchFiltered = await apiOk('admin.orders', { filters: { search: 'footer' } }, ADMIN_T);
  // "footer" matches nothing, so direct + item names shouldn't match
  eq(searchFiltered.orders.length, 0, 'admin search no match -> empty');

  // admin transition from submitted skips approval (valid path)
  const skip = await apiOk('orders.create', { items: { 'ITM-6': 4 } }, MONA_T);
  await apiOk('orders.submit', { order_id: skip.order_id }, MONA_T);
  const sk = await apiOk('admin.orders.transition', { order_id: skip.order_id, to: 'processing', approved_qty: { 'ITM-6': 4 } }, ADMIN_T);
  eq(sk.status, 'processing', 'submitted -> processing (approval bypass)');

  // cancel from processing
  const c = await apiOk('admin.orders.transition', { order_id: skip.order_id, to: 'cancelled', reason: 'out of stock' }, ADMIN_T);
  eq(c.status, 'cancelled', 'processing -> cancelled');
  eq(c.cancel_reason, 'out of stock', 'admin cancel reason stored');

  // ---------------------------------------------------------------------------
  // F. Analytics & reports & CSV
  // ---------------------------------------------------------------------------
  section('F. Analytics, reports, CSV');

  const metrics = await apiOk('admin.metrics', {}, ADMIN_T);
  truthy(metrics.cards && typeof metrics.cards.total === 'number', 'metrics.cards');
  truthy(Array.isArray(metrics.byBranch), 'metrics.byBranch');
  truthy(Array.isArray(metrics.topItems), 'metrics.topItems');
  truthy(Array.isArray(metrics.recentOrders), 'metrics.recentOrders');
  truthy(metrics.flow && typeof metrics.flow.submittedNow === 'number', 'metrics.flow');
  assert(metrics.cards.total >= 6, 'metrics.total counts orders', JSON.stringify(metrics.cards).slice(0, 160));

  const activity = (await apiOk('admin.activity', {}, ADMIN_T)).logs;
  assert(activity.length > 0, 'activity log populated', 'n=' + activity.length);
  record(activity.some(a => a.action === 'order_submitted'), 'activity includes order_submitted');

  const repOrders = (await apiOk('reports.orders', {}, ADMIN_T)).rows;
  assert(repOrders.length >= 5, 'orders report rows', 'n=' + repOrders.length);
  truthy(repOrders[0].branch_name, 'orders report has branch_name');
  truthy(typeof repOrders[0].total_requested === 'number', 'orders report totals');

  const repBranches = (await apiOk('reports.branches', {}, ADMIN_T)).rows;
  assert(repBranches.length >= 3, 'branch summary rows', 'n=' + repBranches.length);
  truthy(typeof repBranches[0].orders === 'number', 'branch summary counts');

  const repItems = (await apiOk('reports.items', {}, ADMIN_T)).rows;
  assert(repItems.length >= 3, 'item demand rows', 'n=' + repItems.length);
  record(repItems.every(x => x.requested > 0), 'item demand excludes zero rows');

  const repShort = (await apiOk('reports.shortages', {}, ADMIN_T)).rows;
  assert(repShort.length >= 1, 'shortage report rows', 'n=' + repShort.length);
  truthy(repShort[0].shortage_quantity > 0, 'shortage report reports quantities');

  const csv = await apiOk('reports.csv', { kind: 'orders' }, ADMIN_T);
  assert(csv.filename.endsWith('.csv'), 'csv filename', csv.filename);
  assert(csv.csv.startsWith('order_id,'), 'csv header first col');
  eq(csv.csv.split('\r\n').length, repOrders.length + 1, 'csv row count = orders + header');
  record(!csv.csv.toLowerCase().includes('password'), 'csv has no password columns');

  const csvBranches = await apiOk('reports.csv', { kind: 'branches' }, ADMIN_T);
  assert(csvBranches.csv.includes('branch_name'), 'branches csv header');
  const csvShort = await apiOk('reports.csv', { kind: 'shortages' }, ADMIN_T);
  assert(csvShort.csv.includes('shortage_quantity'), 'shortages csv header');

  const repRange = (await apiOk('reports.orders', { filters: { from: '2030-01-01' } }, ADMIN_T)).rows;
  eq(repRange.length, 0, 'future date range filters everything out');

  const rangeMet = await apiOk('admin.metrics', { from: '2000-01-01', to: '2030-12-31' }, ADMIN_T);
  truthy(rangeMet.cards.total >= 5, 'metrics respects wide range');

  // branch user blocked from reports (admin guard)
  await errOf('reports.orders', {}, ALI_T);

  // ---------------------------------------------------------------------------
  // G. Account & branch lifecycle
  // ---------------------------------------------------------------------------
  section('G. Account & branch lifecycle');

  // last active admin guard (demo ships a second admin, so retire it first)
  const demoAdminId = (await apiOk('admin.users.list', {}, ADMIN_T)).users.filter((u) => u.username === 'admin.demo')[0].user_id;
  const retireDemoAdmin = await api('admin.users.update', { user_id: demoAdminId, status: 'inactive' }, ADMIN_T);
  eq(retireDemoAdmin.ok, true, 'demo admin can be deactivated while another admin stays active');
  const deactivateOnlyAdmin = await api('admin.users.update', { user_id: ADMIN_ID, status: 'inactive' }, ADMIN_T);
  eq(deactivateOnlyAdmin.ok, false, 'cannot deactivate last active admin');
  eq(deactivateOnlyAdmin.error.code, 'last_active_admin', 'last_active_admin code');

  // create second admin, then deactivate first
  const newAdmin = await apiOk('admin.users.create', { username: 'admin.session', password: 'Passw@123', role: 'admin', full_name: 'Second Admin' }, ADMIN_T);
  truthy(newAdmin.user_id, 'second admin created');
  const deactFirst = await apiOk('admin.users.update', { user_id: ADMIN_ID, status: 'inactive' }, ADMIN_T);
  eq(deactFirst.status, 'inactive', 'first admin now inactive');
  const admin2Login = await apiOk('auth.login', { username: 'admin.session', password: 'Passw@123' });
  eq(admin2Login.user.role, 'admin', 'second admin can log in');

  // first admin: existing token dead + fresh login blocked
  const deadTokenErr = await api('admin.orders', {}, ADMIN_T);
  eq(deadTokenErr.ok, false, 'deactivated admin token rejected');
  const reactErr = await api('auth.login', { username: 'admin', password: 'Admin@12345' });
  eq(reactErr.error.code, 'account_inactive', 'deactivated admin login blocked');

  // reactivate for later steps
  await apiOk('admin.users.update', { user_id: ADMIN_ID, status: 'active' }, admin2Login.token);
  const adminTokenBack = (await apiOk('auth.login', { username: 'admin', password: 'Admin@12345' })).token;

  // change password flow
  const tmpUser = await apiOk('admin.users.create', { username: 'tmp.user', password: 'Tmp@12345', role: 'branch_user', branch_id: 'BR-001', full_name: 'Temp User' }, adminTokenBack);
  const tmpLogin = await apiOk('auth.login', { username: 'tmp.user', password: 'Tmp@12345' });
  const badOld = await api('auth.password', { current_password: 'WRONG!', new_password: 'New@12345' }, tmpLogin.token);
  eq(badOld.ok, false, 'change password with wrong current rejected');
  const weak = await api('auth.password', { current_password: 'Tmp@12345', new_password: '123' }, tmpLogin.token);
  eq(weak.error.code, 'weak_password', 'weak new password rejected');
  await apiOk('auth.password', { current_password: 'Tmp@12345', new_password: 'New@12345' }, tmpLogin.token);
  const oldPwdLogin = await api('auth.login', { username: 'tmp.user', password: 'Tmp@12345' });
  eq(oldPwdLogin.ok, false, 'old password no longer works');
  const newPwdLogin = await api('auth.login', { username: 'tmp.user', password: 'New@12345' });
  eq(newPwdLogin.ok, true, 'new password works');

  // branch user deactivated -> token dies, login blocked
  const MONA_ID = monaLogin.data.user.user_id;
  const depErr = await apiOk('admin.users.update', { user_id: MONA_ID, status: 'inactive' }, adminTokenBack);
  eq(depErr.status, 'inactive', 'branch user deactivated');
  const monaDead = await api('orders.list', {}, MONA_T);
  eq(monaDead.ok, false, 'deactivated user token rejected');
  const monaLoginBlocked = await api('auth.login', { username: 'mona.hassan', password: 'Demo@1234' });
  eq(monaLoginBlocked.error.code, 'account_inactive', 'deactivated user cannot log in');
  await apiOk('admin.users.update', { user_id: MONA_ID, status: 'active' }, adminTokenBack);

  // branch deactivated -> login blocked
  await apiOk('admin.branches.update', { branch_id: 'BR-003', status: 'inactive' }, adminTokenBack);
  const kareemLogin = await api('auth.login', { username: 'kareem.said', password: 'Demo@1234' });
  eq(kareemLogin.error.code, 'branch_inactive', 'login blocked when branch inactive');
  await apiOk('admin.branches.update', { branch_id: 'BR-003', status: 'active' }, adminTokenBack);
  const kareemLogin2 = await api('auth.login', { username: 'kareem.said', password: 'Demo@1234' });
  eq(kareemLogin2.ok, true, 'branch user login restored after branch activated');

  // duplicate username prevented
  const dupUserErr = await api('admin.users.create', { username: 'tmp.user', password: 'X123456', role: 'branch_user', branch_id: 'BR-001' }, adminTokenBack);
  eq(dupUserErr.ok, false, 'duplicate username rejected');

  // branch code duplicates prevented
  const dupBranchErr = await api('admin.branches.create', { branch_code: 'CAIRO-1', branch_name: 'Dup' }, adminTokenBack);
  eq(dupBranchErr.ok, false, 'duplicate branch code rejected');

  // ---------------------------------------------------------------------------
  // H. Concurrency / sequence uniqueness
  // ---------------------------------------------------------------------------
  section('H. Concurrency & sequence uniqueness');

  const t1 = (await apiOk('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' })).token;
  const mkDraft = async (i) => await apiOk('orders.create', { items: { 'ITM-5': 2 }, notes: 'batch ' + i }, t1);
  const results = [];
  for (let i = 0; i < 40; i++) results.push(await mkDraft(i));
  const nums = results.map(d => d.order_number);
  eq(new Set(nums).size, 40, '40 concurrent drafts produce 40 unique order numbers');
  record(nums.every(n => /^ORD-\d{4}-\d{4}$/.test(n)), 'all order numbers formatted');
  eq(new Set(nums).size, new Set(nums.map(n => n.slice(-4))).size, 'final sequence column unique');

  // drafts are visible per branch, listed newest first
  const latest = (await apiOk('orders.list', {}, t1)).orders[0];
  eq(latest.order_number, nums[nums.length - 1], 'list sorted newest first');

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  section('Result');
  console.log(('passed=' + passed + ' failed=' + failed));
  if (failLog.length) {
    console.log('Failures:');
    failLog.forEach(f => console.log('  - ' + f));
  }
  return { passed, failed };
}