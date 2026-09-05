/**
 * Regression tests for the order-report / receiving / approval feature set.
 *
 * Usage:  node tests/order-features.mjs [admin|branch]     (default: admin)
 *
 * admin  → backend: submitted→approved transition, approved-qty persistence,
 *          refresh persistence, invalid transitions blocked, print permission
 *          helpers + report HTML (requested vs approved, admin notes);
 *          UI (jsdom): approve modal flow updates badge + next action,
 *          report print/download buttons, language switcher labels.
 * branch → backend: full / partial / reasoned receiving, >sent rejected,
 *          branch isolation; UI (jsdom): pick-row order, receiving modal
 *          (full checkbox, shortage calc, reason toggle, >sent blocked),
 *          branch report excludes admin notes.
 */
import { JSDOM } from 'jsdom';

const scenario = process.argv[2] || 'admin';
let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };
const ok = (c, m) => { if (!c) fail(m); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- node-side shims for pure modules (report.js / i18n.js) ---------- */
const store = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}
if (!globalThis.window) globalThis.window = globalThis;
globalThis.localStorage.setItem('bo.lang', 'en');

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
const apiOk = async (action, payload, token) => {
  const r = await apiCall(action, payload, token);
  if (!r.ok) throw new Error(action + ' failed: ' + JSON.stringify(r));
  return r.data;
};

const adminLogin = await apiOk('auth.login', { username: 'admin', password: 'Admin@12345' });
const AT = adminLogin.token;
await apiOk('admin.branches.create', { branch_code: 'CAIRO-1', branch_name: 'Cairo - Nasr City' }, AT);
await apiOk('admin.branches.create', { branch_code: 'GIZA-1', branch_name: 'Giza' }, AT);
await apiOk('admin.users.create', { username: 'ali.ahmed', password: 'Demo@1234', role: 'branch_user', branch_id: 'BR-001', full_name: 'Ali Ahmed' }, AT);
await apiOk('admin.users.create', { username: 'mona.hassan', password: 'Demo@1234', role: 'branch_user', branch_id: 'BR-002', full_name: 'Mona Hassan' }, AT);
const item = await apiOk('admin.items.create', { item_code: 'WAT-1', item_name: 'Mineral Water', category: 'Beverage', unit: 'bottle' }, AT);
const IID = item.item_id;

