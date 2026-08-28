/**
 * Local browser database = port of SheetsRepo.gs + Ids + CONFIG.
 * One JSON document in localStorage (key `bo.db`), shaped exactly like
 * the Apps Script workbook so the service layer ports 1:1.
 */
import { sha256Hex } from './sha256.js';
import { ApiError } from './constants.js';

export var DB_KEY = 'bo.db';

export var SHEET_HEADERS = Object.freeze({
  Users: ['user_id', 'username', 'email', 'password_hash', 'password_salt', 'full_name', 'role', 'branch_id', 'status', 'created_at', 'updated_at', 'last_login_at'],
  Branches: ['branch_id', 'branch_code', 'branch_name', 'location', 'status', 'created_at', 'updated_at'],
  Items: ['item_id', 'item_code', 'item_name', 'category', 'unit', 'active', 'sort_order', 'created_at', 'updated_at'],
  Branch_Items: ['branch_id', 'item_id', 'is_available', 'max_quantity', 'updated_at'],
  Orders: ['order_id', 'order_number', 'branch_id', 'created_by', 'status', 'notes', 'admin_notes', 'cancel_reason', 'submitted_at', 'processed_at', 'sent_at', 'received_at', 'created_at', 'updated_at'],
  Order_Items: ['order_item_id', 'order_id', 'item_id', 'requested_quantity', 'approved_quantity', 'sent_quantity', 'received_quantity', 'shortage_quantity', 'shortage_reason', 'created_at', 'updated_at'],
  Activity_Log: ['log_id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'details_json', 'created_at'],
  Sessions: ['token', 'user_id', 'created_at', 'expires_at', 'active'],
  Settings: ['key', 'value'],
  Maintenance: ['key', 'value']
});

var CONFIG_DEFAULTS = {
  TIMEZONE: 'Africa/Cairo',
  SESSION_HOURS: '12',
  MAX_QTY_PER_ITEM: '9999',
  ALLOW_DECIMAL_QTY: 'false',
  REQUIRE_APPROVAL: 'true',
  APP_VERSION: '1.0.0'
};

var _db = null;

export function localStorage_() {
  if (!globalThis.localStorage) {
    throw new ApiError('storage_error', 'localStorage is not available in this browser.');
  }
  return globalThis.localStorage;
}

function emptyDb() {
  return { version: 1, sheets: {}, props: {} };
}

export function loadDB() {
  if (!_db) {
    var fresh = emptyDb();
    try {
      var raw = localStorage_().getItem(DB_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.sheets) _db = parsed; else _db = fresh;
      } else {
        _db = fresh;
      }
    } catch (e) {
      _db = fresh;
    }
    if (!_db.sheets) _db.sheets = {};
    if (!_db.props) _db.props = {};
  }
  return _db;
}

export function persist() {
  try {
    localStorage_().setItem(DB_KEY, JSON.stringify(loadDB()));
  } catch (e) {
    throw new ApiError('storage_error', 'Could not save data in this browser. Storage may be full or disabled.');
  }
}

export function wipeDB() {
  _db = emptyDb();
  persist();
}

export function analyze(db) {
  return db && db.sheets && typeof db.sheets === 'object';
}

export function replaceDB(parsed) {
  if (!parsed || !parsed.sheets || typeof parsed.sheets !== 'object') {
    throw new ApiError('validation', 'Invalid database backup file.');
  }
  _db = { version: 1, sheets: parsed.sheets || {}, props: parsed.props || {} };
  persist();
}

function sheet_(name) {
  var sh = loadDB().sheets[name];
  if (!sh) throw new ApiError('config_error', 'Missing sheet: ' + name);
  return sh;
}

function ensureHeaders_(sh, headers) {
  var first = sh[0] || [];
  var known = {};
  for (var i = 0; i < first.length; i++) known[String(first[i]).trim()] = true;
  var toAdd = [];
  for (var j = 0; j < headers.length; j++) {
    if (!known[headers[j]]) toAdd.push(headers[j]);
  }
  if (toAdd.length) {
    for (var k = 0; k < toAdd.length; k++) first.push(toAdd[k]);
    for (var r = 1; r < sh.length; r++) {
      while (sh[r].length < first.length) sh[r].push('');
    }
    persist();
  }
}

function ensureSheet_(name, headers) {
  var sh = loadDB().sheets[name];
  if (!sh) {
    sh = [headers ? headers.slice() : []];
    loadDB().sheets[name] = sh;
    persist();
    return sh;
  }
  if (headers && headers.length) ensureHeaders_(sh, headers);
  return sh;
}

