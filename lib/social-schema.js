const { randomInt } = require('crypto');

// Dipanggil dalam transaksi migrasi, serta sebelum INSERT user baru (satu proses SQLite).
function newTag(db) {
  const exists = db.prepare('SELECT 1 FROM users WHERE tag = ?');
  for (let i = 0; i < 1000; i++) {
    const tag = String(randomInt(1000000, 10000000));
    if (!exists.get(tag)) return tag;
  }
  throw Error('Ruang tag hampir habis.');
}

const schema = `
ALTER TABLE users ADD COLUMN tag TEXT;
ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX users_tag ON users(tag);
CREATE TABLE friend_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, CHECK(from_id <> to_id)
);
CREATE UNIQUE INDEX requests_pair ON friend_requests(min(from_id,to_id), max(from_id,to_id));
CREATE INDEX requests_to ON friend_requests(to_id,id);
CREATE INDEX requests_from ON friend_requests(from_id,id);
CREATE TABLE friends (
 user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, PRIMARY KEY(user_a,user_b), CHECK(user_a < user_b)
);
CREATE INDEX friends_b ON friends(user_b,user_a);
CREATE TABLE dm_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 reply_to INTEGER REFERENCES dm_messages(id) ON DELETE SET NULL,
 mentions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
 CHECK(sender_id <> recipient_id)
);
CREATE INDEX dm_pair_id ON dm_messages(sender_id,recipient_id,id);
CREATE INDEX dm_recipient_id ON dm_messages(recipient_id,sender_id,id);
CREATE TABLE servers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('friends','community')),
 template TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE members (
 server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, PRIMARY KEY(server_id,user_id)
);
CREATE INDEX members_user ON members(user_id,server_id);
CREATE TABLE channels (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text','voice')),
 category TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
 UNIQUE(server_id,category,name)
);
CREATE INDEX channels_server ON channels(server_id,position,id);
CREATE TABLE messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
 mentions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE INDEX messages_channel_id ON messages(channel_id,id);
CREATE TABLE reactions (
 message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(message_id,user_id)
);
CREATE TABLE dm_reactions (
 message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(message_id,user_id)
);
CREATE TABLE reads (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 last_msg_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,channel_id)
);`;
const tagConstraints = `
CREATE TRIGGER users_tag_insert BEFORE INSERT ON users
WHEN NEW.tag IS NULL OR length(NEW.tag) <> 7 OR NEW.tag GLOB '*[^0-9]*'
BEGIN SELECT RAISE(ABORT,'Tag wajib 7 digit'); END;
CREATE TRIGGER users_tag_update BEFORE UPDATE OF tag ON users
WHEN NEW.tag IS NULL OR length(NEW.tag) <> 7 OR NEW.tag GLOB '*[^0-9]*'
BEGIN SELECT RAISE(ABORT,'Tag wajib 7 digit'); END;`;
function migrateSocial(db) {
  db.exec(schema);
  const update = db.prepare('UPDATE users SET tag = ? WHERE id = ?');
  // Batch agar migrasi akun lama tidak memuat seluruh tabel ke RAM.
  const batch = db.prepare('SELECT id FROM users WHERE tag IS NULL ORDER BY id LIMIT 500');
  let rows;
  while ((rows = batch.all()).length) for (const row of rows) update.run(newTag(db), row.id);
  db.exec(tagConstraints);
}
module.exports = { migrateSocial, newTag, schema, tagConstraints };
