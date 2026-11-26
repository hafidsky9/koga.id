const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcrypt');

const secret = process.env.SESSION_SECRET || '';
if (secret.length < 32) {
  console.error('SESSION_SECRET wajib diisi di .env, minimal 32 karakter. Buat dengan: openssl rand -hex 32');
  process.exit(1);
}

const { db, newTag } = require('./db');
const { UPLOAD_DIR } = require('./lib/upload');
const SqliteStore = require('./lib/store');
const { csrf } = require('./lib/http');

// data/ dan uploads/ harus bisa ditulis oleh user di dalam kontainer (uid 1000).
for (const d of [path.dirname(db.name), UPLOAD_DIR]) {
  try { fs.accessSync(d, fs.constants.W_OK); } catch {
    console.error(`Folder ${d} tidak bisa ditulis. Di STB jalankan: sudo chown -R 1000:1000 data uploads`);
    process.exit(1);
  }
}

// Admin pertama dari env, hanya bila belum ada admin.
function ensureAdmin() {
  const { ADMIN_USER: u, ADMIN_PASS: p } = process.env;
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return;
  if (!u || !p) return console.warn('Belum ada admin. Isi ADMIN_USER dan ADMIN_PASS di .env lalu start ulang.');
  if (!/^[A-Za-z0-9_.]{3,24}$/.test(u) || p.length < 8 || Buffer.byteLength(p) > 72) {
    return console.error('ADMIN_USER/ADMIN_PASS tidak valid (username 3-24 karakter, password 8-72 byte). Admin tidak dibuat.');
  }
  try {
    db.prepare("INSERT INTO users (username, pass_hash, role, created_at, tag) VALUES (?, ?, 'admin', ?, ?)")
      .run(u, bcrypt.hashSync(p, 10), new Date().toISOString(), newTag());
    console.log(`Admin "${u}" dibuat.`);
  } catch (e) {
    console.error('Admin tidak dibuat:', e.message);
  }
}
ensureAdmin();

// CSP ketat tanpa 'unsafe-inline' untuk skrip: blok <script>/<style> inline di public/ diizinkan lewat hash.
const PUBLIC = path.join(__dirname, 'public');
const hashes = { script: [], style: [] };
for (const f of fs.readdirSync(PUBLIC).filter((n) => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\r\n?/g, '\n');
  for (const m of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    hashes[m[1].toLowerCase()].push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
  }
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...hashes.script],
      styleSrc: ["'self'", ...hashes.style],
      styleSrcAttr: ["'unsafe-inline'"], // atribut style="" dipakai luas di tampilan
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '10kb' }));
const store = new SqliteStore();
const sessionParser = session({
  name: 'koga.sid',
  secret,
  store,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 3600 * 1000 },
});
app.use(sessionParser);
app.use('/api', csrf);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/social'));
app.use(require('./routes/voice-qr'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan.' }));

// Gambar dilayani sebagai berkas statis, tidak pernah dieksekusi.
app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false, dotfiles: 'deny', maxAge: '7d', immutable: true,
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; sandbox"),
}));

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use(express.static(PUBLIC, { dotfiles: 'ignore' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Data yang dikirim tidak valid.' });
  }
  if (err.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server.' });
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, '0.0.0.0', () => console.log(`Koga jalan di port ${port}`));
require('./lib/realtime').attach(server, sessionParser, store);
