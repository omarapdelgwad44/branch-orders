/**
 * Frontend talks to a Supabase Edge Function (same JSON actions as before).
 * Set API_URL + SUPABASE_ANON_KEY after you create the project (see README).
 */
export const CONFIG = {
  API_URL: 'https://jiwnhtpwmgggqrtpjrhp.supabase.co/functions/v1/api',
  SUPABASE_ANON_KEY: 'sb_publishable_Msm3zgV5qodg-myIKBEE_A_jdxAO-SO',
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

function isLocalApi(url) {
  return /^http:\/\/localhost(?::\d+)?\//.test(url || '');
}

function effectiveApiUrl() {
  let override = null;
  try { override = localStorage.getItem(OVERRIDE_KEY); } catch (e) { override = null; }
  if (override && isLocalApi(override)) return override;
  return CONFIG.API_URL;
}

/**
 * Local testing only: ?api=http://localhost:8787/api
 * Production always uses CONFIG.API_URL (stale overrides are ignored).
 */
export function captureApiOverride() {
  try {
    const m = /[?&]api=([^&#]*)/.exec(location.search || '');
    if (m) {
      if (m[1]) {
        const v = decodeURIComponent(m[1]);
        if (isLocalApi(v)) localStorage.setItem(OVERRIDE_KEY, v);
        else localStorage.removeItem(OVERRIDE_KEY);
      } else {
        localStorage.removeItem(OVERRIDE_KEY);
      }
    }
  } catch (e) { /* ignore */ }
}

export const getApiUrl = () => effectiveApiUrl();

export const getAnonKey = () => {
  const k = CONFIG.SUPABASE_ANON_KEY || '';
  return /YOUR_ANON_KEY/.test(k) ? '' : k;
};

export const isConfigured = () => {
  const url = effectiveApiUrl();
  if (isLocalApi(url)) return true;
  return /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\//.test(url) &&
    !/YOUR_PROJECT/.test(url) &&
    !!getAnonKey();
};
