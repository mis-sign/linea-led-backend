const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'linea.db'));
db.pragma('journal_mode = WAL');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT UNIQUE NOT NULL,
    warranty_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    contact_email TEXT,
    site_address TEXT,
    issue_reported TEXT NOT NULL,
    photo1_path TEXT,
    photo2_path TEXT,
    photo3_path TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    gps_lat TEXT,
    gps_lng TEXT,
    in_warranty INTEGER DEFAULT 0,
    warranty_match_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warranties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warranty_id TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    branch_name TEXT,
    contact_number TEXT,
    contact_person_name TEXT,
    email TEXT,
    site_address TEXT,
    city_name TEXT,
    pin_code TEXT,
    registration_status TEXT,
    product_name TEXT,
    product_type TEXT,
    sku_name TEXT,
    brand TEXT,
    warranty_months INTEGER DEFAULT 12,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Lightweight migration for warranties created with older schema
const wcols = db.prepare("PRAGMA table_info(warranties)").all().map(c => c.name);
const wAdd = (name, def) => { if (!wcols.includes(name)) db.exec(`ALTER TABLE warranties ADD COLUMN ${name} ${def}`); };
wAdd('contact_person_name', 'TEXT');
wAdd('email', 'TEXT');
wAdd('city_name', 'TEXT');
wAdd('pin_code', 'TEXT');
wAdd('registration_status', 'TEXT');
wAdd('product_name', 'TEXT');
wAdd('product_type', 'TEXT');
wAdd('sku_name', 'TEXT');
wAdd('brand', 'TEXT');

// Lightweight migration for installs created with the older schema
const cols = db.prepare("PRAGMA table_info(complaints)").all().map(c => c.name);
if (!cols.includes('gps_lat')) db.exec('ALTER TABLE complaints ADD COLUMN gps_lat TEXT');
if (!cols.includes('gps_lng')) db.exec('ALTER TABLE complaints ADD COLUMN gps_lng TEXT');
if (!cols.includes('in_warranty')) db.exec('ALTER TABLE complaints ADD COLUMN in_warranty INTEGER DEFAULT 0');
if (!cols.includes('warranty_match_note')) db.exec('ALTER TABLE complaints ADD COLUMN warranty_match_note TEXT');

module.exports = db;
