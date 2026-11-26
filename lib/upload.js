const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { bad } = require('./http');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// [mime, ekstensi, cek magic bytes]
const TYPES = [
  ['image/jpeg', 'jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', 'png', (b) => b.subarray(0, 8).equals(PNG)],
  ['image/webp', 'webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];

const m = multer({
  storage: multer.memoryStorage(), // file ditolak tidak pernah menyentuh disk
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 20, fieldSize: 16 * 1024 },
  fileFilter: (req, file, cb) =>
    TYPES.some(([mime]) => mime === file.mimetype) ? cb(null, true) : cb(bad('Gambar harus jpg, png, atau webp.')),
}).single('img');

const upload = (req, res, next) =>
  m(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(bad('Gambar maksimal 2 MB.'));
    if (err.expose) return next(err);
    next(bad('Upload tidak valid.'));
  });

// Mime dari klien dan isi file harus cocok. Nama file dan ekstensi dari klien tidak dipakai.
function saveImage(file) {
  const t = TYPES.find(([mime, , magic]) => mime === file.mimetype && magic(file.buffer));
  if (!t) throw bad('Isi file bukan gambar jpg, png, atau webp yang valid.');
  const name = crypto.randomBytes(16).toString('hex') + '.' + t[1];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer, { flag: 'wx' });
  return '/uploads/' + name;
}

function removeImage(url) {
  const r = /^\/uploads\/([0-9a-f]{32}\.(?:jpg|png|webp))$/.exec(url || '');
  if (r) fs.rmSync(path.join(UPLOAD_DIR, r[1]), { force: true });
}

module.exports = { upload, saveImage, removeImage, UPLOAD_DIR };
