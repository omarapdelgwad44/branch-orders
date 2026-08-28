/**
 * Frontend talks only to the Google Apps Script Web App.
 * Data lives in Google Sheets (shared across every device).
 */
export const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxxAwaOJsvKNc34Ci2SPYR-rmn62gQAfipuwM8mpX5V6_JPQMV3Sdqdvqlh08ac_X75nw/exec',
  APP_NAME: 'Branch Orders',
  APP_TAGLINE: 'Internal ordering system',
  STORAGE_KEYS: {
    token: 'bo.token',
    session: 'bo.session',
    lang: 'bo.lang',
    apiUrl: 'bo.apiUrl'
  }
};

const OVERRIDE_KEY = CONFIG.STORAGE_KEYS.apiUrl;

function effectiveApiUrl() {
  let override = null;
  try { override = localStorage.getItem(OVERRIDE_KEY); } catch (e) { override = null; }
  if (override && /^http:\/\/localhost(?::\d+)?\//.test(override)) return override;
  return CONFIG.API_URL;
}

/**
 * Local testing only: ?api=http://localhost:8787/exec
 * Production always uses CONFIG.API_URL (stale overrides are ignored).
 */
export function captureApiOverride() {
  try {
    const m = /[?&]api=([^&#]*)/.exec(location.search || '');
    if (m) {
      if (m[1]) {
        const v = decodeURIComponent(m[1]);
        if (/^http:\/\/localhost(?::\d+)?\//.test(v)) localStorage.setItem(OVERRIDE_KEY, v);
        else localStorage.removeItem(OVERRIDE_KEY);
      } else {
        localStorage.removeItem(OVERRIDE_KEY);
      }
    }
  } catch (e) { /* ignore */ }
}

export const getApiUrl = () => effectiveApiUrl();

export const isConfigured = () => {
  const url = effectiveApiUrl();
  return !/YOUR_SCRIPT_ID/.test(url) &&
    (/^https:\/\/script\.google\.com\//.test(url) || /^http:\/\/localhost(?::\d+)?\//.test(url));
};
