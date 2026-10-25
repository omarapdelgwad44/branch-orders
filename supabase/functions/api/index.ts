import { createClient } from 'npm:@supabase/supabase-js@2';
import { createApp, dispatchHttp, jsonHeaders } from '../_shared/handle.mjs';
import { createSupabaseStore } from '../_shared/store-supabase.mjs';

function adminKey() {
  // Prefer sb_secret_ keys. A disabled legacy JWT in SUPABASE_SERVICE_ROLE_KEY
  // still occupies that variable and makes every database call fail.
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const values = Object.values(named).filter((v) => typeof v === 'string');
    const modern = (typeof named.default === 'string' && named.default) ||
      values.find((v) => v.startsWith('sb_secret_')) ||
      values[0];
    if (modern) return modern;
  } catch (e) { /* fall through */ }
  return Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

const key = adminKey();
const jwt = key.startsWith('eyJ');

const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    // supabase-js sends the key as Authorization: Bearer. Secret keys are not
    // JWTs, and the gateway rejects that header with Invalid JWT.
    fetch: (input, init) => {
      const headers = new Headers((init && init.headers) || {});
      headers.set('apikey', key);
      if (jwt) headers.set('Authorization', 'Bearer ' + key);
      else headers.delete('Authorization');
      return fetch(input, Object.assign({}, init, { headers }));
    }
  }
});

const app = createApp(createSupabaseStore(supabase));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: jsonHeaders() });
  }
  const raw = req.method === 'POST' ? await req.text() : '';
  const result = await dispatchHttp(app, req.method, req.url, raw);
  return new Response(JSON.stringify(result), { headers: jsonHeaders() });
});
