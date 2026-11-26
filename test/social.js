// Skenario integrasi tahap 2. Dijalankan dari smoke.js dengan server dan DB sementara yang sama.
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function socket(base, cookie, origin = base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { Cookie: cookie, Origin: origin }, handshakeTimeout: 3000 });
    const inbox = [];
    ws.on('message', b => inbox.push(JSON.parse(b)));
    ws.on('error', reject);
    ws.once('open', () => resolve({ ws, inbox,
      send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
      async wait(type, predicate = () => true) {
        for (let i = 0; i < 150; i++) {
          const n = inbox.findIndex(e => e.type === type && predicate(e));
          if (n >= 0) return inbox.splice(n, 1)[0];
          await sleep(20);
        }
        throw Error('Tidak menerima ' + type + ': ' + JSON.stringify(inbox));
      },
    }));
  });
}
module.exports = async ({ BASE, client, user, anon, admin, check }) => {
  const other = client();
  const post = (c, url, json) => c('POST', '/api' + url, { json });
  const get = (c, url) => c('GET', '/api' + url);
  const status = async (p, code) => { const r = await p; assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
  const ok = name => check('Tahap 2: ' + name, true);
  const sockets = [];
  try {
    await status(post(anon, '/register', { username: 'sari', email: 'sari@mail.id', password: 'password123' }), 201);
    const a = (await status(get(user, '/me'), 200)).user;
    const b = (await status(post(other, '/login', { id: 'sari', password: 'password123' }), 200)).user;
    assert.match(a.tag, /^\d{7}$/); assert.match(b.tag, /^\d{7}$/); assert.notEqual(a.tag, b.tag);
    await status(get(anon, '/friends'), 401); await status(get(anon, '/templates'), 401);
    await assert.rejects(socket(BASE, '', BASE)); await assert.rejects(socket(BASE, user.cookie(), 'http://evil.example'));
    ok('tag unik 7 digit, login REST dan Origin/cookie WS wajib');
    const A = await socket(BASE, user.cookie()); sockets.push(A.ws);
    const B = await socket(BASE, other.cookie()); sockets.push(B.ws);
    const C = await socket(BASE, admin.cookie()); sockets.push(C.ws);
    await status(get(user, `/dms/${b.id}/messages`), 403);
    A.send('message.send', { dmUserId: b.id, body: 'tanpa teman', requestId: 'notfriend' });
    assert.equal((await A.wait('error', e => e.requestId === 'notfriend')).status, 403);
    await status(post(user, '/friends/request', { tag: '#' + a.tag }), 400);
    await status(post(user, '/friends/request', { tag: '#' + b.tag }), 201);
    await B.wait('friend.request');
    const req = (await status(get(other, '/friends/requests'), 200)).items[0];
    await status(post(user, `/friends/requests/${req.id}/accept`, {}), 404);
    await status(post(other, `/friends/requests/${req.id}/accept`, {}), 200);
    assert.equal((await status(get(user, '/friends'), 200)).groups.online[0].id, b.id);
    ok('permintaan teman realtime, hanya penerima dapat menerima, relasi dua arah');
    await status(post(other, '/me/status', { status_text: 'Bermain - Koga' }), 200);
    await A.wait('presence.update', e => e.userId === b.id && e.presence === 'in_game');
    B.send('presence.set', { state: 'idle' });
    await A.wait('presence.update', e => e.userId === b.id && e.presence === 'idle');
    assert.equal(C.inbox.some(e => e.type === 'presence.update'), false);
    ok('presence game/idle hanya ke teman');
    A.send('message.send', { dmUserId: b.id, body: '  halo @sari  ', requestId: 'dm1' });
    const dm = (await B.wait('message.new', e => e.scope === 'dm')).message;
    assert.equal(dm.body, 'halo @sari'); assert.deepEqual(dm.mentions, ['sari']);
    assert.equal((await status(get(other, `/dms/${a.id}/messages`), 200)).items[0].id, dm.id);
    assert.equal((await status(get(other, '/dms'), 200)).items[0].body, dm.body);
    ok('DM realtime, trim, mention disimpan, histori dan daftar DM');
    const tpl = (await status(get(user, '/templates'), 200)).items;
    assert.ok(tpl.length >= 3);
    const server = await status(post(user, '/servers', { name: 'Server tes', template: tpl[0].id, kind: 'friends' }), 201);
    const channels = (await status(get(user, `/servers/${server.id}/channels`), 200)).items;
    const ch = channels.find(c => c.type === 'text'); assert.ok(ch);
    await status(get(other, `/servers/${server.id}/channels`), 403);
    await status(get(other, `/channels/${ch.id}/messages`), 403);
    B.send('message.send', { channelId: ch.id, body: 'intruder', requestId: 'intruder' });
    assert.equal((await B.wait('error', e => e.requestId === 'intruder')).status, 403);
    await status(post(other, '/servers/join', { code: server.code }), 200);
    await status(post(other, `/servers/${server.id}/channels`, { name: 'x', type: 'text', category: 'Umum' }), 403);
    await status(post(user, `/servers/${server.id}/channels`, { name: 'baru', type: 'text', category: 'Umum' }), 201);
    ok('template, buat server, join kode, non-anggota ditolak baca/kirim, kanal owner-only');
    A.send('message.send', { channelId: ch.id, body: 'realtime', requestId: 'channel1' });
    const m = (await B.wait('message.new', e => e.scope === 'channel')).message;
    assert.equal(m.body, 'realtime');
    assert.equal((await status(get(other, '/servers'), 200)).items[0].unread, 1);
    B.send('reaction.toggle', { messageId: m.id });
    assert.equal((await A.wait('reaction.update')).count, 1);
    C.send('reaction.toggle', { messageId: m.id, requestId: 'badreact' });
    assert.equal((await C.wait('error', e => e.requestId === 'badreact')).status, 403);
    B.send('message.send', { channelId: ch.id, body: 'balas', replyTo: m.id });
    const reply = (await A.wait('message.new', e => e.message.body === 'balas')).message;
    assert.equal(reply.reply_to, m.id);
    B.send('read.mark', { channelId: ch.id, lastMsgId: reply.id, requestId: 'read' });
    await B.wait('ack', e => e.requestId === 'read');
    assert.equal((await status(get(other, '/servers'), 200)).items[0].unread, 0);
    assert.equal((await status(get(other, `/channels/${ch.id}/messages?before=${reply.id}&limit=1`), 200)).items[0].id, m.id);
    assert.equal(C.inbox.some(e => e.type === 'message.new'), false);
    ok('pesan channel realtime, reply, reaksi, unread/read, cursor pagination, non-anggota tidak menerima');
    await sleep(1050);
    A.send('message.send', { channelId: ch.id, body: 'x'.repeat(2001), requestId: 'long' });
    assert.equal((await A.wait('error', e => e.requestId === 'long')).status, 400);
    A.send('message.send', { channelId: ch.id, body: '   ', requestId: 'empty' });
    assert.equal((await A.wait('error', e => e.requestId === 'empty')).status, 400);
    await sleep(1050);
    for (let i = 0; i < 6; i++) A.send('message.send', { channelId: ch.id, body: 'burst ' + i, requestId: 'burst' + i });
    assert.equal((await A.wait('error', e => e.requestId === 'burst5')).status, 429);
    assert.equal((await status(get(other, `/channels/${ch.id}/messages`), 200)).items.filter(x => x.body.startsWith('burst ')).length, 5);
    ok('pesan kosong/panjang ditolak dan batas 5 pesan/detik');
    await status(user('DELETE', `/api/friends/${b.id}`), 200);
    await status(get(other, `/dms/${a.id}/messages`), 403);
    ok('hapus teman mencabut izin membaca DM');
    await status(post(user, '/friends/request', { tag: b.tag }), 201);
    const declined = (await status(get(other, '/friends/requests'), 200)).items[0];
    await status(post(other, `/friends/requests/${declined.id}/decline`, {}), 200);
    assert.equal((await status(get(other, '/friends/requests'), 200)).items.length, 0);
    await status(get(other, `/dms/${a.id}/messages`), 403);
    ok('tolak permintaan tidak membuat relasi teman');
    await status(other('POST', '/api/logout'), 200);
    for (let i = 0; i < 100 && B.ws.readyState !== WebSocket.CLOSED; i++) await sleep(20);
    assert.equal(B.ws.readyState, WebSocket.CLOSED);
    ok('logout mencabut koneksi WS');
  } finally { for (const ws of sockets) ws.terminate(); }
};
module.exports.socket=socket;
module.exports.sleep=sleep;
