/**
 * Stopped-site notice, and the hidden developer key that opens and closes it.
 * The key is not linked from the app. Open it at #/dev.
 */
import { setLang, getLang, t, errorText } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function langButton() {
  return '<button class="lang-pill halt-lang" id="langSwitch" type="button" aria-label="' + esc(t('a11y.switchLanguage')) + '">' +
    icon('globe', 15) + '<span>' + esc(t('lang.toggle')) + '</span></button>';
}

export function renderStopped(app, { onLang }) {
  setLang(getLang());
  app.innerHTML =
    '<main class="halt">' +
      langButton() +
      '<article class="halt-sheet">' +
        '<p class="halt-stamp" aria-hidden="true">' + esc(t('lock.stamp')) + '</p>' +
        '<h1>' + esc(t('lock.title')) + '</h1>' +
        '<p>' + esc(t('lock.message')) + '</p>' +
        '<p class="halt-brand">' + esc(t('app.name')) + '</p>' +
      '</article>' +
    '</main>';
  const btn = document.getElementById('langSwitch');
  if (btn) btn.addEventListener('click', onLang);
}

export function renderDev(app, { locked, onLang, onChanged }) {
  setLang(getLang());
  const stopping = !locked;
  app.innerHTML =
    '<main class="dev-gate">' +
      '<form class="dev-card" id="devForm">' +
        '<div class="dev-card-top">' + langButton() + '</div>' +
        '<h1>' + esc(t('dev.title')) + '</h1>' +
        '<p class="dev-lead">' + esc(t('dev.lead')) + '</p>' +
        '<p class="dev-state' + (locked ? ' is-locked' : '') + '" id="devState">' +
          esc(locked ? t('dev.lockedNow') : t('dev.openNow')) + '</p>' +
        '<div class="dev-alert hidden" id="devAlert" role="alert"></div>' +
        '<label class="field">' +
          '<span class="field-label">' + esc(t('dev.password')) + '</span>' +
          '<input class="input" type="password" name="password" autocomplete="current-password" required autofocus>' +
        '</label>' +
        '<button class="btn ' + (stopping ? 'btn-danger' : 'btn-primary') + ' btn-block" type="submit">' +
          esc(stopping ? t('dev.lock') : t('dev.unlock')) + '</button>' +
        '<a class="dev-back" href="#/login">' + esc(t('dev.back')) + '</a>' +
      '</form>' +
    '</main>';

  const lang = document.getElementById('langSwitch');
  if (lang) lang.addEventListener('click', onLang);

  const form = document.getElementById('devForm');
  const alert = document.getElementById('devAlert');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = new FormData(form).get('password');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    alert.classList.add('hidden');
    try {
      const data = await api('system.maintenance.set', { password: String(password || ''), locked: !locked });
      onChanged(!!(data && data.locked));
    } catch (err) {
      alert.classList.remove('hidden');
      alert.textContent = errorText(err);
      btn.disabled = false;
    }
  });
}
