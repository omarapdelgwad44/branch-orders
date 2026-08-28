/**
 * Global configuration and constants.
 * Values prefixed GLOBAL_* can be overridden via script Properties
 * (see README "Configuration") or rows in the Settings sheet.
 */

var CONFIG = (function () {
  var PROPS = PropertiesService.getScriptProperties();
  var DEFAULTS = {
    TIMEZONE: 'Africa/Cairo',
    SESSION_HOURS: '12',
    MAX_QTY_PER_ITEM: '9999',
    ALLOW_DECIMAL_QTY: 'false',
    REQUIRE_APPROVAL: 'true',
    APP_VERSION: '1.0.0'
  };
  return {
    get: function (name) {
      var v = PROPS.getProperty(name);
      return v === null ? DEFAULTS[name] : v;
    },
    set: function (name, value) {
      PROPS.setProperty(name, String(value));
    },
    bool: function (name) {
      return String(CONFIG.get(name)).toLowerCase() === 'true';
    },
    int: function (name) {
      var n = parseInt(CONFIG.get(name), 10);
      return isNaN(n) ? parseInt(DEFAULTS[name], 10) : n;
    },
    timezone: function () { return CONFIG.get('TIMEZONE'); }
  };
})();

var ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  PROCESSING: 'processing',
  SENT: 'sent',
  RECEIVED: 'received',
  PARTIALLY_RECEIVED: 'partially_received',
  SHORTAGE_REPORTED: 'shortage_reported',
  CANCELLED: 'cancelled'
});

var ORDER_STATUS_FLOW = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT,
  ORDER_STATUS.RECEIVED
]);

var USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  BRANCH_USER: 'branch_user'
});

var USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

var ORDERABLE_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT
]);

var TERMINAL_RECEIVE_STATUSES = Object.freeze([
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.PARTIALLY_RECEIVED,
  ORDER_STATUS.SHORTAGE_REPORTED
]);

var ACTIVE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT
]);

function nowIso() {
  return Utilities.formatDate(new Date(), CONFIG.timezone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function ApiError(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details || {};
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.name = 'ApiError';
ApiError.prototype.constructor = ApiError;

function fail(code, message, details) {
  throw new ApiError(code, message, details);
}