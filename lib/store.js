const session = require('express-session');
const { db } = require('../db');

// Penyimpan sesi di SQLite: login tetap hidup setelah restart, tanpa dependency baru.
const WEEK = 7 * 24 * 3600 * 1000;
const q = {
  get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
  set: db.prepare(
    `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
     ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
  ),
  del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  gc: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
};

class SqliteStore extends session.Store {
  constructor() {
    super();
    setInterval(() => q.gc.run(Date.now()), 3600e3).unref();
  }
  get(sid, cb) {
    try {
      const r = q.get.get(sid, Date.now());
      cb(null, r ? JSON.parse(r.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + WEEK;
      q.set.run(sid, JSON.stringify(sess), exp);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { q.del.run(sid); this.emit('session:destroy', sid); cb(null); } catch (e) { cb(e); }
  }
}

module.exports = SqliteStore;
