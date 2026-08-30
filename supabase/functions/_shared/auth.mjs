import {
  fail,
  hashPassword,
  verifyPassword,
  storedRounds,
  newToken,
  USER_ROLES,
  USER_STATUS
} from './lib.mjs';

export function createAuth(store, cfg, activity) {
  async function userFromRow(row) {
    if (!row) return null;
    const u = {
      user_id: row.user_id,
      username: row.username,
      email: row.email || '',
      full_name: row.full_name || row.username,
      role: row.role,
      branch_id: row.branch_id || '',
      status: row.status
    };
    if (u.branch_id) {
      const branch = await store.find('Branches', 'branch_id', u.branch_id);
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

  async function resolveUserByToken(token) {
    if (!token) return null;
    const session = await store.find('Sessions', 'token', token);
    if (!session) return null;
    if (session.active !== true && String(session.active) !== 'true') return null;
    const exp = Date.parse(session.expires_at);
    if (isNaN(exp) || exp < Date.now()) return null;
    const row = await store.find('Users', 'user_id', session.user_id);
    if (!row || String(row.status) !== USER_STATUS.ACTIVE) return null;
    const u = await userFromRow(row);
    u.session_token = token;
    return u;
  }

  async function requireUser(token) {
    const u = await resolveUserByToken(token);
    if (!u) fail('auth_required', 'Your session is invalid or has expired. Please log in again.');
    return u;
  }

  function requireRole(user, role) {
    if (user.role !== role) fail('forbidden', 'You do not have permission to perform this action.');
    return true;
  }

  async function createSession(user) {
    const token = await newToken();
    const hours = await cfg.int('SESSION_HOURS');
    const expires = new Date(Date.now() + hours * 3600 * 1000);
    const tz = await cfg.timezone();
    await store.insert('Sessions', {
      token,
      user_id: user.user_id,
      created_at: await cfg.now(),
      expires_at: formatExpires(expires, tz),
      active: true
    });
    await store.update('Users', user, { last_login_at: await cfg.now() });
    return token;
  }

  async function login(username, password) {
    if (!username || !password) fail('invalid_credentials', 'Please enter your username and password.');
    const rows = await store.all('Users');
    const v = String(username).toLowerCase().trim();
    const hit = rows.find((r) => {
      const ue = String(r.email || '').toLowerCase().trim();
      const un = String(r.username || '').toLowerCase().trim();
      return ue === v || un === v;
    });
    if (!hit || !(await verifyPassword(password, hit.password_hash))) {
      fail('invalid_credentials', 'Incorrect username or password.');
    }
    if (String(hit.status) !== USER_STATUS.ACTIVE) {
      fail('account_inactive', 'This account is disabled. Contact your administrator.');
    }
    if (String(hit.role) === USER_ROLES.BRANCH_USER && hit.branch_id) {
      const branch = await store.find('Branches', 'branch_id', hit.branch_id);
      if (branch && String(branch.status) !== USER_STATUS.ACTIVE) {
        fail('branch_inactive', 'Your branch is disabled. Contact your administrator.');
      }
    }
    const user = await userFromRow(hit);
    const token = await createSession(hit);
    if (storedRounds(hit.password_hash) > 32) {
      await store.update('Users', hit, { password_hash: await hashPassword(password), updated_at: await cfg.now() });
    }
    return { token, user };
  }

  async function logout(token) {
    if (!token) return true;
    const session = await store.find('Sessions', 'token', token);
    if (session) await store.update('Sessions', session, { active: false });
    return true;
  }

  async function changePassword(userId, oldPassword, newPassword) {
    const row = await store.find('Users', 'user_id', userId);
    if (!row) fail('not_found', 'User not found.');
    if (!(await verifyPassword(oldPassword, row.password_hash))) {
      fail('invalid_credentials', 'Current password is incorrect.');
    }
    if (!newPassword || String(newPassword).length < 6) {
      fail('weak_password', 'New password must be at least 6 characters.');
    }
    return store.update('Users', row, {
      password_hash: await hashPassword(String(newPassword)),
      updated_at: await cfg.now()
    });
  }

  async function publicUser(userId) {
    return userFromRow(await store.find('Users', 'user_id', userId));
  }

  return {
    hashPassword,
    verifyPassword,
    login,
    logout,
    requireUser,
    requireRole,
    resolveUserByToken,
    changePassword,
    publicUser,
    userFromRow
  };
}

function formatExpires(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
}
