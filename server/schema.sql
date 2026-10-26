PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_login_at TEXT,
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
  next_service TEXT,
  tuv TEXT,
  insurance TEXT NOT NULL DEFAULT '',
  acquired TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  notes TEXT NOT NULL DEFAULT '',
  image_file TEXT,
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
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at > start_at),
  CHECK (start_km IS NULL OR start_km >= 0),
  CHECK (end_km IS NULL OR end_km >= 0)
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_time ON bookings (vehicle_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_time ON bookings (driver_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_costs_date ON costs (date);
CREATE INDEX IF NOT EXISTS idx_costs_vehicle ON costs (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance (due_date);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
