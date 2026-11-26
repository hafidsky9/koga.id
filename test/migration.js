// Fixture skema v1 persis dari tahap 1, bukan database produksi.
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
module.exports = check => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'koga-migrate-'));
  const filename=path.join(dir,'koga.db');
  try {
    const old=new Database(filename);
    old.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), created_at TEXT NOT NULL);
      CREATE TABLE content (id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('artikel','streaming','esports','patch')),title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',img TEXT NOT NULL DEFAULT '',date TEXT NOT NULL,game TEXT,tour TEXT,ta TEXT,tb TEXT,
      sa INTEGER,sb INTEGER,st TEXT CHECK(st IS NULL OR st IN ('akan','live','selesai')),bo TEXT);
      CREATE INDEX content_type_date ON content(type,date);
      CREATE TABLE sessions(sid TEXT PRIMARY KEY,sess TEXT NOT NULL,expires INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    old.prepare('INSERT INTO users(id,username,email,pass_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(42,'akunlama','lama@example.test','hash-lama','admin','2026-01-01');
    old.prepare('INSERT INTO content(id,type,title,body,date) VALUES(?,?,?,?,?)').run(7,'artikel','Judul lama','Isi lama','2026-01-01');
    old.prepare('INSERT INTO sessions VALUES(?,?,?)').run('sesi-lama','{"uid":42}',Date.now()+86400000);
    old.close();
    const migrate=()=>{const r=spawnSync(process.execPath,['-e',"const {db}=require('./db');db.close()"],{cwd:path.join(__dirname,'..'),env:{...process.env,DATA_DIR:dir},encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
    migrate();const migrated=new Database(filename);const u=migrated.prepare('SELECT * FROM users WHERE id=?').get(42);
    assert.equal(u.username,'akunlama');assert.equal(u.pass_hash,'hash-lama');assert.equal(u.role,'admin');assert.match(u.tag,/^\d{7}$/);assert.equal(u.status_text,'');
    assert.equal(migrated.prepare('SELECT body FROM content WHERE id=?').get(7).body,'Isi lama');
    assert.equal(migrated.prepare('SELECT sess FROM sessions WHERE sid=?').get('sesi-lama').sess,'{"uid":42}');
    assert.equal(migrated.pragma('user_version',{simple:true}),2);assert.equal(migrated.pragma('journal_mode',{simple:true}),'wal');
    assert.deepEqual(migrated.pragma('foreign_key_check'),[]);migrated.close();
    migrate();const reopened=new Database(filename);assert.equal(reopened.prepare('SELECT tag FROM users WHERE id=?').get(42).tag,u.tag);reopened.close();
    check('Tahap 2: migrasi v1 → v2 menjaga akun, hash, konten, sesi, tag tetap setelah restart, WAL',true);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
};
