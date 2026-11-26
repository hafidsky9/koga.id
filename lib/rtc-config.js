const {createHmac}=require('crypto');
function iceConfig(env=process.env,now=Date.now()){
  const stun=env.STUN_URL||'stun:stun.l.google.com:19302';
  const iceServers=[{urls:stun}];
  if(env.TURN_URL&&env.TURN_SECRET){
    const username=String(Math.floor(now/1000)+3600);
    const urls=env.TURN_URL.split(',').map(s=>s.trim()).filter(Boolean);
    if(urls.length)iceServers.push({urls:urls.length===1?urls[0]:urls,username,credential:createHmac('sha1',env.TURN_SECRET).update(username).digest('base64')});
  }
  return {iceServers};
}
module.exports=iceConfig;
