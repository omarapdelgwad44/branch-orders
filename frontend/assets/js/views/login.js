/**
 * Unified login view. The role is detected on the server; the UI simply
 * follows the authenticated role to the right dashboard.
 */
import { setLang, getLang, t, errorText } from '../i18n.js';
import { api, warmup } from '../api.js';
import { icon } from '../icons.js';
import { isConfigured, CONFIG } from '../config.js';

export function render(app, { onLogin }) {
  warmup();
  setLang(getLang());
  app.innerHTML = layout();
  bind(app, onLogin);
  checkStatus(app);
}

function layout() {
  const langBtn = '<button class="lang-pill" id="langSwitch" type="button" aria-label="' + esc(t('a11y.switchLanguage')) + '">' +
    icon('globe', 15) + '<span>' + esc(t('lang.toggle')) + '</span></button>';
  const hints = (CONFIG.LOGIN_HINTS || [])
    .map((u) => '<option value="' + esc(u) + '"></option>')
    .join('');
  return (
    '<div class="login">' +
    '<aside class="login-hero">' +
      '<div class="hero-glow"></div>' +
      '<div class="hero-grid"></div>' +
      '<div class="hero-inner">' +
        '<div class="hero-brand">' +
          '<img class="hero-brand-logo" src="assets/images/sdg-logo-official.png" alt="SDG — Smart Distribution Group" width="720" height="988" fetchpriority="high">' +
          '<span class="brand-text"><b>' + esc(t('app.name')) + '</b><em>' + esc(t('app.tagline')) + '</em></span>' +
        '</div>' +
        '<div class="hero-copy">' +
          '<h1 class="login-steps"><span>' + esc(t('login.stat.order')) + '</span><i aria-hidden="true">·</i><span>' + esc(t('login.stat.track')) + '</span><i aria-hidden="true">·</i><span>' + esc(t('login.stat.receive')) + '</span></h1>' +
          '<p>' + esc(t('login.brandSub')) + '</p>' +
        '</div>' +
      '</div>' +
    '</aside>' +
    '<main class="login-panel">' +
      '<div class="login-card">' +
        '<div class="login-card-title-row"><h2>' + esc(t('login.welcome')) + '</h2>' + langBtn + '</div>' +
        '<p class="login-sub">' + esc(t('login.subtitle')) + '</p>' +
        '<div class="login-alert hidden" id="loginAlert" role="alert" aria-live="polite"></div>' +
        '<form id="loginForm" novalidate>' +
          '<label class="field">' +
            '<span class="field-label">' + esc(t('login.username')) + '</span>' +
            '<span class="input-wrap"><span class="input-icon" aria-hidden="true">' + icon('user', 18) + '</span>' +
            '<input class="input" type="text" name="username" autocomplete="username" spellcheck="false" list="loginHints" required autofocus></span>' +
            '<datalist id="loginHints">' + (hints || '<option></option>') + '</datalist>' +
          '</label>' +
          '<label class="field">' +
            '<span class="field-label">' + esc(t('login.password')) + '</span>' +
            '<span class="input-wrap"><span class="input-icon" aria-hidden="true">' + icon('lock', 18) + '</span>' +
            '<input class="input" id="loginPassword" type="password" name="password" autocomplete="current-password" required>' +
            '<button class="password-toggle" id="passwordToggle" type="button" aria-label="' + esc(t('login.showPassword')) + '" aria-pressed="false">' + icon('eye', 18) + '</button></span>' +
          '</label>' +
          '<button class="btn btn-primary btn-block btn-lg login-submit" type="submit"><span>' +
            esc(t('login.submit')) + '</span></button>' +
        '</form>' +
        '<div class="login-note hidden" id="loginNote"></div>' +
      '</div>' +
    '</main>' +
    '</div>'
  );
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAlert(node, message, ok) {
  node.classList.remove('hidden', 'alert-ok', 'alert-err');
  node.classList.add(ok ? 'alert-ok' : 'alert-err');
  node.textContent = message;
}

function bind(app, onLogin) {
  document.getElementById('langSwitch').addEventListener('click', () => {
    setLang(getLang() === 'ar' ? 'en' : 'ar');
    app.innerHTML = layout();
    bind(app, onLogin);
    checkStatus(app);
  });

  const form = document.getElementById('loginForm');
  const alertBox = document.getElementById('loginAlert');
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector('span');
  const password = form.password;
  const passwordToggle = document.getElementById('passwordToggle');

  passwordToggle.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    passwordToggle.setAttribute('aria-pressed', String(!visible));
    passwordToggle.setAttribute('aria-label', t(visible ? 'login.showPassword' : 'login.hidePassword'));
  });

  const setSubmitting = (submitting) => {
    btn.disabled = submitting;
    btn.classList.toggle('loading', submitting);
    btn.setAttribute('aria-busy', String(submitting));
    btnLabel.textContent = submitting ? t('login.signingIn') : t('login.submit');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      showAlert(alertBox, t('login.empty') || 'Please enter your credentials.', false);
      (!username ? form.username : form.password).focus();
      return;
    }
    setSubmitting(true);
    try {
      const session = await api('auth.login', { username, password });
      onLogin(session);
    } catch (err) {
      showAlert(alertBox, errorText(err), false);
      setSubmitting(false);
    }
  });
}

