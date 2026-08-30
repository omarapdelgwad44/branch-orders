/**
 * Postgres store via supabase-js (service role). Same interface as memory store.
 */

const TABLE = {
  Users: 'users',
  Branches: 'branches',
  Items: 'items',
  Branch_Items: 'branch_items',
  Orders: 'orders',
  Order_Items: 'order_items',
  Activity_Log: 'activity_log',
  Sessions: 'sessions',
  Settings: 'settings',
  Maintenance: 'settings'
};

const PK = {
  Users: 'user_id',
  Branches: 'branch_id',
  Items: 'item_id',
  Orders: 'order_id',
  Order_Items: 'order_item_id',
  Activity_Log: 'log_id',
  Sessions: 'token',
  Settings: 'key',
  Maintenance: 'key'
};

const NULLABLE_NUM = {
  approved_quantity: true,
  sent_quantity: true,
  received_quantity: true,
  shortage_quantity: true,
  max_quantity: true
};

function table(name) {
  const t = TABLE[name];
  if (!t) throw new Error('Unknown table: ' + name);
  return t;
}

function emptyToNull(row) {
  const out = Object.assign({}, row);
  for (const k of Object.keys(NULLABLE_NUM)) {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  }
  return out;
}

function nullToEmpty(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  for (const k of Object.keys(NULLABLE_NUM)) {
    if (out[k] === null || out[k] === undefined) out[k] = '';
  }
  if (out.branch_id === null) out.branch_id = '';
  if (out.last_login_at === null) out.last_login_at = '';
  if (out.submitted_at === null) out.submitted_at = '';
  if (out.processed_at === null) out.processed_at = '';
  if (out.sent_at === null) out.sent_at = '';
  if (out.received_at === null) out.received_at = '';
  return out;
}

function throwSb(error, ctx) {
  if (error) throw new Error((ctx || 'supabase') + ': ' + error.message);
}

export function createSupabaseStore(client) {
  return {
    async all(name) {
      const { data, error } = await client.from(table(name)).select('*');
      throwSb(error, 'all ' + name);
      return (data || []).map(nullToEmpty);
    },
    async find(name, col, val) {
      const { data, error } = await client.from(table(name)).select('*').eq(col, val).maybeSingle();
      throwSb(error, 'find ' + name);
      return data ? nullToEmpty(data) : null;
    },
    async filter(name, fn) {
      return (await this.all(name)).filter(fn);
    },
    async insert(name, row) {
      const payload = emptyToNull(row);
      const { data, error } = await client.from(table(name)).insert(payload).select().single();
      throwSb(error, 'insert ' + name);
      return nullToEmpty(data);
    },
    async update(name, row, patch) {
      const payload = emptyToNull(patch);
      if (name === 'Branch_Items') {
        const { data, error } = await client.from('branch_items').update(payload)
          .eq('branch_id', row.branch_id).eq('item_id', row.item_id).select().single();
        throwSb(error, 'update Branch_Items');
        const rec = nullToEmpty(data);
        Object.assign(row, rec);
        return row;
      }
      const key = PK[name];
      const { data, error } = await client.from(table(name)).update(payload).eq(key, row[key]).select().single();
      throwSb(error, 'update ' + name);
      const rec = nullToEmpty(data);
      Object.assign(row, rec);
      return row;
    },
    async getSetting(key, fallback) {
      const { data, error } = await client.from('settings').select('value').eq('key', key).maybeSingle();
      throwSb(error, 'getSetting');
      if (!data) return fallback === undefined ? null : fallback;
      return data.value;
    },
    async setSetting(key, value) {
      const { error } = await client.from('settings').upsert({ key, value: String(value) });
      throwSb(error, 'setSetting');
      return true;
    },
    async nextSeq(key) {
      const { data, error } = await client.rpc('next_setting_seq', { p_key: key });
      throwSb(error, 'nextSeq');
      return Number(data);
    },
    raw() {
      throw new Error('raw() is only available on the memory store');
    }
  };
}
