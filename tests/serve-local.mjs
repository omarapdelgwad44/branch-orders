/**
 * Local demo backend (in-memory copy of the Supabase API).
 *
 * Run:      node tests/serve-local.mjs [port]        (default 8787)
 * Then open:
 *           http://localhost:8080/?api=http://localhost:8787/api
 */
import http from 'node:http';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.mjs';
import { createApp, dispatchHttp, jsonHeaders } from '../supabase/functions/_shared/handle.mjs';

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
const app = createApp(createMemoryStore());

await app.direct.setupSystem();
await app.direct.createFirstAdmin('admin', 'Admin@12345', 'System Admin');
await app.direct.loadDemoData();

function send(res, status, obj) {
  res.writeHead(status, jsonHeaders());
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders());
    return res.end();
  }
  const url = req.url || '';
  if (req.method === 'GET') {
    return dispatchHttp(app, 'GET', url, '').then((out) => send(res, 200, out));
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        send(res, 200, await dispatchHttp(app, 'POST', url, body));
      } catch (e) {
        console.error('backend threw:', e && e.stack ? e.stack : e);
        send(res, 500, { ok: false, error: { code: 'internal_error', message: String((e && e.message) || e) } });
      }
    });
    return;
  }
  send(res, 404, { ok: false, error: { code: 'not_found', message: req.method + ' ' + url } });
});

server.listen(PORT, () => {
  console.log('');
  console.log('Local Branch Orders backend (in-memory Supabase API)');
  console.log('  API:   http://localhost:' + PORT + '/api');
  console.log('');
  console.log('  admin       : admin      / Admin@12345');
  console.log('  admin       : admin.demo / Demo@1234');
  console.log('  branch user : ali.ahmed  / Demo@1234   (Cairo - Nasr City)');
  console.log('  branch user : mona.hassan / Demo@1234 (Alexandria)');
  console.log('  branch user : kareem.said / Demo@1234 (Giza)');
  console.log('');
  console.log('Open the frontend with:');
  console.log('  http://localhost:8080/?api=http://localhost:' + PORT + '/api');
  console.log('(Ctrl+C to stop. All data resets on restart.)');
  console.log('');
});
