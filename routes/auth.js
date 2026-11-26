const router = require('express').Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { db, newTag } = require('../db');
const { bad, currentUser } = require('../lib/http');

const num = (k, d) => Number(process.env[k]) || d;
const limit = (max, windowMs, skipOk) =>
  rateLimit({
    windowMs, max, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: skipOk,
    message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
  });
const loginLimit = limit(num('RATE_LOGIN_MAX', 10), 15 * 60e3, true); // hanya percobaan gagal dihitung
const registerLimit = limit(num('RATE_REGISTER_MAX', 5), 3600e3, false);

const COST = 10;
const DUMMY = bcrypt.hashSync('dummy-password', COST); // samakan waktu respons bila akun tidak ada
const str = (v) => (typeof v === 'string' ? v.trim() : '');

router.post('/register', registerLimit, async (req, res, next) => {
  try {
    const username = str(req.body.username);
    const email = str(req.body.email).toLowerCase();
    const password = req.body.password;
    if (!/^[A-Za-z0-9_.]{3,24}$/.test(username)) throw bad('Username 3 sampai 24 karakter: huruf, angka, titik, atau garis bawah.');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw bad('Format email belum benar.');
    if (typeof password !== 'string' || password.length < 8) throw bad('Password minimal 8 karakter.');
    if (Buffer.byteLength(password) > 72) throw bad('Password maksimal 72 byte.');

    const hash = await bcrypt.hash(password, COST);
    try {
      db.prepare('INSERT INTO users (username, email, pass_hash, created_at, tag) VALUES (?, ?, ?, ?, ?)')
        .run(username, email, hash, new Date().toISOString(), newTag());
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw bad('Username atau email sudah dipakai.', 409);
      throw e;
    }
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const { id, password, admin } = req.body;
    if (typeof id !== 'string' || typeof password !== 'string') throw bad('Isi username dan password.');
    const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(id.trim(), id.trim());
    const ok = await bcrypt.compare(password, u ? u.pass_hash : DUMMY);
    if (!u || !ok) throw bad('Username/email atau password salah.', 401);
    // Panel admin minta login admin: server yang memutuskan, sesi tidak dibuat untuk non-admin.
    if (admin === true && u.role !== 'admin') throw bad('Akun ini bukan admin.', 403);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.uid = u.id;
      res.json({ user: { id: u.id, username: u.username, email: u.email, role: u.role, tag: u.tag, status_text: u.status_text } });
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('koga.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Belum masuk.' });
  res.json({ user });
});

module.exports = router;
