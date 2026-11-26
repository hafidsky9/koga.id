const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { socket, sleep } = require('./social');
module.exports = async ({ BASE, client, user, anon, admin, check }) => {
  const post=(c,p,json)=>c('POST','/api'+p,{json});
  const get=(c,p)=>c('GET','/api'+p);
  const expect=async(p,status)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.data));return r;};
  const ok=n=>check('Tahap 3: '+n,true);
  const a=(await expect(get(user,'/me'),200)).data.user;
  const accounts=[user,admin];
  for(let i=0;i<5;i++){
    const c=client(),username='voiceuser'+i;
    await expect(post(c,'/register',{username,email:username+'@mail.id',password:'password123'}),201);
    await expect(post(c,'/login',{id:username,password:'password123'}),200);accounts.push(c);
  }
  const ids=await Promise.all(accounts.map(async c=>(await expect(get(c,'/me'),200)).data.user));
  const server=(await expect(post(user,'/servers',{name:'Voice smoke',kind:'friends',template:'gaming'}),201)).data;
  const channel=(await expect(get(user,`/servers/${server.id}/channels`),200)).data.items.find(c=>c.type==='voice');
  const channel2=(await expect(post(user,`/servers/${server.id}/channels`,{name:'voice2',category:'Game',type:'voice'}),201)).data;
  const text=(await expect(get(user,`/servers/${server.id}/channels`),200)).data.items.find(c=>c.type==='text');
  const clients=[];let seq=0;
  const send=async(c,type,data={},status)=>{const requestId='v'+(++seq);c.send(type,{...data,requestId});const r=await c.wait(status?'error':'ack',e=>e.requestId===requestId);if(status)assert.equal(r.status,status);};
  try{
    for(const c of accounts)clients.push(await socket(BASE,c.cookie()));
    const [A,B,C,D,E,F,G]=clients;
    await send(B,'voice.join',{channelId:channel.id},403);
    await send(A,'voice.join',{channelId:text.id},400);
    for(const c of accounts.slice(1,6))await expect(post(c,'/servers/join',{code:server.code}),200);
    await send(A,'voice.join',{channelId:channel.id});assert.equal((await A.wait('voice.peers')).peers.length,0);
    await send(B,'voice.join',{channelId:channel.id});assert.equal((await B.wait('voice.peers')).peers[0].id,a.id);
    assert.equal((await A.wait('voice.peer-joined')).user.id,ids[1].id);
    const roster=await A.wait('voice.roster',e=>e.users.length===2);assert.equal(roster.channelId,channel.id);
    assert.equal((await expect(get(user,`/servers/${server.id}/channels`),200)).data.items.find(c=>c.id===channel.id).users.length,2);
    assert.equal(G.inbox.some(e=>e.type==='voice.roster'),false);ok('anggota join, non-anggota/kanal teks ditolak, roster privat');
    const offer={type:'offer',sdp:'v=0\r\n'};
    await send(A,'voice.signal',{to:ids[1].id,data:offer});assert.deepEqual((await B.wait('voice.signal')).data,offer);
    await send(A,'voice.signal',{to:ids[6].id,data:offer},403);
    await send(C,'voice.join',{channelId:channel2.id});await C.wait('voice.peers');
    await send(A,'voice.signal',{to:ids[2].id,data:offer},403);
    await send(A,'voice.state',{muted:true});assert.equal((await B.wait('voice.state')).muted,true);
    await sleep(50);assert.equal(C.inbox.some(e=>e.type==='voice.signal'),false);assert.equal(G.inbox.some(e=>e.type==='voice.signal'),false);ok('relay signaling hanya satu kanal; mute');
    for(const c of [C,D,E]){await send(c,'voice.join',{channelId:channel.id});await c.wait('voice.peers');}
    await send(F,'voice.join',{channelId:channel.id},409);ok('maksimal lima peserta');
    B.ws.terminate();await A.wait('voice.peer-left',e=>e.userId===ids[1].id);
    await send(F,'voice.join',{channelId:channel.id});await F.wait('voice.peers');
    await send(F,'voice.leave');await A.wait('voice.peer-left',e=>e.userId===ids[5].id);ok('leave otomatis saat putus; slot kembali tersedia');
    await send(C,'voice.join',{channelId:channel2.id});await A.wait('voice.peer-left',e=>e.userId===ids[2].id);ok('pindah kanal otomatis keluar');
    const B2=await socket(BASE,accounts[2].cookie());clients.push(B2);await send(B2,'voice.join',{channelId:channel.id});await C.wait('voice.left');await B2.wait('voice.peers');ok('satu user satu koneksi voice');
    for(let i=0;i<65;i++)B2.send('voice.signal',{to:a.id,data:offer,requestId:'burst'+i});
    assert.equal((await B2.wait('error',e=>e.status===429)).status,429);ok('batas event signaling aktif');
    await expect(get(anon,'/rtc-config'),401);const rtc=(await expect(get(user,'/rtc-config'),200)).data;
    const turn=rtc.iceServers.find(x=>x.urls.startsWith('turn:'));assert.ok(turn);assert.equal(turn.credential,createHmac('sha1','smoke-turn-secret').update(turn.username).digest('base64'));assert.ok(Math.abs(Number(turn.username)-Math.floor(Date.now()/1000)-3600)<10);assert.ok(!JSON.stringify(rtc).includes('smoke-turn-secret'));ok('TURN sementara, secret tidak bocor');
    const decoder=await expect(anon('GET','/vendor/jsQR.js',{raw:true}),200);assert.ok(decoder.data.length>1000);
    await expect(get(anon,'/me/qr.svg'),401);const svg=await expect(get(user,'/me/qr.svg'),200);assert.match(svg.headers.get('content-type'),/image\/svg\+xml/);assert.match(svg.data,/<svg/);
    assert.equal((await expect(get(user,'/me/invite'),200)).data.url,`${BASE}/add/${a.tag}`);
    const target=ids[6];const pending=await expect(anon('GET','/add/'+target.tag),302);assert.equal(pending.headers.get('location'),`/?add=${target.tag}`);
    const invite=await expect(user('GET','/add/'+target.tag),302);assert.equal(invite.headers.get('location'),'/?invite=sent');
    const requests=(await expect(get(accounts[6],'/friends/requests'),200)).data.items;assert.ok(requests.some(x=>x.user_id===a.id));
    assert.equal((await expect(user('GET','/add/'+target.tag),302)).headers.get('location'),'/?invite=pending');
    const unknown='0000000'; /* generator hanya 1000000-9999999 */ await expect(user('GET','/add/'+unknown),404);ok('QR SVG, undangan login, permintaan otomatis, tag asing ditolak');
  }finally{for(const c of clients)c.ws.terminate();}
};
