/**
 * Frontend configuration.
 *
 * IMPORTANT: replace API_URL with your deployed Google Apps Script
 * Web App URL (Settings → Deployments → Web app → URL, ends with /exec).
 * Example: 'https://script.google.com/macros/s/AKfycb.../exec'
 */
export const CONFIG = {
  /**
   * Where the app stores data:
   *  'local'  → a full backend runs inside the browser, persisted to
   *             localStorage. 100% GitHub Pages, nothing external.
   *  'google' → a Google Apps Script Web App (API_URL below) is used,
   *             data lives in Google Sheets (shared across browsers).
   */
  DATA_MODE: 'local',
  API_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  APP_NAME: 'Branch Orders',
  APP_TAGLINE: 'Internal ordering system',
  STORAGE_KEYS: {
    token: 'bo.token',
    session: 'bo.session',
    lang: 'bo.lang',
    apiUrl: 'bo.apiUrl',
    mode: 'bo.mode'
  }
};

const MODE_KEY = CONFIG.STORAGE_KEYS.mode;

/**
 * Runtime data mode. Defaults to 'local' (CONFIG.DATA_MODE) but any browser
 * can switch to the shared 'google' mode via ?api=<Apps Script /exec URL>
 * (or back with a bare ?api=). The chosen mode persists per browser.
 */
export function effectiveDataMode() {
  try {
    if (localStorage.getItem(MODE_KEY) === 'google') return 'google';
  } catch (e) { /* ignore */ }
  return CONFIG.DATA_MODE;
}

export const isLocalMode = () => effectiveDataMode() === 'local';

const OVERRIDE_KEY = CONFIG.STORAGE_KEYS.apiUrl;

function effectiveApiUrl() {
  let override = null;
  try { override = localStorage.getItem(OVERRIDE_KEY); } catch (e) { override = null; }
  return override || CONFIG.API_URL;
}

/*
 * Local testing override: open the app with ?api=<local mock URL>
 * e.g.  http://localhost:8080/?api=http://localhost:8787/exec
 * The override is stored in localStorage and cleared by a bare ?api=
 *
 * Shared-data mode: ?api=https://script.google.com/macros/s/.../exec also
 * switches THIS browser from 'local' to the shared 'google' data mode, so
 * the same browser always talks to the shared Google Sheets backend.
 */
export function captureApiOverride() {
  try {
    const m = /[?&]api=([^&#]*)/.exec(location.search || '');
    if (m) {
      if (m[1]) {
        localStorage.setItem(OVERRIDE_KEY, decodeURIComponent(m[1]));
        localStorage.setItem(MODE_KEY, 'google');
      } else {
        localStorage.removeItem(OVERRIDE_KEY);
        localStorage.removeItem(MODE_KEY);
      }
    }
  } catch (e) { /* ignore */ }
}

export const getApiUrl = () => effectiveApiUrl();

export const isConfigured = () => {
  if (CONFIG.DATA_MODE === 'local') return true;
  const url = effectiveApiUrl();
  return !/YOUR_SCRIPT_ID/.test(url) &&
    (/^https:\/\/script\.google\.com\//.test(url) || /^http:\/\/localhost(?::\d+)?\//.test(url));
};