/**
 * Backend test suite for the Supabase-compatible API
 * (in-memory store — same handlers as the Edge Function).
 *
 * Run:  node tests/run-backend-tests.mjs
 */
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.mjs';
import { createApp } from '../supabase/functions/_shared/handle.mjs';
import { runSharedSuite } from './shared-suite.mjs';

const app = createApp(createMemoryStore());

const host = {
  api(action, payload, token) {
    return app.handle(Object.assign({ action, token }, payload || {}));
  },
  direct(name, ...args) {
    return app.direct[name](...args);
  },
  repoRows(sheetName) {
    return app.store.raw(sheetName);
  }
};

const result = await runSharedSuite(host);
process.exit(result.failed ? 1 : 0);
