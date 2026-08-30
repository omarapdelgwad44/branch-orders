/**
 * Shared constants, errors, time, and password hashing (Web Crypto).
 * Works in Node 20 and Deno Edge Functions.
 */

export const SERVICE_NAME = 'branch-orders';
export const SERVICE_VERSION = '1.0.0';

export const DEFAULTS = {
  TIMEZONE: 'Africa/Cairo',
  SESSION_HOURS: '12',
  MAX_QTY_PER_ITEM: '9999',
  ALLOW_DECIMAL_QTY: 'false',
  REQUIRE_APPROVAL: 'true',
  APP_VERSION: '1.0.0'
};

export const SHEET_NAMES = [
  'Users', 'Branches', 'Items', 'Branch_Items', 'Orders',
  'Order_Items', 'Activity_Log', 'Sessions', 'Settings', 'Maintenance'
];

export const ORDER_STATUS = Object.freeze({
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

export const ORDERABLE_STATUSES = Object.freeze([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SENT
]);

export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  BRANCH_USER: 'branch_user'
});

export const USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details || {};
    this.name = 'ApiError';
  }
}

export function fail(code, message, details) {
  throw new ApiError(code, message, details);
}

export function nowIso(timezone) {
  const tz = timezone || DEFAULTS.TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
}

export function formatStamp(timezone) {
  return nowIso(timezone).replace(/[-T:]/g, '').replace(/^(\d{8})(\d{4})/, '$1-$2').slice(0, 13);
}

async function digestHex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashRounds(str, rounds) {
  let h = await digestHex(str);
  for (let i = 1; i < rounds; i++) h = await digestHex(h);
  return h;
}

const HASH_ID = 'sha256';
const ROUNDS = 32;

export async function hashPassword(password) {
  const salt = (await digestHex(crypto.randomUUID() + ':' + Date.now() + ':' + Math.random())).slice(0, 24);
  return HASH_ID + '$' + ROUNDS + '$' + salt + '$' + await hashRounds(password + ':' + salt, ROUNDS);
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_ID) return false;
  const rounds = parseInt(parts[1], 10);
  const actual = await hashRounds(password + ':' + parts[2], rounds);
  return actual === parts[3];
}

export function storedRounds(stored) {
  const parts = String(stored || '').split('$');
  return parts[0] === HASH_ID ? parseInt(parts[1], 10) : 0;
}

export async function newToken() {
  return digestHex(crypto.randomUUID() + Date.now() + Math.random());
}

export function pad(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

export function createConfig(store) {
  return {
    async get(name) {
      const v = await store.getSetting(name, null);
      return v === null || v === undefined ? DEFAULTS[name] : v;
    },
    async bool(name) {
      return String(await this.get(name)).toLowerCase() === 'true';
    },
    async int(name) {
      const n = parseInt(await this.get(name), 10);
      return isNaN(n) ? parseInt(DEFAULTS[name], 10) : n;
    },
    async timezone() {
      return this.get('TIMEZONE');
    },
    async now() {
      return nowIso(await this.timezone());
    },
    async stamp() {
      return formatStamp(await this.timezone());
    }
  };
}

export function createIds(store) {
  return {
    async next(prefix, key, digits) {
      return prefix + pad(await store.nextSeq(key), digits || 4);
    },
    async orderId() {
      return 'ORD-' + new Date().getFullYear() + '-' + pad(await store.nextSeq('seq.order'), 4);
    },
    async itemId() {
      return 'UIT-' + await store.nextSeq('seq.item');
    },
    async branchId() {
      return 'BR-' + pad(await store.nextSeq('seq.branch'), 3);
    },
    async userId() {
      return 'USR-' + pad(await store.nextSeq('seq.user'), 3);
    },
    async lineId() {
      return 'OL-' + await store.nextSeq('seq.line');
    },
    async logId() {
      return 'LOG-' + await store.nextSeq('seq.log');
    }
  };
}
