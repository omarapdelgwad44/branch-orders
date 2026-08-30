/**
 * Installs globalThis.fetch that talks to the in-memory API,
 * so frontend tests exercise the same HTTP path as production.
 */
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.mjs';
import { createApp, dispatchHttp } from '../supabase/functions/_shared/handle.mjs';

export async function installBackendFetch() {
  const app = createApp(createMemoryStore());
  await app.direct.setupSystem();

  globalThis.fetch = async (url, opts = {}) => {
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    const result = await dispatchHttp(app, method, url, (opts && opts.body) || '');
    const text = JSON.stringify(result);
    return {
      ok: true,
      json: async () => result,
      text: async () => text
    };
  };

  return app;
}

/** @deprecated alias kept for older test imports */
export const installAppsScriptFetch = installBackendFetch;
