/**
 * Setup / initialization: creates missing sheets with headers, supports
 * first-admin creation and explicitly-requested demo data. Never deletes
 * or overwrites existing production data.
 *
 * Run from the Apps Script editor:
 *   1. setupSystem()          - idempotent; safe to run anytime.
 *   2. createFirstAdmin('admin', 'YourPass@123', 'Admin User')
 *   3. loadDemoData()         - only when you want sample data (adds, never overwrites).
 */

function setupSystem() {
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    SheetsRepo.ensure(name, SHEET_HEADERS[name]);
  });
  SheetsRepo.ensure('Settings', SHEET_HEADERS.Settings);
  SheetsRepo.setSetting('SYS_INITIALIZED', 'true');
  var out = { ok: true, sheets: Object.keys(SHEET_HEADERS) };
  return out;
}

function sheetsAreReady_() {
  var ss;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    try {
      var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      if (id) ss = SpreadsheetApp.openById(id);
    } catch (e2) { ss = null; }
  }
  if (!ss) return false;
  var need = Object.keys(SHEET_HEADERS);
  for (var i = 0; i < need.length; i++) {
    if (!ss.getSheetByName(need[i])) return false;
  }
  return true;
}

function ensureSetup_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SYS_READY') !== '1') {
    if (!sheetsAreReady_()) setupSystem();
    props.setProperty('SYS_READY', '1');
  }
  speedUpDemoPasswords_(props);
}

function speedUpDemoPasswords_(props) {
  props = props || PropertiesService.getScriptProperties();
  if (props.getProperty('PWD_FAST') === '1') return;
  var p = 'Demo@1234';
  var names = { 'admin.demo': true, 'ali.ahmed': true, 'mona.hassan': true, 'kareem.said': true };
  var repo = SheetsRepo.repo('Users');
  var rows = repo.readAll();
  for (var i = 0; i < rows.length; i++) {
    if (!names[String(rows[i].username || '')]) continue;
    var parts = String(rows[i].password_hash || '').split('$');
    var rounds = parseInt(parts[1], 10);
    if (parts[0] === 'sha256' && rounds > 32) {
      repo.update(rows[i], { password_hash: Auth.hashPassword(p), updated_at: nowIso() });
    }
  }
  props.setProperty('PWD_FAST', '1');
}

function createFirstAdmin(username, password, fullName) {
  ensureSetup_();
  if (SheetsRepo.getSetting('FIRST_ADMIN_CREATED', 'false') === 'true') {
    fail('already_initialized', 'First admin already exists. Add more admins from the Admin panel.');
  }
  var repo = SheetsRepo.repo('Users');
  var admins = repo.filterAll(function (r) { return String(r.role) === USER_ROLES.ADMIN; });
  if (admins.length > 0) {
    SheetsRepo.setSetting('FIRST_ADMIN_CREATED', 'true');
    fail('already_initialized', 'An admin account already exists in the Users sheet.');
  }
  if (!username || !password) fail('validation', 'Username and password are required.');
  if (String(password).length < 6) fail('validation', 'Password must be at least 6 characters.');
  var id = Ids.userId();
  var rec = repo.insert({
    user_id: id,
    username: String(username).trim(),
    email: '',
    password_hash: Auth.hashPassword(String(password)),
    password_salt: '',
    full_name: String(fullName || username).trim(),
    role: USER_ROLES.ADMIN,
    branch_id: '',
    status: USER_STATUS.ACTIVE,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_login_at: ''
  });
  SheetsRepo.setSetting('FIRST_ADMIN_CREATED', 'true');
  Activity.log(id, 'first_admin_created', 'user', id, {});
  return { ok: true, user_id: rec.user_id, username: rec.username };
}

