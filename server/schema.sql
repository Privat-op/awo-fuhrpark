PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cost_centers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  permission_overrides TEXT NOT NULL DEFAULT '{}',
  object_permissions TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  color_mode TEXT CHECK (color_mode IN ('light', 'dark', 'auto')),
  last_login_at TEXT,
  deactivated_at TEXT,
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  object_permissions TEXT NOT NULL DEFAULT '{}',
  booking_request_policy TEXT NOT NULL DEFAULT '{"allow":[],"deny":[]}',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plate TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('Pkw', 'Transporter', 'Bus')),
  fuel TEXT NOT NULL CHECK (fuel IN ('Diesel', 'Benzin', 'Elektro', 'Hybrid')),
  seats INTEGER NOT NULL DEFAULT 5 CHECK (seats > 0),
  location TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance')),
  mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  blocked_reason TEXT NOT NULL DEFAULT '',
  next_service TEXT,
  tuv TEXT,
  insurance TEXT NOT NULL DEFAULT '',
  acquired TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  notes TEXT NOT NULL DEFAULT '',
  image_file TEXT,
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  leasing_start TEXT,
  leasing_end TEXT,
  leasing_start_km INTEGER,
  leasing_km_limit INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '["B"]',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'away')),
  color TEXT NOT NULL DEFAULT '#2563eb',
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  own_trips_access INTEGER NOT NULL DEFAULT 1 CHECK (own_trips_access IN (0, 1)),
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'canceled')),
  start_km INTEGER,
  end_km INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at > start_at),
  CHECK (start_km IS NULL OR start_km >= 0),
  CHECK (end_km IS NULL OR end_km >= 0)
);

CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'canceled')),
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS maintenance (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  workshop TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('open', 'planned', 'done')),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS costs (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  receipt_file TEXT,
  receipt_name TEXT,
  receipt_mime TEXT,
  receipt_size INTEGER,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  org_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'awo' CHECK (theme IN ('awo', 'neutral')),
  brand_name TEXT,
  logo_file TEXT,
  accent_color TEXT NOT NULL DEFAULT '#0f766e',
  sidebar_style TEXT NOT NULL DEFAULT 'dark' CHECK (sidebar_style IN ('dark', 'light')),
  page_background TEXT NOT NULL DEFAULT '#f4f5f7',
  surface_color TEXT NOT NULL DEFAULT '#ffffff',
  text_color TEXT NOT NULL DEFAULT '#191c23',
  muted_color TEXT NOT NULL DEFAULT '#737a88',
  border_color TEXT NOT NULL DEFAULT '#e7e9ee',
  default_color_mode TEXT NOT NULL DEFAULT 'light' CHECK (default_color_mode IN ('light', 'dark', 'auto')),
  auto_anonymize_days INTEGER NOT NULL DEFAULT 0,
  audit_retention_days INTEGER NOT NULL DEFAULT 0,
  session_retention_days INTEGER NOT NULL DEFAULT 0,
  password_reset_retention_days INTEGER NOT NULL DEFAULT 0,
  notification_retention_days INTEGER NOT NULL DEFAULT 0,
  seeded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, alert_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  actor_role_id TEXT,
  actor_role_name TEXT,
  actor_rank INTEGER,
  is_meta INTEGER NOT NULL DEFAULT 0 CHECK (is_meta IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  totp_confirmed_at TEXT,
  totp_last_used_step INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  batch_id TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sso (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT 'Passkey',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS passkey_attempts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS smtp_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587,
  secure INTEGER NOT NULL DEFAULT 0 CHECK (secure IN (0, 1)),
  username TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'email',
  vehicle_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  format TEXT NOT NULL DEFAULT 'generic' CHECK (format IN ('generic', 'teams', 'discord', 'slack')),
  events TEXT NOT NULL DEFAULT '[]',
  secret_enc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sso_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sso_enabled IN (0, 1)),
  sso_issuer TEXT NOT NULL DEFAULT '',
  sso_client_id TEXT NOT NULL DEFAULT '',
  sso_client_secret_enc TEXT,
  sso_redirect_uri TEXT NOT NULL DEFAULT '',
  sso_scopes TEXT NOT NULL DEFAULT 'openid profile email',
  sso_allowed_domains TEXT NOT NULL DEFAULT '',
  sso_auto_provision INTEGER NOT NULL DEFAULT 0 CHECK (sso_auto_provision IN (0, 1)),
  sso_default_role TEXT NOT NULL DEFAULT 'user',
  sso_group_claim TEXT NOT NULL DEFAULT 'groups',
  sso_admin_group TEXT NOT NULL DEFAULT '',
  sso_manager_group TEXT NOT NULL DEFAULT '',
  teams_enabled INTEGER NOT NULL DEFAULT 0 CHECK (teams_enabled IN (0, 1)),
  teams_webhook_enc TEXT,
  teams_send_leasing INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_leasing IN (0, 1)),
  teams_send_booking_requests INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_booking_requests IN (0, 1)),
  teams_send_maintenance INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_maintenance IN (0, 1)),
  clamav_enabled INTEGER NOT NULL DEFAULT 0 CHECK (clamav_enabled IN (0, 1)),
  clamav_host TEXT NOT NULL DEFAULT '127.0.0.1',
  clamav_port INTEGER NOT NULL DEFAULT 3310,
  clamav_fail_closed INTEGER NOT NULL DEFAULT 1 CHECK (clamav_fail_closed IN (0, 1)),
  webauthn_rp_id TEXT NOT NULL DEFAULT '',
  webauthn_rp_name TEXT NOT NULL DEFAULT '',
  webauthn_origin TEXT NOT NULL DEFAULT '',
  webauthn_enabled INTEGER NOT NULL DEFAULT 1 CHECK (webauthn_enabled IN (0, 1)),
  locations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (locations_enabled IN (0, 1)),
  app_base_url TEXT NOT NULL DEFAULT '',
  leasing_scheduler_enabled INTEGER NOT NULL DEFAULT 1 CHECK (leasing_scheduler_enabled IN (0, 1)),
  leasing_interval_ms INTEGER NOT NULL DEFAULT 21600000,
  leasing_initial_delay_ms INTEGER NOT NULL DEFAULT 5000,
  leasing_debounce_ms INTEGER NOT NULL DEFAULT 3000,
  reminder_scheduler_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminder_scheduler_enabled IN (0, 1)),
  reminder_interval_ms INTEGER NOT NULL DEFAULT 21600000,
  reminder_initial_delay_ms INTEGER NOT NULL DEFAULT 5000,
  retention_scheduler_enabled INTEGER NOT NULL DEFAULT 1 CHECK (retention_scheduler_enabled IN (0, 1)),
  retention_interval_ms INTEGER NOT NULL DEFAULT 86400000,
  retention_initial_delay_ms INTEGER NOT NULL DEFAULT 10000,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_time ON bookings (vehicle_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_time ON bookings (driver_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_booking_requests_requester ON booking_requests (requested_by, created_at);
CREATE INDEX IF NOT EXISTS idx_booking_requests_vehicle ON booking_requests (vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_requests_driver ON booking_requests (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_costs_date ON costs (date);
CREATE INDEX IF NOT EXISTS idx_costs_vehicle ON costs (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance (due_date);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries (status, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa (totp_enabled);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes (user_id, used_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sso_subject ON user_sso (issuer, subject);
