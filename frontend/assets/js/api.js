/**
 * API client for the Supabase Edge Function.
 * POST JSON { action, token, ... } — same envelope the UI already expects.
 */
import { CONFIG, isConfigured, getApiUrl, getAnonKey, captureApiOverride } from './config.js';

captureApiOverride();

function storedToken() {
  try {
    const persistent = localStorage.getItem(CONFIG.STORAGE_KEYS.token);
    if (persistent) return persistent;
  } catch (e) {}
  try {
    return sessionStorage.getItem(CONFIG.STORAGE_KEYS.token) || '';
  } catch (e) {
    return '';
  }
}

let _token = storedToken();

export function getToken() {
  return _token;
}
export function setToken(token, remember = true) {
  _token = token || '';
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.token);
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.token);
    if (!token) return;
    const store = remember ? localStorage : sessionStorage;
    store.setItem(CONFIG.STORAGE_KEYS.token, token);
  } catch (e) { return; }
}

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details || {};
  }
}

function tryParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const anon = getAnonKey();
  if (anon) {
    headers.apikey = anon;
    // Legacy JWT anon keys go in Authorization. New sb_publishable_ keys are not JWTs.
    if (anon.startsWith('eyJ')) headers.Authorization = 'Bearer ' + anon;
  }
  return headers;
}

export function warmup() {
  if (!isConfigured()) return;
  fetch(getApiUrl(), { method: 'GET', credentials: 'omit', cache: 'no-store' }).catch(function () {});
}

export async function api(action, payload = {}) {
  if (!isConfigured()) {
    throw new ApiError('setup_error', 'Backend is not configured yet.');
  }
  const body = Object.assign({ action, token: _token }, payload);
  let json;
  try {
    const res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      credentials: 'omit'
    });
    json = tryParse(await res.text());
  } catch (e) {
    throw new ApiError('network', 'Could not reach the backend. Check your connection and the API URL.');
  }
  if (!json) {
    throw new ApiError('bad_response', 'The backend returned an invalid response.');
  }
  if (json.ok !== true) {
    const code = (json.error && json.error.code) || 'error';
    const message = (json.error && json.error.message) || 'Request failed';
    throw new ApiError(code, message, json.error && json.error.details);
  }
  return json.data;
}
