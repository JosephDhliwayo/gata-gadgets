const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const dbPath = process.env.GATA_DB_PATH || path.join(__dirname, 'gata.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  clock_in_id TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  active INTEGER NOT NULL DEFAULT 1,
  commission_rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  cost_price REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  cash_received REAL,
  change_due REAL,
  receivable_status TEXT CHECK(receivable_status IN ('outstanding','cleared')),
  cleared_at TEXT,
  cleared_by INTEGER REFERENCES users(id),
  courier_destination TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK(type IN ('restock','correction','damage','return')),
  quantity_change INTEGER NOT NULL,
  note TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS return_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS return_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_request_id INTEGER NOT NULL REFERENCES return_requests(id),
  receipt_item_id INTEGER NOT NULL REFERENCES receipt_items(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  posted_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL CHECK(event IN ('login','logout')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS ecocash_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  note TEXT,
  withdrawn_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS courier_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  note TEXT,
  collected_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);

CREATE TABLE IF NOT EXISTS discount_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  discount_amount REAL NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours'))
);
`);

// Migration: add commission_rate to users if upgrading from an older schema
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('commission_rate')) {
  db.exec('ALTER TABLE users ADD COLUMN commission_rate REAL NOT NULL DEFAULT 0');
}
if (!userColumns.includes('clock_in_id')) {
  db.exec('ALTER TABLE users ADD COLUMN clock_in_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clock_in_id ON users(clock_in_id)');

// Backfill any user (e.g. from before Clock-in IDs existed) with a generated unique one.
const usersMissingClockInId = db.prepare('SELECT id FROM users WHERE clock_in_id IS NULL OR clock_in_id = \'\'').all();
if (usersMissingClockInId.length > 0) {
  const setClockInId = db.prepare('UPDATE users SET clock_in_id = ? WHERE id = ?');
  for (const u of usersMissingClockInId) {
    setClockInId.run(String(u.id).padStart(3, '0'), u.id);
  }
}

// Migration: add customer_id to receipts if upgrading from an older schema
const receiptColumns = db.prepare("PRAGMA table_info(receipts)").all().map(c => c.name);
if (!receiptColumns.includes('customer_id')) {
  db.exec('ALTER TABLE receipts ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
}
if (!receiptColumns.includes('cash_received')) {
  db.exec('ALTER TABLE receipts ADD COLUMN cash_received REAL');
}
if (!receiptColumns.includes('change_due')) {
  db.exec('ALTER TABLE receipts ADD COLUMN change_due REAL');
}
if (!receiptColumns.includes('receivable_status')) {
  db.exec('ALTER TABLE receipts ADD COLUMN receivable_status TEXT');
}
if (!receiptColumns.includes('cleared_at')) {
  db.exec('ALTER TABLE receipts ADD COLUMN cleared_at TEXT');
}
if (!receiptColumns.includes('cleared_by')) {
  db.exec('ALTER TABLE receipts ADD COLUMN cleared_by INTEGER REFERENCES users(id)');
}
if (!receiptColumns.includes('courier_destination')) {
  db.exec('ALTER TABLE receipts ADD COLUMN courier_destination TEXT');
}

// Migration: chat moved from a single admin-inbox thread per user to real peer-to-peer messaging.
// The old table's conversation_user_id column is NOT NULL, which SQLite can't relax via ALTER TABLE,
// so rebuild the table outright — there's no chat history from the old model worth preserving.
const chatColumns = db.prepare("PRAGMA table_info(chat_messages)").all().map(c => c.name);
if (chatColumns.includes('conversation_user_id')) {
  db.exec(`
    DROP TABLE chat_messages;
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      recipient_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+2 hours')),
      read_at TEXT
    );
  `);
}

// Seed default admin user on first run
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('Admin@123', 10);
  db.prepare(
    'INSERT INTO users (name, email, clock_in_id, password, role) VALUES (?, ?, ?, ?, ?)'
  ).run('System Administrator', 'admin@gatagadgets.com', '001', hash, 'admin');
  console.log('============================================');
  console.log(' GATA GADGETS - default admin account created');
  console.log(' Clock-in ID: 001');
  console.log(' password:    Admin@123');
  console.log(' Please log in and change this password (via Manage Users) immediately.');
  console.log('============================================');
}

module.exports = db;