if (scenario === 'admin') {
  /* ================= backend: approval + quantities ================= */
  const ali = await apiOk('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' });
  const d = await apiOk('orders.create', { notes: 'branch note', items: { [IID]: 10 } }, ali.token);
  await apiOk('orders.submit', { order_id: d.order_id }, ali.token);

  const approved = await apiOk('admin.orders.transition',
    { order_id: d.order_id, to: 'approved', approved_qty: { [IID]: 6 }, notes: 'secret-admin-note' }, AT);
  ok(approved.status === 'approved', 'submitted→approved, got ' + approved.status);
  const line = approved.items.find((i) => i.item_id === IID);
  ok(line && line.requested_quantity === 10, 'requested stays 10, got ' + (line && line.requested_quantity));
  ok(line && line.approved_quantity === 6, 'approved saved as 6, got ' + (line && line.approved_quantity));

  // refresh persistence: refetch from the backend
  const refetched = await apiOk('admin.orders.detail', { order_id: d.order_id }, AT);
  ok(refetched.status === 'approved', 'refresh preserves approved, got ' + refetched.status);
  const rline = refetched.items.find((i) => i.item_id === IID);
  ok(rline.requested_quantity === 10 && rline.approved_quantity === 6, 'refresh keeps requested=10 approved=6');

  // invalid transitions remain blocked
  const again = await apiCall('admin.orders.transition', { order_id: d.order_id, to: 'approved', approved_qty: { [IID]: 6 } }, AT);
  ok(again.ok === false, 'approved→approved rejected');

  // approval removal: explicit 0 stays dropped through every later stage
  const dz = await apiOk('orders.create', { items: { [IID]: 10 } }, ali.token);
  await apiOk('orders.submit', { order_id: dz.order_id }, ali.token);
  const zAppr = await apiOk('admin.orders.transition', { order_id: dz.order_id, to: 'approved', approved_qty: { [IID]: 0 } }, AT);
  const zline = zAppr.items.find((i) => i.item_id === IID);
  ok(zline.approved_quantity === 0 && zline.requested_quantity === 10, 'removed item approved=0, requested kept=10');
  await apiOk('admin.orders.transition', { order_id: dz.order_id, to: 'processing' }, AT);
  const zProc = await apiOk('admin.orders.detail', { order_id: dz.order_id }, AT);
  ok(zProc.items.find((i) => i.item_id === IID).approved_quantity === 0, 'removed item stays 0 after processing');
  await apiOk('admin.orders.transition', { order_id: dz.order_id, to: 'sent', sent_qty: { [IID]: 0 } }, AT);
  const zRecv = await apiOk('orders.receive', { order_id: dz.order_id, quantities: { [IID]: 0 }, reasons: {} }, ali.token);
  ok(zRecv.status === 'received', 'zero-qty order receives cleanly, got ' + zRecv.status);
  const zRep = (await import('../frontend/assets/js/report.js')).buildReportHtml(zRecv, { forAdmin: true });
  ok(zRep.includes('10'), 'report keeps requested 10 for dropped item');

  /* ================= pure report module ================= */
  const { canPrintReport, buildReportHtml } = await import('../frontend/assets/js/report.js');
  ok(canPrintReport(adminLogin.user, refetched) === true, 'admin can print authorized order');
  const branchUser = (await apiOk('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' })).user;
  ok(canPrintReport(branchUser, refetched) === true, 'branch can print own order');
  const other = Object.assign({}, refetched, { branch_id: 'BR-002' });
  ok(canPrintReport(branchUser, other) === false, 'branch cannot print another branch order');

  const htmlAdmin = buildReportHtml(refetched, { forAdmin: true });
  ok(htmlAdmin.includes('10') && htmlAdmin.includes('6'), 'report shows requested 10 and approved 6');
  ok(htmlAdmin.includes('secret-admin-note'), 'admin report includes admin notes');
  const htmlBranch = buildReportHtml(refetched, { forAdmin: false });
  ok(!htmlBranch.includes('secret-admin-note'), 'branch report excludes admin notes');
  ok(htmlBranch.includes('branch note'), 'branch report includes branch notes');

  /* ================= UI (jsdom): approval modal ================= */
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="UTF-8"><title>t</title></head>' +
    '<body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div><div id="report-root"></div></body></html>',
    { url: 'https://example.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  globalThis.addEventListener = window.addEventListener.bind(window);
  globalThis.removeEventListener = window.removeEventListener.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  const { document } = window;
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    await tick(250);
  };
  const click = async (node) => { node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(150); };

  window.localStorage.setItem('bo.lang', 'en');
  window.localStorage.setItem('bo.token', AT);
  window.localStorage.setItem('bo.session', JSON.stringify(adminLogin.user));
  window.localStorage.setItem('bo.apiUrl', 'http://localhost:8787/api');
  await import(new URL('../frontend/assets/js/app.js', import.meta.url).href + '?orderfeat=admin');
  await tick(120);

  const d2 = await apiOk('orders.create', { items: { [IID]: 10 } }, ali.token);
  await apiOk('orders.submit', { order_id: d2.order_id }, ali.token);
  await go('#/admin/orders/' + d2.order_id);
  ok(!!document.querySelector('[data-act="approved"]'), 'submitted shows Approve action');
  await click(document.querySelector('[data-act="approved"]'));
  ok(!!document.querySelector('#modal-root .modal'), 'approve modal opens');
  const qty = document.querySelector('#modal-root .qty-val');
  ok(!!qty, 'approve modal has qty input');
  if (qty) { qty.value = '6'; qty.dispatchEvent(new window.Event('input', { bubbles: true })); }
  await click(document.getElementById('doTransition'));
  await tick(350);
  const badge = document.querySelector('.badge');
  ok(!!badge && /approv/i.test(badge.textContent), 'UI shows approved status, got ' + (badge && badge.textContent));
  ok(!!document.querySelector('[data-act="processing"]'), 'next action is Start processing');
  const viewText = document.getElementById('view').textContent;
  ok(viewText.includes('10') && viewText.includes('6'), 'detail shows requested 10 and approved 6');
  ok(document.querySelectorAll('.tl-step.done').length >= 3, 'timeline lights the approved step');

  // UI removal: clearing the approval input must persist as 0, not resurrect
  const d3 = await apiOk('orders.create', { items: { [IID]: 8 } }, ali.token);
  await apiOk('orders.submit', { order_id: d3.order_id }, ali.token);
  await go('#/admin/orders/' + d3.order_id);
  await click(document.querySelector('[data-act="approved"]'));
  const clearInput = document.querySelector('#modal-root .qty-val');
  clearInput.value = '';
  clearInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await click(document.getElementById('doTransition'));
  await tick(350);
  const chk3 = await apiOk('admin.orders.detail', { order_id: d3.order_id }, AT);
  const l3 = chk3.items.find((i) => i.item_id === IID);
  ok(l3.approved_quantity === 0 && l3.requested_quantity === 8, 'cleared input persists as approved=0, requested=8');
  await go('#/admin/orders/' + d3.order_id);
  await click(document.querySelector('[data-act="processing"]'));
  await click(document.getElementById('doTransition'));
  await tick(350);
  await go('#/admin/orders/' + d3.order_id);
  await click(document.querySelector('[data-act="sent"]'));
  await tick(150);
  const sentPrefill = document.querySelector('#modal-root .qty-val');
  ok(!!sentPrefill && sentPrefill.value === '0', 'sent modal prefills dropped item as 0, got ' + (sentPrefill && sentPrefill.value));

  // print / download buttons
  ok(!!document.getElementById('reportPrint'), 'admin Print report button present');
  ok(!!document.getElementById('reportDownload'), 'admin Download report button present');
  const titleBefore = document.title;
  await click(document.getElementById('reportDownload'));
  ok((window.__printed || 0) >= 1, 'download triggers print flow');
  ok(document.title === titleBefore, 'document title restored after download');
  ok(document.getElementById('report-root').innerHTML.includes('6'), 'print root has approved qty');

  // language switcher: visible text + localized aria
  const langBtn = document.getElementById('btn-lang');
  ok(!!langBtn && langBtn.textContent.trim().length > 0, 'sidebar language button has visible text');
  ok(!!langBtn.querySelector('svg'), 'sidebar language button has an icon (not an empty box)');
  ok(!!langBtn.getAttribute('aria-label'), 'sidebar language button has aria-label');
  const langTop = document.getElementById('btn-lang2');
  ok(!!langTop && langTop.textContent.trim().length > 0, 'topbar language button has visible text');
  ok(!!langTop.getAttribute('aria-label'), 'topbar language button has aria-label');

  dom.window.close();
} else {
  /* ================= backend: receiving rules ================= */
  const ali = await apiOk('auth.login', { username: 'ali.ahmed', password: 'Demo@1234' });
  const mkSent = async (qty) => {
    const dd = await apiOk('orders.create', { items: { [IID]: qty } }, ali.token);
    await apiOk('orders.submit', { order_id: dd.order_id }, ali.token);
    await apiOk('admin.orders.transition', { order_id: dd.order_id, to: 'approved', approved_qty: { [IID]: qty } }, AT);
    await apiOk('admin.orders.transition', { order_id: dd.order_id, to: 'processing' }, AT);
    await apiOk('admin.orders.transition', { order_id: dd.order_id, to: 'sent', sent_qty: { [IID]: qty } }, AT);
    return dd.order_id;
  };
  const oFull = await mkSent(10);
  const full = await apiOk('orders.receive', { order_id: oFull, quantities: { [IID]: 10 }, reasons: {} }, ali.token);
  ok(full.status === 'received', 'full receipt → received, got ' + full.status);

  const oPart = await mkSent(10);
  const part = await apiOk('orders.receive', { order_id: oPart, quantities: { [IID]: 4 }, reasons: {} }, ali.token);
  ok(part.status === 'partially_received', 'partial without reason → partially_received, got ' + part.status);
  ok(part.total_shortage === 6, 'shortage = 10-4 = 6, got ' + part.total_shortage);

  const oShort = await mkSent(10);
  const short = await apiOk('orders.receive', { order_id: oShort, quantities: { [IID]: 4 }, reasons: { [IID]: 'damaged' } }, ali.token);
  ok(short.status === 'shortage_reported', 'partial with reason → shortage_reported, got ' + short.status);

  const oOver = await mkSent(10);
  const over = await apiCall('orders.receive', { order_id: oOver, quantities: { [IID]: 99 }, reasons: {} }, ali.token);
  ok(over.ok === false, 'received > sent rejected');

  // branch isolation (print permission boundary)
  const mona = await apiOk('auth.login', { username: 'mona.hassan', password: 'Demo@1234' });
  const cross = await apiCall('orders.detail', { order_id: oFull }, mona.token);
  ok(cross.ok === false, 'branch cannot view another branch order');

  /* ================= UI (jsdom): receiving + rows + report ================= */
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="UTF-8"><title>t</title></head>' +
    '<body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div><div id="report-root"></div></body></html>',
    { url: 'https://example.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.localStorage = window.localStorage;
  globalThis.addEventListener = window.addEventListener.bind(window);
  globalThis.removeEventListener = window.removeEventListener.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  const { document } = window;
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    await tick(250);
  };
  const click = async (node) => { node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(150); };

  window.localStorage.setItem('bo.lang', 'en');
  window.localStorage.setItem('bo.token', ali.token);
  window.localStorage.setItem('bo.session', JSON.stringify(ali.user));
  window.localStorage.setItem('bo.apiUrl', 'http://localhost:8787/api');
  await import(new URL('../frontend/assets/js/app.js', import.meta.url).href + '?orderfeat=branch');
  await tick(120);

  // new-order row direction: info first, stepper second in DOM order
  await go('#/order/new');
  const row = document.querySelector('.pick-row');
  ok(!!row, 'pick row renders');
  if (row) {
    const kids = Array.from(row.children).map((n) => n.className || n.tagName);
    ok(row.querySelector('.pick-info') && row.querySelector('[data-stepper]'), 'row has info + stepper');
    ok(row.children[0].querySelector('.pick-info') || row.children[0].className.includes('pick-info'), 'item info comes first in DOM order, got ' + kids.join(','));
  }

  // receiving modal behaviour on a fresh sent order
  const oUi = await mkSent(10);
  await go('#/order/' + oUi);
  await click(document.getElementById('btnReceive'));
  const mrow = document.querySelector('#modal-root .recv-item');
  ok(!!mrow, 'receiving modal opens with item rows');
  if (mrow) {
    ok(mrow.dataset.sent === '10', 'row carries sent qty, got ' + mrow.dataset.sent);
    const fullBox = mrow.querySelector('[data-full]');
    ok(!!fullBox && fullBox.checked, 'received-in-full checked by default');
    ok(mrow.querySelector('[data-reasonwrap]').classList.contains('hidden'), 'reason hidden when no shortage');
    const input = mrow.querySelector('.qty-val');
    input.value = '4';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(60);
    ok(mrow.querySelector('[data-short] b').textContent.includes('6'), 'shortage shows 6, got ' + mrow.querySelector('[data-short] b').textContent);
    ok(!mrow.querySelector('[data-reasonwrap]').classList.contains('hidden'), 'reason shown when shortage');
    ok(!mrow.querySelector('[data-full]').checked, 'full unchecked after partial qty');
    input.value = '99';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(40);
    await click(document.getElementById('recvConfirm'));
    const toastEl = document.querySelector('.toast');
    ok(!!toastEl && /exceed/i.test(toastEl.textContent), 'qty > sent blocked client-side');
    const still = await apiOk('orders.detail', { order_id: oUi }, ali.token);
    ok(still.status === 'sent', 'order stays sent after blocked receive');
    input.value = '4';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    mrow.querySelector('[data-reason]').value = 'damaged';
    await click(document.getElementById('recvConfirm'));
    await tick(350);
    const done = await apiOk('orders.detail', { order_id: oUi }, ali.token);
    ok(done.status === 'shortage_reported', 'partial+reason → shortage_reported, got ' + done.status);
  }

  // branch report buttons + print flow
  await go('#/order/' + oUi);
  ok(!!document.getElementById('reportPrint'), 'branch Print report button present');
  await click(document.getElementById('reportPrint'));
  ok((window.__printed || 0) >= 1, 'branch print triggers print flow');
  const repHtml = document.getElementById('report-root').innerHTML;
  ok(repHtml.includes('Mineral Water'), 'branch report lists items');
  dom.window.close();
}

console.log('order-features (' + scenario + '):', failed === 0 ? 'OK' : (failed + ' failure(s)'));
process.exit(failed ? 1 : 0);
