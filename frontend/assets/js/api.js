/**
 * API client for the Apps Script Web App.
 *
 * Google 302s POST /exec to googleusercontent.com/macros/echo. Browsers often
 * follow that as GET, which returns HTML or a health-check JSON. We POST with
 * credentials omitted, then fall back to GET ?payload= if needed.
 */
import { CONFIG, isConfigured, getApiUrl, captureApiOverride } from './config.js';

captureApiOverride();

let _token = localStorage.getItem(CONFIG.STORAGE_KEYS.token) || '';

export function getToken() {
  return _token;
}
export function setToken(token) {
  _token = token || '';
  if (token) localStorage.setItem(CONFIG.STORAGE_KEYS.token, token);
  else localStorage.removeItem(CONFIG.STORAGE_KEYS.token);
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

function isHealthCheck(json) {
  return !!(json && json.ok === true && json.service && json.data === undefined && json.time);
}

async function readJson(res) {
  const text = await res.text();
  return tryParse(text);
}

async function postExec(body) {
  const res = await fetch(getApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'follow'
  });
  return readJson(res);
}

async function getExec(body) {
  const q = encodeURIComponent(JSON.stringify(body));
  if (q.length > 1800) return null;
  const res = await fetch(getApiUrl() + '?payload=' + q, {
    method: 'GET',
    credentials: 'omit',
    redirect: 'follow'
  });
  return readJson(res);
}

export async function api(action, payload = {}) {
  if (!isConfigured()) {
    throw new ApiError('setup_error', 'Backend is not configured yet.');
  }
  const body = Object.assign({ action, token: _token }, payload);
  let json;
  try {
    json = await postExec(body);
    if (!json || isHealthCheck(json)) json = await getExec(body);
  } catch (e) {
    throw new ApiError('network', 'Could not reach the backend. Check your connection and the Apps Script URL.');
  }
  if (!json) {
    throw new ApiError('bad_response', 'The backend returned an invalid response.');
  }
  if (json.ok !== true) {
    const code = (json.error && json.error.code) || 'error';
    const message = (json.error && json.error.message) || 'Request failed';
    throw new ApiError(code, message, json.error && json.error.details);
  }
  if (isHealthCheck(json)) {
    throw new ApiError('bad_response', 'The backend returned an invalid response.');
  }
  return json.data;
}
