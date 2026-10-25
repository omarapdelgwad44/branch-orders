import { CONFIG } from './config.js';

function readBoth(key) {
  try {
    const persistent = localStorage.getItem(key);
    if (persistent) return persistent;
  } catch (e) {}
  try {
    return sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export function getSessionUser() {
  try {
    const raw = readBoth(CONFIG.STORAGE_KEYS.session);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setSessionUser(user, remember = true) {
  try {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.session);
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.session);
    if (!user) return;
    const store = remember ? localStorage : sessionStorage;
    store.setItem(CONFIG.STORAGE_KEYS.session, JSON.stringify(user));
  } catch (e) { return; }
}

export function isBranch(user) {
  return user && user.role === 'branch_user';
}

export function isAdmin(user) {
  return user && user.role === 'admin';
}
