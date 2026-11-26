const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateSocial, newTag } = require('./lib/social-schema');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'koga.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tiap item = satu migrasi. Urutan tidak boleh diubah, hanya ditambah di akhir.
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     email TEXT UNIQUE COLLATE NOCASE,
     pass_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
     created_at TEXT NOT NULL
   );
   CREATE TABLE content (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL CHECK (type IN ('artikel','streaming','esports','patch')),
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     img TEXT NOT NULL DEFAULT '',
     date TEXT NOT NULL,
     game TEXT, tour TEXT, ta TEXT, tb TEXT,
     sa INTEGER, sb INTEGER,
     st TEXT CHECK (st IS NULL OR st IN ('akan','live','selesai')),
     bo TEXT
   );
   CREATE INDEX content_type_date ON content (type, date);
   CREATE TABLE sessions (
     sid TEXT PRIMARY KEY,
     sess TEXT NOT NULL,
     expires INTEGER NOT NULL
   );`,
  migrateSocial,
];

const ver = db.pragma('user_version', { simple: true });
for (let v = ver; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    const migration = MIGRATIONS[v];
    if (typeof migration === 'function') migration(db); else db.exec(migration);
    db.pragma(`user_version = ${v + 1}`);
  })();
}

// Kolom konten yang dikirim ke klien. "desc" kata kunci SQL, jadi kolomnya "body".
const COLS = 'id, type, title, body AS "desc", img, date, game, tour, ta, tb, sa, sb, st, bo';

module.exports = { db, COLS, DATA_DIR, newTag: () => newTag(db) };
