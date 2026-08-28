import { CONFIG } from './config.js';

export function getSessionUser() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.session);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setSessionUser(user) {
  if (user) localStorage.setItem(CONFIG.STORAGE_KEYS.session, JSON.stringify(user));
  else localStorage.removeItem(CONFIG.STORAGE_KEYS.session);
}

export function isBranch(user) {
  return user && user.role === 'branch_user';
}

export function isAdmin(user) {
  return user && user.role === 'admin';
}