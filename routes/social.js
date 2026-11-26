const router = require('express').Router();
const { randomBytes } = require('crypto');
const { db } = require('../db');
const { bad, currentUser } = require('../lib/http');
const S = require('../lib/social');
const R = require('../lib/realtime');

// Wajib sesi pada semua endpoint sosial; route publik tahap 1 tetap independen.
const route=fn=>(req,res,next)=>{try{const u=currentUser(req);if(!u)throw bad('Belum masuk.',401);req.user=u;fn(req,res,u.id);}catch(e){next(e);}};
const friends=db.prepare(`WITH peers AS (SELECT user_b AS id FROM friends WHERE user_a=? UNION ALL SELECT user_a FROM friends WHERE user_b=?)
 SELECT u.id,u.username,u.tag,u.status_text FROM peers p JOIN users u ON u.id=p.id ORDER BY u.username COLLATE NOCASE,u.id LIMIT ? OFFSET ?`);
router.get('/friends',route((req,res,uid)=>{
  const p=S.page(req.query), result=S.paged(friends.all(uid,uid,p.limit+1,p.offset),p);
  const groups={in_game:[],online:[],offline:[]};
  for(const u of result.items){u.presence=R.presence(u.id,u.status_text);groups[u.presence==='idle'?'online':u.presence].push(u);}
  res.json({...result,groups});
}));
const requestFriend=require('../lib/friend-request');
router.post('/friends/request',route((req,res,uid)=>res.status(201).json(requestFriend(uid,req.body?.tag))));
const requests=db.prepare(`SELECT r.id,r.created_at,u.id AS user_id,u.username,u.tag FROM friend_requests r JOIN users u ON u.id=r.from_id WHERE r.to_id=? ORDER BY r.id DESC LIMIT ? OFFSET ?`);
router.get('/friends/requests',route((req,res,uid)=>{const p=S.page(req.query);res.json(S.paged(requests.all(uid,p.limit+1,p.offset),p));}));
const findReq=db.prepare('SELECT * FROM friend_requests WHERE id=? AND to_id=?');
const delReq=db.prepare('DELETE FROM friend_requests WHERE id=?');
const insertFriend=db.prepare('INSERT OR IGNORE INTO friends(user_a,user_b,created_at) VALUES(?,?,?)');
const resolveReq=db.transaction((rid,uid,accept)=>{const r=findReq.get(rid,uid);if(!r)throw bad('Permintaan tidak ditemukan.',404);if(accept)insertFriend.run(...S.pair(uid,r.from_id),S.now());delReq.run(rid);return r;});
for(const action of ['accept','decline'])router.post(`/friends/requests/:id/${action}`,route((req,res,uid)=>{
  const r=resolveReq(S.id(req.params.id),uid,action==='accept');R.broadcast([{id:r.from_id},{id:uid}],{type:'friend.request',action,id:r.id,userId:uid});
  if(action==='accept'){R.announce(uid);R.announce(r.from_id);}res.json({ok:true});
}));
const delFriend=db.prepare('DELETE FROM friends WHERE user_a=? AND user_b=?');
router.delete('/friends/:id',route((req,res,uid)=>{const peer=S.id(req.params.id);if(!delFriend.run(...S.pair(uid,peer)).changes)throw bad('Teman tidak ditemukan.',404);R.broadcast([{id:peer},{id:uid}],{type:'friend.request',action:'removed',userId:uid,peerId:peer});res.json({ok:true});}));
const updateStatus=db.prepare('UPDATE users SET status_text=? WHERE id=?');
router.post('/me/status',route((req,res,uid)=>{if(typeof req.body?.status_text!=='string')throw bad('Status tidak valid.');const value=S.str(req.body.status_text);if([...value].length>100)throw bad('Status maksimal 100 karakter.');updateStatus.run(value,uid);R.announce(uid);res.json({status_text:value});}));
const dms=db.prepare(`WITH peers AS (SELECT user_b AS id FROM friends WHERE user_a=@uid UNION ALL SELECT user_a FROM friends WHERE user_b=@uid), latest AS (
 SELECT p.id, max(coalesce((SELECT max(id) FROM dm_messages WHERE sender_id=@uid AND recipient_id=p.id),0),coalesce((SELECT max(id) FROM dm_messages WHERE sender_id=p.id AND recipient_id=@uid),0)) AS mid FROM peers p)
 SELECT u.id,u.username,u.tag,m.id AS message_id,m.body,m.created_at,m.sender_id FROM latest l JOIN dm_messages m ON m.id=l.mid JOIN users u ON u.id=l.id ORDER BY m.id DESC LIMIT @limit OFFSET @offset`);
