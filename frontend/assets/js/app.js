/**
 * App shell + hash router + session gate.
 */
import { setLang, getLang, t } from './i18n.js';
import { getSessionUser, setSessionUser } from './session.js';
import { api, setToken, warmup } from './api.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import * as loginView from './views/login.js';
import * as branchView from './views/branch.js';
import * as adminView from './views/admin.js';

let state = { user: getSessionUser() };

const parseHash = () => {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = h.split('?');
  const parts = pathPart.split('/').filter(String);
  return { parts, query };
};

const match = () => {
  const { parts, query } = parseHash();
  const routes = [
    { re: /^login$/, type: 'login' },
    { re: /^app$/, type: 'branch.dashboard' },
    { re: /^order\/new$/, type: 'branch.new' },
    { re: /^order\/(.+)$/, type: 'branch.detail', id: parts[1] },
    { re: /^orders$/, type: 'branch.history' },
    { re: /^admin$/, type: 'admin.dashboard' },
    { re: /^admin\/orders$/, type: 'admin.orders' },
    { re: /^admin\/orders\/(.+)$/, type: 'admin.order', id: parts[2] },
    { re: /^admin\/branches$/, type: 'admin.branches' },
    { re: /^admin\/users$/, type: 'admin.users' },
    { re: /^admin\/items$/, type: 'admin.items' },
    { re: /^admin\/availability$/, type: 'admin.availability' },
    { re: /^admin\/reports$/, type: 'admin.reports' },
    { re: /^$/, type: 'root' }
  ];
  const full = parts.join('/');
  for (const r of routes) {
    if (r.re.test(full)) return Object.assign({}, r, { source: query });
  }
  return { type: '404' };
};

function sidebarNav(user) {
  if (user.role === 'admin') {
    return [
      ['#/admin', 'nav.adminDashboard', 'dashboard'],
      ['#/admin/orders', 'nav.adminOrders', 'receipt'],
      ['#/admin/branches', 'nav.branches', 'building'],
      ['#/admin/users', 'nav.users', 'users'],
      ['#/admin/items', 'nav.items', 'box'],
      ['#/admin/availability', 'nav.availability', 'layers'],
      ['#/admin/reports', 'nav.reports', 'chart']
    ];
  }
  return [
    ['#/app', 'nav.dashboard', 'dashboard'],
    ['#/order/new', 'nav.newOrder', 'plus'],
    ['#/orders', 'nav.orders', 'receipt']
  ];
}

function isActive(href) {
  const current = location.hash.replace(/^#\/?/, '');
  const target = href.replace(/^#\/?/, '');
  if (target === current) return true;
  if (target === 'admin/orders') return current.indexOf('admin/orders') === 0;
  if (target === 'admin') return current === 'admin';
  if (target === 'app') return current === 'app';
  return false;
}

function renderShell(user) {
  const appRoot = document.getElementById('app');
  const brandMonogram = 'BO';
  const navItems = sidebarNav(user).map(([href, key, ic]) => {
    const active = isActive(href);
    return '<a class="nav-item' + (active ? ' active' : '') + '" href="' + href + '">' +
      '<span class="nav-ic">' + icon(ic, 18) + '</span><span class="nav-label">' + escNav(t(key)) + '</span></a>';
  }).join('');

  appRoot.innerHTML =
    '<div class="shell">' +
    '<div class="backdrop" id="backdrop"></div>' +
    '<aside class="sidebar" id="sidebar" aria-label="' + escNav(t('app.name')) + '">' +
      '<div class="brand">' +
        '<span class="brand-mark">' + brandMonogram + '</span>' +
        '<span class="brand-text"><b>' + escNav(t('app.name')) + '</b><em>' + escNav(t('app.tagline')) + '</em></span>' +
      '</div>' +
      '<nav class="nav" aria-label="' + escNav(t('app.name')) + '">' + navItems + '</nav>' +
      '<div class="side-foot">' +
        '<div class="side-user">' +
          '<span class="avatar">' + escNav((user.full_name || user.username || 'U').slice(0, 1).toUpperCase()) + '</span>' +
          '<span class="side-user-meta"><b>' + escNav(user.full_name || user.username) + '</b>' +
          '<em>' + (user.role === 'admin' ? escNav(t('manage.roleAdmin')) : escNav(user.branch && user.branch.branch_name || '')) + '</em></span>' +
        '</div>' +
        '<button class="side-link" id="btn-lang">' + icon('copy', 15) + ' ' + escNav(t('lang.toggle')) + '</button>' +
        '<button class="side-link danger" id="btn-logout">' + icon('logout', 15) + ' ' + escNav(t('nav.logout')) + '</button>' +
      '</div>' +
    '</aside>' +
    '<div class="main">' +
      '<header class="topbar">' +
        '<button class="icon-btn menu-btn" id="btn-menu" aria-label="' + escNav(t('a11y.menu')) + '" aria-controls="sidebar" aria-expanded="false">' + icon('menu', 20) + '</button>' +
        '<span class="topbar-title" id="topbar-title"></span>' +
        '<div class="topbar-right">' +
          '<button class="icon-btn" id="btn-lang2" aria-label="' + escNav(t('a11y.language')) + '">' + icon('copy', 18) + '</button>' +
          '<button class="icon-btn" id="btn-logout2" aria-label="' + escNav(t('a11y.logout')) + '">' + icon('logout', 18) + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="content" id="view"></div>' +
    '</div>' +
    '</div>';

  document.getElementById('btn-lang').addEventListener('click', toggleLang);
  document.getElementById('btn-lang2').addEventListener('click', toggleLang);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout2').addEventListener('click', logout);
  document.getElementById('btn-menu').addEventListener('click', toggleDrawer);
  document.getElementById('backdrop').addEventListener('click', closeDrawer);
  syncDrawer(false);
}

function isDrawerMode() {
  try {
    if (window.matchMedia) return window.matchMedia('(max-width: 1100px)').matches;
  } catch (e) { /* ignore */ }
  return false;
}

function syncDrawer(open) {
  try {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btn-menu');
    if (!sidebar || !btn) return;
    const isOpen = open !== undefined ? open : document.body.classList.contains('drawer-open');
    if (btn.setAttribute) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isDrawerMode()) {
      if (sidebar.setAttribute) sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      try { if ('inert' in sidebar) sidebar.inert = !isOpen; } catch (e) { /* ignore */ }
    } else {
      if (sidebar.removeAttribute) sidebar.removeAttribute('aria-hidden');
      try { if ('inert' in sidebar) sidebar.inert = false; } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore: minimal DOM stubs */ }
}

function toggleDrawer() {
  const willOpen = !document.body.classList.contains('drawer-open');
  document.body.classList.toggle('drawer-open', willOpen);
  syncDrawer(willOpen);
  if (willOpen) {
    const first = document.querySelector('#sidebar .nav-item, #sidebar button');
    if (first) first.focus();
  }
}

function closeDrawer() {
  try {
    if (!document.body.classList.contains('drawer-open')) { syncDrawer(false); return; }
    document.body.classList.remove('drawer-open');
    syncDrawer(false);
    const btn = document.getElementById('btn-menu');
    const sidebar = btn && document.getElementById('sidebar');
    if (btn && btn.focus && sidebar && sidebar.contains && document.activeElement &&
        sidebar.contains(document.activeElement)) {
      btn.focus();
    }
  } catch (e) { /* ignore: minimal DOM stubs */ }
}

if (typeof window !== 'undefined' && !window.__boDrawerKeys) {
  window.__boDrawerKeys = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
      closeDrawer();
    }
  });
  window.addEventListener('resize', () => {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => syncDrawer());
    else syncDrawer();
  });
}

