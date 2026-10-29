import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHost, tick } from './client-host.mjs';

const resumes = {
 channel: h => h.emit(null, 'CHANNEL_SELECT'),
 reconnect: async h => { await h.emit(null, 'CONNECTION_CLOSED'); await h.emit(null, 'CONNECTION_OPEN'); },
 interrupted: async h => { await h.emit(null, 'CONNECTION_INTERRUPTED'); await h.emit(null, 'CONNECTION_RESUMED'); },
 foreground: async h => { for (const fn of h.changes) fn('background'); for (const fn of h.changes) fn('active'); await tick(); },
 delete: h => h.emit(null, 'MESSAGE_DELETE'),
 bulkDelete: h => h.emit(null, 'MESSAGE_DELETE_BULK'),
 edit: h => h.emit(null, 'MESSAGE_UPDATE', {message:{id:'123', content:'edit'}}),
 keyReplace: h => h.rt.setKey('synthetic_replacement_000000'),
 invalidate: async h => h.rt.auto.invalidate(),
 resume: async h => { h.rt.auto.pause(); h.rt.auto.resume(); },
};
const modes = { all:{incoming:false,ownReplies:false}, incoming:{incoming:false,ownReplies:true}, own:{incoming:true,ownReplies:false} };
for (const [name,mode] of Object.entries(modes)) for (const state of ['pending','failure']) {
 test(`bundle consent: revoke ${name}, ${state}, every resume path remains revoked`, async()=>{
  for (const [path,resume] of Object.entries(resumes)) {
   const h=clientHost(); let release; let write;
   try {
    const rt=await h.ready(); await rt.auto.configure({incoming:true,ownReplies:true});
    if(state==='pending')h.beforeSave(()=>new Promise(r=>release=r)); else h.failStorage(true);
    write=rt.auto.configure(mode);
    // Effective state changes before the write even starts.
    assert.equal(rt.diagnostics.incoming,mode.incoming,path); assert.equal(rt.diagnostics.ownReplies,mode.ownReplies,path);
    if(state==='failure') {
     await assert.rejects(write,{code:'preferences'});
     assert.match(rt.diagnostics.autoProblem,/session seulement/);
     assert.match(rt.diagnostics.autoProblem,/redémarrage/);
    } else await tick();
    assert.equal(h.prefs.incoming,true); assert.equal(h.prefs.ownReplies,true); // deliberately stale disk
    await resume(h);
    if(!mode.incoming)await h.emit(h.voice(2));
    if(!mode.ownReplies)await h.emit(h.voice(3,true));
    assert.equal(h.calls.filter(x=>x==='stt').length,0,`${path}: revoked transfer`);
    assert.equal(h.posts.length,0,`${path}: revoked publication`);
    assert.equal(rt.diagnostics.incoming,mode.incoming,path); assert.equal(rt.diagnostics.ownReplies,mode.ownReplies,path);
    if(state==='pending'){release();await write;}
    // A partial opt-out does not revoke the other, independently granted mode.
    if(mode.incoming || mode.ownReplies){await h.emit(h.voice(4,mode.ownReplies));assert.equal(h.calls.filter(x=>x==='stt').length,1,path);assert.equal(h.posts.length,mode.ownReplies?1:0,path);}
   } finally {release?.();await write?.catch(()=>{});h.stop();await tick();}
  }
 });
}

test('bundle consent: failed revoke then failed enable stays off; only successful explicit enable restores',async()=>{
 const h=clientHost();try{
  const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});
  h.failStorage(true);await assert.rejects(rt.auto.configure(modes.all));
  await assert.rejects(rt.auto.configure({incoming:true,ownReplies:true}));
  await resumes.reconnect(h);await h.emit(h.voice(2,true));await h.emit(h.voice(3));
  assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.posts.length,0);
  h.failStorage(false);let release;h.beforeSave(()=>new Promise(r=>release=r));
  const enable=rt.auto.configure({incoming:true,ownReplies:true});await tick();
  await resumes.channel(h);await h.emit(h.voice(4,true));await h.emit(h.voice(5));
  assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.posts.length,0);
  release();await enable;assert.equal(rt.diagnostics.autoProblem,'');
  await h.emit(h.voice(6,true));assert.equal(h.posts.length,1);
 }finally{h.stop();await tick();}
});

test('bundle consent: revoke cancels active work and queued obsolete enable cannot restore it',async()=>{
 const h=clientHost();let finish;let release;try{
  const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});
  rt.engine.run=()=>new Promise(r=>finish=r);rt.engine.cancel=()=>h.calls.push('cancel');
  const active=h.emit(h.voice(1,true));await tick();
  let first=true;h.beforeSave(async()=>{if(first){first=false;await new Promise(r=>release=r)}});
  const obsolete=rt.auto.configure({incoming:true,ownReplies:true});await tick();
  h.failStorage(true);const revoke=rt.auto.configure(modes.all);const rejected=assert.rejects(revoke);
  // Both writes fail; no older agreement is restored by either completion.
  const oldRejected=assert.rejects(obsolete);release();await Promise.all([oldRejected,rejected]);
  finish('late transcript');await active;assert(h.calls.includes('cancel'));assert.equal(h.posts.length,0);
  await resumes.reconnect(h);await h.emit(h.voice(2,true));assert.equal(h.posts.length,0);assert.equal(rt.diagnostics.ownReplies,false);
 }finally{finish?.('cleanup');release?.();h.stop();await tick();}
});

test('bundle consent: configure snapshots caller input; mutable object cannot grant consent',async()=>{
 const h=clientHost();try{const rt=await h.ready();const mode={incoming:false,ownReplies:false};
 const write=rt.auto.configure(mode);mode.incoming=true;mode.ownReplies=true;await write;
 await resumes.channel(h);await h.emit(h.voice(2,true));await h.emit(h.voice(3));
 assert.equal(h.prefs.external,false);assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.posts.length,0);
 }finally{h.stop();await tick();}
});
