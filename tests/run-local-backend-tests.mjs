/**
 * Backend test suite for the browser/local backend (frontend/assets/js/backend/*)
 * — the same shared-suite assertions that run against the Apps Script shim,
 * but executed through the in-browser dispatcher with a localStorage stub.
 *
 * Run:  node tests/run-local-backend-tests.mjs
 * Exit code 0 = all tests passed.
 */
import { runSharedSuite } from './shared-suite.mjs';

// fresh localStorage stub (installed before any store call — store reads lazily)
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};

const { dispatch } = await import('../frontend/assets/js/backend/routes.js');
const bootstrap = await import('../frontend/assets/js/backend/bootstrap.js');
const { SheetsRepo } = await import('../frontend/assets/js/backend/store.js');

const host = {
  api(action, payload, token) {
    const body = Object.assign({ action, token }, payload || {});
    return dispatch(action, body);
  },
  direct(name, ...args) {
    if (name === 'setupSystem') return bootstrap.setupSystem(...args);
    if (name === 'createFirstAdmin') return bootstrap.createFirstAdmin(...args);
    if (name === 'loadDemoData') return bootstrap.loadDemoData(...args);
    throw new Error('unknown direct call: ' + name);
  },
  repoRows(sheetName) {
    return SheetsRepo.repo(sheetName).readAll();
  }
};

const result = runSharedSuite(host);
process.exit(result.failed ? 1 : 0);