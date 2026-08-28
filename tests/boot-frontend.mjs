/**
 * Frontend boot smoke test (no real DOM required).
 *
 * Boots the real entry module (frontend/assets/js/app.js) against a minimal
 * registry-based DOM stub and asserts:
 *   1. module evaluation does not throw (boxes e.g. missing imports → blank screen),
 *   2. the router writes the view content into an element still attached to
 *      the live document (not a node captured before the shell re-rendered —
 *      this caused "sidebar visible, content empty"),
 *   3. the view actually ends up with content.
 *
 * Usage:  node tests/boot-frontend.mjs [admin|branch]     (default: admin)
 */

function buildDom() {
  const registry = new Map();
  let detachedWrites = 0;

  function makeEl(id) {
    const cls = { add() {}, remove() {}, toggle() { return true; }, contains() { return false; } };
    const el = {
      _detached: false,
      _html: '',
      id: id || '',
      textContent: '',
      value: '',
      disabled: false,
      className: '',
      classList: cls,
      style: {},
      addEventListener() {}, removeEventListener() {},
      querySelector() { return makeEl(null); },
      querySelectorAll() { return []; },
      appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, click() {},
      setAttribute() {}, getAttribute() { return null; }, closest() { return null; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html; },
      set(v) {
        if (this._detached) detachedWrites++;
        this._html = String(v);
        const re = /\bid="([^"]+)"/g;
        let m;
        while ((m = re.exec(this._html))) {
          const idv = m[1];
          const prev = registry.get(idv);
          if (prev && prev !== el) prev._detached = true;
          if (registry.has(idv) && registry.get(idv) !== el) registry.delete(idv);
          if (!registry.has(idv)) registry.set(idv, makeEl(idv));
        }
      }
    });
    return el;
  }
  const byId = (id) => {
    if (!registry.has(id)) registry.set(id, makeEl(id));
    return registry.get(id);
  };

  return {
    document: {
      getElementById: byId,
      createElement: () => makeEl(null),
      querySelector: () => makeEl(null),
      body: byId('body'),
      documentElement: byId('documentElement'),
      addEventListener() {}
    },
    registry,
    detachedWrites: () => detachedWrites
  };
}

let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };

// --- detector self-test ---
{
  const dom = buildDom();
  const app1 = dom.document.getElementById('app');
  const view1 = dom.document.getElementById('view');
  app1.innerHTML = '<div class="content" id="view"></div>';
  view1.innerHTML = '<h1>gone</h1>';
  if (dom.detachedWrites() !== 1) fail('detached-write detector self-test');
}

const scenario = process.argv[2] || 'admin';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }
};
globalThis.window = globalThis;
const dom = buildDom();
globalThis.document = dom.document;
globalThis.location = { search: '', hash: scenario === 'branch' ? '#/app' : '#/admin' };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const backendDir = new URL('../frontend/assets/js/backend/', import.meta.url);
const appEntry = new URL('../frontend/assets/js/app.js', import.meta.url);
const { dispatch } = await import(new URL('routes.js', backendDir).href);
const bootstrap = await import(backendDir + 'bootstrap.js');

bootstrap.setupSystem();
bootstrap.createFirstAdmin('admin', 'Admin@12345', 'System Admin');
const adminLogin = dispatch('auth.login', { action: 'auth.login', username: 'admin', password: 'Admin@12345' });
const ADMIN_T = adminLogin.data.token;

const AP = (action, payload, token) => dispatch(action, Object.assign({ token }, payload || {}));

let targetUser, targetToken;
if (scenario === 'branch') {
  AP('admin.branches.create', { branch_code: 'CAIRO-1', branch_name: 'Cairo - Nasr City' }, ADMIN_T);
  AP('admin.users.create', {
    username: 'ali.ahmed', password: 'Demo@1234', role: 'branch_user',
    branch_id: 'BR-001', full_name: 'Ali Ahmed'
  }, ADMIN_T);
  const logged = AP('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' });
  targetUser = logged.data.user;
  targetToken = logged.data.token;
} else {
  targetUser = adminLogin.data.user;
  targetToken = adminLogin.data.token;
}
store.set('bo.token', targetToken);
store.set('bo.session', JSON.stringify(targetUser));

let err = null;
try {
  await import(appEntry);
} catch (e) {
  err = e;
}
await new Promise((r) => setTimeout(r, 80));

const dw = dom.detachedWrites();
const viewEl = dom.registry.get('view');
const viewContent = viewEl ? viewEl._html : '';

if (err) fail('app.js boot threw: ' + (err.stack || err).toString().split('\n').slice(0, 4).join(' | '));
if (dw > 0) fail('view content written into a detached node (' + dw + ' writes)');
if (!viewContent || viewContent.length < 20) {
  fail('view element ended up empty (len=' + viewContent.length + ')');
} else {
  console.log('  ' + scenario + ' boot ok, #view content len=' + viewContent.length,
    '| starts with:', viewContent.slice(0, 40).replace(/\s+/g, ' '));
}

console.log(failed === 0 ? 'boot-frontend (' + scenario + '): OK' : 'boot-frontend (' + scenario + '): ' + failed + ' failure(s)');
process.exit(failed ? 1 : 0);