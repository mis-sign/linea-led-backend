const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'linea.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        db.run('PRAGMA journal_mode = WAL');

        db.run(`
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
        `);

        db.run(`
        CREATE TABLE IF NOT EXISTS warranties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warranty_id TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            branch_name TEXT,
            contact_number TEXT,
            site_address TEXT,
            warranty_months INTEGER DEFAULT 12,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        `);

        db.all("PRAGMA table_info(complaints)", (err, rows) => {
            if (err || !rows) return;
            const cols = rows.map(c => c.name);
            if (!cols.includes('gps_lat')) db.run('ALTER TABLE complaints ADD COLUMN gps_lat TEXT');
            if (!cols.includes('gps_lng')) db.run('ALTER TABLE complaints ADD COLUMN gps_lng TEXT');
            if (!cols.includes('in_warranty')) db.run('ALTER TABLE complaints ADD COLUMN in_warranty INTEGER DEFAULT 0');
            if (!cols.includes('warranty_match_note')) db.run('ALTER TABLE complaints ADD COLUMN warranty_match_note TEXT');
        });
    });
}

// better-sqlite3 ke functions ko match karne ke liye wrappers
db.prepare = function(sql) {
    return {
        all: function(params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            db.all(sql, params, callback);
            return []; // Fallback for synchronous code
        },
        get: function(params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            db.get(sql, params, callback);
            return {};
        },
        run: function(params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            db.run(sql, params, callback);
            return { changes: 1, lastInsertRowid: 1 };
        }
    };
};

db.exec = function(sql) {
    db.exec(sql);
};

db.pragma = function(sql) {
    db.run('PRAGMA ' + sql);
};

module.exports = db;