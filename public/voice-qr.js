// Tahap 3: memakai layar dan kelas yang sudah ada; tidak membuat layout/stylesheet baru.
const kogaMedia=(()=>{
  const grid=$('#voice .vgrid'),title=$('#voice .top b'),mic=$('#voice [aria-label="Mikrofon"]'),speaker=$('#voice [aria-label="Speaker"]');
  const qrMine=$('#qr [data-p=k]'),qrScan=$('#qr [data-p=p]'),qrBox=qrMine.querySelector('.qr'),scanBox=qrScan.querySelector('.qr'),scanHelp=qrScan.querySelector('h2'),qrTitle=qrMine.querySelector('h2');
  const [share,copy]=qrMine.querySelectorAll('button');
  const voice={token:0,channel:null,starting:false,stream:null,config:null,users:new Map(),peers:new Map(),muted:false,silent:false,request:null,timer:null,joined:false};
  const scan={token:0,stream:null,timer:null,loading:null};
  const inviteParams=new URLSearchParams(location.search);
  let pendingTag=/^\d{7}$/.test(inviteParams.get('add')||'')?inviteParams.get('add'):null;
  let inviteResult=inviteParams.get('invite');
  let invitation=null;
  const stopTracks=s=>s?.getTracks().forEach(t=>t.stop());
  function mediaError(err,kind){
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)return `${kind} memerlukan HTTPS. Buka alamat HTTPS Koga (localhost hanya untuk pengujian).`;
    if(err?.name==='NotAllowedError'||err?.name==='SecurityError')return `Izin ${kind.toLowerCase()} ditolak. Izinkan di pengaturan situs/browser, lalu coba lagi.`;
    if(err?.name==='NotFoundError')return `${kind} tidak ditemukan. Hubungkan perangkat lalu coba lagi.`;
    if(err?.name==='NotReadableError')return `${kind} sedang digunakan atau tidak dapat dibuka. Tutup aplikasi lain lalu coba lagi.`;
    return `${kind} gagal: ${err?.message||'perangkat/browser tidak mendukung fitur ini.'}`;
  }
  const micIcon=off=>off?'<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#mic"/><path d="M3 3L21 21" stroke="currentColor" stroke-width="2"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#mic"/></svg>';
  function updateControls(){mic.setAttribute('aria-pressed',String(voice.muted));mic.title=voice.muted?'Aktifkan mikrofon':'Bisukan mikrofon';mic.innerHTML=micIcon(voice.muted);speaker.setAttribute('aria-pressed',String(voice.silent));speaker.title=voice.silent?'Aktifkan speaker':'Bisukan speaker';speaker.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#spk"/>${voice.silent?'<path d="M3 3L21 21" stroke="currentColor" stroke-width="2"/>':''}</svg>`;}
  function renderVoice(){grid.replaceChildren();for(const u of voice.users.values()){
    const card=document.createElement('div');card.className='vt';card.innerHTML='<i data-i="img"></i><span></span>';
    const label=card.querySelector('span');label.textContent=u.username+(u.id===social.me?.id?' (Anda)':'');
    if(u.muted){const mark=document.createElement('i');mark.innerHTML=micIcon(true);mark.title='Mikrofon dibisukan';mark.setAttribute('aria-label','Mikrofon dibisukan');label.append(' ',mark);}
    grid.append(card);
  }icons();updateControls();}
  function dropPeer(id){const p=voice.peers.get(id);if(!p)return;voice.peers.delete(id);p.pc.onicecandidate=p.pc.ontrack=p.pc.onconnectionstatechange=null;p.pc.close();if(p.audio){p.audio.pause();p.audio.srcObject=null;p.audio.remove();}}
  function endVoice(notify=true,back=false){const had=voice.channel;voice.token++;voice.starting=false;clearTimeout(voice.timer);voice.timer=null;
    if(notify&&had)wsSend('voice.leave',{channelId:had.id});for(const id of voice.peers.keys())dropPeer(id);stopTracks(voice.stream);Object.assign(voice,{channel:null,stream:null,config:null,users:new Map(),muted:false,silent:false,request:null,joined:false});renderVoice();if(back&&cur==='voice')go('komunitas',true);
  }
  const voiceError=t=>{endVoice(true,true);window.alert(t);};
  async function joinVoice(id,name){
    if(voice.starting)return;if(voice.channel)endVoice();if(!social.me||social.ws?.readyState!==WebSocket.OPEN){socialNotice('Koneksi realtime belum siap.');return;}
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){window.alert(mediaError(null,'Mikrofon'));return;}
    const token=++voice.token,g=social.generation;voice.starting=true;
    try{
      const r=await api('/api/rtc-config');if(token!==voice.token||g!==social.generation)return;if(!r.ok)throw Error(r.data.error||'Konfigurasi ICE tidak tersedia.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(token!==voice.token||g!==social.generation||cur!=='komunitas'){stopTracks(stream);return;}
      voice.stream=stream;voice.config=r.data;voice.channel={id,name};voice.request='voiceJoin'+(++social.seq);
      if(!wsSend('voice.join',{channelId:id},voice.request))throw Error('Koneksi realtime terputus.');
      voice.timer=setTimeout(()=>{if(voice.token===token&&!voice.joined)voiceError('Server tidak merespons join voice. Coba lagi.');},10000);
    }catch(e){if(token!==voice.token)return;endVoice();window.alert(mediaError(e,'Mikrofon'));}
    finally{if(token===voice.token)voice.starting=false;}
  }
  const sendSignal=(p,data)=>{if(voice.peers.get(p.user.id)!==p||!voice.channel)return;const frame={channelId:voice.channel.id,to:p.user.id,peerId:p.user.peerId,data};if(new TextEncoder().encode(JSON.stringify({type:'voice.signal',...frame})).length>16384){socialNotice('Signal voice terlalu besar.');return;}if(!wsSend('voice.signal',frame))socialNotice('Koneksi signaling terputus.');};
  function peer(u){
    let p=voice.peers.get(u.id);if(p?.user.peerId===u.peerId)return p;if(p)dropPeer(u.id);
    const pc=new RTCPeerConnection(voice.config),audio=document.createElement('audio');audio.autoplay=true;audio.muted=voice.silent;audio.hidden=true;$('#voice').append(audio);
    p={pc,audio,user:u,ice:[],queue:Promise.resolve()};voice.peers.set(u.id,p);
    for(const track of voice.stream.getAudioTracks())pc.addTrack(track,voice.stream);
    pc.onicecandidate=e=>{if(e.candidate)sendSignal(p,{type:'candidate',...e.candidate.toJSON()});};
    pc.ontrack=e=>{if(voice.peers.get(u.id)!==p)return;audio.srcObject=e.streams[0]||new MediaStream([e.track]);audio.play().catch(()=>socialNotice('Audio diblokir browser. Ketuk tombol Speaker untuk mengaktifkan.'));};
    pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'&&voice.peers.get(u.id)===p)socialNotice('Audio '+u.username+' gagal tersambung. Coba masuk ulang atau gunakan TURN.');};
    return p;
  }
  function enqueue(p,fn){p.queue=p.queue.then(async()=>{if(voice.peers.get(p.user.id)!==p)return;await fn();}).catch(e=>{if(voice.peers.get(p.user.id)===p)socialNotice('Koneksi voice gagal: '+e.message);});}
  function offer(u){const p=peer(u);enqueue(p,async()=>{await p.pc.setLocalDescription(await p.pc.createOffer());sendSignal(p,{type:'offer',sdp:p.pc.localDescription.sdp});});}
  function signal(e){const u=voice.users.get(e.from);if(!u||u.peerId!==e.peerId)return;const p=peer(u),d=e.data;enqueue(p,async()=>{
    if(d.type==='candidate'){const {type,...candidate}=d;if(!p.pc.remoteDescription){if(p.ice.length<128)p.ice.push(candidate);return;}await p.pc.addIceCandidate(candidate);return;}
    await p.pc.setRemoteDescription({type:d.type,sdp:d.sdp});for(const c of p.ice.splice(0))await p.pc.addIceCandidate(c);
    if(d.type==='offer'){await p.pc.setLocalDescription(await p.pc.createAnswer());sendSignal(p,{type:'answer',sdp:p.pc.localDescription.sdp});}
  });}
  function event(e){
    if(e.type==='voice.roster'){
      const l=social.lists.channels,c=l?.items.find(x=>x.id===e.channelId);if(l?.loading&&l.voiceUpdates.size<200)l.voiceUpdates.set(e.channelId,e.users);if(c){c.users=e.users;if(cur==='komunitas')drawChannels();}return true;
    }
    if(e.type==='error'&&e.requestId&&e.requestId===voice.request){voiceError(e.error);return true;}
    if(!e.type.startsWith('voice.'))return false;
    if(e.channelId!==voice.channel?.id)return true;
    if(e.type==='voice.peers'){
      clearTimeout(voice.timer);voice.timer=null;voice.request=null;voice.joined=true;voice.users=new Map([e.self,...e.peers].map(u=>[u.id,u]));
      title.textContent=voice.channel.name;go('voice');renderVoice();for(const u of e.peers)offer(u);return true;
    }
    if(e.type==='voice.left'){endVoice(false,true);socialNotice(e.reason||'Voice berakhir.');return true;}
    if(!voice.joined)return true;
    if(e.type==='voice.peer-joined'){dropPeer(e.user.id);voice.users.set(e.user.id,e.user);renderVoice();}
    if(e.type==='voice.peer-left'&&voice.users.get(e.userId)?.peerId===e.peerId){dropPeer(e.userId);voice.users.delete(e.userId);renderVoice();}
    if(e.type==='voice.signal')signal(e);
    if(e.type==='voice.state'){const u=voice.users.get(e.userId);if(u?.peerId===e.peerId){u.muted=e.muted;renderVoice();}}
    return true;
  }
  mic.removeAttribute('data-soon');speaker.removeAttribute('data-soon');
  mic.addEventListener('click',()=>{if(!voice.joined)return;voice.muted=!voice.muted;for(const t of voice.stream.getAudioTracks())t.enabled=!voice.muted;const self=voice.users.get(social.me.id);if(self)self.muted=voice.muted;wsSend('voice.state',{channelId:voice.channel.id,muted:voice.muted});renderVoice();});
  speaker.addEventListener('click',()=>{if(!voice.joined)return;const blocked=[...voice.peers.values()].filter(p=>p.audio.srcObject&&p.audio.paused);if(!voice.silent&&blocked.length){for(const p of blocked)p.audio.play().catch(()=>socialNotice('Audio belum dapat diputar.'));return;}voice.silent=!voice.silent;for(const p of voice.peers.values()){p.audio.muted=voice.silent;if(!voice.silent)p.audio.play().catch(()=>socialNotice('Audio belum dapat diputar.'));}updateControls();});
  // Kedua tombol kembali/akhiri menggunakan navigasi asli; screen() membersihkan media.
  grid.replaceChildren();title.textContent='Voice';updateControls();
  function stopScan(){scan.token++;clearTimeout(scan.timer);scan.timer=null;stopTracks(scan.stream);scan.stream=null;scanBox.replaceChildren();}
  function scanMessage(t){scanBox.textContent=t;}
  function qrTab(){return $('#qr .tabs .on')?.dataset.t;}
  function parseTag(text,base){try{const u=new URL(text),v=new URL(base);const m=/^\/add\/(\d{7})$/.exec(u.pathname);return u.origin===v.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&m?m[1]:null;}catch{return null;}}
  function loadDecoder(){if(typeof window.jsQR==='function')return Promise.resolve();if(!scan.loading)scan.loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/jsQR.js';s.onload=()=>typeof window.jsQR==='function'?resolve():reject(Error('jsQR tidak tersedia.'));s.onerror=()=>reject(Error('jsQR lokal belum terpasang. Jalankan npm ci.'));document.head.append(s);}).catch(e=>{scan.loading=null;throw e;});return scan.loading;}
  async function inviteLink(){const r=await api('/api/me/invite');if(!r.ok)throw Error(r.data.error||'Tautan undangan tidak tersedia.');return r.data.url;}
  async function mine(){stopScan();const t=scan.token,g=social.generation;invitation=null;qrTitle.textContent=social.me?`${social.me.username} #${social.me.tag}`:'Kode Saya';qrBox.textContent='Memuat kode QR…';
    try{const url=await inviteLink();if(t!==scan.token||cur!=='qr'||qrTab()!=='k'||g!==social.generation)return;invitation=url;const image=document.createElement('img');image.alt='QR akun kamu';image.src='/api/me/qr.svg';image.width=256;image.height=256;image.addEventListener('error',()=>{if(image.parentElement===qrBox)qrBox.textContent='QR gagal dimuat. Buka ulang tab ini.';});qrBox.replaceChildren(image);}
    catch(e){if(t===scan.token)qrBox.textContent=e.message;}
  }
  async function startScan(){stopScan();const t=scan.token;scanMessage('Meminta izin kamera…');scanHelp.textContent='Lanjutkan dengan memindai kode QR';
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){scanMessage(mediaError(null,'Kamera'));return;}
    try{
      const base=await inviteLink();if(t!==scan.token)return;
      let detector=null;if(window.BarcodeDetector){try{const supported=await BarcodeDetector.getSupportedFormats();if(supported.includes('qr_code'))detector=new BarcodeDetector({formats:['qr_code']});}catch{}}
      if(!detector)await loadDecoder();if(t!==scan.token)return;
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(t!==scan.token||cur!=='qr'||qrTab()!=='p'){stopTracks(stream);return;}
      scan.stream=stream;const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.width=280;video.height=280;video.srcObject=stream;scanBox.replaceChildren(video);await video.play();
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      async function tick(){if(t!==scan.token)return;try{
        let value;if(video.readyState>=2){if(detector){try{value=(await detector.detect(video))[0]?.rawValue;}catch{detector=null;await loadDecoder();}}
          if(!detector){const scale=Math.min(1,640/video.videoWidth);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));ctx.drawImage(video,0,0,canvas.width,canvas.height);const px=ctx.getImageData(0,0,canvas.width,canvas.height);value=window.jsQR(px.data,px.width,px.height)?.data;}}
        if(t!==scan.token)return;
        if(value){const tag=parseTag(value,base);if(!tag){scanHelp.textContent='QR bukan undangan Koga yang valid. Pindai ulang.';scan.timer=setTimeout(tick,1000);return;}
          stopScan();const after=scan.token;scanMessage('Mengirim permintaan…');const r=await api('/api/friends/request',{method:'POST',body:{tag}});if(after!==scan.token||cur!=='qr')return;
          if(r.ok){go('teman',true);$('#teman [data-t=r]').click();socialNotice('Permintaan teman dikirim.');}else{scanMessage(r.data.error||'Permintaan gagal. Pilih tab Pindai untuk mencoba lagi.');}return;}
        scan.timer=setTimeout(tick,180);
      }catch(e){if(t===scan.token){stopScan();scanMessage('Pemindai gagal: '+e.message+'. Pilih tab Pindai untuk mencoba lagi.');}}}
      tick();
    }catch(e){if(t===scan.token){stopScan();scanMessage(mediaError(e,'Kamera'));}}
  }
  share.removeAttribute('data-soon');copy.removeAttribute('data-soon');
  copy.addEventListener('click',()=>invitation?copyId(invitation,'link undangan'):socialNotice('Link undangan belum siap.'));
  share.addEventListener('click',async()=>{if(!invitation)return socialNotice('Link undangan belum siap.');if(navigator.share){try{await navigator.share({title:'Tambah teman Koga',url:invitation});return;}catch(e){if(e.name==='AbortError')return;}}copyId(invitation,'link undangan');});
  qrTitle.textContent='Kode Saya';qrBox.textContent='Memuat kode QR…';scanBox.textContent='Buka kamera untuk memindai kode QR.';
  // Listener document berjalan setelah navigasi tab bawaan selesai.
  document.addEventListener('click',e=>{if(cur==='qr'&&e.target.closest('#qr .tabs [data-t]'))qrTab()==='k'?mine():startScan();});
  function afterLogin(){if(pendingTag){const tag=pendingTag;pendingTag=null;location.replace('/add/'+tag);return;}if(inviteResult){const result=inviteResult;inviteResult=null;history.replaceState(null,'','/');go('teman',true);$('#teman [data-t=r]').click();socialNotice(({sent:'Permintaan teman dikirim.',pending:'Sudah berteman atau permintaan sudah ada.',self:'Tidak dapat menambah diri sendiri.'})[result]||'Undangan tidak valid.');}}
  function screen(id){
    if(id!=='qr'){stopScan();invitation=null;}else if(social.me){qrTab()==='k'?mine():startScan();}
    if(id!=='voice'&&(voice.channel||voice.starting))endVoice(true);
    if(id==='welcome'&&pendingTag)queueMicrotask(()=>{if(cur==='welcome'&&!social.me){go('auth',true);$('#auth [data-t=m]').click();}});
  }
  function session(){endVoice(true);stopScan();invitation=null;}
  function disconnected(){if(voice.channel||voice.starting){endVoice(false,true);socialNotice('Koneksi realtime terputus. Masuk ulang ke voice.');}}
  window.addEventListener('pagehide',()=>{endVoice(true);stopScan();});
  return {event,joinVoice,screen,session,disconnected,afterLogin};
})();
