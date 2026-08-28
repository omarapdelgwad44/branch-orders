/**
 * Catalog port of CatalogService.gs: users, branches, items, availability.
 */
import { SheetsRepo, Ids } from './store.js';
import { Auth } from './auth.js';
import { Activity } from './activity.js';
import { fail, nowIso, USER_ROLES, USER_STATUS } from './constants.js';

var Users = (function () {
  function repo() { return SheetsRepo.repo('Users').ensure(); }

  function list() {
    var branches = {};
    SheetsRepo.repo('Branches').readAll().forEach(function (b) { branches[b.branch_id] = b.branch_name; });
    return repo().readAll().map(function (r) {
      return {
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
      };
    });
  }

  function findById(userId) {
    var u = repo().find('user_id', userId);
    if (!u) return null;
    var x = Auth.publicUser(userId);
    x.__row = u.__row;
    x.status = u.status;
    return x;
  }

  function guardLastActiveAdmin_(role, patchStatus) {
    if (String(patchStatus) === USER_STATUS.INACTIVE && String(role) === USER_ROLES.ADMIN) {
      var admins = repo().filterAll(function (r) {
        return String(r.role) === USER_ROLES.ADMIN && String(r.status) === USER_STATUS.ACTIVE;
      });
      if (admins.length <= 1) {
        fail('last_active_admin', 'You cannot disable the last active administrator account.');
      }
    }
  }

  function create(payload) {
    var username = String(payload.username || '').trim();
    var password = String(payload.password || '');
    var role = String(payload.role || '').trim();
    var branchId = String(payload.branch_id || '').trim();
    if (!username || !password) fail('validation', 'Username and password are required.');
    if (String(password).length < 6) fail('validation', 'Password must be at least 6 characters.');
    if ([USER_ROLES.ADMIN, USER_ROLES.BRANCH_USER].indexOf(role) === -1) fail('validation', 'Invalid role.');
    if (role === USER_ROLES.BRANCH_USER) {
      var branch = SheetsRepo.repo('Branches').find('branch_id', branchId);
      if (!branch) fail('validation', 'A branch is required for branch users.');
    }
    var dup = repo().filterAll(function (r) {
      return String(r.username).toLowerCase() === username.toLowerCase();
    });
    if (dup.length) fail('validation', 'This username is already taken.');
    var id = Ids.userId();
    return repo().insert({
      user_id: id,
      username: username,
      email: String(payload.email || '').trim(),
      password_hash: Auth.hashPassword(password),
      password_salt: '',
      full_name: String(payload.full_name || payload.username || '').trim(),
      role: role,
      branch_id: role === USER_ROLES.BRANCH_USER ? branchId : '',
      status: String(payload.status || USER_STATUS.ACTIVE) === USER_STATUS.INACTIVE ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_login_at: ''
    });
  }

  function update(userId, payload) {
    var row = repo().find('user_id', userId);
    if (!row) fail('not_found', 'User not found.');
    var patch = { updated_at: nowIso() };
    if (payload.full_name !== undefined) patch.full_name = String(payload.full_name).trim();
    if (payload.email !== undefined) patch.email = String(payload.email).trim();
    if (payload.role !== undefined) {
      var role = String(payload.role);
      if ([USER_ROLES.ADMIN, USER_ROLES.BRANCH_USER].indexOf(role) === -1) fail('validation', 'Invalid role.');
      patch.role = role;
    }
    if (payload.username !== undefined) {
      var username = String(payload.username).trim();
      var dup = repo().filterAll(function (r) { return r.user_id !== userId && String(r.username).toLowerCase() === username.toLowerCase(); });
      if (dup.length) fail('validation', 'This username is already taken.');
      patch.username = username;
    }
    if (payload.status !== undefined) {
      var st = String(payload.status) === USER_STATUS.ACTIVE ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE;
      guardLastActiveAdmin_(row.role, st);
      patch.status = st;
    }
    if (payload.branch_id !== undefined) {
      if (String(payload.role === undefined ? row.role : patch.role) === USER_ROLES.BRANCH_USER) {
        var b = SheetsRepo.repo('Branches').find('branch_id', String(payload.branch_id));
        if (!b) fail('validation', 'Invalid branch.');
        patch.branch_id = String(payload.branch_id);
      } else {
        patch.branch_id = '';
      }
    }
    if (payload.new_password) {
      if (String(payload.new_password).length < 6) fail('validation', 'Password must be at least 6 characters.');
      patch.password_hash = Auth.hashPassword(String(payload.new_password));
    }
    var updated = repo().update(row, patch);
    Activity.log(null, 'user_updated', 'user', userId, { role: patch.role || row.role });
    return updated;
  }

  return { list: list, findById: findById, create: create, update: update };
})();

