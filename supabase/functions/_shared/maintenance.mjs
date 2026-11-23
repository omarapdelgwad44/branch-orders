/**
 * Developer-only site lock. The password never lives in the frontend.
 * Set DEVELOPER_LOCK_PASSWORD on the Edge Function (and in the local demo).
 */
import { fail } from './lib.mjs';

const SETTING = 'SITE_LOCKED';

function developerPassword() {
  try {
    if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
      const fromDeno = Deno.env.get('DEVELOPER_LOCK_PASSWORD');
      if (fromDeno) return fromDeno;
    }
  } catch (e) { /* Node has no Deno.env */ }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.DEVELOPER_LOCK_PASSWORD) {
      return process.env.DEVELOPER_LOCK_PASSWORD;
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function digestHex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function passwordMatches(given) {
  const secret = developerPassword();
  if (!secret || !given) return false;
  const a = await digestHex('dev-lock\n' + secret);
  const b = await digestHex('dev-lock\n' + given);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createMaintenance(store) {
  return {
    async isLocked() {
      return (await store.getSetting(SETTING, 'false')) === 'true';
    },
    async status() {
      return { locked: await this.isLocked() };
    },
    async set(body) {
      if (!developerPassword()) {
        fail('developer_unconfigured', 'Developer lock password is not configured.');
      }
      if (!(await passwordMatches(String((body && body.password) || '')))) {
        fail('developer_denied', 'Developer password is incorrect.');
      }
      const locked = body && (body.locked === true || body.locked === 'true');
      await store.setSetting(SETTING, locked ? 'true' : 'false');
      return { locked: !!locked };
    }
  };
}