async function checkStatus(app) {
  const note = document.getElementById('loginNote');
  if (!note) return;
  const showNote = (html) => {
    if (html) {
      note.innerHTML = html;
      note.classList.remove('hidden');
    } else {
      note.innerHTML = '';
      note.classList.add('hidden');
    }
  };
  if (!isConfigured()) {
    showNote('<span class="note-ic">' + icon('alert', 15) + '</span>' +
      esc(t('err.setup_error')));
    return;
  }
  try {
    let status = null;
    try {
      const raw = sessionStorage.getItem('bo.sysStatus');
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.data && Date.now() - c.at < 600000) status = c.data;
      }
    } catch (e) { /* ignore */ }
    if (!status) {
      status = await api('system.status');
      try { sessionStorage.setItem('bo.sysStatus', JSON.stringify({ at: Date.now(), data: status })); } catch (e) { /* ignore */ }
    }
    if (status.needsSetup) {
      showNote(firstRunCard());
      bindFirstRun(note);
    }
  } catch (err) {
    showNote('<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(errorText(err)));
  }
}

function firstRunCard() {
  return (
    '<div class="setup-card">' +
      '<h3>' + esc(t('firstRun.adminTitle')) + '</h3>' +
      '<p>' + esc(t('firstRun.adminDesc')) + '</p>' +
      '<form id="adminSetupForm" novalidate>' +
        '<label class="field"><span class="field-label">' + esc(t('firstRun.fullName')) + '</span>' +
        '<input class="input" type="text" name="fullName" placeholder="' + esc(t('firstRun.fullName')) + '"></label>' +
        '<label class="field"><span class="field-label">' + esc(t('login.username')) + '</span>' +
        '<input class="input" type="text" name="username" placeholder="' + esc(t('firstRun.usernamePH')) + '" required></label>' +
        '<label class="field"><span class="field-label">' + esc(t('login.password')) + '</span>' +
        '<input class="input" type="password" name="password" placeholder="' + esc(t('firstRun.passwordPH')) + '" required></label>' +
        '<button class="btn btn-primary btn-block" type="submit">' + esc(t('firstRun.createBtn')) + '</button>' +
      '</form>' +
      '<button class="link-btn" id="demoLoad" type="button">' + esc(t('firstRun.demoBtn')) + '</button>' +
    '</div>'
  );
}

function bindFirstRun(note) {
  const form = document.getElementById('adminSetupForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        await api('system.setup.firstAdmin', {
          username: form.username.value.trim(),
          password: form.password.value,
          full_name: form.fullName.value.trim()
        });
        note.innerHTML = '<span class="note-ic">' + icon('check', 15) + '</span>' + esc(t('firstRun.created'));
      } catch (err) {
        note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(errorText(err));
      }
    });
  }
  const demo = document.getElementById('demoLoad');
  if (demo) {
    demo.addEventListener('click', async () => {
      demo.disabled = true;
      demo.textContent = t('firstRun.demoWait');
      try {
        await api('system.setup.demo');
        note.innerHTML = '<span class="note-ic">' + icon('check', 15) + '</span>' +
          esc(t('firstRun.demoLoaded', { admin: 'admin.demo', branch: 'ali.ahmed', pass: 'Demo@1234' }));
      } catch (err) {
        demo.disabled = false;
        demo.textContent = t('firstRun.demoBtn');
        note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(errorText(err));
      }
    });
  }
}
