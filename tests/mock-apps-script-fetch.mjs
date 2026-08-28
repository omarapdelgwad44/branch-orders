/**
 * Installs globalThis.fetch that talks to the in-memory Apps Script shim,
 * so frontend tests exercise the same HTTP path as production.
 */
import { buildContext, loadBackend } from './appsscript-shim.mjs';

export function installAppsScriptFetch() {
  const build = buildContext();
  const { sandbox } = loadBackend(build);
  sandbox.setupSystem();

  globalThis.fetch = async (_url, opts = {}) => {
    const i = build.contentOutputs.length;
    const method = String((opts && opts.method) || 'GET').toUpperCase();
    if (method === 'GET') sandbox.doGet({});
    else sandbox.doPost({ postData: { contents: (opts && opts.body) || '{}' } });
    const text = build.contentOutputs[i].getContent();
    return {
      ok: true,
      json: async () => JSON.parse(text),
      text: async () => text
    };
  };

  return sandbox;
}
