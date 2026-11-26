const { db }=require('../db');
const { bad }=require('./http');
const S=require('./social');
const R=require('./realtime');
const byTag=db.prepare('SELECT id,username,tag FROM users WHERE tag=?');
const insertRequest=db.prepare('INSERT INTO friend_requests(from_id,to_id,created_at) VALUES(?,?,?)');
function target(value){const tag=S.str(value).replace(/^#/,'');if(!/^\d{7}$/.test(tag))throw bad('Masukkan ID 7 digit.');const u=byTag.get(tag);if(!u)throw bad('ID teman tidak ditemukan.',404);return u;}
function requestFriend(uid,value){
  const u=target(value);if(u.id===uid)throw bad('Tidak dapat menambah diri sendiri.');if(S.areFriends(uid,u.id))throw bad('Sudah berteman.',409);
  let result;try{result=insertRequest.run(uid,u.id,S.now());}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')throw bad('Permintaan sudah ada.',409);throw e;}
  const id=Number(result.lastInsertRowid);R.broadcast([u],{type:'friend.request',action:'new',id,userId:uid});return {ok:true,id};
}
module.exports=requestFriend;module.exports.target=target;
