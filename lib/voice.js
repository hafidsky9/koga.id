// Voice hanya signaling; audio tidak melewati proses Node.js. Satu socket aktif per user.
const { randomUUID } = require('crypto');
function createVoice({bad,id,getChannel,getUser,memberIds,send,broadcast,isLive}) {
  const rooms=new Map(), users=new Map();
  const publicUser=p=>({id:p.uid,username:p.username,muted:p.muted,peerId:p.peerId});
  const roster=cid=>[...(rooms.get(cid)?.values()||[])].filter(p=>isLive(p.ws)).map(publicUser);
  const publish=(cid,sid)=>broadcast(memberIds(sid),{type:'voice.roster',channelId:cid,users:roster(cid)});
  function leave(ws,reason){
    const p=users.get(ws.uid);if(!p||p.ws!==ws)return;
    users.delete(p.uid);const room=rooms.get(p.cid);room.delete(p.uid);if(!room.size)rooms.delete(p.cid);
    for(const other of room.values())send(other.ws,{type:'voice.peer-left',channelId:p.cid,userId:p.uid,peerId:p.peerId});
    if(reason)send(ws,{type:'voice.left',channelId:p.cid,reason});
    publish(p.cid,p.sid);
  }
  function access(cid,uid){const c=getChannel(cid,uid);if(!c)throw bad('Khusus anggota server.',403);if(c.type!=='voice')throw bad('Kanal ini bukan kanal suara.',400);return c;}
  function active(ws,d){const p=users.get(ws.uid);if(!p||p.ws!==ws||(d.channelId!==undefined&&id(d.channelId)!==p.cid))throw bad('Gabung kanal suara terlebih dahulu.',403);access(p.cid,p.uid);return p;}
  function join(ws,d){
    const cid=id(d.channelId),c=access(cid,ws.uid),prev=users.get(ws.uid);
    for(const p of rooms.get(cid)?.values()||[])if(!isLive(p.ws))leave(p.ws);
    const existing=rooms.get(cid);if(existing?.size>=5&&!existing.has(ws.uid))throw bad('Kanal suara penuh (maksimal 5 peserta).',409);
    if(prev?.ws===ws&&prev.cid===cid&&users.get(ws.uid)===prev)return;
    if(prev)leave(prev.ws,prev.ws===ws?undefined:'Voice dipindahkan ke perangkat/tab lain.');
    const room=rooms.get(cid)||new Map();rooms.set(cid,room);
    const p={uid:ws.uid,username:getUser(ws.uid).username,ws,cid,sid:c.server_id,muted:false,peerId:randomUUID()};
    const peers=[...room.values()];room.set(ws.uid,p);users.set(ws.uid,p);
    send(ws,{type:'voice.peers',channelId:cid,self:publicUser(p),peers:peers.map(publicUser)});
    for(const other of peers)send(other.ws,{type:'voice.peer-joined',channelId:cid,user:publicUser(p)});
    publish(cid,c.server_id);
  }
  function signalData(d){
    if(!d||typeof d!=='object'||Array.isArray(d)||Buffer.byteLength(JSON.stringify(d))>16*1024)throw bad('Signal tidak valid (maksimal 16 KB).');
    if(['offer','answer'].includes(d.type)&&typeof d.sdp==='string'&&d.sdp.length)return {type:d.type,sdp:d.sdp};
    if(d.type==='candidate'&&typeof d.candidate==='string'&&d.candidate.length<=4096&&(d.sdpMid==null||typeof d.sdpMid==='string')&&(d.sdpMLineIndex==null||Number.isInteger(d.sdpMLineIndex))&&(d.usernameFragment==null||typeof d.usernameFragment==='string'))return {type:'candidate',candidate:d.candidate,sdpMid:d.sdpMid??null,sdpMLineIndex:d.sdpMLineIndex??null,usernameFragment:d.usernameFragment??null};
    throw bad('Signal harus berupa SDP offer/answer atau ICE candidate.');
  }
  function event(ws,d){
    if(d.type==='voice.join')return join(ws,d);
    if(d.type==='voice.leave'){const p=users.get(ws.uid);if(p?.ws===ws){if(d.channelId!==undefined&&id(d.channelId)!==p.cid)throw bad('Kanal suara tidak cocok.',403);leave(ws);}return;}
    const p=active(ws,d),room=rooms.get(p.cid);
    if(d.type==='voice.signal'){
      const target=room.get(id(d.to));if(!target||target===p||!isLive(target.ws)||(d.peerId!==undefined&&d.peerId!==target.peerId))throw bad('Signal hanya untuk peserta kanal suara yang sama.',403);
      access(p.cid,target.uid);
      send(target.ws,{type:'voice.signal',channelId:p.cid,from:p.uid,peerId:p.peerId,data:signalData(d.data)});return;
    }
    if(d.type==='voice.state'){
      if(typeof d.muted!=='boolean')throw bad('Status mikrofon tidak valid.');p.muted=d.muted;
      for(const other of room.values())send(other.ws,{type:'voice.state',channelId:p.cid,userId:p.uid,peerId:p.peerId,muted:p.muted});publish(p.cid,p.sid);return;
    }
    throw bad('Event voice tidak dikenal.');
  }
  return {event,leave,roster};
}
module.exports={createVoice};
