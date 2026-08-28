/**
 * API client for the Apps Script Web App.
 *
 * Prefer GET ?payload= for typical calls. Browsers follow Google's POST 302 as
 * GET and that wasted a full round-trip (~10–30s) before the real request.
 * POST is used only when the body is too large for a query string.
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
  return tryParse(await res.text());
}

function encodedPayload(body) {
  return encodeURIComponent(JSON.stringify(body));
}

async function getExec(body) {
  const q = encodedPayload(body);
  if (q.length > 1800) return null;
  const res = await fetch(getApiUrl() + '?payload=' + q, {
    method: 'GET',
    credentials: 'omit',
    redirect: 'follow'
  });
  return readJson(res);
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
    json = await getExec(body);
    if (!json || isHealthCheck(json)) json = await postExec(body);
  } catch (e) {
    throw new ApiError('network', 'Could not reach the backend. Check your connection and the Apps Script URL.');
  }
  if (!json || isHealthCheck(json)) {
    throw new ApiError('bad_response', 'The backend returned an invalid response.');
  }
  if (json.ok !== true) {
    const code = (json.error && json.error.code) || 'error';
    const message = (json.error && json.error.message) || 'Request failed';
    throw new ApiError(code, message, json.error && json.error.details);
  }
  return json.data;
}
