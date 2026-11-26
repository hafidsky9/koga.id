const { db } = require('../db');

// Error yang pesannya aman ditampilkan ke pengguna.
const bad = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

// Tolak request pengubah data bila asalnya bukan situs ini (cookie sesi rentan CSRF).
const extra = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
const csrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    const u = new URL(req.get('origin') || req.get('referer'));
    if (u.host === req.get('host') || extra.has(u.origin)) return next();
  } catch {}
  res.status(403).json({ error: 'Permintaan ditolak: asal tidak valid.' });
};

const currentUser = (req) =>
  req.session && req.session.uid
    ? db.prepare('SELECT id, username, email, role, tag, status_text FROM users WHERE id = ?').get(req.session.uid)
    : undefined;

const requireAdmin = (req, res, next) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Belum masuk.' });
  if (u.role !== 'admin') return res.status(403).json({ error: 'Khusus admin.' });
  req.user = u;
  next();
};

module.exports = { bad, csrf, currentUser, requireAdmin };