var Branches = (function () {
  function repo() { return SheetsRepo.repo('Branches').ensure(); }
  function list() {
    return repo().readAll().map(function (r) {
      return {
        branch_id: r.branch_id,
        branch_code: r.branch_code,
        branch_name: r.branch_name,
        location: r.location || '',
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at
      };
    });
  }
  function create(payload) {
    var code = String(payload.branch_code || '').trim();
    var name = String(payload.branch_name || '').trim();
    if (!code || !name) fail('validation', 'Branch code and name are required.');
    var dup = repo().filterAll(function (r) { return String(r.branch_code).toLowerCase() === code.toLowerCase(); });
    if (dup.length) fail('validation', 'This branch code is already in use.');
    var id = Ids.branchId();
    var rec = repo().insert({
      branch_id: id,
      branch_code: code,
      branch_name: name,
      location: String(payload.location || '').trim(),
      status: String(payload.status || USER_STATUS.ACTIVE) === USER_STATUS.INACTIVE ? USER_STATUS.INACTIVE : USER_STATUS.ACTIVE,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    Activity.log(null, 'branch_created', 'branch', id, { code: code, name: name });
    return rec;
  }
  function update(branchId, payload) {
    var row = repo().find('branch_id', branchId);
    if (!row) fail('not_found', 'Branch not found.');
    var patch = { updated_at: nowIso() };
    if (payload.branch_code !== undefined) patch.branch_code = String(payload.branch_code).trim();
    if (payload.branch_name !== undefined) patch.branch_name = String(payload.branch_name).trim();
    if (payload.location !== undefined) patch.location = String(payload.location).trim();
    if (payload.status !== undefined) {
      patch.status = String(payload.status) === USER_STATUS.ACTIVE ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE;
    }
    var updated = repo().update(row, patch);
    Activity.log(null, 'branch_updated', 'branch', branchId, { status: patch.status || '' });
    return updated;
  }
  return { list: list, create: create, update: update };
})();

var Items = (function () {
  function repo() { return SheetsRepo.repo('Items').ensure(); }

  function sanitize(r) {
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

  function list(includeInactive) {
    return repo().readAll().map(sanitize);
  }

  function catalogForBranch(branchId) {
    var items = list(true);
    var avail = SheetsRepo.repo('Branch_Items').readAll();
    var byBranch = {};
    avail.forEach(function (a) {
      if (String(a.branch_id) === String(branchId)) byBranch[a.item_id] = {
        is_available: String(a.is_available) !== 'false' && a.is_available !== false,
        max_quantity: a.max_quantity === '' || a.max_quantity === null ? null : parseInt(a.max_quantity, 10)
      };
    });
    var out = [];
    items.forEach(function (it) {
      if (!it.active) return;
      var cfg = byBranch[it.item_id] || { is_available: true, max_quantity: null };
      if (!cfg.is_available) return;
      out.push({
        item_id: it.item_id,
        item_code: it.item_code,
        item_name: it.item_name,
        category: it.category,
        unit: it.unit,
        max_quantity: cfg.max_quantity
      });
    });
    out.sort(function (a, b) {
      var c = String(a.category).localeCompare(String(b.category));
      return c !== 0 ? c : String(a.item_name).localeCompare(String(b.item_name));
    });
    return out;
  }

  function categories() {
    var set = {};
    repo().readAll().forEach(function (r) { if (r.category) set[r.category] = true; });
    return Object.keys(set).sort();
  }

  function create(payload) {
    var name = String(payload.item_name || '').trim();
    if (!name) fail('validation', 'Item name is required.');
    var rec = repo().insert({
      item_id: Ids.itemId(),
      item_code: String(payload.item_code || '').trim(),
      item_name: name,
      category: String(payload.category || '').trim(),
      unit: String(payload.unit || 'pc').trim() || 'pc',
      active: String(payload.active) === 'false' || payload.active === false ? false : true,
      sort_order: parseInt(payload.sort_order, 10) || 0,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    Activity.log(null, 'item_created', 'item', rec.item_id, { name: name });
    return rec;
  }

  function update(itemId, payload) {
    var row = repo().find('item_id', itemId);
    if (!row) fail('not_found', 'Item not found.');
    var patch = { updated_at: nowIso() };
    if (payload.item_name !== undefined) patch.item_name = String(payload.item_name).trim();
    if (payload.item_code !== undefined) patch.item_code = String(payload.item_code).trim();
    if (payload.category !== undefined) patch.category = String(payload.category).trim();
    if (payload.unit !== undefined) patch.unit = String(payload.unit).trim() || 'pc';
    if (payload.active !== undefined) patch.active = String(payload.active) === 'false' || payload.active === false ? false : true;
    if (payload.sort_order !== undefined) patch.sort_order = parseInt(payload.sort_order, 10) || 0;
    var updated = repo().update(row, patch);
    Activity.log(null, 'item_updated', 'item', itemId, {});
    return updated;
  }

  function setBranchItems(branchId, assignments) {
    var repoBI = SheetsRepo.repo('Branch_Items').ensure();
    if (!Array.isArray(assignments)) fail('validation', 'Assignments must be an array.');
    var branch = SheetsRepo.repo('Branches').find('branch_id', branchId);
    if (!branch) fail('not_found', 'Branch not found.');
    var itemIds = {};
    repo().readAll().forEach(function (it) { itemIds[it.item_id] = true; });
    assignments.forEach(function (a) {
      if (!itemIds[a.item_id]) fail('validation', 'Unknown item: ' + a.item_id);
      var hit = repoBI.filterAll(function (r) { return String(r.branch_id) === String(branchId) && String(r.item_id) === String(a.item_id); })[0];
      var patch = {
        is_available: a.is_available === undefined || a.is_available === true ? true : false,
        max_quantity: a.max_quantity ? parseInt(a.max_quantity, 10) : '',
        updated_at: nowIso()
      };
      if (hit) repoBI.update(hit, patch);
      else repoBI.insert({
        branch_id: String(branchId),
        item_id: String(a.item_id),
        is_available: patch.is_available,
        max_quantity: patch.max_quantity,
        updated_at: nowIso()
      });
    });
    Activity.log(null, 'availability_updated', 'branch', branchId, { items: assignments.length });
    return true;
  }

  return { list: list, catalogForBranch: catalogForBranch, categories: categories, create: create, update: update, setBranchItems: setBranchItems };
})();

export var UsersService = Users;
export var BranchesService = Branches;
export var Items = Items;