const router = require('express').Router();
const { db, COLS } = require('../db');
const { bad, requireAdmin } = require('../lib/http');
const { upload, saveImage, removeImage } = require('../lib/upload');

const TYPES = ['artikel', 'streaming', 'esports', 'patch'];
const STATUS = ['akan', 'live', 'selesai'];
const get = (id) => db.prepare(`SELECT ${COLS} FROM content WHERE id = ?`).get(id);

const text = (b, k, max, label) => {
  // Browser mengirim baris baru textarea sebagai CRLF; simpan sebagai LF.
  const v = typeof b[k] === 'string' ? b[k].replace(/\r\n?/g, '\n').trim() : '';
  if (v.length > max) throw bad(`${label} maksimal ${max} karakter.`);
  return v;
};
const score = (b, k, label) => {
  const v = typeof b[k] === 'string' ? b[k].trim() : '';
  if (v === '') return 0;
  if (!/^\d{1,3}$/.test(v)) throw bad(`${label} harus angka 0 sampai 999.`);
  return Number(v);
};

// Validasi di server; aturan klien hanya kemudahan, bukan pengaman.
function parse(b) {
  if (!TYPES.includes(b.type)) throw bad('Jenis konten tidak valid.');
  const v = {
    type: b.type,
    title: text(b, 'title', 120, 'Judul'),
    body: text(b, 'desc', 2000, 'Deskripsi'),
    date: null,
    game: null, tour: null, ta: null, tb: null, sa: null, sb: null, st: null, bo: null,
  };
  if (!v.title) throw bad('Judul wajib diisi.');
  if (b.date) {
    const t = Date.parse(b.date);
    if (Number.isNaN(t)) throw bad('Tanggal tidak valid.');
    v.date = new Date(t).toISOString();
  }
  if (v.type === 'esports') {
    v.game = text(b, 'game', 60, 'Game');
    v.tour = text(b, 'tour', 60, 'Turnamen');
    v.ta = text(b, 'ta', 60, 'Tim A');
    v.tb = text(b, 'tb', 60, 'Tim B');
    v.bo = text(b, 'bo', 40, 'Format');
    if (!v.game) throw bad('Game wajib diisi.');
    if (!v.ta || !v.tb) throw bad('Nama Tim A dan Tim B wajib diisi.');
    v.sa = score(b, 'sa', 'Skor A');
    v.sb = score(b, 'sb', 'Skor B');
    v.st = b.st === undefined || b.st === '' ? 'akan' : b.st;
    if (!STATUS.includes(v.st)) throw bad('Status tidak valid.');
  }
  return v;
}

router.use(requireAdmin); // sebelum multer: request tanpa hak tidak sempat membawa file

router.get('/content', (req, res) => {
  res.json({ items: db.prepare(`SELECT ${COLS} FROM content ORDER BY date DESC, id DESC LIMIT 500`).all() });
});

router.post('/content', upload, (req, res) => {
  const v = parse(req.body || {});
  const img = req.file ? saveImage(req.file) : '';
  try {
    const r = db.prepare(
      `INSERT INTO content (type, title, body, img, date, game, tour, ta, tb, sa, sb, st, bo)
       VALUES (@type, @title, @body, @img, @date, @game, @tour, @ta, @tb, @sa, @sb, @st, @bo)`
    ).run({ ...v, img, date: v.date || new Date().toISOString() });
    res.status(201).json(get(r.lastInsertRowid));
  } catch (e) {
    removeImage(img);
    throw e;
  }
});

router.put('/content/:id', upload, (req, res) => {
  const old = /^\d{1,9}$/.test(req.params.id) && get(req.params.id);
  if (!old) throw bad('Konten tidak ditemukan.', 404);
  const v = parse(req.body || {});
  const img = req.file ? saveImage(req.file) : old.img;
  try {
    db.prepare(
      `UPDATE content SET type=@type, title=@title, body=@body, img=@img, date=@date, game=@game, tour=@tour,
         ta=@ta, tb=@tb, sa=@sa, sb=@sb, st=@st, bo=@bo WHERE id=@id`
    ).run({ ...v, img, date: v.date || old.date, id: old.id });
  } catch (e) {
    if (req.file) removeImage(img);
    throw e;
  }
  if (req.file) removeImage(old.img);
  res.json(get(old.id));
});

router.delete('/content/:id', (req, res) => {
  const old = /^\d{1,9}$/.test(req.params.id) && get(req.params.id);
  if (!old) throw bad('Konten tidak ditemukan.', 404);
  db.prepare('DELETE FROM content WHERE id = ?').run(old.id);
  removeImage(old.img);
  res.json({ ok: true });
});

module.exports = router;
