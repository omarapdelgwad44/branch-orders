/**
 * Constants + error helpers, ported 1:1 from Config.gs so the local
 * browser backend behaves identically to the Apps Script one.
 */

export var ORDER_STATUS = Object.freeze({
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

export var ORDER_STATUS_FLOW = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT,
  ORDER_STATUS.RECEIVED
]);

export var USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  BRANCH_USER: 'branch_user'
});

export var USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

export var ORDERABLE_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT
]);

export var TERMINAL_RECEIVE_STATUSES = Object.freeze([
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.PARTIALLY_RECEIVED,
  ORDER_STATUS.SHORTAGE_REPORTED
]);

export var ACTIVE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT
]);

function pad2(n) { return String(n).padStart(2, '0'); }

export function nowIso() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

export function formatStamp(d) {
  return d.getFullYear() + '' + pad2(d.getMonth() + 1) + '' + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + '' + pad2(d.getMinutes());
}

export function ApiError(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details || {};
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.name = 'ApiError';
ApiError.prototype.constructor = ApiError;

export function fail(code, message, details) {
  throw new ApiError(code, message, details);
}