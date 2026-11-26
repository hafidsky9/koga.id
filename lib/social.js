const { db } = require('../db');
const { bad } = require('./http');
const now = () => new Date().toISOString();
const str = v => typeof v === 'string' ? v.trim() : '';
function id(v) {
  if (!(typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) || !Number.isSafeInteger(Number(v)) || Number(v) < 1) throw bad('ID tidak valid.');
  return Number(v);
}
function size(v, def = 50) { return v === undefined ? def : Math.min(id(v), 100); }
function page(q) { return { limit: size(q.limit), offset: q.offset === undefined || q.offset === '0' ? 0 : Math.min(id(q.offset), 1000000) }; }
function paged(rows, p) { return { items: rows.slice(0,p.limit), nextOffset: rows.length > p.limit ? p.offset + p.limit : null }; }
function history(q) { return { limit: size(q.limit), before: q.before === undefined || q.before === '' ? Number.MAX_SAFE_INTEGER : id(q.before) }; }
function text(v, max, label) { const s = str(v); if (!s || s.includes('\0') || [...s].length > max) throw bad(`${label} wajib 1-${max} karakter.`); return s; }
const pair = (a,b) => [Math.min(a,b),Math.max(a,b)];
const qFriend = db.prepare('SELECT 1 FROM friends WHERE user_a=? AND user_b=?');
function areFriends(a,b) { return a !== b && !!qFriend.get(...pair(a,b)); }
function requireFriend(a,b) { if (!areFriends(a,b)) throw bad('DM hanya untuk teman.',403); }
const qMember = db.prepare('SELECT 1 FROM members WHERE server_id=? AND user_id=?');
function member(server,uid) { if (!qMember.get(server,uid)) throw bad('Khusus anggota server.',403); }
const qChannel = db.prepare('SELECT c.* FROM channels c JOIN members m ON m.server_id=c.server_id WHERE c.id=? AND m.user_id=?');
function channel(cid,uid) { const c = qChannel.get(cid,uid); if (!c) throw bad('Khusus anggota server.',403); if(c.type !== 'text') throw bad('Kanal ini bukan kanal teks.',400); return c; }
const friendIds = db.prepare('SELECT user_b AS id FROM friends WHERE user_a=? UNION ALL SELECT user_a AS id FROM friends WHERE user_b=?');
const memberIds = db.prepare('SELECT user_id AS id FROM members WHERE server_id=?');
const templates = [
 { id:'gaming', name:'Gaming', channels:[['Umum','umum','text'],['Game','mabar','text'],['Game','voice','voice']] },
 { id:'hobby', name:'Hobi', channels:[['Umum','perkenalan','text'],['Diskusi','obrolan','text'],['Diskusi','ruang-suara','voice']] },
 { id:'community', name:'Komunitas', channels:[['Informasi','pengumuman','text'],['Umum','diskusi','text'],['Umum','ruang-suara','voice']] },
 { id:'blank', name:'Buat Untuk Diri Sendiri', channels:[['Umum','umum','text'],['Umum','voice','voice']] },
];
const mentionsQuery = db.prepare(`SELECT u.username FROM users u JOIN json_each(?) j ON u.username = j.value COLLATE NOCASE
 WHERE (? IS NOT NULL AND EXISTS(SELECT 1 FROM members m WHERE m.server_id=? AND m.user_id=u.id))
 OR (? IS NULL AND u.id IN (?,?)) GROUP BY u.id`);
function mentions(body, server, uid, peer) {
  const names = [...new Set([...body.matchAll(/(?<![\w@])@([A-Za-z0-9_.]{3,24})(?![A-Za-z0-9_.])/g)].map(m=>m[1].toLowerCase()))];
  return names.length ? mentionsQuery.all(JSON.stringify(names),server,server,server,uid,peer).map(x=>x.username) : [];
}
const channelSelect = `SELECT m.id,m.channel_id,m.user_id,m.body,m.reply_to,m.mentions,m.created_at,u.username,
 (SELECT count(*) FROM reactions r WHERE r.message_id=m.id) AS reactions,
 EXISTS(SELECT 1 FROM reactions r WHERE r.message_id=m.id AND r.user_id=?) AS reacted,
 p.body AS reply_body,pu.username AS reply_username
 FROM messages m JOIN users u ON u.id=m.user_id LEFT JOIN messages p ON p.id=m.reply_to LEFT JOIN users pu ON pu.id=p.user_id`;
const dmSelect = `SELECT m.id,m.sender_id AS user_id,m.recipient_id,m.body,m.reply_to,m.mentions,m.created_at,u.username,
 (SELECT count(*) FROM dm_reactions r WHERE r.message_id=m.id) AS reactions,
 EXISTS(SELECT 1 FROM dm_reactions r WHERE r.message_id=m.id AND r.user_id=?) AS reacted,
 p.body AS reply_body,pu.username AS reply_username
 FROM dm_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN dm_messages p ON p.id=m.reply_to LEFT JOIN users pu ON pu.id=p.sender_id`;
