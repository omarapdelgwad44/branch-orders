/**
 * API client for the Apps Script Web App.
 * POST uses Content-Type text/plain to avoid a CORS preflight.
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

export async function api(action, payload = {}) {
  if (!isConfigured()) {
    throw new ApiError('setup_error', 'Backend is not configured yet.');
  }
  const body = Object.assign({ action, token: _token }, payload);
  let res;
  try {
    res = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new ApiError('network', 'Could not reach the backend. Check your connection and the Apps Script URL.');
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new ApiError('bad_response', 'The backend returned an invalid response.');
  }
  if (!json || json.ok !== true) {
    const code = (json && json.error && json.error.code) || 'error';
    const message = (json && json.error && json.error.message) || 'Request failed';
    throw new ApiError(code, message, json && json.error && json.error.details);
  }
  return json.data;
}
