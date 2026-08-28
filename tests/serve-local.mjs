/**
 * Local demo backend.
 *
 * Serves the SAME backend/*.gs code (via the Apps Script shim) over HTTP so
 * the frontend can be exercised end-to-end before any Google/GitHub deploy.
 *
 * On start it bootstraps: setupSystem → createFirstAdmin → loadDemoData,
 * all in memory (resets on every restart).
 *
 * Run:      node tests/serve-local.mjs [port]        (default 8787)
 * Then open:
 *           http://localhost:8080/?api=http://localhost:8787/exec
 *
 * Demo accounts and admin matching README.
 */
import http from 'node:http';
import { buildContext, loadBackend } from './appsscript-shim.mjs';

const PORT = Number(process.env.PORT || process.argv[2] || 8787);

const build = buildContext();
const { sandbox } = loadBackend(build);

sandbox.setupSystem();
sandbox.createFirstAdmin('admin', 'Admin@12345', 'System Admin');
sandbox.loadDemoData();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(res, status, text) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method === 'GET' && (req.url || '').indexOf('/exec') !== -1) {
    const i = build.contentOutputs.length;
    sandbox.doGet(req);
    return json(res, 200, build.contentOutputs[i].getContent());
  }
  if (req.method === 'POST' && (req.url || '').indexOf('/exec') !== -1) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const i = build.contentOutputs.length;
      try {
        sandbox.doPost({ postData: { contents: body } });
        json(res, 200, build.contentOutputs[i].getContent());
      } catch (e) {
        console.error('backend threw:', e && e.stack ? e.stack : e);
        json(res, 500, JSON.stringify({ ok: false, error: { code: 'internal_error', message: String((e && e.message) || e) } }));
      }
    });
    return;
  }
  json(res, 404, JSON.stringify({ ok: false, error: { code: 'not_found', message: req.method + ' ' + (req.url || '') } }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('Local Branch Orders backend (in-memory demo of backend/*.gs)');
  console.log('  API:   http://localhost:' + PORT + '/exec');
  console.log('');
  console.log('  admin       : admin    / Admin@12345');
  console.log('  admin      : admin.demo / Demo@1234');
  console.log('  branch user: ali.ahmed / Demo@1234   (Cairo - Nasr City)');
  console.log('  branch user : mona.hassan / Demo@1234 (Alexandria)');
  console.log('  branch user : kareem.said / Demo@1234 (Giza)');
  console.log('');
  console.log('Open the frontend with:');
  console.log('  http://localhost:8080/?api=http://localhost:' + PORT + '/exec');
  console.log('(Ctrl+C to stop. All data resets on restart.)');
  console.log('');
});