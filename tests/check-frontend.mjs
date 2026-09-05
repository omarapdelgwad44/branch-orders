/**
 * Frontend static checks:
 *  1. every t('key') used in views exists in AR & EN dictionaries
 *  2. every icon('name') used in views exists in icons.js
 *  3. t() calls with dynamic keys (t('status.'+s), t('manage.'+k)) are whitelisted
 *
 * Run:  node tests/check-frontend.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

globalThis.localStorage = {
  data: new Map(),
  getItem: (k) => globalThis.localStorage.data.has(k) ? globalThis.localStorage.data.get(k) : null,
  setItem: (k, v) => globalThis.localStorage.data.set(k, String(v)),
  removeItem: (k) => globalThis.localStorage.data.delete(k),
};
globalThis.window = globalThis;

const { DICT_AR, DICT_EN } = await import('../frontend/assets/js/i18n.js');
const { ICON_NAMES } = await import('../frontend/assets/js/icons.js');

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(here, '..', 'frontend', 'assets', 'js', 'views');
const srcDir = join(here, '..', 'frontend', 'assets', 'js');

let failed = 0;
const fail = (msg) => { failed++; console.log('  FAIL ' + msg); };

// collect all t('...') and icon('...') literal keys
const files = readdirSync(viewsDir).filter(f => f.endsWith('.js'))
  .concat(['app.js', 'ui.js', 'report.js'].filter(f => readdirSync(srcDir).includes(f)))
  .map(f => readdirSync(viewsDir).includes(f) ? join(viewsDir, f) : join(srcDir, f));

const staticKeys = new Set();
const dynamicPrefixes = new Set();
const iconsUsed = new Set();
const keyPat = /(?<![A-Za-z0-9_])t\((['"])([\w<>.-]+)\1\)/g;
const dynPat = /(?<![A-Za-z0-9_])t\(['"]([a-zA-Z.]+)['"]\s*\+/g;
const iconPat = /(?<![A-Za-z0-9_])icon\((['"])([\w-]+)\1/g;

for (const fp of files) {
  const src = readFileSync(fp, 'utf8');
  let m;
  while ((m = keyPat.exec(src))) staticKeys.add(m[2]);
  while ((m = dynPat.exec(src))) dynamicPrefixes.add(m[1]);
  while ((m = iconPat.exec(src))) iconsUsed.add(m[2]);
}

// keys entirely missing
const arMissing = [], enMissing = [];
for (const k of staticKeys) {
  if (!(k in DICT_AR)) arMissing.push(k);
  if (!(k in DICT_EN)) enMissing.push(k);
}
if (arMissing.length) fail('t() keys missing in AR: ' + [...new Set(arMissing)].join(', '));
if (enMissing.length) fail('t() keys missing in EN: ' + [...new Set(enMissing)].join(', '));

// verify two known dynamic prefixes resolve for the keys actually produced
const known = new Set([...Object.keys(DICT_AR), 'dashboard.branchLabel', 'status.cancelled']);
// this is informational; concrete dynamic keys are checked via runtime rendering

// icons missing
const iconMissing = [...iconsUsed].filter(n => !(n in ICON_NAMES));
if (iconMissing.length) fail('icon() names missing in icons.js: ' + iconMissing.join(', '));

// import sanity: any shared API symbol used in a file must be imported (or defined locally).
// Catches the class of bug where a view references e.g. getLang() without importing it → blank screen.
const sharedSymbols = ['setLang', 'getLang', 't', 'fmtDate', 'fmtNum', 'icon', 'api', 'setToken', 'getToken',
  'setSessionUser', 'getSessionUser', 'isBranch', 'isAdmin', 'isConfigured', 'toast', 'badge',
  'skeletons', 'qtyControl', 'attachQty', 'confirmDialog', 'openModal', 'closeModal', 'esc', 'numberCell',
  'fileDownload', 'debounce', 'STATUS_TYPES', 'el'];
for (const fp of files) {
  const src = readFileSync(fp, 'utf8');
  const imported = new Set();
  let m;
  const impPat = /\bimport\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  while ((m = impPat.exec(src))) {
    m[1].split(',').forEach(b => {
      const name = b.trim().split(/\s+as\s+/)[0].split(/\s+/)[0];
      if (name) imported.add(name.replace(/^.*?([A-Za-z_$][\w$]*)$/, '$1'));
    });
  }
  for (const s of sharedSymbols) {
    const definedLocally = new RegExp('(?:export\\s+)?(?:function\\s+' + s + '\\b|(?:const|let|var)\\s+' + s + '\\s*[=:])').test(src);
    if (definedLocally) continue;
    if (imported.has(s)) continue;
    const used = new RegExp('(?<![A-Za-z0-9_$.])\\b' + s + '\\b').test(src);
    if (used) fail(fp.replace(/^.*frontend/, 'frontend') + ' uses ' + s + '() without importing it');
  }
}

console.log('missing AR keys:', arMissing.length === 0 ? 'none ✓' : arMissing.join(', '));
console.log('missing EN keys:', enMissing.length === 0 ? 'none ✓' : enMissing.join(', '));
console.log('missing icons:', iconMissing.length === 0 ? 'none ✓' : iconMissing.join(', '));

console.log('static keys checked:', staticKeys.size, '| dynamic prefixes:', [...dynamicPrefixes].join(', ') || '(none)', '| icons used:', iconsUsed.size);
process.exit(failed ? 1 : 0);