import { fail, hashPassword, USER_ROLES, USER_STATUS } from './lib.mjs';

function publicUser(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  delete out.password_hash;
  delete out.password_salt;
  return out;
}

function parseActive(value) {
  return parseStatus(value) === USER_STATUS.ACTIVE;
}

function parseStatus(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (['0', 'false', 'no', 'n', 'لا', 'غير نشط', 'inactive'].indexOf(s) !== -1) return USER_STATUS.INACTIVE;
  return USER_STATUS.ACTIVE;
}

function parseRole(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['admin', 'مدير', 'مدير نظام', 'مسؤول'].indexOf(s) !== -1) return USER_ROLES.ADMIN;
  return USER_ROLES.BRANCH_USER;
}

function findBranch(branches, label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  return branches.find((b) =>
    String(b.branch_code || '').toLowerCase() === s || String(b.branch_name || '').toLowerCase() === s
  ) || null;
}

export function createCatalog(store, cfg, ids, activity, auth) {
  const Users = {
    async list() {
      const branches = {};
      (await store.all('Branches')).forEach((b) => { branches[b.branch_id] = b.branch_name; });
      return (await store.all('Users')).map((r) => ({
        user_id: r.user_id,
        username: r.username,
        email: r.email || '',
        full_name: r.full_name,
        role: r.role,
        branch_id: r.branch_id || '',
        branch_name: branches[r.branch_id] || '',
        status: r.status,
        last_login_at: r.last_login_at || '',
        created_at: r.created_at
      }));
    },

    async create(payload) {
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '');
      const role = String(payload.role || '').trim();
      const branchId = String(payload.branch_id || '').trim();
      if (!username || !password) fail('validation', 'Username and password are required.');
      if (String(password).length < 6) fail('validation', 'Password must be at least 6 characters.');
      if ([USER_ROLES.ADMIN, USER_ROLES.BRANCH_USER].indexOf(role) === -1) fail('validation', 'Invalid role.');
      if (role === USER_ROLES.BRANCH_USER) {
        const branch = await store.find('Branches', 'branch_id', branchId);
        if (!branch) fail('validation', 'A branch is required for branch users.');
      }
      const dup = (await store.all('Users')).filter((r) => String(r.username).toLowerCase() === username.toLowerCase());
      if (dup.length) fail('validation', 'This username is already taken.');
      const id = await ids.userId();
      const rec = await store.insert('Users', {
        user_id: id,
        username,
        email: String(payload.email || '').trim(),
        password_hash: await hashPassword(password),
        password_salt: '',
        full_name: String(payload.full_name || payload.username || '').trim(),
        role,
        branch_id: role === USER_ROLES.BRANCH_USER ? branchId : '',
        status: String(payload.status || USER_STATUS.ACTIVE) === USER_STATUS.INACTIVE ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE,
        created_at: await cfg.now(),
        updated_at: await cfg.now(),
        last_login_at: ''
      });
      return publicUser(rec);
    },

    async update(userId, payload) {
      const row = await store.find('Users', 'user_id', userId);
      if (!row) fail('not_found', 'User not found.');
      const patch = { updated_at: await cfg.now() };
      if (payload.full_name !== undefined) patch.full_name = String(payload.full_name).trim();
      if (payload.email !== undefined) patch.email = String(payload.email).trim();
      if (payload.role !== undefined) {
        const role = String(payload.role);
        if ([USER_ROLES.ADMIN, USER_ROLES.BRANCH_USER].indexOf(role) === -1) fail('validation', 'Invalid role.');
        patch.role = role;
      }
      if (payload.username !== undefined) {
        const username = String(payload.username).trim();
        const dup = (await store.all('Users')).filter((r) => r.user_id !== userId && String(r.username).toLowerCase() === username.toLowerCase());
        if (dup.length) fail('validation', 'This username is already taken.');
        patch.username = username;
      }
      if (payload.status !== undefined) {
        const st = String(payload.status) === USER_STATUS.ACTIVE ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE;
        if (st === USER_STATUS.INACTIVE && String(row.role) === USER_ROLES.ADMIN) {
          const admins = (await store.all('Users')).filter((r) =>
            String(r.role) === USER_ROLES.ADMIN && String(r.status) === USER_STATUS.ACTIVE);
          if (admins.length <= 1) fail('last_active_admin', 'You cannot disable the last active administrator account.');
        }
        patch.status = st;
      }
      if (payload.branch_id !== undefined) {
        const role = payload.role === undefined ? row.role : patch.role;
        if (String(role) === USER_ROLES.BRANCH_USER) {
          const b = await store.find('Branches', 'branch_id', String(payload.branch_id));
          if (!b) fail('validation', 'Invalid branch.');
          patch.branch_id = String(payload.branch_id);
        } else {
          patch.branch_id = '';
        }
      }
      if (payload.new_password) {
        if (String(payload.new_password).length < 6) fail('validation', 'Password must be at least 6 characters.');
        patch.password_hash = await hashPassword(String(payload.new_password));
      }
      const updated = await store.update('Users', row, patch);
      await activity.log(null, 'user_updated', 'user', userId, { role: patch.role || row.role });
      return publicUser(updated);
    },
    async remove(userId, actor) {
      const row = await store.find('Users', 'user_id', userId);
      if (!row) fail('not_found', 'User not found.');
      if (actor && String(actor.user_id) === String(userId)) {
        fail('delete_self', 'You cannot delete the account you are signed in with.');
      }
      if (String(row.role) === USER_ROLES.ADMIN && String(row.status) === USER_STATUS.ACTIVE) {
        const admins = (await store.all('Users')).filter((r) =>
          String(r.role) === USER_ROLES.ADMIN && String(r.status) === USER_STATUS.ACTIVE && String(r.user_id) !== String(userId));
        if (!admins.length) fail('delete_last_admin', 'You cannot delete the last active administrator.');
      }
      const orders = await store.all('Orders');
      if (orders.some((o) => String(o.created_by) === String(userId))) {
        fail('in_use', 'This user still has orders and cannot be deleted.');
      }
      await store.remove('Sessions', 'user_id', userId);
      await store.remove('Users', 'user_id', userId);
      await activity.log(actor && actor.user_id, 'user_deleted', 'user', userId, { username: row.username });
      return { ok: true };
    },
    async importRows(rows) {
      if (!Array.isArray(rows) || !rows.length) fail('validation', 'The file has no rows to import.');
      const existing = await store.all('Users');
      const branchList = await store.all('Branches');
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || {};
        const username = String(raw.username || '').trim();
        const rowNo = parseInt(raw.row, 10) || (i + 2);
        if (!username && !String(raw.full_name || '').trim()) { skipped++; continue; }
        if (username.toUpperCase() === 'EXAMPLE') { skipped++; continue; }
        if (!username) {
          errors.push({ row: rowNo, message: 'Username is required.' });
          continue;
        }
        const role = parseRole(raw.role);
        const branch = findBranch(branchList, raw.branch);
        if (role === USER_ROLES.BRANCH_USER && !branch) {
          errors.push({ row: rowNo, message: 'Branch was not found.' });
          continue;
        }
        const hit = existing.find((u) => String(u.username || '').toLowerCase() === username.toLowerCase());
        const password = String(raw.password || '');
        try {
          if (hit) {
            const payload = {
              full_name: String(raw.full_name || hit.full_name || '').trim(),
              email: String(raw.email || '').trim(),
              role,
              branch_id: role === USER_ROLES.BRANCH_USER ? branch.branch_id : '',
              status: parseStatus(raw.status)
            };
            if (password) payload.new_password = password;
            await this.update(hit.user_id, payload);
            updated++;
          } else {
            if (password.length < 6) {
              errors.push({ row: rowNo, message: 'Password must be at least 6 characters.' });
              continue;
            }
            const rec = await this.create({
              username,
              password,
              full_name: String(raw.full_name || username).trim(),
              email: String(raw.email || '').trim(),
              role,
              branch_id: role === USER_ROLES.BRANCH_USER ? branch.branch_id : '',
              status: parseStatus(raw.status)
            });
            existing.push(rec);
            created++;
          }
        } catch (err) {
          errors.push({ row: rowNo, message: (err && err.message) || 'Invalid row' });
        }
      }
      return { created, updated, skipped, errors };
    }
  };

  const Branches = {
    async list() {
      return (await store.all('Branches')).map((r) => ({
        branch_id: r.branch_id,
        branch_code: r.branch_code,
        branch_name: r.branch_name,
        location: r.location || '',
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at
      }));
    },
    async nextFreeBranchId() {
      for (;;) {
        const id = await ids.branchId();
        if (!(await store.find('Branches', 'branch_id', id))) return id;
      }
    },
    async create(payload) {
      const name = String(payload.branch_name || '').trim();
      if (!name) fail('validation', 'Branch name is required.');
      const id = await this.nextFreeBranchId();
      let code = String(payload.branch_code || '').trim() || id;
      const all = await store.all('Branches');
      if (all.some((r) => String(r.branch_code).toLowerCase() === code.toLowerCase())) {
        if (payload.branch_code) fail('validation', 'This branch code is already in use.');
        do { code = await this.nextFreeBranchId(); }
        while (all.some((r) => String(r.branch_code).toLowerCase() === code.toLowerCase()));
      }
      const rec = await store.insert('Branches', {
        branch_id: id,
        branch_code: code,
        branch_name: name,
        location: String(payload.location || '').trim(),
        status: String(payload.status || USER_STATUS.ACTIVE) === USER_STATUS.INACTIVE ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE,
        created_at: await cfg.now(),
        updated_at: await cfg.now()
      });
      await activity.log(null, 'branch_created', 'branch', id, { code, name });
      return rec;
    },
    async update(branchId, payload) {
      const row = await store.find('Branches', 'branch_id', branchId);
      if (!row) fail('not_found', 'Branch not found.');
      const patch = { updated_at: await cfg.now() };
      if (payload.branch_code !== undefined) patch.branch_code = String(payload.branch_code).trim();
      if (payload.branch_name !== undefined) patch.branch_name = String(payload.branch_name).trim();
      if (payload.location !== undefined) patch.location = String(payload.location || '').trim();
      if (payload.status !== undefined) {
        patch.status = String(payload.status) === USER_STATUS.ACTIVE ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE;
      }
      const updated = await store.update('Branches', row, patch);
      await activity.log(null, 'branch_updated', 'branch', branchId, { status: patch.status || '' });
      return updated;
    },
    async importRows(rows) {
      if (!Array.isArray(rows) || !rows.length) fail('validation', 'The file has no rows to import.');
      const existing = await store.all('Branches');
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || {};
        const code = String(raw.branch_code || '').trim();
        const name = String(raw.branch_name || '').trim();
        const rowNo = parseInt(raw.row, 10) || (i + 2);
        if (!name && !code) { skipped++; continue; }
        if (code.toUpperCase() === 'EXAMPLE') { skipped++; continue; }
        if (!name) {
          errors.push({ row: rowNo, message: 'Branch name is required.' });
          continue;
        }
        const payload = {
          branch_name: name,
          location: String(raw.location || '').trim(),
          status: parseStatus(raw.status)
        };
        if (code) payload.branch_code = code;
        const hit = code
          ? existing.find((b) => String(b.branch_code || '').toLowerCase() === code.toLowerCase())
          : null;
        try {
          if (hit) {
            await this.update(hit.branch_id, payload);
            Object.assign(hit, payload);
            updated++;
          } else {
            const rec = await this.create(payload);
            existing.push(rec);
            created++;
          }
        } catch (err) {
          errors.push({ row: rowNo, message: (err && err.message) || 'Invalid row' });
        }
      }
      return { created, updated, skipped, errors };
    },
    async remove(branchId) {
      const row = await store.find('Branches', 'branch_id', branchId);
      if (!row) fail('not_found', 'Branch not found.');
      const users = await store.all('Users');
      if (users.some((u) => String(u.branch_id) === String(branchId))) {
        fail('in_use', 'This branch still has users and cannot be deleted.');
      }
      const orders = await store.all('Orders');
      if (orders.some((o) => String(o.branch_id) === String(branchId))) {
        fail('in_use', 'This branch still has orders and cannot be deleted.');
      }
      await store.remove('Branch_Items', 'branch_id', branchId);
      await store.remove('Branches', 'branch_id', branchId);
      await activity.log(null, 'branch_deleted', 'branch', branchId, { code: row.branch_code });
      return { ok: true };
    }
  };

  function sanitizeItem(r) {
    return {
      item_id: r.item_id,
      item_code: r.item_code || '',
      item_name: r.item_name,
      category: r.category || '',
      unit: r.unit || 'pc',
      active: String(r.active) === 'false' || r.active === false ? false : true,
      sort_order: parseInt(r.sort_order, 10) || 0,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  const Items = {
    async list() {
      return (await store.all('Items')).map(sanitizeItem);
    },
    async catalogForBranch(branchId) {
      const items = await this.list();
      const avail = await store.all('Branch_Items');
      const byBranch = {};
      avail.forEach((a) => {
        if (String(a.branch_id) === String(branchId)) {
          byBranch[a.item_id] = {
            is_available: String(a.is_available) !== 'false' && a.is_available !== false,
            max_quantity: a.max_quantity === '' || a.max_quantity === null || a.max_quantity === undefined
              ? null
              : parseInt(a.max_quantity, 10)
          };
        }
      });
      const out = [];
      items.forEach((it) => {
        if (!it.active) return;
        const cfgA = byBranch[it.item_id] || { is_available: true, max_quantity: null };
        if (!cfgA.is_available) return;
        out.push({
          item_id: it.item_id,
          item_code: it.item_code,
          item_name: it.item_name,
          category: it.category,
          unit: it.unit,
          max_quantity: cfgA.max_quantity
        });
      });
      out.sort((a, b) => {
        const c = String(a.category).localeCompare(String(b.category));
        return c !== 0 ? c : String(a.item_name).localeCompare(String(b.item_name));
      });
      return out;
    },
    async categories() {
      const set = {};
      (await store.all('Items')).forEach((r) => { if (r.category) set[r.category] = true; });
      return Object.keys(set).sort();
    },
    async create(payload) {
      const name = String(payload.item_name || '').trim();
      if (!name) fail('validation', 'Item name is required.');
      const rec = await store.insert('Items', {
        item_id: await ids.itemId(),
        item_code: String(payload.item_code || '').trim(),
        item_name: name,
        category: String(payload.category || '').trim(),
        unit: String(payload.unit || 'pc').trim() || 'pc',
        active: String(payload.active) === 'false' || payload.active === false ? false : true,
        sort_order: parseInt(payload.sort_order, 10) || 0,
        created_at: await cfg.now(),
        updated_at: await cfg.now()
      });
      await activity.log(null, 'item_created', 'item', rec.item_id, { name });
      return rec;
    },
    async update(itemId, payload) {
      const row = await store.find('Items', 'item_id', itemId);
      if (!row) fail('not_found', 'Item not found.');
      const patch = { updated_at: await cfg.now() };
      if (payload.item_name !== undefined) patch.item_name = String(payload.item_name).trim();
      if (payload.item_code !== undefined) patch.item_code = String(payload.item_code).trim();
      if (payload.category !== undefined) patch.category = String(payload.category).trim();
      if (payload.unit !== undefined) patch.unit = String(payload.unit).trim() || 'pc';
      if (payload.active !== undefined) patch.active = String(payload.active) === 'false' || payload.active === false ? false : true;
      if (payload.sort_order !== undefined) patch.sort_order = parseInt(payload.sort_order, 10) || 0;
      const updated = await store.update('Items', row, patch);
      await activity.log(null, 'item_updated', 'item', itemId, {});
      return updated;
    },
    async remove(itemId) {
      const row = await store.find('Items', 'item_id', itemId);
      if (!row) fail('not_found', 'Item not found.');
      const lines = await store.all('Order_Items');
      if (lines.some((l) => String(l.item_id) === String(itemId))) {
        fail('in_use', 'This item is used on orders and cannot be deleted.');
      }
      await store.remove('Branch_Items', 'item_id', itemId);
      await store.remove('Items', 'item_id', itemId);
      await activity.log(null, 'item_deleted', 'item', itemId, { name: row.item_name });
      return { ok: true };
    },
    async importRows(rows) {
      if (!Array.isArray(rows) || !rows.length) fail('validation', 'The file has no items.');
      const existing = await store.all('Items');
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] || {};
        const code = String(raw.item_code || '').trim();
        const name = String(raw.item_name || '').trim();
        const rowNo = parseInt(raw.row, 10) || (i + 2);
        if (!name && !code) { skipped++; continue; }
        if (code.toUpperCase() === 'EXAMPLE') { skipped++; continue; }
        if (!name) {
          errors.push({ row: rowNo, message: 'Item name is required.' });
          continue;
        }
        const payload = {
          item_name: name,
          item_code: code,
          category: String(raw.category || '').trim(),
          unit: String(raw.unit || '').trim() || 'pc',
          sort_order: parseInt(raw.sort_order, 10) || 0,
          active: parseActive(raw.active)
        };
        const hit = code
          ? existing.find((r) => String(r.item_code || '').toLowerCase() === code.toLowerCase())
          : null;
        try {
          if (hit) {
            await this.update(hit.item_id, payload);
            Object.assign(hit, payload);
            updated++;
          } else {
            const rec = await this.create(payload);
            existing.push(rec);
            created++;
          }
        } catch (err) {
          errors.push({ row: rowNo, message: (err && err.message) || 'Invalid row' });
        }
      }
      return { created, updated, skipped, errors };
    },
    async branchAssignments(branchId) {
      const branch = await store.find('Branches', 'branch_id', branchId);
      if (!branch) fail('not_found', 'Branch not found.');
      const items = await this.list();
      const avail = await store.all('Branch_Items');
      const byItem = {};
      avail.forEach((a) => {
        if (String(a.branch_id) === String(branchId)) {
          byItem[String(a.item_id)] = {
            is_available: String(a.is_available) !== 'false' && a.is_available !== false,
            max_quantity: a.max_quantity === '' || a.max_quantity === null || a.max_quantity === undefined
              ? '' : Number(a.max_quantity)
          };
        }
      });
      return items.map((it) => ({
        item_id: it.item_id,
        is_available: byItem[it.item_id] ? byItem[it.item_id].is_available : true,
        max_quantity: byItem[it.item_id] ? byItem[it.item_id].max_quantity : ''
      }));
    },
    async setBranchItems(branchId, assignments) {
      if (!Array.isArray(assignments)) fail('validation', 'Assignments must be an array.');
      const branch = await store.find('Branches', 'branch_id', branchId);
      if (!branch) fail('not_found', 'Branch not found.');
      const itemIds = {};
      (await store.all('Items')).forEach((it) => { itemIds[it.item_id] = true; });
      const allBI = await store.all('Branch_Items');
      for (const a of assignments) {
        if (!itemIds[a.item_id]) fail('validation', 'Unknown item: ' + a.item_id);
        const hit = allBI.find((r) => String(r.branch_id) === String(branchId) && String(r.item_id) === String(a.item_id));
        const patch = {
          is_available: a.is_available === undefined || a.is_available === true,
          max_quantity: a.max_quantity ? parseInt(a.max_quantity, 10) : '',
          updated_at: await cfg.now()
        };
        if (hit) await store.update('Branch_Items', hit, patch);
        else {
          const rec = await store.insert('Branch_Items', {
            branch_id: String(branchId),
            item_id: String(a.item_id),
            is_available: patch.is_available,
            max_quantity: patch.max_quantity,
            updated_at: patch.updated_at
          });
          allBI.push(rec);
        }
      }
      await activity.log(null, 'availability_updated', 'branch', branchId, { items: assignments.length });
      return true;
    }
  };

  return { Users, Branches, Items };
}
