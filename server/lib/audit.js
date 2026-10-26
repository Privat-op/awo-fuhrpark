'use strict';

function writeAudit(db, { userId = null, action, entityType, entityId = null, details = null }) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, entityType, entityId, details ? JSON.stringify(details) : null);
  } catch (error) {
    console.warn('Audit-Log konnte nicht geschrieben werden:', error.message);
  }
}

module.exports = { writeAudit };
