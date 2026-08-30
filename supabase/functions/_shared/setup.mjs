import { fail, hashPassword, SHEET_NAMES, USER_ROLES, USER_STATUS, ORDER_STATUS } from './lib.mjs';

export function createSetup(store, cfg, ids, activity, auth) {
  async function setupSystem() {
    await store.setSetting('SYS_INITIALIZED', 'true');
    return { ok: true, sheets: SHEET_NAMES.slice() };
  }

  async function createFirstAdmin(username, password, fullName) {
    if ((await store.getSetting('FIRST_ADMIN_CREATED', 'false')) === 'true') {
      fail('already_initialized', 'First admin already exists. Add more admins from the Admin panel.');
    }
    const admins = (await store.all('Users')).filter((r) => String(r.role) === USER_ROLES.ADMIN);
    if (admins.length > 0) {
      await store.setSetting('FIRST_ADMIN_CREATED', 'true');
      fail('already_initialized', 'An admin account already exists.');
    }
    if (!username || !password) fail('validation', 'Username and password are required.');
    if (String(password).length < 6) fail('validation', 'Password must be at least 6 characters.');
    const id = await ids.userId();
    const now = await cfg.now();
    const rec = await store.insert('Users', {
      user_id: id,
      username: String(username).trim(),
      email: '',
      password_hash: await hashPassword(String(password)),
      password_salt: '',
      full_name: String(fullName || username).trim(),
      role: USER_ROLES.ADMIN,
      branch_id: '',
      status: USER_STATUS.ACTIVE,
      created_at: now,
      updated_at: now,
      last_login_at: ''
    });
    await store.setSetting('FIRST_ADMIN_CREATED', 'true');
    await activity.log(id, 'first_admin_created', 'user', id, {});
    return { ok: true, user_id: rec.user_id, username: rec.username };
  }

  async function seedOrder(branchId, by, status, lines) {
    const id = await ids.orderId();
    const now = await cfg.now();
    const rec = await store.insert('Orders', {
      order_id: id,
      order_number: id,
      branch_id: branchId,
      created_by: by,
      status,
      notes: '',
      admin_notes: '',
      cancel_reason: '',
      submitted_at: now,
      processed_at: now,
      sent_at: ['sent', 'received'].indexOf(status) !== -1 ? now : '',
      received_at: status === ORDER_STATUS.RECEIVED ? now : '',
      created_at: now,
      updated_at: now
    });
    for (const it of Object.keys(lines)) {
      const q = lines[it];
      await store.insert('Order_Items', {
        order_item_id: await ids.lineId(),
        order_id: id,
        item_id: it,
        requested_quantity: q.req,
        approved_quantity: q.appr === undefined ? '' : q.appr,
        sent_quantity: q.sent === undefined ? '' : q.sent,
        received_quantity: q.recv === undefined ? '' : q.recv,
        shortage_quantity: '',
        shortage_reason: '',
        created_at: now,
        updated_at: now
      });
    }
    return rec;
  }

  async function loadDemoData() {
    if ((await store.getSetting('DEMO_LOADED', 'false')) === 'true') {
      fail('demo_exists', 'Demo data has already been loaded.');
    }
    const now = await cfg.now();
    const b1 = 'BR-001';
    const b2 = 'BR-002';
    const b3 = 'BR-003';
    async function ensure(table, col, val, row) {
      const hit = await store.find(table, col, val);
      if (hit) return hit;
      return store.insert(table, row);
    }
    await ensure('Branches', 'branch_id', b1, {
      branch_id: b1, branch_code: 'CAIRO-1', branch_name: 'Cairo - Nasr City', location: 'Nasr City, Cairo',
      status: USER_STATUS.ACTIVE, created_at: now, updated_at: now
    });
    await ensure('Branches', 'branch_id', b2, {
      branch_id: b2, branch_code: 'ALEX-1', branch_name: 'Alexandria - Sidi Gaber', location: 'Sidi Gaber, Alexandria',
      status: USER_STATUS.ACTIVE, created_at: now, updated_at: now
    });
    await ensure('Branches', 'branch_id', b3, {
      branch_id: b3, branch_code: 'GIZA-1', branch_name: 'Giza - Dokki', location: 'Dokki, Giza',
      status: USER_STATUS.ACTIVE, created_at: now, updated_at: now
    });

    const demoItems = [
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
    for (let i = 0; i < demoItems.length; i++) {
      const d = demoItems[i];
      const id = 'ITM-' + (i + 1);
      await ensure('Items', 'item_id', id, {
        item_id: id, item_code: d.item_code, item_name: d.item_name, category: d.category,
        unit: d.unit, active: true, sort_order: i + 1, created_at: now, updated_at: now
      });
      const allBI = await store.all('Branch_Items');
      for (const bid of [b1, b2, b3]) {
        const exists = allBI.some((r) => String(r.branch_id) === bid && String(r.item_id) === id);
        if (exists) continue;
        await store.insert('Branch_Items', {
          branch_id: bid, item_id: id, is_available: true, max_quantity: '', updated_at: now
        });
      }
    }

    const p = 'Demo@1234';
    const hash = await hashPassword(p);
    async function ensureUser(username, row) {
      const hit = await store.find('Users', 'username', username);
      if (hit) return hit;
      return store.insert('Users', Object.assign({ user_id: await ids.userId() }, row));
    }
    await ensureUser('admin.demo', {
      username: 'admin.demo', email: 'admin@demo.local',
      password_hash: hash, password_salt: '', full_name: 'System Admin (Demo)',
      role: USER_ROLES.ADMIN, branch_id: '', status: USER_STATUS.ACTIVE,
      created_at: now, updated_at: now, last_login_at: ''
    });
    const u1 = await ensureUser('ali.ahmed', {
      username: 'ali.ahmed', email: 'ali@demo.local',
      password_hash: hash, password_salt: '', full_name: 'Ali Ahmed Saleh',
      role: USER_ROLES.BRANCH_USER, branch_id: b1, status: USER_STATUS.ACTIVE,
      created_at: now, updated_at: now, last_login_at: ''
    });
    const u2 = await ensureUser('mona.hassan', {
      username: 'mona.hassan', email: 'mona@demo.local',
      password_hash: hash, password_salt: '', full_name: 'Mona Hassan',
      role: USER_ROLES.BRANCH_USER, branch_id: b2, status: USER_STATUS.ACTIVE,
      created_at: now, updated_at: now, last_login_at: ''
    });
    const u3 = await ensureUser('kareem.said', {
      username: 'kareem.said', email: 'kareem@demo.local',
      password_hash: hash, password_salt: '', full_name: 'Kareem Said',
      role: USER_ROLES.BRANCH_USER, branch_id: b3, status: USER_STATUS.ACTIVE,
      created_at: now, updated_at: now, last_login_at: ''
    });

    await seedOrder(b1, u1.user_id, ORDER_STATUS.RECEIVED, {
      'ITM-1': { req: 24, appr: 24, sent: 24, recv: 24 },
      'ITM-2': { req: 48, appr: 48, sent: 48, recv: 48 },
      'ITM-6': { req: 12, appr: 12, sent: 12, recv: 12 }
    });
    await seedOrder(b2, u2.user_id, ORDER_STATUS.SENT, {
      'ITM-4': { req: 10, appr: 10, sent: 10 },
      'ITM-9': { req: 5, appr: 5, sent: 5 }
    });
    await seedOrder(b3, u3.user_id, ORDER_STATUS.SUBMITTED, {
      'ITM-5': { req: 20, appr: 20 },
      'ITM-7': { req: 30, appr: 30 }
    });

    await store.setSetting('DEMO_LOADED', 'true');
    await store.setSetting('FIRST_ADMIN_CREATED', 'true');
    await activity.log(u1.user_id, 'demo_data_loaded', 'system', 'demo', {});
    return { ok: true, message: 'Demo data loaded. Admin: admin.demo / Demo@1234.' };
  }

  return { setupSystem, createFirstAdmin, loadDemoData };
}
