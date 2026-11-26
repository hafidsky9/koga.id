const router=require('express').Router();
const QRCode=require('qrcode');
const {bad,currentUser}=require('../lib/http');
const requestFriend=require('../lib/friend-request');
const iceConfig=require('../lib/rtc-config');
function baseUrl(){try{const u=new URL(process.env.BASE_URL);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();return u.origin;}catch{throw bad('BASE_URL Koga belum dikonfigurasi dengan benar.',503);}}
const inviteUrl=u=>`${baseUrl()}/add/${u.tag}`;
const logged=fn=>(req,res,next)=>{Promise.resolve().then(()=>{const u=currentUser(req);if(!u)throw bad('Belum masuk.',401);return fn(req,res,u);}).catch(next);};
router.get('/api/rtc-config',logged((req,res)=>res.json(iceConfig())));
router.get('/api/me/invite',logged((req,res,u)=>res.json({url:inviteUrl(u)})));
router.get('/api/me/qr.svg',logged(async(req,res,u)=>{const svg=await QRCode.toString(inviteUrl(u),{type:'svg',margin:4,errorCorrectionLevel:'M'});res.type('image/svg+xml').send(svg);}));
// URL undangan publik: validasi format sebelum login; cek target dan mutasi hanya dengan sesi.
// HEAD/prefetch/subresource tidak boleh menyebabkan permintaan teman.
router.get('/add/:tag',(req,res,next)=>{try{
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
  if(req.method!=='GET'||(req.get('sec-fetch-mode')&&req.get('sec-fetch-mode')!=='navigate')||/prefetch|prerender/i.test((req.get('purpose')||'')+' '+(req.get('sec-purpose')||'')))return res.status(405).json({error:'Buka undangan melalui navigasi browser.'});
  if(!/^\d{7}$/.test(req.params.tag))throw bad('ID teman tidak valid.');
  const u=currentUser(req);if(!u)return res.redirect(302,`/?add=${req.params.tag}`);
  const target=requestFriend.target(req.params.tag);
  if(u.id===target.id)return res.redirect(302,'/?invite=self');
  try{requestFriend(u.id,target.tag);}catch(e){if(e.expose&&e.status===409)return res.redirect(302,'/?invite=pending');throw e;}
  res.redirect(302,'/?invite=sent');
}catch(e){next(e);}});
module.exports=router;
