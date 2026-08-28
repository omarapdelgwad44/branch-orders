/**
 * Thin spreadsheet repository. One sheet = one table.
 * Row 1 carries headers; data starts at row 2. Soft-deletes only.
 */

var SHEET_HEADERS = Object.freeze({
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

var SheetsRepo = (function () {
  var ssCache_ = null;
  var sheetCache_ = {};
  var rowsCache_ = {};

  function invalidate_(name) {
    delete rowsCache_[name];
  }

  function ss_() {
    if (ssCache_) return ssCache_;
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) { ssCache_ = active; return ssCache_; }
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SPREADSHEET_ID');
    if (id) {
      try { ssCache_ = SpreadsheetApp.openById(id); return ssCache_; } catch (e) { /* recreate below */ }
    }
    var created = SpreadsheetApp.create('Branch Orders');
    props.setProperty('SPREADSHEET_ID', created.getId());
    ssCache_ = created;
    return ssCache_;
  }

  function sheet_(name) {
    if (sheetCache_[name]) return sheetCache_[name];
    var sh = ss_().getSheetByName(name);
    if (!sh) throw new ApiError('config_error', 'Missing sheet: ' + name);
    sheetCache_[name] = sh;
    return sh;
  }

  function ensureSheet_(name, headers) {
    var sh = ss_().getSheetByName(name);
    if (!sh) {
      sh = ss_().insertSheet(name);
      if (headers && headers.length) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
      }
      sheetCache_[name] = sh;
      invalidate_(name);
      return sh;
    }
    if (headers && headers.length) ensureHeaders_(sh, headers);
    return sh;
  }

  function ensureHeaders_(sh, headers) {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var known = {};
    for (var i = 0; i < existing.length; i++) known[String(existing[i]).trim()] = true;
    var toAdd = [];
    for (var j = 0; j < headers.length; j++) {
      if (!known[headers[j]]) toAdd.push(headers[j]);
    }
    if (toAdd.length) {
      sh.insertColumnsAfter(Math.max(lastCol, 1), toAdd.length);
      for (var k = 0; k < toAdd.length; k++) {
        sh.getRange(1, lastCol + 1 + k).setValue(toAdd[k]);
      }
    }
  }

  function Repo(sheetName, headers) {
    this.sheetName = sheetName;
    this.headers = headers || SHEET_HEADERS[sheetName] || [];
  }

  Repo.prototype.ensure = function () {
    ensureSheet_(this.sheetName, this.headers);
    return this;
  };

  Repo.prototype.readAll = function () {
    if (rowsCache_[this.sheetName]) return rowsCache_[this.sheetName];
    var sh = sheet_(this.sheetName);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) {
      rowsCache_[this.sheetName] = [];
      return rowsCache_[this.sheetName];
    }
    var values = sh.getRange(2, 1, lastRow - 1, this.headers.length).getValues();
    var out = [];
    for (var r = 0; r < values.length; r++) {
      var row = { __row: r + 2 };
      for (var c = 0; c < this.headers.length; c++) row[this.headers[c]] = values[r][c];
      out.push(row);
    }
    rowsCache_[this.sheetName] = out;
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
    var sh = sheet_(this.sheetName);
    var values = [];
    for (var i = 0; i < this.headers.length; i++) {
      values.push(patch[this.headers[i]] !== undefined ? patch[this.headers[i]] : '');
    }
    sh.appendRow(values);
    var row = { __row: sh.getLastRow() };
    for (var c = 0; c < this.headers.length; c++) row[this.headers[c]] = values[c];
    invalidate_(this.sheetName);
    return row;
  };

  Repo.prototype.update = function (row, patch) {
    var sh = sheet_(this.sheetName);
    var colIndex = {};
    for (var i = 0; i < this.headers.length; i++) colIndex[this.headers[i]] = i + 1;
    var keys = Object.keys(patch);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (colIndex[k]) sh.getRange(row.__row, colIndex[k]).setValue(patch[k]);
    }
    for (var m = 0; m < keys.length; m++) row[keys[m]] = patch[keys[m]];
    invalidate_(this.sheetName);
    return row;
  };

  Repo.prototype.updateByKey = function (key, value, patch) {
    var row = this.find(key, value);
    if (!row) return null;
    return this.update(row, patch);
  };

  /* Settings helpers on the Settings / Maintenance sheet */
  function getSetting(name, fallback) {
    var sh = ss_().getSheetByName('Settings');
    if (!sh) return fallback;
    var rows = new Repo('Settings').readAll();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].key) === name) return rows[i].value;
    }
    return fallback;
  }
  function setSetting(name, value) {
    var repo = new Repo('Settings').ensure();
    var row = repo.find('key', name);
    if (row) return repo.update(row, { value: value });
    return repo.insert({ key: name, value: value });
  }

  return {
    ensure: ensureSheet_,
    repo: function (sheetName) { return new Repo(sheetName); },
    headers: function (sheetName) { return SHEET_HEADERS[sheetName] || []; },
    getSetting: getSetting,
    setSetting: setSetting
  };
})();

/**
 * Stable id + order-number generation, protected by a script lock
 * so concurrent requests never produce duplicates.
 */
var Ids = (function () {
  function pad(n, width, zero) {
    n = String(n);
    zero = zero || '0';
    while (n.length < width) n = zero + n;
    return n;
  }
  function nextSeq_(key) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      SheetsRepo.ensure('Settings', SHEET_HEADERS.Settings);
      var cur = 0;
      var repo = SheetsRepo.repo('Settings');
      var row = repo.find('key', key);
      if (row) cur = parseInt(row.value, 10) || 0;
      var next = cur + 1;
      if (row) repo.update(row, { value: next });
      else repo.insert({ key: key, value: next });
      return next;
    } finally {
      lock.releaseLock();
    }
  }
  function hex(seed) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed + ':' + Date.now() + ':' + Math.random());
  }
  function hashObj() {
    var d = hex(Utilities.getUuid());
    var s = '';
    for (var i = 0; i < d.length; i++) s += ('0' + ((d[i] & 0xff).toString(16))).slice(-2);
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