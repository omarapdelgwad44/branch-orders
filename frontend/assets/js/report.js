/**
 * Printable order report (shared by branch + admin views).
 *
 * Browser-compatible printing: the report is rendered into the dedicated
 * #report-root container and printed with window.print() using print-only
 * CSS. "Download" sets the document title to the order number so the
 * browser's "Save as PDF" destination produces a meaningful filename.
 * No PDF library or backend service is used (see limitation note below).
 */
import { t, fmtDate, fmtNum } from './i18n.js';
import { icon } from './icons.js';
import { esc, badge, openModal, closeModal, toast } from './ui.js';

/**
 * Printing permissions:
 * - admins may print any order they are authorized to view
 *   (the detail API already enforces this; a failed fetch means no report).
 * - branch users may print only orders of their own branch.
 */
export function canPrintReport(user, order) {
  if (!user || !order) return false;
  if (user.role === 'admin') return true;
  return String(order.branch_id || '') === String(user.branch_id || '');
}

function totals(order) {
  let req = 0, appr = 0, sent = 0, recv = 0, short = 0;
  (order.items || []).forEach((it) => {
    req += Number(it.requested_quantity) || 0;
    appr += Number(it.approved_quantity) || 0;
    sent += Number(it.sent_quantity) || 0;
    recv += Number(it.received_quantity) || 0;
    short += Number(it.shortage_quantity) || 0;
  });
  return { req, appr, sent, recv, short };
}

function metaRow(label, value) {
  return '<div class="rep-meta"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
}

/**
 * Full report markup. Requested / approved / sent / received / shortage are
 * always rendered as separate columns — approved never overwrites requested.
 * Admin-only notes are included only when forAdmin is true.
 */
export function buildReportHtml(order, opts) {
  const forAdmin = !!(opts && opts.forAdmin);
  const tt = totals(order);
  const showReceiver = ['sent', 'partially_received', 'shortage_reported', 'received'].indexOf(order.status) !== -1;

  const head =
    '<div class="rep-head"><div><div class="rep-app">' + esc(t('app.name')) + '</div>' +
    '<h2>' + esc(t('report.title')) + ' · <span class="mono">' + esc(order.order_number || order.order_id) + '</span></h2></div>' +
    '<div class="rep-status">' + badge(order.status) + '</div></div>';

  const meta =
    '<div class="rep-block"><div class="rep-grid">' +
    metaRow(t('report.branch'), (order.branch_name || '') + (order.branch_code ? ' · ' + order.branch_code : '')) +
    metaRow(t('order.status'), t('status.' + order.status)) +
    metaRow(t('order.createdAt'), fmtDate(order.created_at)) +
    metaRow(t('order.submittedAt'), fmtDate(order.submitted_at)) +
    metaRow(t('order.sentAt'), fmtDate(order.sent_at)) +
    metaRow(t('order.receivedAt'), fmtDate(order.received_at)) +
    '</div></div>';

  const items =
    '<div class="rep-block"><table class="rep-tbl"><thead><tr>' +
    '<th>' + esc(t('manage.itemName')) + '</th>' +
    '<th>' + esc(t('order.requested')) + '</th>' +
    '<th>' + esc(t('order.approved')) + '</th>' +
    '<th>' + esc(t('order.sent')) + '</th>' +
    '<th>' + esc(t('order.received')) + '</th>' +
    '<th>' + esc(t('order.shortage')) + '</th>' +
    '<th>' + esc(t('order.shortageReason')) + '</th>' +
    '</tr></thead><tbody>' +
    (order.items || []).map((it) =>
      '<tr><td><b>' + esc(it.item_name) + '</b>' +
      (it.item_code ? '<div class="rep-sub">' + esc(it.item_code) + '</div>' : '') + '</td>' +
      '<td>' + fmtNum(it.requested_quantity) + '</td>' +
      '<td>' + (it.approved_quantity === null || it.approved_quantity === undefined || it.approved_quantity === '' ? esc(t('common.none')) : fmtNum(it.approved_quantity)) + '</td>' +
      '<td>' + (it.sent_quantity === null || it.sent_quantity === undefined || it.sent_quantity === '' ? esc(t('common.none')) : fmtNum(it.sent_quantity)) + '</td>' +
      '<td>' + (it.received_quantity === null || it.received_quantity === undefined || it.received_quantity === '' ? esc(t('common.none')) : fmtNum(it.received_quantity)) + '</td>' +
      '<td>' + (it.shortage_quantity === null || it.shortage_quantity === undefined || it.shortage_quantity === '' ? esc(t('common.none')) : fmtNum(it.shortage_quantity)) + '</td>' +
      '<td>' + esc(it.shortage_reason || '') + '</td></tr>'
    ).join('') +
    '<tr class="rep-total"><td><b>' + esc(t('report.totals')) + '</b></td>' +
    '<td><b>' + fmtNum(tt.req) + '</b></td><td><b>' + fmtNum(tt.appr) + '</b></td>' +
    '<td><b>' + fmtNum(tt.sent) + '</b></td><td><b>' + fmtNum(tt.recv) + '</b></td>' +
    '<td><b>' + fmtNum(tt.short) + '</b></td><td></td></tr>' +
    '</tbody></table></div>';

  let notes = '';
  if (order.notes) notes += '<div class="rep-note"><b>' + esc(t('order.notes')) + '</b><p>' + esc(order.notes) + '</p></div>';
  if (forAdmin && order.admin_notes) notes += '<div class="rep-note"><b>' + esc(t('order.adminNotes')) + '</b><p>' + esc(order.admin_notes) + '</p></div>';
  if (order.cancel_reason) notes += '<div class="rep-note"><b>' + esc(t('order.cancelReason')) + '</b><p>' + esc(order.cancel_reason) + '</p></div>';
  if (notes) notes = '<div class="rep-block">' + notes + '</div>';

  const sigs =
    '<div class="rep-signs">' +
    '<div class="rep-sign"><span>' + esc(t('report.accountant')) + '</span></div>' +
    '<div class="rep-sign"><span>' + esc(t('report.stamp')) + '</span></div>' +
    (showReceiver ? '<div class="rep-sign"><span>' + esc(t('report.receiver')) + '</span></div>' : '') +
    '</div>';

  return '<div class="report" dir="auto">' + head + meta + items + notes + sigs + '</div>';
}

