import { fail, hashPassword, USER_ROLES, USER_STATUS } from './lib.mjs';

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
      return store.insert('Users', {
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
      return updated;
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