function loadDemoData() {
  ensureSetup_();
  if (SheetsRepo.getSetting('DEMO_LOADED', 'false') === 'true') {
    fail('demo_exists', 'Demo data has already been loaded. Delete the DEMO_LOADED setting to reload.');
  }
  var branches = SheetsRepo.repo('Branches');
  var items = SheetsRepo.repo('Items');
  var users = SheetsRepo.repo('Users');
  var branchItems = SheetsRepo.repo('Branch_Items');
  var orders = SheetsRepo.repo('Orders');
  var orderItems = SheetsRepo.repo('Order_Items');

  var b1 = branchId('BR', '001');
  var br1 = branches.insert({
    branch_id: b1, branch_code: 'CAIRO-1', branch_name: 'Cairo - Nasr City', location: 'Nasr City, Cairo',
    status: USER_STATUS.ACTIVE, created_at: nowIso(), updated_at: nowIso()
  });
  var b2 = branchId('BR', '002');
  var br2 = branches.insert({
    branch_id: b2, branch_code: 'ALEX-1', branch_name: 'Alexandria - Sidi Gaber', location: 'Sidi Gaber, Alexandria',
    status: USER_STATUS.ACTIVE, created_at: nowIso(), updated_at: nowIso()
  });
  var b3 = branchId('BR', '003');
  var br3 = branches.insert({
    branch_id: b3, branch_code: 'GIZA-1', branch_name: 'Giza - Dokki', location: 'Dokki, Giza',
    status: USER_STATUS.ACTIVE, created_at: nowIso(), updated_at: nowIso()
  });

  var demoItems = [
    { item_code: 'BEV-COLA', item_name: 'Soft Drink - Cola (1L)', category: 'Beverage', unit: 'bottle' },
    { item_code: 'BEV-COLA.33', item_name: 'Soft Drink - Cola (330ml)', category: 'Beverage', unit: 'bottle' },
    { item_code: 'BEV-WAT', item_name: 'Mineral Water (500ml)', category: 'Beverage', unit: 'bottle' },
    { item_code: 'BEV-JUICE', item_name: 'Orange Juice (1L)', category: 'Beverage', unit: 'carton' },
    { item_code: 'MAT-NAP', item_name: 'Paper Napkins', category: 'Material', unit: 'pack' },
    { item_code: 'MAT-CUP', item_name: 'Plastic Cups (200ml)', category: 'Material', unit: 'pack' },
    { item_code: 'MAT-STRAW', item_name: 'Drinking Straws', category: 'Material', unit: 'pack' },
    { item_code: 'MAT-GLOVE', item_name: 'Disposable Gloves', category: 'Material', unit: 'box' },
    { item_code: 'FOOD-SUG', item_name: 'Sugar (5kg)', category: 'Food', unit: 'bag' },
    { item_code: 'FOOD-TEA', item_name: 'Black Tea (250g)', category: 'Food', unit: 'box' },
    { item_code: 'FOOD-MILK', item_name: 'UHT Milk (1L)', category: 'Food', unit: 'carton' },
    { item_code: 'MAT-ICE', item_name: 'Ice Cubes (5kg)', category: 'Material', unit: 'bag' }
  ];
  var itemIds = {};
  demoItems.forEach(function (d, i) {
    var id = 'ITM-' + String(i + 1);
    itemIds[id] = id;
    items.insert({
      item_id: id, item_code: d.item_code, item_name: d.item_name, category: d.category,
      unit: d.unit, active: true, sort_order: i + 1, created_at: nowIso(), updated_at: nowIso()
    });
  });

  Object.keys(itemIds).forEach(function (id) {
    [b1, b2, b3].forEach(function (bid) {
      branchItems.insert({
        branch_id: bid, item_id: id, is_available: true, max_quantity: '',
        updated_at: nowIso()
      });
    });
  });

  var p = 'Demo@1234';
  var uA = users.insert({
    user_id: Ids.userId(), username: 'admin.demo', email: 'admin@demo.local',
    password_hash: Auth.hashPassword(p), password_salt: '', full_name: 'System Admin (Demo)',
    role: USER_ROLES.ADMIN, branch_id: '', status: USER_STATUS.ACTIVE,
    created_at: nowIso(), updated_at: nowIso(), last_login_at: ''
  });
  var u1 = users.insert({
    user_id: Ids.userId(), username: 'ali.ahmed', email: 'ali@demo.local',
    password_hash: Auth.hashPassword(p), password_salt: '', full_name: 'Ali Ahmed Saleh',
    role: USER_ROLES.BRANCH_USER, branch_id: b1, status: USER_STATUS.ACTIVE,
    created_at: nowIso(), updated_at: nowIso(), last_login_at: ''
  });
  var u2 = users.insert({
    user_id: Ids.userId(), username: 'mona.hassan', email: 'mona@demo.local',
    password_hash: Auth.hashPassword(p), password_salt: '', full_name: 'Mona Hassan',
    role: USER_ROLES.BRANCH_USER, branch_id: b2, status: USER_STATUS.ACTIVE,
    created_at: nowIso(), updated_at: nowIso(), last_login_at: ''
  });
  var u3 = users.insert({
    user_id: Ids.userId(), username: 'kareem.said', email: 'kareem@demo.local',
    password_hash: Auth.hashPassword(p), password_salt: '', full_name: 'Kareem Said',
    role: USER_ROLES.BRANCH_USER, branch_id: b3, status: USER_STATUS.ACTIVE,
    created_at: nowIso(), updated_at: nowIso(), last_login_at: ''
  });

  seedOrder(orderItems, orders, b1, u1.user_id, ORDER_STATUS.RECEIVED,
    { 'ITM-1': { req: 24, appr: 24, sent: 24, recv: 24 }, 'ITM-2': { req: 48, appr: 48, sent: 48, recv: 48 }, 'ITM-6': { req: 12, appr: 12, sent: 12, recv: 12 } });
  seedOrder(orderItems, orders, b2, u2.user_id, ORDER_STATUS.SENT,
    { 'ITM-4': { req: 10, appr: 10, sent: 10 }, 'ITM-9': { req: 5, appr: 5, sent: 5 } });
  seedOrder(orderItems, orders, b3, u3.user_id, ORDER_STATUS.SUBMITTED,
    { 'ITM-5': { req: 20, appr: 20 }, 'ITM-7': { req: 30, appr: 30 } });

  SheetsRepo.setSetting('DEMO_LOADED', 'true');
  SheetsRepo.setSetting('FIRST_ADMIN_CREATED', 'true');
  Activity.log(u1.user_id, 'demo_data_loaded', 'system', 'demo', {});
  return { ok: true, message: 'Demo data loaded. Admin: admin.demo / Demo@1234.' };
}

function seedOrder(orderItems, orders, branchId, by, status, lines) {
  var id = Ids.orderId();
  var now = nowIso();
  var rec = orders.insert({
    order_id: id, order_number: id, branch_id: branchId, created_by: by, status: status,
    notes: '', admin_notes: '', cancel_reason: '', submitted_at: now, processed_at: now,
    sent_at: ['sent', 'received'].indexOf(status) !== -1 ? now : '', received_at: status === ORDER_STATUS.RECEIVED ? now : '',
    created_at: now, updated_at: now
  });
  Object.keys(lines).forEach(function (it) {
    var q = lines[it];
    orderItems.insert({
      order_item_id: Ids.lineId(), order_id: id, item_id: it,
      requested_quantity: q.req, approved_quantity: q.appr || '',
      sent_quantity: q.sent === undefined ? '' : q.sent, received_quantity: q.recv === undefined ? '' : q.recv,
      shortage_quantity: '', shortage_reason: '', created_at: now, updated_at: now
    });
  });
  return rec;
}

function branchId(prefix, key) {
  return prefix + '-' + key;
}