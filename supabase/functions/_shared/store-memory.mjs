/**
 * In-memory tables matching the Sheets layout. Used by tests and `npm run demo:server`.
 */

const TABLES = [
  'Users', 'Branches', 'Items', 'Branch_Items', 'Orders',
  'Order_Items', 'Activity_Log', 'Sessions', 'Settings', 'Maintenance'
];

export function createMemoryStore() {
  const db = {};
  for (const name of TABLES) db[name] = [];

  function rows(name) {
    if (!db[name]) db[name] = [];
    return db[name];
  }

  return {
    async all(name) {
      return rows(name).slice();
    },
    async find(name, col, val) {
      return rows(name).find((r) => String(r[col]) === String(val)) || null;
    },
    async filter(name, fn) {
      return rows(name).filter(fn);
    },
    async insert(name, row) {
      const rec = Object.assign({}, row);
      rows(name).push(rec);
      return rec;
    },
    async update(name, row, patch) {
      Object.assign(row, patch);
      return row;
    },
    async getSetting(key, fallback) {
      const row = rows('Settings').find((r) => String(r.key) === String(key));
      if (!row) return fallback === undefined ? null : fallback;
      return row.value;
    },
    async setSetting(key, value) {
      const row = rows('Settings').find((r) => String(r.key) === String(key));
      if (row) row.value = String(value);
      else rows('Settings').push({ key, value: String(value) });
      return true;
    },
    async nextSeq(key) {
      const row = rows('Settings').find((r) => String(r.key) === String(key));
      if (row) {
        const next = (parseInt(row.value, 10) || 0) + 1;
        row.value = next;
        return next;
      }
      rows('Settings').push({ key, value: 1 });
      return 1;
    },
    raw(name) {
      return rows(name);
    }
  };
}