function toggleLang() {
  setLang(getLang() === 'ar' ? 'en' : 'ar');
  render();
}

function escNav(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function logout() {
  try { await api('auth.logout'); } catch (e) { /* ignore */ }
  setToken('');
  setSessionUser(null);
  state.user = null;
  location.hash = '#/login';
  toast(t('msg.loggedOut'), 'info');
  render();
}

function render() {
  const route = match();
  const app = document.getElementById('app');

  if (!state.user) {
    app.innerHTML = '';
    loginView.render(app, { route, onLogin: (session) => {
      state.user = session.user;
      setSessionUser(session.user);
      setToken(session.token);
      render();
    } });
    return;
  }

  renderShell(state.user);
  const view = document.getElementById('view');

  const user = state.user;
  const adminOnly = ['admin.dashboard', 'admin.orders', 'admin.order', 'admin.branches', 'admin.users', 'admin.items', 'admin.availability', 'admin.reports'];
  if (adminOnly.indexOf(route.type) !== -1 && user.role !== 'admin') {
    location.hash = user.role === 'admin' ? '#/admin' : '#/app';
    return;
  }
  if (['branch.dashboard', 'branch.new', 'branch.detail', 'branch.history'].indexOf(route.type) !== -1 && user.role === 'admin') {
    location.hash = '#/admin';
    return;
  }

  document.getElementById('topbar-title').textContent = pageTitle(route.type, user);

  if (route.type === 'login') { location.hash = user.role === 'admin' ? '#/admin' : '#/app'; return; }
  if (route.type === '404') { view.innerHTML = notFound(); return; }

  if (route.type === 'root') {
    location.hash = user.role === 'admin' ? '#/admin' : '#/app';
    return;
  }

  const ctx = { route, user, state, render };
  if (route.type.startsWith('admin.')) adminView.render(route.type, view, ctx);
  else if (route.type.startsWith('branch.')) branchView.render(route.type, view, ctx);
  enhanceTableWraps(view);
  closeDrawer();
}

function enhanceTableWraps(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.table-wrap, .flow-scroll').forEach((wrapNode) => {
    if (!wrapNode.hasAttribute('tabindex')) wrapNode.setAttribute('tabindex', '0');
    if (!wrapNode.hasAttribute('role')) wrapNode.setAttribute('role', 'region');
  });
}

function pageTitle(type, user) {
  const map = {
    'branch.dashboard': t('nav.dashboard'),
    'branch.new': t('nav.newOrder'),
    'branch.detail': t('order.number'),
    'branch.history': t('nav.orders'),
    'admin.dashboard': t('nav.adminDashboard'),
    'admin.orders': t('nav.adminOrders'),
    'admin.order': t('admin.details'),
    'admin.branches': t('nav.branches'),
    'admin.users': t('nav.users'),
    'admin.items': t('nav.items'),
    'admin.availability': t('nav.availability'),
    'admin.reports': t('nav.reports')
  };
  return map[type] || t('app.name');
}

function notFound() {
  return '<div class="state"><h2>404</h2><p>' + t('common.notFound') + '</p>' +
    '<a class="btn btn-primary" href="#/app">' + t('common.back') + '</a></div>';
}

export function start() {
  setLang(getLang());
  warmup();
  render();
  window.addEventListener('hashchange', render);
}

export { state };

start();