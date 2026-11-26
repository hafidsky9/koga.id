// Smoke test: menjalankan server nyata dengan DB sementara, lalu menembak API lewat HTTP.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koga-smoke-'));
const UP = path.join(tmp, 'uploads');
const ADMIN = { u: 'boss', p: 'rahasia-admin-1' };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);

let fails = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${!cond && extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`);
  if (!cond) fails++;
};

// Satu "browser": cookie jar sendiri.
const client = () => {
  let cookie = '';
  const call = async (method, url, { json, form, origin = BASE, raw } = {}) => {
    const headers = {};
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    if (json) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers, body: json ? JSON.stringify(json) : form, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) cookie = c.split(';')[0].endsWith('=') ? '' : c.split(';')[0];
    const type = r.headers.get('content-type') || '';
    const data = raw ? Buffer.from(await r.arrayBuffer()) : type.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data, headers: r.headers };
  };
  call.cookie = () => cookie;
  return call;
};

const fd = (fields, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append('img', new Blob([file.buf], { type: file.type }), file.name || 'x.png');
  return f;
};

async function main() {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT, DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: UP,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_USER: ADMIN.u, ADMIN_PASS: ADMIN.p,
      RATE_LOGIN_MAX: '5', RATE_REGISTER_MAX: '50',
      BASE_URL: BASE, STUN_URL: 'stun:stun.l.google.com:19302', TURN_URL: 'turn:turn.example:3478', TURN_SECRET: 'smoke-turn-secret',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
      if (i > 50) throw new Error('server tidak naik');
      await new Promise((r) => setTimeout(r, 100));
    }

    const anon = client(), user = client(), admin = client();

    // --- Header keamanan
    const page = await anon('GET', '/');
    const csp = page.headers.get('content-security-policy') || '';
    check('halaman utama dilayani dengan CSP tanpa unsafe-inline untuk skrip', page.status === 200 && /script-src 'self' 'sha256-/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp);

    // --- CSRF
    check('POST tanpa Origin ditolak', (await anon('POST', '/api/login', { json: { id: 'a', password: 'b' }, origin: null })).status === 403);
    check('POST dengan Origin asing ditolak', (await anon('POST', '/api/login', { json: { id: 'a', password: 'b' }, origin: 'http://evil.example' })).status === 403);

    // --- Register
    const reg = (o) => anon('POST', '/api/register', { json: { username: 'budi', email: 'budi@mail.id', password: 'password123', ...o } });
    check('register valid', (await reg()).status === 201);
    check('register ganda ditolak (409)', (await reg()).status === 409);
    check('register password < 8 ditolak', (await reg({ username: 'budi2', email: 'b2@mail.id', password: 'short' })).status === 400);
    check('register email salah ditolak', (await reg({ username: 'budi3', email: 'bukan-email' })).status === 400);
    check('register username tidak valid ditolak', (await reg({ username: 'a b', email: 'b4@mail.id' })).status === 400);

    // --- Login user
    check('login password salah ditolak (401)', (await user('POST', '/api/login', { json: { id: 'budi', password: 'salah-salah' } })).status === 401);
    const li = await user('POST', '/api/login', { json: { id: 'budi@mail.id', password: 'password123' } });
    check('login user via email', li.status === 200 && li.data.user.role === 'user' && !('pass_hash' in li.data.user), li.data);
    const me = await user('GET', '/api/me');
    check('/api/me mengembalikan user', me.status === 200 && me.data.user.username === 'budi', me.data);

    // --- Hak akses admin
    check('anonim ditolak di /api/admin (401)', (await anon('GET', '/api/admin/content')).status === 401);
    check('user biasa ditolak GET /api/admin/content (403)', (await user('GET', '/api/admin/content')).status === 403);
    check('user biasa ditolak POST /api/admin/content (403)', (await user('POST', '/api/admin/content', { form: fd({ type: 'artikel', title: 'x' }) })).status === 403);
    check('user biasa ditolak PUT /api/admin/content/1 (403)', (await user('PUT', '/api/admin/content/1', { form: fd({ type: 'artikel', title: 'x' }) })).status === 403);
    check('user biasa ditolak DELETE /api/admin/content/1 (403)', (await user('DELETE', '/api/admin/content/1')).status === 403);
    const ua = client();
    const uadm = await ua('POST', '/api/login', { json: { id: 'budi', password: 'password123', admin: true } });
    check('login panel admin dengan akun user ditolak (403) dan tanpa sesi', uadm.status === 403 && (await ua('GET', '/api/me')).status === 401, uadm.data);

    // --- Login admin
    const la = await admin('POST', '/api/login', { json: { id: ADMIN.u, password: ADMIN.p, admin: true } });
    check('login admin lolos', la.status === 200 && la.data.user.role === 'admin', la.data);

    // --- Konten
    const make = (fields, file) => admin('POST', '/api/admin/content', { form: fd(fields, file) });
    const a1 = await make({ type: 'artikel', title: 'Event <b>Baru</b>', desc: 'Isi lengkap artikel.' });
    check('admin buat artikel', a1.status === 201 && a1.data.id && a1.data.desc === 'Isi lengkap artikel.', a1.data);
    check('esports tanpa tim ditolak', (await make({ type: 'esports', title: 'M1', game: 'Valorant' })).status === 400);
    check('esports tanpa game ditolak', (await make({ type: 'esports', title: 'M1', ta: 'A', tb: 'B' })).status === 400);
    check('jenis konten asing ditolak', (await make({ type: 'hack', title: 'x' })).status === 400);
    const m1 = await make({ type: 'esports', title: 'Final', game: 'Valorant', tour: 'Liga Koga', ta: 'Alfa', tb: 'Beta', sa: '2', sb: '1', st: 'selesai', bo: 'Best Of 3' });
    const m2 = await make({ type: 'esports', title: 'Semi', game: 'Valorant', tour: 'Liga Koga', ta: 'Gama', tb: 'Delta', st: 'akan', bo: 'Best Of 5' });
    check('admin buat pertandingan esports', m1.status === 201 && m1.data.sa === 2 && m1.data.st === 'selesai' && m2.status === 201, [m1.data, m2.data]);

    // --- Upload
    const bad = async (name, file, expect = 400) => {
      const r = await make({ type: 'artikel', title: 'Gambar' }, file);
      check(`upload ditolak: ${name}`, r.status === expect, r.data);
    };
    await bad('teks menyamar png', { buf: Buffer.from('ini bukan gambar'), type: 'image/png', name: 'a.png' });
    await bad('png asli tapi mime text/plain', { buf: PNG, type: 'text/plain', name: 'a.png' });
    await bad('jpeg diklaim png', { buf: JPG, type: 'image/png', name: 'a.png' });
    await bad('skrip html menyamar jpg', { buf: Buffer.from('<script>alert(1)</script>'), type: 'image/jpeg', name: 'a.jpg' });
    await bad('lebih dari 2 MB', { buf: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), type: 'image/png', name: 'big.png' });
    check('tidak ada file tersisa dari upload yang ditolak', !fs.existsSync(UP) || fs.readdirSync(UP).length === 0, fs.existsSync(UP) && fs.readdirSync(UP));

    const up = await make({ type: 'patch', title: 'Patch 1.2', desc: 'Catatan.' }, { buf: PNG, type: 'image/png', name: '../../evil.php' });
    check('upload png valid diterima, nama acak', up.status === 201 && /^\/uploads\/[0-9a-f]{32}\.png$/.test(up.data.img), up.data);
    const file1 = path.join(UP, path.basename(up.data.img));
    const served = await anon('GET', up.data.img, { raw: true });
    check('gambar dilayani sebagai image/png dengan nosniff', served.status === 200 && served.headers.get('content-type') === 'image/png' && served.headers.get('x-content-type-options') === 'nosniff');
    check('path traversal di /uploads ditolak', (await anon('GET', '/uploads/..%2fdata%2fkoga.db', { raw: true })).status !== 200);
    const w = await make({ type: 'streaming', title: 'Live' }, { buf: WEBP, type: 'image/webp', name: 'a.webp' });
    check('upload webp valid diterima', w.status === 201 && w.data.img.endsWith('.webp'), w.data);

    // ganti gambar -> file lama terhapus
    const put = await admin('PUT', `/api/admin/content/${up.data.id}`, { form: fd({ type: 'patch', title: 'Patch 1.2b', desc: 'Catatan.' }, { buf: JPG, type: 'image/jpeg', name: 'b.jpg' }) });
    check('PUT mengganti gambar dan menghapus file lama', put.status === 200 && put.data.img.endsWith('.jpg') && !fs.existsSync(file1), put.data);
    const put2 = await admin('PUT', `/api/admin/content/${up.data.id}`, { form: fd({ type: 'patch', title: 'Patch 1.2c', desc: 'Catatan.' }) });
    check('PUT tanpa file mempertahankan gambar', put2.status === 200 && put2.data.img === put.data.img, put2.data);
    const file2 = path.join(UP, path.basename(put.data.img));
    const del = await admin('DELETE', `/api/admin/content/${up.data.id}`);
    check('DELETE menghapus konten dan filenya', del.status === 200 && !fs.existsSync(file2) && (await anon('GET', `/api/content/${up.data.id}`)).status === 404);
    check('PUT id tak ada -> 404', (await admin('PUT', '/api/admin/content/99999', { form: fd({ type: 'artikel', title: 'x' }) })).status === 404);

    // Perilaku browser: input file kosong tetap terkirim sebagai bagian dengan filename kosong, dan textarea memakai CRLF.
    const B = '----koga' + crypto.randomBytes(6).toString('hex');
    const part = (n, v, file) => `--${B}\r\nContent-Disposition: form-data; name="${n}"${file ? '; filename=""' : ''}\r\n${file ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n${v}\r\n`;
    const raw = part('type', 'artikel') + part('title', 'Dari browser') + part('desc', 'satu\r\ndua') + part('img', '', true) + `--${B}--\r\n`;
    const rb = await fetch(BASE + '/api/admin/content', {
      method: 'POST', headers: { Origin: BASE, Cookie: admin.cookie(), 'Content-Type': `multipart/form-data; boundary=${B}` }, body: raw,
    });
    check('file kosong dari browser tidak dianggap upload; CRLF jadi LF', rb.status === 201 && (await rb.json()).desc === 'satu\ndua');

    // --- API publik
    const feed = await anon('GET', '/api/feed');
    check('feed mengembalikan konten', feed.status === 200 && feed.data.items.length >= 4 && feed.data.items.some((i) => i.title === 'Event <b>Baru</b>'), feed.data);
    check('feed?type=artikel hanya artikel', (await anon('GET', '/api/feed?type=artikel')).data.items.every((i) => i.type === 'artikel'));
    check('feed?type asing ditolak', (await anon('GET', '/api/feed?type=x')).status === 400);
    check('games', JSON.stringify((await anon('GET', '/api/games')).data.items) === '["Valorant"]');
    check('tournaments?game=', JSON.stringify((await anon('GET', '/api/tournaments?game=valorant')).data.items) === '["Liga Koga"]');
    const done = await anon('GET', '/api/matches?game=Valorant&status=selesai');
    const next = await anon('GET', '/api/matches?game=Valorant&tour=Liga%20Koga&status=akan,live');
    check('matches status selesai / akan terpisah', done.data.items.length === 1 && done.data.items[0].ta === 'Alfa' && next.data.items.length === 1 && next.data.items[0].ta === 'Gama', [done.data, next.data]);
    check('matches status asing ditolak', (await anon('GET', '/api/matches?status=foo')).status === 400);
    check("SQL injection di query tidak merusak", (await anon('GET', "/api/matches?game=' OR 1=1 --")).data.items.length === 0);
    const one = await anon('GET', `/api/content/${a1.data.id}`);
    check('content/:id', one.status === 200 && one.data.title === 'Event <b>Baru</b>', one.data);
    check('content/:id tak valid -> 404', (await anon('GET', '/api/content/abc')).status === 404);

    // --- Tahap 2 (seluruh skenario tahap 1 tetap dijalankan)
    require('./migration')(check);
    await require('./social')({ BASE, client, user, anon, admin, check });

    await require('./voice-qr')({ BASE, client, user, anon, admin, check });

    // --- Logout
    check('logout', (await user('POST', '/api/logout')).status === 200 && (await user('GET', '/api/me')).status === 401);

    // --- Rate limit login (terakhir, supaya tidak mengganggu tes lain)
    let limited = false;
    for (let i = 0; i < 10 && !limited; i++) {
      limited = (await anon('POST', '/api/login', { json: { id: 'budi', password: 'salah-salah' } })).status === 429;
    }
    check('rate limit login aktif (429)', limited);
  } finally {
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} tes GAGAL` : '\nSemua tes lolos');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
