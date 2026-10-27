'use strict';

const { normalizePermissions, parsePermissions } = require('./permissions');

const AUDIT_SCHEMA_VERSION = 3;

function ensureAuditColumns(db) {
  const columns = db.prepare('PRAGMA table_info(audit_logs)').all();
  if (!columns.length) return;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('actor_role_id')) db.exec('ALTER TABLE audit_logs ADD COLUMN actor_role_id TEXT');
  if (!names.has('actor_role_name')) db.exec('ALTER TABLE audit_logs ADD COLUMN actor_role_name TEXT');
  if (!names.has('actor_rank')) db.exec('ALTER TABLE audit_logs ADD COLUMN actor_rank INTEGER');
  if (!names.has('is_meta')) db.exec('ALTER TABLE audit_logs ADD COLUMN is_meta INTEGER NOT NULL DEFAULT 0');
}

function ensureAuditIndexes(db) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs (user_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_rank_created ON audit_logs (actor_rank, created_at)');
}

function backfillAuditSnapshots(db) {
  db.exec(`
    UPDATE audit_logs
    SET
      actor_role_id = (SELECT u.role FROM users u WHERE u.id = audit_logs.user_id),
      actor_role_name = (
        SELECT r.name FROM users u JOIN roles r ON r.id = u.role WHERE u.id = audit_logs.user_id
      ),
      actor_rank = (
        SELECT r.rank FROM users u JOIN roles r ON r.id = u.role WHERE u.id = audit_logs.user_id
      )
    WHERE user_id IS NOT NULL
      AND actor_role_id IS NULL
      AND actor_role_name IS NULL
      AND actor_rank IS NULL
  `);
}

function grantManagerAuditViewOnce(db) {
  const manager = db.prepare('SELECT id, permissions FROM roles WHERE id = ?').get('manager');
  if (!manager) return;
  const permissions = new Set(parsePermissions(manager.permissions));
  permissions.add('audit_view');
  db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
    .run(JSON.stringify(normalizePermissions([...permissions])), manager.id);
}

function migrateAuditSchema(db) {
  ensureAuditColumns(db);
  ensureAuditIndexes(db);

  const schemaVersion = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    backfillAuditSnapshots(db);
    if (schemaVersion < AUDIT_SCHEMA_VERSION) grantManagerAuditViewOnce(db);
  })();
  if (schemaVersion < AUDIT_SCHEMA_VERSION) {
    db.pragma(`user_version = ${AUDIT_SCHEMA_VERSION}`);
    return true;
  }
  return false;
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  migrateAuditSchema
};