router.get('/dms',route((req,res,uid)=>{const p=S.page(req.query);res.json(S.paged(dms.all({uid,limit:p.limit+1,offset:p.offset}),p));}));
router.get('/dms/:userId/messages',route((req,res,uid)=>res.json(S.dmHistory(uid,S.id(req.params.userId),req.query))));
router.get('/templates',route((req,res)=>{const p=S.page(req.query);res.json(S.paged(S.templates.slice(p.offset,p.offset+p.limit+1).map(t=>({...t,channels:t.channels.map(([category,name,type],position)=>({category,name,type,position}))})),p));}));
const insertServer=db.prepare('INSERT INTO servers(owner_id,name,code,kind,template,created_at) VALUES(?,?,?,?,?,?)');
const addMember=db.prepare('INSERT OR IGNORE INTO members(server_id,user_id,created_at) VALUES(?,?,?)');
const addChannel=db.prepare('INSERT INTO channels(server_id,category,name,type,position) VALUES(?,?,?,?,?)');
const serverById=db.prepare('SELECT * FROM servers WHERE id=?');
const serverByCode=db.prepare('SELECT * FROM servers WHERE code=?');
const createServer=db.transaction((uid,name,kind,tpl)=>{const code=randomBytes(9).toString('base64url');const sid=Number(insertServer.run(uid,name,code,kind,tpl.id,S.now()).lastInsertRowid);addMember.run(sid,uid,S.now());tpl.channels.forEach(([cat,n,type],i)=>addChannel.run(sid,cat,n,type,i));return serverById.get(sid);});
router.post('/servers',route((req,res,uid)=>{const name=S.text(req.body?.name,80,'Nama server');const tpl=S.templates.find(t=>t.id===req.body?.template);if(!tpl)throw bad('Template tidak valid.');const kind=req.body?.kind;if(!['friends','community'].includes(kind))throw bad('Jenis server tidak valid.');res.status(201).json(createServer(uid,name,kind,tpl));}));
router.post('/servers/join',route((req,res,uid)=>{const code=S.str(req.body?.code);if(!/^[A-Za-z0-9_-]{12}$/.test(code))throw bad('Kode undangan tidak valid.');const s=serverByCode.get(code);if(!s)throw bad('Undangan tidak ditemukan.',404);addMember.run(s.id,uid,S.now());res.json(s);}));
// Satu kueri per daftar; hitung unread hanya pada server yang diminta dalam halaman.
const servers=db.prepare(`WITH selected AS (SELECT s.* FROM members me JOIN servers s ON s.id=me.server_id WHERE me.user_id=@uid ORDER BY s.id LIMIT @limit OFFSET @offset)
 SELECT s.*, (SELECT count(*) FROM channels c JOIN messages m ON m.channel_id=c.id LEFT JOIN reads r ON r.channel_id=c.id AND r.user_id=@uid WHERE c.server_id=s.id AND m.id>coalesce(r.last_msg_id,0) AND m.user_id<>@uid) AS unread FROM selected s ORDER BY s.id`);
router.get('/servers',route((req,res,uid)=>{const p=S.page(req.query);res.json(S.paged(servers.all({uid,limit:p.limit+1,offset:p.offset}),p));}));
const channels=db.prepare(`SELECT c.*, (SELECT count(*) FROM messages m WHERE m.channel_id=c.id AND m.id>coalesce(r.last_msg_id,0) AND m.user_id<>@uid) AS unread FROM channels c LEFT JOIN reads r ON r.channel_id=c.id AND r.user_id=@uid WHERE c.server_id=@sid ORDER BY c.position,c.id LIMIT @limit OFFSET @offset`);
router.get('/servers/:id/channels',route((req,res,uid)=>{const sid=S.id(req.params.id);S.member(sid,uid);const p=S.page(req.query);const result=S.paged(channels.all({uid,sid,limit:p.limit+1,offset:p.offset}),p);for(const c of result.items)if(c.type==='voice')c.users=R.voiceRoster(c.id);res.json(result);}));
const nextPosition=db.prepare('SELECT coalesce(max(position),-1)+1 AS n FROM channels WHERE server_id=?');
const getChannel=db.prepare('SELECT * FROM channels WHERE id=?');
router.post('/servers/:id/channels',route((req,res,uid)=>{
  const sid=S.id(req.params.id), s=serverById.get(sid);if(!s||s.owner_id!==uid)throw bad('Khusus pemilik server.',403);
  const name=S.text(req.body?.name,60,'Nama kanal'), category=S.text(req.body?.category,60,'Kategori'),type=req.body?.type;
  if(!['text','voice'].includes(type))throw bad('Jenis kanal tidak valid.');
  try{const cid=Number(addChannel.run(sid,category,name,type,nextPosition.get(sid).n).lastInsertRowid);res.status(201).json(getChannel.get(cid));}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')throw bad('Kanal sudah ada.',409);throw e;}
}));
router.get('/channels/:id/messages',route((req,res,uid)=>res.json(S.channelHistory(uid,S.id(req.params.id),req.query))));
module.exports=router;