export var SheetsRepo = {
  repo: function (sheetName) { return new Repo(sheetName); },
  ensure: ensureSheet_,
  headers: function (sheetName) { return SHEET_HEADERS[sheetName] || []; },
  getSetting: function (name, fallback) {
    try {
      var rows = new Repo('Settings').readAll();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].key) === name) return rows[i].value;
      }
    } catch (e) { /* sheet missing */ }
    return fallback;
  },
  setSetting: function (name, value) {
    var repo = new Repo('Settings').ensure();
    var row = repo.find('key', name);
    if (row) return repo.update(row, { value: value });
    return repo.insert({ key: name, value: value });
  }
};

function Repo(sheetName, headers) {
  this.sheetName = sheetName;
  this.headers = headers || SHEET_HEADERS[sheetName] || [];
}

Repo.prototype.ensure = function () {
  ensureSheet_(this.sheetName, this.headers);
  return this;
};

Repo.prototype.readAll = function () {
  var sh = sheet_(this.sheetName);
  var rows = sh.slice(1);
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var row = { __row: r + 2 };
    for (var c = 0; c < this.headers.length; c++) {
      row[this.headers[c]] = rows[r][c] !== undefined ? rows[r][c] : '';
    }
    out.push(row);
  }
  return out;
};

Repo.prototype.find = function (key, value) {
  var rows = this.readAll();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key] || '') === String(value)) return rows[i];
  }
  return null;
};

Repo.prototype.filterAll = function (pred) {
  return this.readAll().filter(pred);
};

Repo.prototype.insert = function (patch) {
  var sh = ensureSheet_(this.sheetName, this.headers);
  var values = [];
  for (var i = 0; i < this.headers.length; i++) {
    values.push(patch[this.headers[i]] !== undefined ? patch[this.headers[i]] : '');
  }
  sh.push(values);
  persist();
  var all = this.readAll();
  return all[all.length - 1];
};

Repo.prototype.update = function (row, patch) {
  var db = loadDB();
  var sh = db.sheets[this.sheetName];
  var colIndex = {};
  for (var i = 0; i < this.headers.length; i++) colIndex[this.headers[i]] = i;
  var keys = Object.keys(patch);
  var idx = row.__row - 1; // find()/readAll() set __row = row index + 2, so sheet-array index = __row - 1
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    if (colIndex[k] !== undefined) {
      while (sh[idx].length <= colIndex[k]) sh[idx].push('');
      sh[idx][colIndex[k]] = patch[k];
      row[k] = patch[k];
    } else {
      row[k] = patch[k];
    }
  }
  persist();
  return row;
};

Repo.prototype.updateByKey = function (key, value, patch) {
  var row = this.find(key, value);
  if (!row) return null;
  return this.update(row, patch);
};

export var CONFIG = {
  get: function (name) {
    var v = loadDB().props[name];
    return v === undefined ? CONFIG_DEFAULTS[name] : v;
  },
  set: function (name, value) {
    loadDB().props[name] = String(value);
    persist();
  },
  bool: function (name) {
    return String(CONFIG.get(name)).toLowerCase() === 'true';
  },
  int: function (name) {
    var n = parseInt(CONFIG.get(name), 10);
    return isNaN(n) ? parseInt(CONFIG_DEFAULTS[name], 10) : n;
  },
  timezone: function () { return CONFIG.get('TIMEZONE'); }
};

export var Ids = (function () {
  function pad(n, width, zero) {
    n = String(n);
    zero = zero || '0';
    while (n.length < width) n = zero + n;
    return n;
  }
  function nextSeq_(key) {
    var sh = loadDB().sheets['Settings'];
    if (!sh) {
      SheetsRepo.ensure('Settings', SHEET_HEADERS.Settings);
      sh = loadDB().sheets['Settings'];
    }
    var repo = SheetsRepo.repo('Settings');
    var row = repo.find('key', key);
    var cur = row ? (parseInt(row.value, 10) || 0) : 0;
    var next = cur + 1;
    if (row) repo.update(row, { value: next });
    else repo.insert({ key: key, value: next });
    return next;
  }
  function hashObj() {
    var s = sha256Hex('uuid:' + Math.random() + ':' + Date.now() + ':' + Math.random());
    return s.slice(0, 16);
  }
  return {
    next: function (prefix, key, digits) {
      return prefix + pad(nextSeq_(key), digits || 4);
    },
    orderId: function () {
      var year = new Date().getFullYear();
      return 'ORD-' + year + '-' + pad(nextSeq_('seq.order'), 4);
    },
    itemId: function () {
      return 'UIT-' + nextSeq_('seq.item');
    },
    branchId: function () {
      return 'BR-' + pad(nextSeq_('seq.branch'), 3);
    },
    userId: function () {
      return 'USR-' + pad(nextSeq_('seq.user'), 3);
    },
    lineId: function () {
      return 'OL-' + nextSeq_('seq.line');
    },
    logId: function () {
      return 'LOG-' + nextSeq_('seq.log');
    },
    unique: function () {
      return 'K-' + hashObj();
    }
  };
})();