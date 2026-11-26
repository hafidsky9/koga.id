// Uji state machine tanpa media maupun dependency npm; bukan pengganti smoke HTTP/WS.
const assert=require('node:assert/strict');
const {createVoice}=require('../lib/voice');
const iceConfig=require('../lib/rtc-config');
const {createHmac}=require('node:crypto');
const {test}=require('node:test');
function fixture(){
  const sockets=Array.from({length:7},(_,i)=>({uid:i+1,inbox:[],live:true}));
  const channels=new Map([[10,{id:10,server_id:1,type:'voice'}],[11,{id:11,server_id:1,type:'voice'}],[12,{id:12,server_id:1,type:'text'}]]);
  const send=(ws,e)=>{if(ws.live)ws.inbox.push(structuredClone(e));};
  const v=createVoice({bad:(message,status=400)=>Object.assign(Error(message),{status}),id:n=>{if(!Number.isSafeInteger(n)||n<1)throw Error('bad id');return n;},getChannel:(cid,uid)=>uid<=6?channels.get(cid):null,getUser:uid=>({username:'user'+uid}),memberIds:()=>sockets.slice(0,6).map(s=>({id:s.uid})),send,broadcast:(ids,e)=>ids.forEach(({id})=>send(sockets[id-1],e)),isLive:ws=>ws.live});
  const event=(ws,type,data)=>v.event(ws,{type,...data}),join=(ws,channelId=10)=>event(ws,'voice.join',{channelId});
  const error=(fn,status)=>assert.throws(fn,e=>e.status===status);
  return {sockets,v,event,join,error};
}
test('voice: membership, kanal voice, kapasitas, roster privat',()=>{
  const {sockets:[a,b,c,d,e,f,g],v,join,error}=fixture();error(()=>join(g),403);error(()=>join(a,12),400);
  for(const s of [a,b,c,d,e])join(s);error(()=>join(f),409);
  assert.equal(v.roster(10).length,5);assert.equal(g.inbox.length,0);assert.equal(a.inbox.find(x=>x.type==='voice.peers').peers.length,0);assert.equal(b.inbox.find(x=>x.type==='voice.peers').peers[0].id,1);
});
test('voice: relay yang sah, isolasi kanal, ukuran dan schema signaling',()=>{
  const {sockets:[a,b,c,d],v,event,join,error}=fixture();join(a);join(b);join(c,11);
  const data={type:'offer',sdp:'v=0\r\n'},p=v.roster(10).find(x=>x.id===2);event(a,'voice.signal',{to:2,peerId:p.peerId,data});assert.deepEqual(b.inbox.find(x=>x.type==='voice.signal').data,data);
  error(()=>event(a,'voice.signal',{to:3,data}),403);error(()=>event(a,'voice.signal',{to:4,data}),403);error(()=>event(a,'voice.signal',{to:1,data}),403);error(()=>event(a,'voice.signal',{to:2,peerId:'old',data}),403);
  error(()=>event(a,'voice.signal',{to:2,data:{type:'offer',sdp:'x'.repeat(16384)}}),400);error(()=>event(a,'voice.signal',{to:2,data:{type:'bad'}}),400);assert.equal(c.inbox.some(x=>x.type==='voice.signal'),false);assert.equal(d.inbox.some(x=>x.type==='voice.signal'),false);
});
test('voice: mute, disconnect, pindah kanal dan satu socket per akun',()=>{
  const {sockets:[a,b,c,d,e,f],v,event,join,error}=fixture();for(const s of [a,b,c,d,e])join(s);
  event(a,'voice.state',{muted:true});assert.equal(v.roster(10)[0].muted,true);assert.equal(b.inbox.find(x=>x.type==='voice.state').muted,true);error(()=>event(a,'voice.state',{muted:'true'}),400);
  b.live=false;v.leave(b);assert.ok(a.inbox.some(x=>x.type==='voice.peer-left'&&x.userId===2));join(f);join(c,11);assert.equal(v.roster(11)[0].id,3);assert.ok(!v.roster(10).some(x=>x.id===3));
  const another={uid:3,inbox:[],live:true};join(another);assert.ok(c.inbox.some(x=>x.type==='voice.left'));assert.equal(v.roster(11).length,0);assert.equal(v.roster(10).filter(x=>x.id===3).length,1);v.leave(c);assert.equal(v.roster(10).filter(x=>x.id===3).length,1);event(another,'voice.leave',{});assert.equal(v.roster(10).length,4);
});
test('ICE: STUN default, TURN optional, HMAC expiry 1 jam, secret tidak bocor',()=>{
  assert.deepEqual(iceConfig({}),{iceServers:[{urls:'stun:stun.l.google.com:19302'}]});assert.equal(iceConfig({TURN_URL:'turn:x'}).iceServers.length,1);
  const t=iceConfig({STUN_URL:'stun:x',TURN_URL:'turn:y',TURN_SECRET:'test-secret'},1000000);assert.deepEqual(t.iceServers[0],{urls:'stun:x'});const turn=t.iceServers[1];assert.equal(turn.username,'4600');assert.equal(turn.credential,createHmac('sha1','test-secret').update('4600').digest('base64'));assert.ok(!JSON.stringify(t).includes('test-secret'));
});