const toMessage = m => ({...m, mentions:JSON.parse(m.mentions),reacted:!!m.reacted});
const qChannelHistory = db.prepare(channelSelect+' WHERE m.channel_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?');
const qDmHistory = db.prepare(dmSelect+' WHERE ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?)) AND m.id<? ORDER BY m.id DESC LIMIT ?');
function historyResult(rows, p) { const items = rows.slice(0,p.limit).reverse().map(toMessage); return {items,nextBefore:rows.length>p.limit?items[0].id:null}; }
function channelHistory(uid,cid,q) { channel(cid,uid); const p=history(q); return historyResult(qChannelHistory.all(uid,cid,p.before,p.limit+1),p); }
function dmHistory(uid,peer,q) { requireFriend(uid,peer); const p=history(q); return historyResult(qDmHistory.all(uid,uid,peer,peer,uid,p.before,p.limit+1),p); }
const qOneChannel=db.prepare(channelSelect+' WHERE m.id=?');
const qOneDm=db.prepare(dmSelect+' WHERE m.id=?');
const qChannelReply=db.prepare('SELECT 1 FROM messages WHERE id=? AND channel_id=?');
const qDmReply=db.prepare('SELECT 1 FROM dm_messages WHERE id=? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))');
const qSendChannel=db.prepare('INSERT INTO messages(channel_id,user_id,body,reply_to,mentions,created_at) VALUES(?,?,?,?,?,?)');
const qSendDm=db.prepare('INSERT INTO dm_messages(sender_id,recipient_id,body,reply_to,mentions,created_at) VALUES(?,?,?,?,?,?)');
const qRead=db.prepare(`INSERT INTO reads(user_id,channel_id,last_msg_id) VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_msg_id=max(reads.last_msg_id,excluded.last_msg_id)`);
function sendMessage(uid,d) {
  const body=text(d.body,2000,'Pesan');
  const reply=d.replyTo==null?null:id(d.replyTo);
  if ((d.channelId==null)===(d.dmUserId==null)) throw bad('Pilih satu tujuan pesan.');
  if (d.channelId!=null) {
    const cid=id(d.channelId), c=channel(cid,uid);
    if(reply!==null&&!qChannelReply.get(reply,cid)) throw bad('Balasan tidak berada di kanal ini.',403);
    const mid=Number(qSendChannel.run(cid,uid,body,reply,JSON.stringify(mentions(body,c.server_id,uid,null)),now()).lastInsertRowid);
    return {scope:'channel', channelId:cid, serverId:c.server_id, message:toMessage(qOneChannel.get(uid,mid)), recipients:memberIds.all(c.server_id)};
  }
  const peer=id(d.dmUserId); requireFriend(uid,peer);
  if(reply!==null&&!qDmReply.get(reply,uid,peer,peer,uid)) throw bad('Balasan tidak berada di DM ini.',403);
  const mid=Number(qSendDm.run(uid,peer,body,reply,JSON.stringify(mentions(body,null,uid,peer)),now()).lastInsertRowid);
  return {scope:'dm', message:toMessage(qOneDm.get(uid,mid)), recipients:[{id:uid},{id:peer}]};
}
const reactOps = {};
for (const [scope,table] of [['channel','reactions'],['dm','dm_reactions']]) {
  // Nama tabel hanya konstanta internal, bukan input pengguna.
  reactOps[scope] = { del:db.prepare(`DELETE FROM ${table} WHERE message_id=? AND user_id=?`), add:db.prepare(`INSERT INTO ${table}(message_id,user_id) VALUES(?,?)`), count:db.prepare(`SELECT count(*) AS n FROM ${table} WHERE message_id=?`) };
}
const qMessageChannel=db.prepare('SELECT channel_id FROM messages WHERE id=?');
const qMessageDm=db.prepare('SELECT sender_id,recipient_id FROM dm_messages WHERE id=?');
function reaction(uid,d) {
  const mid=id(d.messageId), scope=d.scope===undefined?'channel':d.scope;
  let recipients, target;
  if(scope==='channel') {
    const m=qMessageChannel.get(mid); if(!m) throw bad('Pesan tidak tersedia.',403);
    const c=channel(m.channel_id,uid); recipients=memberIds.all(c.server_id); target={channelId:c.id,serverId:c.server_id};
  } else if(scope==='dm') {
    const m=qMessageDm.get(mid); if(!m||![m.sender_id,m.recipient_id].includes(uid)) throw bad('Pesan tidak tersedia.',403);
    requireFriend(m.sender_id,m.recipient_id); recipients=[{id:m.sender_id},{id:m.recipient_id}]; target={senderId:m.sender_id,recipientId:m.recipient_id};
  } else throw bad('Jenis reaksi tidak valid.');
  const ops=reactOps[scope], reacted=db.transaction(()=>{if(ops.del.run(mid,uid).changes)return false;ops.add.run(mid,uid);return true;})();
  return {scope,...target,messageId:mid,userId:uid,reacted,count:ops.count.get(mid).n,recipients};
}
function markRead(uid,d) {
  const cid=id(d.channelId), mid=id(d.lastMsgId); channel(cid,uid);
  if(!qChannelReply.get(mid,cid)) throw bad('Pesan tidak berada di kanal ini.',403);
  qRead.run(uid,cid,mid);
}
module.exports={now,str,id,size,page,paged,text,pair,areFriends,requireFriend,member,channel,friendIds,memberIds,templates,channelHistory,dmHistory,sendMessage:db.transaction(sendMessage),reaction,markRead};
