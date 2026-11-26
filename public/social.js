// Tahap 2: mengisi komponen yang sudah ada, tanpa stylesheet/layout baru.
const social = { me:null, ws:null, timer:null, retry:1000, generation:0, lastActivity:Date.now(), idle:false,
  lists:{}, server:null, chat:null, chatVersion:0, messages:new Map(), before:null, loading:false, reply:null, pending:null, mark:null, tpl:null, kind:null, filter:'all', collapsed:new Set(), seq:0 };
const panels={friends:$('#teman [data-p=t]'),dms:$('#teman [data-p=m]'),requests:$('#teman [data-p=r]')};
const socialTab=()=>$('#teman .tabs .on').dataset.t;
const av=dot=>`<span class="av"><i data-i="img"></i>${dot?`<span class="dot" style="background:var(--${dot})"></span>`:''}</span>`;
const more=(name,next)=>next==null?'':`<button class="btn" data-s="more" data-list="${name}">Muat lagi</button>`;
const waitText=()=>box('Memuat…','');
function socialNotice(t){const o=$('#toast');o.textContent=t||'Gagal. Coba lagi.';o.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>{o.classList.remove('on');o.textContent='Segera hadir'},2500);}
function sError(r){if(r.status===401){socialSession(null);go('welcome',true);}else socialNotice(r.data.error);}
const copyId=async(value,label)=>{try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(value);socialNotice(label+' disalin.');}catch{window.prompt('Salin '+label,value);}};
const keepOnly=(el,...nodes)=>{for(const child of [...el.children])if(!nodes.includes(child))child.remove();};
const searchFriend=panels.friends.querySelector('.sch');
const fab=panels.dms.querySelector('.fab');fab.removeAttribute('data-soon');fab.dataset.s='newdm';
const copyButton=panels.requests.querySelector('.btn');copyButton.removeAttribute('data-soon');copyButton.dataset.s='copytag';copyButton.firstChild.textContent='Salin ID Koga-ku ';
const requestTitle=panels.requests.querySelector('.row.sp');
const addFriend=panels.requests.querySelector('.btn.o');addFriend.removeAttribute('data-soon');addFriend.dataset.s='addfriend';
const community=$('#komunitas .chn'), serverTitle=community.querySelector('.row.b'), channelSearch=community.querySelector('.sch');
channelSearch.querySelector('span').outerHTML='<input placeholder="Cari kanal" aria-label="Cari kanal">';
serverTitle.dataset.s='invite';serverTitle.tabIndex=0;serverTitle.setAttribute('role','button');serverTitle.title='Salin kode undangan';
const addServerButton=$('#tambah .chn button[data-soon]');addServerButton.removeAttribute('data-soon');addServerButton.dataset.s='join';
const templateOpts=$$('#template .opt'), blank=templateOpts[0].querySelector('button');blank.removeAttribute('data-go');blank.dataset.s='template';blank.dataset.template='blank';
$$('#jenis .opt button').forEach((b,i)=>{b.removeAttribute('data-go');b.dataset.s='kind';b.dataset.kind=i?'community':'friends';});
const createBtn=$('#atur .btn.r');createBtn.removeAttribute('data-go');createBtn.removeAttribute('data-reset');createBtn.dataset.s='create';
const statusBtn=$('#profil .btn[data-soon]');statusBtn.removeAttribute('data-soon');statusBtn.dataset.s='status';
const filterBtn=$('#teman .top [data-soon]');filterBtn.removeAttribute('data-soon');filterBtn.dataset.s='filter';filterBtn.setAttribute('aria-label','Filter teman');
const chatBody=$('#chat .bd'), chatInput=$('#chat .cmp input'), chatHeader=$('#chat .top b'), chatSub=$('#chat .top .mu');
const chatSend=document.createElement('button');chatSend.type='button';chatSend.dataset.s='send';chatSend.setAttribute('aria-label','Kirim pesan');chatSend.innerHTML='<i data-i="arr"></i>';$('#chat .cmp [data-i=mic]').replaceWith(chatSend);
chatInput.maxLength=4000; // batas 2000 code point divalidasi saat kirim
const clearMocks=()=>{panels.friends.replaceChildren(searchFriend);panels.dms.replaceChildren(fab);panels.requests.replaceChildren(copyButton,requestTitle,addFriend);$('#rqn').textContent='0';community.replaceChildren(serverTitle,channelSearch);serverTitle.textContent='Komunitas';chatBody.replaceChildren();chatHeader.textContent='Pesan';chatSub.textContent='';templateOpts[1].replaceChildren();$$('.rail').forEach(el=>{const plus=el.querySelector('.add');el.replaceChildren(plus);});};
clearMocks();icons();
function wsSend(type,data={},requestId){if(social.ws?.readyState!==WebSocket.OPEN)return false;social.ws.send(JSON.stringify({type,...data,...(requestId?{requestId}:{})}));return true;}
function socialSession(u){
  if(social.me?.id===u?.id){if(u)social.me=u;return;}
  if(typeof kogaMedia!=='undefined')kogaMedia.session();
  social.generation++;clearTimeout(social.timer);social.timer=null;
  if(social.ws){const ws=social.ws;social.ws=null;ws.close();}
  Object.assign(social,{me:u,lists:{},server:null,chat:null,messages:new Map(),before:null,loading:false,reply:null,pending:null,mark:null,tpl:null,kind:null,filter:'all',collapsed:new Set(),retry:1000,idle:false,lastActivity:Date.now()});
  social.chatVersion++;chatInput.value='';searchFriend.querySelector('input').value='';channelSearch.querySelector('input').value='';clearMocks();
  if(u){connectSocial();queueMicrotask(()=>{if(typeof kogaMedia!=='undefined'&&social.me===u)kogaMedia.afterLogin();});}
}
function connectSocial(){
  if(!social.me||social.ws)return;
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);social.ws=ws;
  ws.addEventListener('open',()=>{if(social.ws!==ws)return;social.retry=1000;social.idle=Date.now()-social.lastActivity>=300000;if(social.idle)wsSend('presence.set',{state:'idle'});if(cur==='chat')loadChat();if(cur==='teman')loadSocialTab();if(cur==='komunitas'||cur==='tambah')loadServers();});
  ws.addEventListener('message',e=>{if(social.ws!==ws)return;try{onSocialEvent(JSON.parse(e.data));}catch(err){console.error(err);}});
  ws.addEventListener('close',()=>{if(social.ws!==ws)return;social.ws=null;social.pending=null;social.mark=null;if(typeof kogaMedia!=='undefined')kogaMedia.disconnected();if(!social.me)return;const g=social.generation;social.timer=setTimeout(async()=>{const r=await api('/api/me');if(g!==social.generation)return;if(r.status===401){socialSession(null);go('welcome',true);return;}connectSocial();},social.retry);social.retry=Math.min(social.retry*2,15000);});
}
function activity(){social.lastActivity=Date.now();if(social.idle){social.idle=false;wsSend('presence.set',{state:'online'});}}
for(const e of ['pointerdown','keydown','touchstart','wheel'])document.addEventListener(e,activity,{passive:true});
setInterval(()=>{if(social.me&&!social.idle&&Date.now()-social.lastActivity>=300000){social.idle=true;wsSend('presence.set',{state:'idle'});}},1000);
function socialScreen(id){if(typeof kogaMedia!=='undefined')kogaMedia.screen(id);if(id==='welcome'||id==='auth'){if(social.me)socialSession(null);}if(id!=='chat'){social.mark=null;}}
// Semua daftar memakai page server; klik "Muat lagi" untuk page selanjutnya.
const listUrls={friends:'/api/friends',dms:'/api/dms',requests:'/api/friends/requests',servers:'/api/servers',templates:'/api/templates'};
async function loadList(name,append=false){
  const key=name==='channels'?social.server?.id:null;if(name==='channels'&&!key)return;
  const url=name==='channels'?`/api/servers/${key}/channels`:listUrls[name];
  let list=social.lists[name];if(append&&(!list||list.next==null||list.loading))return;
  if(!append){list={items:[],next:null,loading:false,key,...(name==='channels'?{voiceUpdates:new Map()}: {})};social.lists[name]=list;}
  list.loading=true;const g=social.generation, offset=append?list.next:0;drawList(name);
  const r=await api(`${url}?limit=50&offset=${offset}`);
  if(g!==social.generation||social.lists[name]!==list||(name==='channels'&&key!==social.server?.id))return;
  list.loading=false;if(!r.ok){list.error=r.data.error;if(append){socialNotice(r.data.error);}else list.next=null;drawList(name);if(r.status===401)sError(r);return;}
  const merged=new Map(list.items.map(x=>[x.id,x]));for(const x of r.data.items){if(name==='channels'&&list.voiceUpdates.has(x.id))x.users=list.voiceUpdates.get(x.id);merged.set(x.id,x);}if(name==='channels')list.voiceUpdates.clear();list.items=[...merged.values()];list.next=r.data.nextOffset;list.error=null;
  if(name==='servers'){
    const updated=list.items.find(s=>s.id===social.server?.id);
    if(updated)social.server=updated;else if(!social.server&&list.items.length)social.server=list.items[0];
    drawList(name);if(cur==='komunitas'&&social.server&&!append)loadList('channels');else if(cur==='komunitas'&&!social.server)drawChannels();
  }else drawList(name);
}
const listState=(name,empty,help)=>{const l=social.lists[name];return l?.error?box('Gagal memuat',`${esc(l.error)} <button class="b" data-s="reload" data-list="${name}">Coba lagi</button>`):l?.loading&&!l.items.length?waitText():box(empty,help);};
function drawList(name){({friends:drawFriends,dms:drawDms,requests:drawRequests,servers:drawServers,channels:drawChannels,templates:drawTemplates})[name]?.();icons();}
const statusLabel=u=>u.presence==='offline'?'Offline':u.presence==='idle'?'Tidak di tempat':u.status_text||'Online';
const statusColor={in_game:'bl',online:'gr',idle:'ye',offline:'mu'};
const groupKey=u=>u.presence==='idle'?'online':u.presence;
function drawFriends(){
  const l=social.lists.friends, items=l?.items||[],q=searchFriend.querySelector('input').value.trim().toLowerCase();
  const shown=items.filter(u=>(social.filter==='all'||groupKey(u)===social.filter)&&`${u.username} ${u.tag} ${u.status_text}`.toLowerCase().includes(q));
  keepOnly(panels.friends,searchFriend);
  let html='';
  for(const [key,label] of [['in_game','Dalam Game'],['online','Online'],['offline','Offline']]){
    const group=shown.filter(u=>groupKey(u)===key);if(!group.length)continue;
    html+=`<div class="grp" role="button" tabindex="0" data-s="collapse" data-group="${key}"><span>${label} &nbsp;${group.length}</span><i data-i="dn"${social.collapsed.has(key)?'':' style="transform:rotate(180deg)"'}></i></div>`;
    if(!social.collapsed.has(key))html+=group.map(u=>`<div class="fr" role="link" tabindex="0" data-s="dm" data-id="${u.id}" data-name="${esc(u.username)}">${av(statusColor[u.presence])}<div><b>${esc(u.username)}</b><span class="mu sm row" style="gap:6px"><i data-i="${u.presence==='in_game'?'mon':'mob'}" style="width:14px"></i>${esc(statusLabel(u))}</span></div></div>`).join('');
  }
  if(!html)html=items.length?box('Tidak ada hasil','Ubah pencarian atau filter.'):listState('friends','Belum ada teman','Buka tab Permintaan untuk menambahkan ID teman.');
  panels.friends.insertAdjacentHTML('beforeend',html+more('friends',l?.next));icons();
}
function drawDms(){const l=social.lists.dms,items=l?.items||[];panels.dms.replaceChildren(fab);panels.dms.insertAdjacentHTML('afterbegin',items.length?items.map(u=>`<div class="fr" style="padding:16px 0" role="link" tabindex="0" data-s="dm" data-id="${u.id}" data-name="${esc(u.username)}">${av()}<div style="flex:1"><div class="row sp"><b>${esc(u.username)}</b><span class="mu sm">${esc(ago(u.created_at))}</span></div><span class="mu">${esc(clip(u.body))}</span></div></div>`).join('')+more('dms',l.next):listState('dms','Belum ada pesan','Ketuk tombol pesan baru untuk memilih teman.'));}
function drawRequests(){const l=social.lists.requests,items=l?.items||[];panels.requests.replaceChildren(copyButton,requestTitle,addFriend);$('#rqn').textContent=items.length+(l?.next!=null?'+':'');addFriend.insertAdjacentHTML('beforebegin',items.length?items.map(u=>`<div class="card rq"><div class="row">${av()}<div><b>${esc(u.username)}</b><div class="mu sm">#${esc(u.tag)} · ${esc(ago(u.created_at))}</div></div></div><div class="row"><button class="btn" data-s="request" data-id="${u.id}" data-action="decline">Tolak</button><button class="btn r" data-s="request" data-id="${u.id}" data-action="accept">Terima</button></div></div>`).join('')+more('requests',l.next):listState('requests','Tidak ada permintaan','Bagikan ID atau tambahkan teman menggunakan ID mereka.'));}
function loadSocialTab(){return loadList(({t:'friends',m:'dms',r:'requests'})[socialTab()]);}
function drawServers(){const l=social.lists.servers;for(const rail of $$('.rail')){const plus=rail.querySelector('.add');rail.replaceChildren(plus);plus.insertAdjacentHTML('beforebegin',(l?.items||[]).map(s=>`<button class="${social.server?.id===s.id?'on':''}" data-s="server" data-id="${s.id}" aria-label="${esc(s.name)}" title="${esc(s.name)}"><i data-i="img"></i>${s.unread?`<em>${s.unread>99?'99+':s.unread}</em>`:''}</button>`).join('')+(l?.next!=null?'<button data-s="more" data-list="servers" aria-label="Muat server lainnya">…</button>':''));}if(!social.server&&cur==='komunitas')drawChannels();}
function drawChannels(){
  keepOnly(community,serverTitle,channelSearch);const s=social.server,l=social.lists.channels;
  serverTitle.innerHTML=s?`${esc(s.name)} <i data-i="rt" style="width:16px;color:var(--mu)"></i>`:'Komunitas';
  channelSearch.style.display=s?'':'none';
  if(!s){community.insertAdjacentHTML('beforeend',listState('servers','Belum ada server','Ketuk + untuk membuat server atau bergabung dengan kode undangan.'));return;}
  const q=channelSearch.querySelector('input').value.trim().toLowerCase(),items=(l?.key===s.id?l.items:[]).filter(c=>`${c.category} ${c.name}`.toLowerCase().includes(q));
  const groups=new Map();for(const c of items){if(!groups.has(c.category))groups.set(c.category,[]);groups.get(c.category).push(c);}
  let html='';for(const [category,cs] of groups){html+=`<div class="cat">${esc(category)} ⌄</div>`+cs.map(c=>`<button class="ch${c.unread?' u':''}" data-s="channel" data-id="${c.id}" data-name="${esc(c.name)}" data-type="${c.type}"><i data-i="${c.type==='voice'?'spk':'hash'}"></i>${esc(c.name)}${c.unread?` (${c.unread})`:''}</button>${c.type==='voice'&&c.users?.length?`<div class="mu sm">${c.users.slice(0,3).map(u=>esc(u.username)).join(', ')}${c.users.length>3?' +'+(c.users.length-3):''}</div>`:''}`).join('');}
  if(!html)html=listState('channels',q?'Kanal tidak ditemukan':'Belum ada kanal',q?'Ubah pencarian.':'Pemilik server dapat menambah kanal.');
  if(s.owner_id===social.me?.id)html+='<button class="ch" data-s="addchannel"><i data-i="plus"></i>Tambah kanal</button>';
  community.insertAdjacentHTML('beforeend',html+more('channels',l?.next));icons();
}
function loadServers(){return loadList('servers');}
function drawTemplates(){const l=social.lists.templates;templateOpts[1].innerHTML=(l?.items||[]).filter(t=>t.id!=='blank').map(t=>`<button data-s="template" data-template="${esc(t.id)}"><i data-i="img"></i>${esc(t.name)}</button>`).join('')||listState('templates','Belum ada template','Buat server untuk diri sendiri.');}
function openChat(scope,id,name){social.chat={scope,id,name};social.reply=null;social.pending=null;chatInput.value='';$('#chat').dataset.tab=scope==='dm'?'teman':'komunitas';go('chat');}
const chatUrl=()=>social.chat.scope==='dm'?`/api/dms/${social.chat.id}/messages`:`/api/channels/${social.chat.id}/messages`;
function highlighted(m){const names=new Set((m.mentions||[]).map(x=>x.toLowerCase()));let out='',last=0;for(const hit of m.body.matchAll(/(?<![\w@])@([A-Za-z0-9_.]{3,24})(?![A-Za-z0-9_.])/g)){out+=esc(m.body.slice(last,hit.index));out+=names.has(hit[1].toLowerCase())?`<span class="men">${esc(hit[0])}</span>`:esc(hit[0]);last=hit.index+hit[0].length;}return out+esc(m.body.slice(last));}
function drawMessage(m){const stamp=new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});return `<div class="msg" data-mid="${m.id}">${av()}<div>${m.reply_to?`<div class="reply">↪ ${esc(m.reply_username||'Pesan')} · ${esc(clip(m.reply_body||''))}</div>`:''}<b>${esc(m.username)}</b> <span class="mu sm">${esc(stamp)}</span><p style="white-space:pre-wrap;overflow-wrap:anywhere">${highlighted(m)}</p><button class="react" data-s="reaction" data-id="${m.id}" aria-pressed="${!!m.reacted}" aria-label="Reaksi jempol"><i data-i="up" style="width:16px"></i>${m.reactions||0}${m.reacted?' ✓':''}</button> <button class="react" data-s="reply" data-id="${m.id}">Balas</button></div></div>`;}
function drawChat(){const rows=[...social.messages.values()].sort((a,b)=>a.id-b.id);let day='';chatBody.innerHTML=rows.length?rows.map(m=>{const d=dayLbl(m.created_at),head=d!==day?`<div class="day">${esc(d)}</div>`:'';day=d;return head+drawMessage(m);}).join(''):social.loading?waitText():box('Belum ada pesan','Kirim pesan pertama untuk memulai obrolan.');icons();}
const bottom=()=>chatBody.scrollHeight-chatBody.scrollTop-chatBody.clientHeight<60;
function updateComposer(){const c=social.chat;chatInput.placeholder=social.reply?'Balas '+social.reply.username+' · Esc untuk batal':c?.scope==='dm'?'Pesan '+c.name:'Pesan #'+(c?.name||'');}
async function loadChat(){
  const c=social.chat;if(!c){chatHeader.textContent='Pesan';chatBody.innerHTML=box('Pilih obrolan','Buka teman atau kanal teks terlebih dahulu.');chatInput.disabled=true;return;}
  const token=++social.chatVersion;social.messages=new Map();social.before=null;social.loading=true;social.mark=null;chatHeader.textContent=(c.scope==='dm'?'':'# ')+c.name;chatSub.textContent=c.scope==='dm'?'Pesan langsung':'Kanal teks';chatInput.disabled=false;updateComposer();drawChat();
  const r=await api(chatUrl()+'?limit=50');if(token!==social.chatVersion)return;social.loading=false;
  if(!r.ok){social.messages.clear();chatBody.innerHTML=fail(r);chatInput.disabled=true;if(r.status===401)sError(r);return;}
  for(const m of r.data.items)if(!social.messages.has(m.id))social.messages.set(m.id,m);social.before=r.data.nextBefore;drawChat();chatBody.scrollTop=chatBody.scrollHeight;markRead();
}
async function older(){if(cur!=='chat'||!social.chat||social.loading||social.before==null)return;social.loading=true;const token=social.chatVersion,height=chatBody.scrollHeight,oldTop=chatBody.scrollTop;const r=await api(`${chatUrl()}?before=${social.before}&limit=50`);if(token!==social.chatVersion)return;social.loading=false;if(!r.ok){sError(r);return;}for(const m of r.data.items)if(!social.messages.has(m.id))social.messages.set(m.id,m);social.before=r.data.nextBefore;drawChat();chatBody.scrollTop=oldTop+chatBody.scrollHeight-height;}
function markRead(){if(cur!=='chat'||social.chat?.scope!=='channel'||!bottom()||document.hidden)return;const last=Math.max(0,...social.messages.keys());if(!last||social.mark?.last===last)return;const req='read'+(++social.seq);if(wsSend('read.mark',{channelId:social.chat.id,lastMsgId:last},req))social.mark={last,req};}
chatBody.addEventListener('scroll',()=>{if(chatBody.scrollTop<=25)older();if(bottom())markRead();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)markRead();});
function sendChat(){const c=social.chat,body=chatInput.value.trim();if(!c||!body||social.pending)return;if([...body].length>2000){socialNotice('Pesan maksimal 2000 karakter.');return;}const requestId='send'+(++social.seq),target=c.scope==='dm'?{dmUserId:c.id}:{channelId:c.id};if(!wsSend('message.send',{...target,body,replyTo:social.reply?.id??null},requestId)){socialNotice('Koneksi realtime terputus. Coba lagi.');return;}social.pending={requestId,text:chatInput.value,chat:c};}
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();sendChat();}if(e.key==='Escape'){social.reply=null;updateComposer();}});
function sameChat(e){const c=social.chat;if(!c||c.scope!==e.scope)return false;if(c.scope==='channel')return c.id===e.channelId;const m=e.message;return c.id===(m?(m.user_id===social.me.id?m.recipient_id:m.user_id):(e.senderId===social.me.id?e.recipientId:e.senderId));}
let badgeTimer;
function refreshBadges(){clearTimeout(badgeTimer);const g=social.generation;badgeTimer=setTimeout(()=>{if(g===social.generation&&(cur==='komunitas'||cur==='tambah'))loadServers();},200);}
function onSocialEvent(e){
  if(typeof kogaMedia!=='undefined'&&kogaMedia.event(e))return;
  if(e.type==='presence.update'){const u=social.lists.friends?.items.find(x=>x.id===e.userId);if(u){u.presence=e.presence;u.status_text=e.status_text;if(cur==='teman'&&socialTab()==='t')drawFriends();}return;}
  if(e.type==='friend.request'){if(cur==='teman')loadSocialTab();if(e.action==='removed'&&cur==='chat'&&social.chat?.scope==='dm'&&[e.userId,e.peerId].includes(social.chat.id))loadChat();return;}
  if(e.type==='message.new'){
    if(cur==='chat'&&sameChat(e)){const keep=bottom(),oldTop=chatBody.scrollTop;social.messages.set(e.message.id,e.message);drawChat();chatBody.scrollTop=keep?chatBody.scrollHeight:oldTop;if(keep)markRead();}
    if(e.scope==='dm'&&cur==='teman'&&socialTab()==='m')loadList('dms');if(e.scope==='channel')refreshBadges();return;
  }
  if(e.type==='reaction.update'&&cur==='chat'&&sameChat(e)){const m=social.messages.get(e.messageId);if(m){m.reactions=e.count;if(e.userId===social.me.id)m.reacted=e.reacted;const oldTop=chatBody.scrollTop;drawChat();chatBody.scrollTop=oldTop;}return;}
  if(e.type==='ack'||e.type==='error'){
    if(social.pending?.requestId===e.requestId){const p=social.pending;social.pending=null;if(e.type==='ack'&&social.chat===p.chat){if(chatInput.value===p.text)chatInput.value='';social.reply=null;updateComposer();}}
    if(social.mark?.req===e.requestId){if(e.type==='error')social.mark=null;else refreshBadges();}
    if(e.type==='error')socialNotice(e.error);return;
  }
}
Object.assign(loaders,{teman:loadSocialTab,komunitas:loadServers,tambah:loadServers,template:()=>loadList('templates'),chat:loadChat});
searchFriend.querySelector('input').addEventListener('input',drawFriends);channelSearch.querySelector('input').addEventListener('input',drawChannels);
// Delegasi sebelum handler navigasi lama agar tombol nyata tidak menjalankan placeholder tahap 1.
document.addEventListener('click',async e=>{
  const tab=e.target.closest('#teman .tabs [data-t]');if(tab){loadList(({t:'friends',m:'dms',r:'requests'})[tab.dataset.t]);return;}
  const t=e.target.closest('[data-s]');if(!t)return;e.preventDefault();e.stopImmediatePropagation();const action=t.dataset.s,id=Number(t.dataset.id);
  const post=(url,body)=>api('/api'+url,{method:'POST',body});const busy=async fn=>{if(t.disabled)return;t.disabled=true;try{await fn();}finally{t.disabled=false;}};
  if(!social.me){const r=await api('/api/me');if(!r.ok){sError(r);return;}socialSession(r.data.user);}
  if(action==='more'||action==='reload'){loadList(t.dataset.list,action==='more');return;}
  if(action==='collapse'){const g=t.dataset.group;social.collapsed.has(g)?social.collapsed.delete(g):social.collapsed.add(g);drawFriends();return;}
  if(action==='filter'){const val=window.prompt('Filter teman: 1 Semua, 2 Dalam Game, 3 Online, 4 Offline','1');const map={'1':'all','2':'in_game','3':'online','4':'offline'};if(map[val]){social.filter=map[val];drawFriends();}return;}
  if(action==='copytag'){copyId('#'+social.me.tag,'ID Koga');return;}
  if(action==='addfriend'){const tag=window.prompt('Masukkan ID Koga teman (#1232131)');if(tag===null)return;await busy(async()=>{const r=await post('/friends/request',{tag});r.ok?socialNotice('Permintaan dikirim.'):sError(r);});return;}
  if(action==='request'){await busy(async()=>{const r=await post(`/friends/requests/${id}/${t.dataset.action}`,{});if(r.ok)loadList('requests');else sError(r);});return;}
  if(action==='newdm'){$('#teman [data-t=t]').click();socialNotice('Pilih teman untuk memulai pesan.');return;}
  if(action==='dm'){openChat('dm',id,t.dataset.name);return;}
  if(action==='server'){const s=social.lists.servers?.items.find(x=>x.id===id);if(s){social.server=s;channelSearch.querySelector('input').value='';if(cur!=='komunitas')go('komunitas');else{drawServers();loadList('channels');}}return;}
  if(action==='invite'){if(social.server)copyId(social.server.code,'kode undangan');return;}
  if(action==='join'){const code=window.prompt('Masukkan kode undangan server');if(code===null)return;await busy(async()=>{const r=await post('/servers/join',{code});if(!r.ok)return sError(r);social.server=r.data;go('komunitas',true);});return;}
  if(action==='template'){social.tpl=t.dataset.template;go('jenis');return;}
  if(action==='kind'){social.kind=t.dataset.kind;go('atur');return;}
  if(action==='create'){await busy(async()=>{const r=await post('/servers',{name:$('#sname').value,template:social.tpl,kind:social.kind});if(!r.ok)return sError(r);social.server=r.data;$('#sname').value='';go('komunitas',true);});return;}
  if(action==='addchannel'){const name=window.prompt('Nama kanal');if(name===null)return;const category=window.prompt('Kategori kanal','Umum');if(category===null)return;const type=window.prompt('Tipe kanal: text atau voice','text');if(type===null)return;await busy(async()=>{const r=await post(`/servers/${social.server.id}/channels`,{name,category,type});if(r.ok)loadList('channels');else sError(r);});return;}
  if(action==='channel'){if(t.dataset.type==='voice'){kogaMedia.joinVoice(id,t.dataset.name);return;}openChat('channel',id,t.dataset.name);return;}
  if(action==='status'){const status_text=window.prompt('Atur status. Untuk dalam game: Bermain - Nama Game',social.me.status_text||'');if(status_text===null)return;await busy(async()=>{const r=await post('/me/status',{status_text});if(!r.ok)return sError(r);social.me.status_text=r.data.status_text;$('#pstat').textContent=r.data.status_text||'Online';});return;}
  if(action==='send'){sendChat();return;}
  if(action==='reaction'){if(!wsSend('reaction.toggle',{scope:social.chat.scope,messageId:id}))socialNotice('Koneksi realtime terputus.');return;}
  if(action==='reply'){const m=social.messages.get(id);if(m){social.reply=social.reply?.id===id?null:m;updateComposer();chatInput.focus();}return;}
},true);
// Chat dari voice belum memiliki kanal teks terpilih.
$('#voice [data-go=chat]').addEventListener('click',e=>{e.stopPropagation();socialNotice('Segera hadir');});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-s][role=button]')){e.preventDefault();e.target.click();}});
api('/api/me').then(r=>{if(r.ok){socialSession(r.data.user);go('profil',true);}else show('welcome');});
