const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { db } = require('../db');
const { bad } = require('./http');
const S = require('./social');
const connections = new Map(); // user ID -> Set koneksi; tidak disimpan di DB
const status = db.prepare('SELECT status_text FROM users WHERE id=?');
const liveSession = db.prepare('SELECT s.expires FROM sessions s JOIN users u ON u.id=json_extract(s.sess,\'$.uid\') WHERE s.sid=? AND s.expires>? AND u.id=?');
const voiceChannel=db.prepare('SELECT c.* FROM channels c JOIN members m ON m.server_id=c.server_id WHERE c.id=? AND m.user_id=?');
const voiceUser=db.prepare('SELECT username FROM users WHERE id=?');
const voice=require('./voice').createVoice({bad,id:S.id,getChannel:(cid,uid)=>voiceChannel.get(cid,uid),getUser:uid=>voiceUser.get(uid),memberIds:sid=>S.memberIds.all(sid),send,broadcast,isLive:ws=>ws.readyState===WebSocket.OPEN&&ws.sessionExpires>Date.now()});
function presence(uid, statusText) {
  const sockets=[...(connections.get(uid)||[])].filter(s=>s.readyState===WebSocket.OPEN&&s.sessionExpires>Date.now());
  if(!sockets.length) return 'offline';
  if(sockets.every(s=>s.idle)) return 'idle';
  return /^Bermain - \S/i.test(statusText)?'in_game':'online';
}
function send(ws, event) {
  if(ws.readyState!==WebSocket.OPEN)return;
  if(ws.sessionExpires<=Date.now()){ws.terminate();return;}
  // Klien lambat tidak boleh menghabiskan RAM STB.
  if(ws.bufferedAmount>256*1024){ws.terminate();return;}
  ws.send(JSON.stringify(event));
}
function broadcast(ids,event) { for(const {id} of ids) for(const ws of connections.get(id)||[]) send(ws,event); }
function announce(uid) {
  const u=status.get(uid); if(!u)return;
  broadcast(S.friendIds.all(uid,uid),{type:'presence.update',userId:uid,presence:presence(uid,u.status_text),status_text:u.status_text});
}
const origins=new Set((process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
function validOrigin(req) {
  try {
    const o=new URL(req.headers.origin);
    const proto=req.socket.encrypted?'https':process.env.TRUST_PROXY?String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim():'http';
    return ['http:','https:'].includes(o.protocol) && (origins.has(o.origin)||(o.host===req.headers.host&&o.protocol===proto+':'));
  } catch{return false;}
}
function attach(server,sessionParser,store) {
  const wss=new WebSocketServer({noServer:true,maxPayload:16*1024,perMessageDeflate:false});
  const reject=(socket,code)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/ws')return reject(socket,'404 Not Found');
    if(!validOrigin(req))return reject(socket,'403 Forbidden');
    socket.on('error',()=>socket.destroy());
    sessionParser(req,new http.ServerResponse(req),err=>{
      if(err||!req.session?.uid||!status.get(req.session.uid))return reject(socket,'401 Unauthorized');
      const live=liveSession.get(req.sessionID,Date.now(),req.session.uid);
      if(!live)return reject(socket,'401 Unauthorized');
      req.sessionExpires=live.expires;
      if(socket.destroyed)return;
      wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
    });
  });
  wss.on('connection',(ws,req)=>{
    const uid=req.session.uid;ws.uid=uid;ws.sid=req.sessionID;ws.sessionExpires=req.sessionExpires;ws.idle=false;ws.alive=true;
    let sockets=connections.get(uid);if(!sockets)connections.set(uid,sockets=new Set());
    sockets.add(ws); announce(uid);
    const sent=[], events=[], signals=[];
    const take=(queue,limit)=>{const t=Date.now();while(queue.length&&queue[0]<=t-1000)queue.shift();if(queue.length>=limit)return false;queue.push(t);return true;};
    ws.on('pong',()=>{ws.alive=true;});
    ws.on('error',()=>ws.terminate());
    ws.on('close',()=>{voice.leave(ws);sockets.delete(ws);if(!sockets.size)connections.delete(uid);announce(uid);});
    ws.on('message',(raw,isBinary)=>{
      let d,requestId;
      try {
        if(!liveSession.get(ws.sid,Date.now(),uid)){ws.close(1008,'Sesi berakhir');return;}
        if(isBinary)throw bad('Gunakan JSON teks.');
        try{d=JSON.parse(raw.toString());}catch{throw bad('JSON tidak valid.');}
        if(!d||typeof d!=='object'||Array.isArray(d))throw bad('Event tidak valid.');
        if(typeof d.requestId==='string'&&d.requestId.length<=80)requestId=d.requestId;
        if(d.type==='voice.signal'){if(!take(signals,60))throw bad('Terlalu banyak signal voice.',429);}
        else if(!take(events,30))throw bad('Terlalu banyak event.',429);
        if(d.type==='message.send') {
          if(!take(sent,5))throw bad('Maksimal 5 pesan per detik.',429);
          const {recipients,...event}=S.sendMessage(uid,d);
          broadcast(recipients,{type:'message.new',...event});
        } else if(d.type==='reaction.toggle') {
          const {recipients,...event}=S.reaction(uid,d);broadcast(recipients,{type:'reaction.update',...event});
        } else if(d.type==='read.mark') S.markRead(uid,d);
        else if(d.type==='presence.set') {
          if(!['idle','online'].includes(d.state))throw bad('Presence tidak valid.');
          const idle=d.state==='idle';if(ws.idle!==idle){ws.idle=idle;announce(uid);}
        } else if(typeof d.type==='string'&&d.type.startsWith('voice.'))voice.event(ws,d);
        else throw bad('Event tidak dikenal.');
        if(requestId)send(ws,{type:'ack',requestId});
      } catch(e) {
        if(!e.expose)console.error(e);
        send(ws,{type:'error',requestId,status:e.expose?e.status:500,error:e.expose?e.message:'Terjadi kesalahan di server.'});
      }
    });
  });
  store.on('session:destroy',sid=>{for(const ws of wss.clients)if(ws.sid===sid)ws.terminate();});
  const timer=setInterval(()=>{
    for(const ws of wss.clients){
      if(!ws.alive||!liveSession.get(ws.sid,Date.now(),ws.uid)){ws.terminate();continue;}
      ws.alive=false;ws.ping();
    }
  },30000);timer.unref();
  wss.on('close',()=>clearInterval(timer));
  server.on('close',()=>{clearInterval(timer);for(const ws of wss.clients)ws.terminate();wss.close();});
}
module.exports={attach,presence,announce,broadcast,voiceRoster:voice.roster};
