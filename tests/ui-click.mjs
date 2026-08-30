/**
 * Real-click UI smoke test running the actual frontend app inside jsdom.
 *
 * Catches "button does nothing" regressions (e.g. an out-of-scope helper
 * throwing before a modal is opened) that static/skeleton checks can't see.
 *
 * Requires the jsdom devDependency:
 *   npm install
 *
 * Usage:  node tests/ui-click.mjs [admin|branch]     (default: admin)
 *
 * admin  → open branches page, actually click "New Branch", fill the form,
 *          save, assert new row; then click row edit, assert prefill + save;
 *          then users page → open the "New User" modal.
 * branch → open the "New Order" page, assert the order form rendered.
 */
import { JSDOM } from 'jsdom';

const scenario = process.argv[2] || 'admin';
let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(
  '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>t</title></head>' +
  '<body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div></body></html>',
  { url: 'https://example.com/', pretendToBeVisual: true }
);
const { window } = dom;
const { document } = window;

globalThis.window = window;
globalThis.document = document;
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.removeEventListener = window.removeEventListener.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

const errors = [];
window.addEventListener('error', (e) => {
  errors.push('window.error: ' + (e.error ? (e.error.stack || e.error.message) : e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  errors.push('unhandledrejection: ' + (e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason)));
});

const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(200);
};
const click = async (el) => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(120); };

const { installBackendFetch } = await import('./mock-apps-script-fetch.mjs');
const sandbox = await installBackendFetch();
await sandbox.direct.createFirstAdmin('admin', 'Admin@12345', 'System Admin');

const apiCall = async (action, payload, token) => {
  const res = await fetch('http://local/exec', {
    method: 'POST',
    body: JSON.stringify(Object.assign({ action, token: token || '' }, payload || {}))
  });
  return res.json();
};

let loginUser, token;
if (scenario === 'branch') {
  const admin = await apiCall('auth.login', { username: 'admin', password: 'Admin@12345' });
  const AT = admin.data.token;
  await apiCall('admin.branches.create', { branch_code: 'CAIRO-1', branch_name: 'Cairo - Nasr City' }, AT);
  await apiCall('admin.users.create', {
    username: 'ali.ahmed', password: 'Demo@1234', role: 'branch_user',
    branch_id: 'BR-001', full_name: 'Ali Ahmed'
  }, AT);
  const l = await apiCall('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' });
  loginUser = l.data.user;
  token = l.data.token;
} else {
  const l = await apiCall('auth.login', { username: 'admin', password: 'Admin@12345' });
  loginUser = l.data.user;
  token = l.data.token;
}
localStorage.setItem('bo.token', token);
localStorage.setItem('bo.session', JSON.stringify(loginUser));
localStorage.setItem('bo.apiUrl', 'http://localhost:8787/api');

await import(new URL('../frontend/assets/js/app.js', import.meta.url).href);
await tick(100);

if (scenario === 'branch') {
  const adminTok = (await apiCall('auth.login', { username: 'admin', password: 'Admin@12345' })).data.token;
  const item = await apiCall('admin.items.create', {
    item_code: 'WAT-1', item_name: 'Mineral Water', category: 'Beverage', unit: 'bottle'
  }, adminTok);
  const itemId = item.data && item.data.item_id;
  if (!itemId) fail('could not create catalog item for submit test');

  await go('#/order/new');
  const v = document.getElementById('view').innerHTML;
  const hasNew = ['itemSearch', 'pickList', 'btnSubmit'].every((id) => !!document.getElementById(id));
  console.log('  new-order form rendered:', !!v && v.length > 200, '| ids present:', hasNew);
  if (!hasNew) fail('new-order page did not render its form');

  const qty = document.querySelector('.qty-val');
  if (!qty) fail('quantity input missing');
  else {
    qty.value = '2';
    qty.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(40);
    const summary = document.getElementById('summary');
    console.log('  after qty: summary has item:', !!(summary && summary.textContent.includes('Mineral Water')));
    if (!summary || !summary.textContent.includes('Mineral Water')) fail('selected item did not appear in summary');

    await click(document.getElementById('btnSubmit'));
    const okBtn = document.querySelector('[data-ok]');
    if (!okBtn) fail('submit confirm dialog did not open');
    else {
      await click(okBtn);
      await tick(400);
      const toast = document.querySelector('.toast');
      const toastText = toast ? toast.textContent : '';
      const hash = String(window.location.hash || '');
      console.log('  after submit: hash=', hash, '| toast=', toastText.trim());
      if (hash !== '#/orders' && !/submitted|تم إرسال/i.test(toastText)) {
        fail('submit with selected items did not succeed: ' + (toastText || hash || 'no toast'));
      }
    }
  }
} else {
  await go('#/admin/branches');
  const addBranch = document.getElementById('addBranch');
  if (!addBranch) fail('New Branch button missing');
  else {
    await click(addBranch);
    const modal = document.getElementById('modal-root');
    const hasForm = ['bn', 'bl', 'bs', 'saveBranch'].every((id) => !!document.getElementById(id));
    console.log('  click addBranch → modal opens:', modal.querySelector('.modal') !== null, '| form fields:', hasForm);
    if (modal.querySelector('.modal') === null) fail('New Branch click did not open a modal');
    if (!hasForm) fail('branch form fields not all present');

    if (hasForm) {
      document.getElementById('bc').value = 'TEST-1';
      document.getElementById('bn').value = 'Test Branch One';
      document.getElementById('bl').value = 'Cairo';
      document.getElementById('bs').value = 'active';
      await click(document.getElementById('saveBranch'));
      const v = document.getElementById('view').innerHTML;
      console.log('  after save: row TEST-1 in table:', v.includes('TEST-1'), '| modal closed:', document.getElementById('modal-root').innerHTML.length === 0);
      if (!v.includes('TEST-1')) fail('saved branch row missing from table');
      if (document.getElementById('modal-root').innerHTML.length !== 0) fail('modal did not close after save');

      const edit = document.querySelector('[data-edit]');
      if (!edit) fail('no edit button rendered');
      else {
        await click(edit);
        const bc = document.getElementById('bc');
        console.log('  edit modal prefill bc=', bc && bc.value);
        if (!bc || bc.value !== 'TEST-1') fail('edit modal did not prefill branch code');
        if (bc) {
          document.getElementById('bn').value = 'Test Branch One (edited)';
          await click(document.getElementById('saveBranch'));
          const v2 = document.getElementById('view').innerHTML;
          console.log('  edited branch visible:', v2.includes('(edited)'));
          if (!v2.includes('(edited)')) fail('edited branch name not reflected in table');
        }
      }
    }
  }

  await go('#/admin/users');
  const addUser = document.getElementById('addUser');
  if (!addUser) fail('New User button missing');
  else {
    await click(addUser);
    const hasForm = ['ufn', 'uun', 'saveUser'].every((id) => !!document.getElementById(id));
    console.log('  click addUser → modal with form:', hasForm);
    if (!hasForm) fail('New User click did not open its modal form');
  }
}

console.log('ui-click (' + scenario + '):',
  failed === 0 ? 'OK' : (failed + ' failure(s)'));
if (errors.length) {
  console.log('  captured application errors:', errors.length);
  failed++;
}
if (failed) console.log(errors.join('\n'));
dom.window.close();
process.exit(failed ? 1 : 0);