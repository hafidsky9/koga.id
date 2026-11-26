// Salin decoder resmi yang dipin oleh package-lock, bukan dari CDN saat runtime.
const fs=require('fs');
const path=require('path');
const source=path.dirname(require.resolve('jsqr/package.json'));
const target=path.join(__dirname,'..','public','vendor');
fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(source,'dist','jsQR.js'),path.join(target,'jsQR.js'));
fs.copyFileSync(path.join(source,'LICENSE'),path.join(target,'jsQR.LICENSE'));
