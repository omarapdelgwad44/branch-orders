/**
 * Activity log port of ActivityService.gs.
 */
import { SheetsRepo, Ids } from './store.js';
import { nowIso } from './constants.js';

function log(actorUserId, action, entityType, entityId, details) {
  var repo = SheetsRepo.repo('Activity_Log').ensure();
  repo.insert({
    log_id: Ids.logId(),
    actor_user_id: actorUserId || '',
    action: action,
    entity_type: entityType || '',
    entity_id: entityId || '',
    details_json: details ? JSON.stringify(details).slice(0, 4000) : '{}',
    created_at: nowIso()
  });
  return true;
}

function recent(limit) {
  var rows = SheetsRepo.repo('Activity_Log').readAll().reverse();
  return rows.slice(0, limit || 50).map(function (r) {
    var d = {};
    try { d = JSON.parse(r.details_json || '{}'); } catch (e) { d = {}; }
    return {
      log_id: r.log_id,
      actor_user_id: r.actor_user_id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      details: d,
      created_at: r.created_at
    };
  });
}

export var Activity = { log: log, recent: recent };