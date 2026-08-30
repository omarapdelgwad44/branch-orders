import { createClient } from 'npm:@supabase/supabase-js@2';
import { createApp, dispatchHttp, jsonHeaders } from '../_shared/handle.mjs';
import { createSupabaseStore } from '../_shared/store-supabase.mjs';

function adminKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (legacy) return legacy;
  const single = Deno.env.get('SUPABASE_SECRET_KEY') || '';
  if (single) return single;
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return named.default || Object.values(named)[0] || '';
  } catch (e) {
    return '';
  }
}

const key = adminKey();
const headers = { apikey: key };
if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;

const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers }
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