function fillPrintRoot(html) {
  const root = document.getElementById('report-root');
  if (root) root.innerHTML = html;
}

export function printReport(order, opts) {
  fillPrintRoot(buildReportHtml(order, opts));
  window.print();
}

/**
 * Download limitation: without adding a PDF library or backend service,
 * a real .pdf byte download cannot be generated safely in this static
 * frontend. "Download report" therefore opens the same print flow with the
 * document title set to the order number, so choosing "Save as PDF" in the
 * browser dialog saves a correctly named PDF. The CSV export is untouched.
 */
export function downloadReport(order, opts) {
  const prev = document.title;
  try { document.title = 'Order-' + (order.order_number || order.order_id); } catch (e) { /* ignore */ }
  fillPrintRoot(buildReportHtml(order, opts));
  toast(t('report.savePdfHint'), 'info');
  window.print();
  try { document.title = prev; } catch (e) { /* ignore */ }
}

export function reportButtonsHtml() {
  return '<button class="btn btn-ghost" id="reportPrint">' + icon('printer', 15) + ' ' + esc(t('report.print')) + '</button>' +
    '<button class="btn btn-ghost" id="reportDownload">' + icon('download', 15) + ' ' + esc(t('report.download')) + '</button>';
}

export function bindReportButtons(order, opts) {
  const p = document.getElementById('reportPrint');
  if (p) p.addEventListener('click', () => printReport(order, opts));
  const d = document.getElementById('reportDownload');
  if (d) d.addEventListener('click', () => downloadReport(order, opts));
}

export function openReportModal(order, opts) {
  const node = openModal({ title: t('report.title'), body: buildReportHtml(order, opts), footer: '' });
  node.querySelector('.modal-foot').innerHTML =
    '<button class="btn btn-ghost" data-cancel>' + esc(t('common.close')) + '</button>' + reportButtonsHtml();
  node.querySelector('[data-cancel]').addEventListener('click', closeModal);
  bindReportButtons(order, opts);
  return node;
}
