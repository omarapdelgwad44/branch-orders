/**
 * Auth port of AuthService.gs. Same iterative SHA-256 scheme, server-side
 * sessions (in the local DB), role checks and branch isolation.
 */
import { SheetsRepo, CONFIG, Ids } from './store.js';
import { sha256Hex } from './sha256.js';
import { fail, nowIso, USER_STATUS, USER_ROLES } from './constants.js';

var ROUNDS = 12000;
var HASH_ID = 'sha256';

function digestHex(str) {
  return sha256Hex(str);
}

function hashRounds(str, rounds) {
  var h = digestHex(str);
  for (var i = 1; i < rounds; i++) h = digestHex(h);
  return h;
}

function makeSalt() {
  return digestHex('salt:' + Math.random() + ':' + Date.now() + ':' + Math.random()).slice(0, 24);
}

function hashPassword(password) {
  var salt = makeSalt();
  return HASH_ID + '$' + ROUNDS + '$' + salt + '$' + hashRounds(password + ':' + salt, ROUNDS);
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  var parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_ID) return false;
  var rounds = parseInt(parts[1], 10);
  var salt = parts[2];
  var expected = parts[3];
  var actual = hashRounds(password + ':' + salt, rounds);
  return actual === expected;
}

function newToken() {
  return digestHex('tok:' + Date.now() + ':' + Math.random() + ':' + Math.random());
}

var sessionsRepo = function () { return SheetsRepo.repo('Sessions').ensure(); };
var usersRepo = function () { return SheetsRepo.repo('Users'); };

function sessionHours() {
  return CONFIG.int('SESSION_HOURS');
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function createSession_(user) {
  var token = newToken();
  var now = new Date();
  var expires = new Date(now.getTime() + sessionHours() * 3600 * 1000);
  var repo = sessionsRepo();
  repo.insert({
    token: token,
    user_id: user.user_id,
    created_at: nowIso(),
    expires_at: fmtDate(expires),
    active: true
  });
  if (user.__row) usersRepo().update(user, { last_login_at: nowIso() });
  return token;
}

function purgeExpired_() {
  var all = sessionsRepo().readAll();
  var nowMs = new Date().getTime();
  var repo = sessionsRepo();
  for (var i = 0; i < all.length; i++) {
    var exp = Date.parse(all[i].expires_at);
    if (isNaN(exp) || exp < nowMs) repo.update(all[i], { active: false });
  }
}

function userFromRow_(row) {
  if (!row) return null;
  var u = {
    user_id: row.user_id,
    username: row.username,
    email: row.email || '',
    full_name: row.full_name || row.username,
    role: row.role,
    branch_id: row.branch_id || '',
    status: row.status
  };
  if (u.branch_id) {
    var branch = SheetsRepo.repo('Branches').find('branch_id', u.branch_id);
    u.branch = branch ? {
      branch_id: branch.branch_id,
      branch_code: branch.branch_code,
      branch_name: branch.branch_name,
      location: branch.location || '',
      status: branch.status
    } : null;
  } else {
    u.branch = null;
  }
  return u;
}

function resolveUserByToken(token) {
  if (!token) return null;
  var session = sessionsRepo().find('token', token);
  if (!session) return null;
  if (String(session.active) !== 'true' && session.active !== true) return null;
  var exp = Date.parse(session.expires_at);
  if (isNaN(exp) || exp < new Date().getTime()) return null;
  var row = usersRepo().find('user_id', session.user_id);
  if (!row) return null;
  if (String(row.status) !== USER_STATUS.ACTIVE) return null;
  var u = userFromRow_(row);
  u.session_token = token;
  return u;
}

function requireUser(token) {
  var u = resolveUserByToken(token);
  if (!u) fail('auth_required', 'Your session is invalid or has expired. Please log in again.');
  return u;
}

function requireRole(user, role) {
  if (user.role !== role) fail('forbidden', 'You do not have permission to perform this action.');
  return true;
}

function publicUser(filter) {
  return userFromRow_(usersRepo().find('user_id', filter));
}

function login(username, password) {
  if (!username || !password) fail('invalid_credentials', 'Please enter your username and password.');
  var rows = usersRepo().readAll();
  var hit = null;
  var v = String(username).toLowerCase().trim();
  for (var i = 0; i < rows.length; i++) {
    var ue = String(rows[i].email || '').toLowerCase().trim();
    var un = String(rows[i].username || '').toLowerCase().trim();
    if (ue === v || un === v) { hit = rows[i]; break; }
  }
  if (!hit || !verifyPassword(password, hit.password_hash)) {
    fail('invalid_credentials', 'Incorrect username or password.');
  }
  if (String(hit.status) !== USER_STATUS.ACTIVE) {
    fail('account_inactive', 'This account is disabled. Contact your administrator.');
  }
  if (String(hit.role) === USER_ROLES.BRANCH_USER && hit.branch_id) {
    var branch = SheetsRepo.repo('Branches').find('branch_id', hit.branch_id);
    if (branch && String(branch.status) !== USER_STATUS.ACTIVE) {
      fail('branch_inactive', 'Your branch is disabled. Contact your administrator.');
    }
  }
  var user = userFromRow_(hit);
  var token = createSession_(hit);
  purgeExpired_();
  return { token: token, user: user };
}

function logout(token) {
  if (!token) return true;
  var session = sessionsRepo().find('token', token);
  if (session) sessionsRepo().update(session, { active: false });
  return true;
}

function changePassword(userId, oldPassword, newPassword) {
  var row = usersRepo().find('user_id', userId);
  if (!row) fail('not_found', 'User not found.');
  if (!verifyPassword(oldPassword, row.password_hash)) fail('invalid_credentials', 'Current password is incorrect.');
  if (!newPassword || String(newPassword).length < 6) fail('weak_password', 'New password must be at least 6 characters.');
  var hash = hashPassword(String(newPassword));
  return usersRepo().update(row, { password_hash: hash, updated_at: nowIso() });
}

export var Auth = {
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  login: login,
  logout: logout,
  requireUser: requireUser,
  requireRole: requireRole,
  resolveUserByToken: resolveUserByToken,
  changePassword: changePassword,
  publicUser: publicUser
};