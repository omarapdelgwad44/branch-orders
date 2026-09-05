/**
 * Small UI toolkit: toasts, modals, confirm dialogs, badges, skeletons.
 */
import { icon } from './icons.js';
import { t, fmtNum } from './i18n.js';

export function el(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html.trim();
  return tmp.firstElementChild;
}

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- toasts ---------- */
const toastRoot = () => document.getElementById('toast-root');

export function toast(message, type) {
  const root = toastRoot();
  const node = el(
    '<div class="toast toast-' + (type || 'info') + '" role="status">' +
    '<span class="toast-ic">' + icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'inbox', 16) + '</span>' +
    '<span class="toast-msg">' + esc(message) + '</span></div>'
  );
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

/* ---------- modal ---------- */
const modalRoot = () => document.getElementById('modal-root');
let modalPrevFocus = null;
let modalEscHandler = null;
let modalTrapHandler = null;

function modalFocusables(node) {
  return Array.from(node.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export function openModal({ title, body, footer }) {
  const root = modalRoot();
  closeModal(true);
  modalPrevFocus = document.activeElement;
  const node = el(
    '<div class="modal-backdrop">' +
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title || '') + '">' +
    '<div class="modal-head"><h3>' + esc(title || '') + '</h3>' +
    '<button class="icon-btn" data-close aria-label="' + esc(t('common.close')) + '">' + icon('x', 18) + '</button></div>' +
    '<div class="modal-body">' + body + '</div>' +
    '<div class="modal-foot">' + (footer || '') + '</div>' +
    '</div></div>'
  );
  const focusables = 'button, input, select, textarea, [tabindex]';
  node.querySelector('[data-close]').addEventListener('click', () => closeModal());
  node.addEventListener('click', (e) => {
    if (e.target === node) closeModal();
  });
  modalEscHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', modalEscHandler);
  modalTrapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const items = modalFocusables(node);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  node.addEventListener('keydown', modalTrapHandler);
  root.appendChild(node);
  const first = node.querySelector(focusables);
  if (first) first.focus();
  return node;
}

export function closeModal(silent) {
  const root = modalRoot();
  if (root) root.innerHTML = '';
  if (modalEscHandler) { document.removeEventListener('keydown', modalEscHandler); modalEscHandler = null; }
  modalTrapHandler = null;
  if (!silent && modalPrevFocus && document.contains(modalPrevFocus)) {
    try { modalPrevFocus.focus(); } catch (e) { /* ignore */ }
  }
  modalPrevFocus = null;
}

export function confirmDialog({ title, message, confirmLabel, danger, cancelLabel }) {
  return new Promise((resolve) => {
    const foot =
      '<button class="btn btn-ghost" data-cancel>' + esc(cancelLabel || t('common.cancel')) + '</button>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-ok>' + esc(confirmLabel || t('common.confirm')) + '</button>';
    const node = openModal({
      title,
      body: '<p class="modal-msg">' + esc(message) + '</p>',
      footer: ''
    });
    node.querySelector('.modal-foot').innerHTML = foot;
    const done = (v) => { closeModal(); resolve(v); };
    node.querySelector('[data-ok]').addEventListener('click', () => done(true));
    node.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    node.querySelector('[data-close]').addEventListener('click', () => done(false));
  });
}

/* ---------- status badge ---------- */
export const STATUS_TYPES = {
  draft: 'slate',
  submitted: 'amber',
  approved: 'blue',
  processing: 'violet',
  sent: 'cyan',
  received: 'green',
  partially_received: 'teal',
  shortage_reported: 'red',
  cancelled: 'gray'
};

export function badge(status) {
  const type = STATUS_TYPES[status] || 'slate';
  return '<span class="badge badge-' + type + '"><span class="dot"></span>' + esc(t('status.' + status)) + '</span>';
}

/* ---------- skeletons ---------- */
export function skeletons(count, lines) {
  let html = '';
  for (let i = 0; i < (count || 3); i++) {
    html += '<div class="skeleton-card"><div class="skeleton-line w40"></div>' +
      Array.from({ length: lines || 3 }, (_, j) => '<div class="skeleton-line w' + (j % 2 ? '60' : '90') + '"></div>').join('') +
      '</div>';
  }
  return html;
}

/* ---------- numbers / qty controls ---------- */
export function qtyControl(value, max) {
  const stepper =
    '<div class="qty">' +
    '<button type="button" class="qty-btn" data-q="-1" aria-label="' + esc(t('a11y.decrease')) + '">' + icon('minus', 14) + '</button>' +
    '<input class="qty-val" type="number" inputmode="decimal" min="0" step="any" value="' + esc(value === null || value === undefined || value === '' ? '' : value) + '" aria-label="' + esc(t('a11y.quantity')) + '">' +
    '<button type="button" class="qty-btn" data-q="1" aria-label="' + esc(t('a11y.increase')) + '">' + icon('plus', 14) + '</button>' +
    '</div>';
  return stepper;
}

export function attachQty(root) {
  root.querySelectorAll('.qty').forEach((w) => {
    const input = w.querySelector('.qty-val');
    w.querySelectorAll('.qty-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const cur = parseFloat(input.value);
        const next = (isNaN(cur) ? 0 : cur) + (b.dataset.q === '1' ? 1 : -1);
        input.value = next > 0 ? next : '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });
}

export function numberCell(v, unit) {
  const s = (v === null || v === undefined || v === '') ? t('common.none') : fmtNum(v);
  return '<span class="num">' + s + (unit ? ' <em>' + esc(unit) + '</em>' : '') + '</span>';
}

export function debounce(fn, ms) {
  let tId;
  return (...args) => {
    clearTimeout(tId);
    tId = setTimeout(() => fn(...args), ms);
  };
}

export function fileDownload(name, content, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: (mime || 'text/csv') + ';charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}