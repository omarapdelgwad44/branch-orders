/**
 * Backend test suite for the Apps Script backend (backend/*.gs),
 * executed in Node against the Apps Script shim (appsscript-shim.mjs).
 *
 * Run:  node tests/run-backend-tests.mjs
 * Exit code 0 = all tests passed.
 */
import { buildContext, loadBackend } from './appsscript-shim.mjs';
import { runSharedSuite } from './shared-suite.mjs';

const build = buildContext();
const { sandbox } = loadBackend(build);

const host = {
  api(action, payload, token) {
    const beforeIdx = build.contentOutputs.length;
    sandbox.doPost({ postData: { contents: JSON.stringify({ action, token, ...(payload || {}) }) } });
    const out = build.contentOutputs[beforeIdx];
    if (!out) throw new Error('doPost produced no output for ' + action);
    return JSON.parse(out.getContent());
  },
  direct(name, ...args) {
    return sandbox[name](...args);
  },
  repoRows(sheetName) {
    return sandbox.SheetsRepo.repo(sheetName).readAll();
  }
};

const result = runSharedSuite(host);
process.exit(result.failed ? 1 : 0);