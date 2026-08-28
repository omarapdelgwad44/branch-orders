/**
 * Unified login view. The role is detected on the server; the UI simply
 * follows the authenticated role to the right dashboard.
 */
import { setLang, getLang, t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { isConfigured, isLocalMode } from '../config.js';

export function render(app, { onLogin }) {
  setLang(getLang());
  app.innerHTML = layout();
  bind(app, onLogin);
  checkStatus(app);
}

function layout() {
  const langBtn = '<button class="lang-pill" id="langSwitch" type="button">' +
    '<span class="lang-dot"></span>' + t('lang.toggle') + '</button>';
  return (
    '<div class="login">' +
    '<aside class="login-hero">' +
      '<div class="hero-glow"></div>' +
      '<div class="hero-grid"></div>' +
      '<div class="hero-inner">' +
        '<div class="hero-brand">' +
          '<span class="brand-mark light">BO</span>' +
          '<span class="brand-text"><b>' + esc(t('app.name')) + '</b><em>' + esc(t('app.tagline')) + '</em></span>' +
        '</div>' +
        '<div class="hero-copy">' +
          '<h1>' + esc(t('login.brandHero')) + '</h1>' +
          '<p>' + esc(t('login.brandSub')) + '</p>' +
          '<div class="hero-stats">' +
            '<div class="hero-stat"><b>' + esc(t('login.stat.order')) + '</b><em>' + esc(t('login.stat.track')) + '</em></div>' +
            '<div class="hero-stat"><b>' + esc(t('login.stat.track')) + '</b><em>' + esc(t('login.stat.receive')) + '</em></div>' +
            '<div class="hero-stat"><b>' + esc(t('login.stat.receive')) + '</b><em>' + esc(t('login.stat.order')) + '</em></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</aside>' +
    '<main class="login-panel">' +
      '<div class="login-card">' +
        '<div class="login-card-top">' + langBtn + '</div>' +
        '<h2>' + esc(t('login.welcome')) + '</h2>' +
        '<p class="login-sub">' + esc(t('login.subtitle')) + '</p>' +
        '<div class="login-alert hidden" id="loginAlert" role="alert"></div>' +
        '<form id="loginForm" novalidate>' +
          '<label class="field">' +
            '<span class="field-label">' + esc(t('login.username')) + '</span>' +
            '<input class="input" type="text" name="username" autocomplete="username" required autofocus>' +
          '</label>' +
          '<label class="field">' +
            '<span class="field-label">' + esc(t('login.password')) + '</span>' +
            '<input class="input" type="password" name="password" autocomplete="current-password" required>' +
          '</label>' +
          '<button class="btn btn-primary btn-block btn-lg" type="submit">' +
            t('login.submit') + '</button>' +
        '</form>' +
        '<div class="login-note" id="loginNote"></div>' +
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      showAlert(alertBox, t('login.empty') || 'Please enter your credentials.', false);
      return;
    }
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const session = await api('auth.login', { username, password });
      onLogin(session);
    } catch (err) {
      showAlert(alertBox, err.message || t('msg.error'), false);
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}

async function checkStatus(app) {
  const note = document.getElementById('loginNote');
  if (!note) return;
  try {
    const status = await api('system.status');
    if (status.needsSetup) {
      if (isLocalMode() && status.sheetsReady !== false) {
        note.innerHTML = firstRunCard();
        bindFirstRun(note);
      } else {
        note.innerHTML = '<span class="note-ic">' + icon('ghost', 15) + '</span>' +
          esc(t('firstRun.text'));
      }
    }
  } catch (err) {
    if (err.code === 'setup_error') {
      note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' +
        esc(t('setupError.text'));
    } else if (err.code === 'network') {
      note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(err.message);
    }
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
        note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(err.message || t('msg.error'));
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
        note.innerHTML = '<span class="note-ic">' + icon('alert', 15) + '</span>' + esc(err.message || t('msg.error'));
      }
    });
  }
}