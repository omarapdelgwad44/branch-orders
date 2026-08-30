import { createClient } from 'npm:@supabase/supabase-js@2';
import { createApp, dispatchHttp, jsonHeaders } from '../_shared/handle.mjs';
import { createSupabaseStore } from '../_shared/store-supabase.mjs';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const app = createApp(createSupabaseStore(supabase));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: jsonHeaders() });
  }
  const raw = req.method === 'POST' ? await req.text() : '';
  const result = await dispatchHttp(app, req.method, req.url, raw);
  return new Response(JSON.stringify(result), { headers: jsonHeaders() });
});
