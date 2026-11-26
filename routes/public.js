const router = require('express').Router();
const { db, COLS } = require('../db');
const { bad } = require('../lib/http');

const TYPES = ['artikel', 'streaming', 'esports', 'patch'];
const STATUS = ['akan', 'live', 'selesai'];
const qs = (req, k) => (typeof req.query[k] === 'string' ? req.query[k] : '');
const list = (sql, params) => ({ items: db.prepare(sql).all(...params) });

router.get('/feed', (req, res) => {
  const type = qs(req, 'type');
  if (type && !TYPES.includes(type)) throw bad('Jenis konten tidak valid.');
  res.json(list(
    `SELECT ${COLS} FROM content ${type ? 'WHERE type = ?' : ''} ORDER BY date DESC, id DESC LIMIT 50`,
    type ? [type] : []
  ));
});

router.get('/games', (req, res) => {
  const rows = db.prepare(
    `SELECT game FROM content WHERE type = 'esports' AND game <> '' GROUP BY game COLLATE NOCASE ORDER BY game COLLATE NOCASE`
  ).all();
  res.json({ items: rows.map((r) => r.game) });
});

router.get('/tournaments', (req, res) => {
  const game = qs(req, 'game');
  const rows = db.prepare(
    `SELECT tour FROM content WHERE type = 'esports' AND tour <> '' ${game ? 'AND game = ? COLLATE NOCASE' : ''}
     GROUP BY tour COLLATE NOCASE ORDER BY tour COLLATE NOCASE`
  ).all(...(game ? [game] : []));
  res.json({ items: rows.map((r) => r.tour) });
});

router.get('/matches', (req, res) => {
  const where = [`type = 'esports'`], params = [];
  if (qs(req, 'game')) { where.push('game = ? COLLATE NOCASE'); params.push(qs(req, 'game')); }
  if (qs(req, 'tour')) { where.push('tour = ? COLLATE NOCASE'); params.push(qs(req, 'tour')); }
  const sts = qs(req, 'status').split(',').filter(Boolean);
  if (sts.some((s) => !STATUS.includes(s))) throw bad('Status tidak valid.');
  if (sts.length) { where.push(`st IN (${sts.map(() => '?').join(',')})`); params.push(...sts); }
  const dir = sts.length && sts.every((s) => s === 'selesai') ? 'DESC' : 'ASC'; // hasil: terbaru dulu, jadwal: terdekat dulu
  res.json(list(`SELECT ${COLS} FROM content WHERE ${where.join(' AND ')} ORDER BY date ${dir}, id ${dir} LIMIT 100`, params));
});

router.get('/content/:id', (req, res) => {
  const item = /^\d{1,9}$/.test(req.params.id) && db.prepare(`SELECT ${COLS} FROM content WHERE id = ?`).get(req.params.id);
  if (!item) throw bad('Konten tidak ditemukan.', 404);
  res.json(item);
});

module.exports = router;
