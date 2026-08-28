import crypto from 'node:crypto';
import vm from 'node:vm';

/**
 * Apps Script runtime shim for testing backend/*.gs under Node.
 * Mocks: SpreadsheetApp, LockService, Utilities, Logger, ContentService,
 * PropertiesService, and the offer bodies of Hooks (onOpen / menu).
 */

export function createWorkbook() {
  const sheets = new Map(); // name -> sheet object
  const sheetApi = {
    _rows: [],               // array of arrays
    appendRow(values) {
      this._rows.push(values.slice());
    },
    getLastRow() {
      return this._rows.length;
    },
    getLastColumn() {
      let max = 0;
      this._rows.forEach((r) => { max = Math.max(max, r.length); });
      return max;
    },
    insertColumnsAfter() {},
    setFrozenRows() {},
    getRange(a, b, c, d) {
      return createRange(this, a, b, c, d);
    },
  };
  const createRange = (sheet, a, b, c, d) => {
    return {
      sheet, a, b, c, d,
      setValues(values) {
        // top-left anchored write, extends rows as needed
        const r0 = a - 1, c0 = b - 1;
        values.forEach((row, ri) => {
          const targetRow = sheet._rows[r0 + ri] || (sheet._rows[r0 + ri] = []);
          row.forEach((val, ci) => { targetRow[c0 + ci] = val; });
        });
        return this;
      },
      setValue(value) {
        const r0 = a - 1, c0 = b - 1;
        const targetRow = sheet._rows[r0] || (sheet._rows[r0] = []);
        targetRow[c0] = value;
        return this;
      },
      getValues() {
        const n = c || 1, m = d || 1;
        const out = [];
        for (let i = 0; i < n; i++) {
          const row = sheet._rows[a - 1 + i] || [];
          const slice = [];
          for (let j = 0; j < m; j++) slice.push(row[b - 1 + j] === undefined ? '' : row[b - 1 + j]);
          out.push(slice);
        }
        return out;
      },
      setNumberFormat() { return this; },
    };
  };
  const workbook = {
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) {
      const s = Object.create(sheetApi);
      s._rows = [];
      s.getName = () => name;
      sheets.set(name, s);
      return s;
    },
    _sheets: sheets,
  };
  return workbook;
}

export function createLock() {
  let depth = 0, lockCount = 0;
  return {
    getScriptLock() {
      return {
        waitLock(ms) {
          lockCount++;
          depth++; // Apps Script locks are re-entrant within one execution
        },
        releaseLock() { depth = Math.max(0, depth - 1); },
      };
    },
    get lockCount() { return lockCount; },
    get depth() { return depth; },
  };
}

export function createUtilities() {
  const p = (x) => String(x).padStart(2, '0');
  const compact = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return {
    computeDigest(algorithm, value) {
      if (algorithm !== 'SHA_256') throw new Error('Unsupported digest algorithm ' + algorithm);
      const hashed = crypto.createHash('sha256').update(String(value), 'utf8').digest();
      return Array.from(hashed);
    },
    formatDate(date, tz, fmt) {
      const d = date instanceof Date ? date : new Date(date);
      if (fmt === 'yyyyMMdd-HHmm') {
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
      }
      return compact(d);
    },
    getUuid() { return crypto.randomUUID(); },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    newBlob() { throw new Error('Mock newBlob not needed'); },
  };
}

export function buildContext() {
  const workbook = createWorkbook();
  const lock = createLock();
  const props = new Map();
  const contentOutputs = [];

  const context = {
    console,
    JSON, Math, Date, String, Number, Object, Array, Boolean, parseInt, parseFloat,
    isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: {
      getActiveSpreadsheet() { return workbook; },
    },
    LockService: lock,
    Utilities: createUtilities(),
    Logger: { log: (...a) => console.log('[Logger]', ...a) },
    ContentService: {
      TextOutput: 'TextOutput',
      MimeType: { JSON: 'JSON', TEXT: 'TEXT', CSV: 'CSV' },
      createTextOutput(str) {
        const out = {
          _content: str,
          setMimeType() { return this; },
          setHeaders() { return this; },
          getContent() { return this._content; },
        };
        contentOutputs.push(out);
        return out;
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(k) { return props.get(k) ?? null; },
          setProperty(k, v) { props.set(k, v); return this; },
          deleteProperty(k) { props.delete(k); return this; },
        };
      },
    },
    CacheService: {
      getScriptCache() {
        const map = new Map();
        return {
          get(k) { return map.get(k) ?? null; },
          put(k, v) { map.set(k, v); return this; },
        };
      },
    },
    UrlFetchApp: { fetch() { throw new Error('Mock UrlFetchApp not needed'); } },
    SpreadsheetAppClock: undefined,
    __workbook: workbook,
    __lock: lock,
    __contentOutputs: contentOutputs,
  };

  const sandbox = vm.createContext(context);
  return { context, sandbox, workbook, lock, props, contentOutputs };
}

export function loadBackend(build) {
  const v = vm.createContext(build.context);
  // concatenate .gs files in dependency order
  const script = new vm.Script(
    [
      'Config.gs', 'SheetsRepo.gs', 'AuthService.gs', 'ActivityService.gs',
      'CatalogService.gs', 'OrderService.gs', 'AdminService.gs',
      'ReportingService.gs', 'Setup.gs', 'Code.gs', 'Ui.gs',
    ]
      .map((f) => `/* === ${f} === */\n` + readScript(f))
      .join('\n'),
  );
  script.runInContext(v);
  return { sandbox: v, context: build.context, workbook: build.workbook, contentOutputs: build.contentOutputs };
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
function readScript(name) {
  return readFileSync(join(here, '..', 'backend', name), 'utf8');
}