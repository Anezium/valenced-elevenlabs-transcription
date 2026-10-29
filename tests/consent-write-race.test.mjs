import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHost, tick } from './client-host.mjs';

test('bundle consent: older successful write cannot restore consent while newer revoke fails',async()=>{
 const h=clientHost();let release;try{
  const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});
  let saves=0;h.beforeSave(async()=>{if(++saves===1)await new Promise(r=>release=r);else throw Error('synthetic revoke failure')});
  const obsolete=rt.auto.configure({incoming:true,ownReplies:true});await tick();
  const revoke=rt.auto.configure({incoming:false,ownReplies:false});const rejected=assert.rejects(revoke,{code:'preferences'});
  release();await obsolete;await rejected;
  assert.equal(h.prefs.external,true); // old write persisted, NOT effective consent
  await h.emit(null,'CONNECTION_OPEN');await h.emit(null,'CHANNEL_SELECT');
  await h.emit(h.voice(2,true));await h.emit(h.voice(3));
  assert.equal(rt.diagnostics.incoming,false);assert.equal(rt.diagnostics.ownReplies,false);
  assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.posts.length,0);
  h.beforeSave(async()=>{});await rt.auto.configure({incoming:false,ownReplies:false});
  h.stop();await tick();h.start();await tick();
  assert.equal(h.rt.diagnostics.incoming,false);assert.equal(h.rt.diagnostics.ownReplies,false);
 }finally{release?.();h.stop();await tick();}
});
