import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHost, tick } from './client-host.mjs';

test('actual bundle: default opt-out, explicit persisted consent then incoming inline row only',async()=>{
 const h=clientHost();const rt=await h.ready();assert.equal(rt.diagnostics.autoReady,true);
 await h.emit(h.voice());assert.equal(h.calls.filter(x=>x==='stt').length,0);
 await rt.auto.configure({incoming:true,ownReplies:false});assert.equal(h.prefs.external,true);assert.equal(h.prefs.publish,false);
 const vocal=h.voice(2);await h.emit(vocal);assert.equal(h.calls.filter(x=>x==='stt').length,1);assert.equal(h.posts.length,0);
 const row=new h.RowManager().generate({message:vocal});assert.equal(row.changeType,2);assert.match(row.message.content.at(-1).content,/Local transcript/);
 assert.match(row.message.content.at(-1).content,/@everyone/);assert.equal(row.message.content.at(-1).type,'text');
 assert.equal(vocal.content,'');assert.equal(vocal.attachments.length,1);assert.equal(h.network,0);
 const again=new h.RowManager().generate({message:vocal});assert.equal(again.message.content.length,2); // never duplicate cached nodes
 h.stop();await tick();assert.equal(h.RowManager.prototype.generate,h.originalRow);
});
test('actual bundle: own SENDING/read ACK ignored; SENT create/server success posts genuine referenced HTTP body once',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});
 assert.equal(h.prefs.publish,true);
 const own=h.voice(2,true);await h.emit({...own,state:'SENDING'});assert.equal(h.posts.length,0);
 await h.emit({...own,state:'SENT'},'MESSAGE_ACK');assert.equal(h.posts.length,0);
 await h.emit(own,'MESSAGE_SEND_SUCCESS');assert.equal(h.posts.length,1);
 const post=h.posts[0];assert.equal(post.url,'/channels/1/messages');assert.equal(post.retries,0);
 assert.deepEqual(post.body.message_reference,{channel_id:'1',message_id:own.id,fail_if_not_exists:true});
 assert.deepEqual(post.body.allowed_mentions,{parse:[],replied_user:false});assert.equal(post.body.enforce_nonce,true);assert.equal(post.body.nonce,`stt${own.id}`);
 assert.equal(post.body.content,'Transcript:\nTexte synthétique @everyone <@123>');await h.emit(own);assert.equal(h.posts.length,1);
 await h.emit({...h.voice(3,true),flags:0,content:post.body.content,attachments:[]});assert.equal(h.posts.length,1); // no feedback
 assert.equal(h.network,0);h.stop();await tick();
});
test('actual bundle: autrui is never public, optimistic/edit/history/bot/ephemeral events skipped',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});
 const v=h.voice(2);await h.emit(v,'MESSAGE_CREATE',{optimistic:true});await h.emit(v,'MESSAGE_UPDATE');
 await h.emit(h.voice(-1000));await h.emit({...h.voice(3),author:{id:'20',bot:true}});await h.emit({...h.voice(4),flags:8192|64});
 assert.equal(h.calls.filter(x=>x==='stt').length,0);await h.emit(v);assert.equal(h.calls.filter(x=>x==='stt').length,1);assert.equal(h.posts.length,0);h.stop();await tick();
});
test('actual bundle: prefs restored on restart, scoped to account, no duplicate replay after reconnect',async()=>{
 const h=clientHost();let rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});const old=h.voice(1,true);await h.emit(old);assert.equal(h.posts.length,1);
 h.stop();await tick();h.clock(100);h.start();await tick();rt=h.rt;assert.equal(rt.diagnostics.ownReplies,true);
 rt.engine.run=async()=>{h.calls.push('stt');return 'restored'};await h.emit(old);assert.equal(h.posts.length,1);
 await h.emit(h.voice(2,true));assert.equal(h.posts.length,2);
 await h.emit(null,'CONNECTION_CLOSED');h.clock(100);const replay=h.voice(-50,true);await h.emit(replay);assert.equal(h.posts.length,2);
 await h.emit(null,'CONNECTION_OPEN');await h.emit(replay);assert.equal(h.posts.length,2);
 h.account('30');await h.emit(h.voice(3,true));assert.equal(h.posts.length,2);assert.equal(h.rt.diagnostics.ownReplies,false);h.stop();await tick();
});
test('actual bundle: permission failure prevents cost; HTTP failure no retry and durable reservation survives same-id event',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:false,ownReplies:true});h.permission(false);
 await h.emit(h.voice(2,true));assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.posts.length,0);
 h.permission(true);h.failReply(true);const v=h.voice(3,true);await h.emit(v);assert.equal(h.posts.length,1);assert.match(rt.diagnostics.autoProblem,/auto_failed_no_retry/);
 await h.emit(v,'MESSAGE_SEND_SUCCESS');assert.equal(h.posts.length,1);assert.equal(h.network,0);h.stop();await tick();
});
test('actual bundle: missing or ambiguous host capabilities refuse enabling; disabling persists despite loss',async()=>{
 for(const name of ['HTTP','Endpoints','RowManager']){
  const h=clientHost({missing:[name]});const rt=await h.ready();assert.equal(rt.diagnostics.autoReady,false);
  await assert.rejects(rt.auto.configure({incoming:true,ownReplies:false}),{code:'hooks'});await h.emit(h.voice());assert.equal(h.posts.length,0);h.stop();await tick();
 }
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});h.discover('HTTP',{HTTP:{post:async()=>{throw Error('must never call duplicate')}}});
 assert.equal(rt.diagnostics.autoReady,false);await rt.auto.configure({incoming:false,ownReplies:false});assert.equal(h.prefs.external,false);h.stop();await tick();
});
test('actual bundle: background/key delete/disable cancel active STT and remove inline text, no late public reply',async()=>{
 for(const action of ['background','delete','disable','stop']){
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:true});let finish;
 rt.engine.run=()=>new Promise(r=>finish=r);rt.engine.cancel=()=>h.calls.push('cancel');
 // Do not await emit while STT intentionally held.
 const v=h.voice(2,true);const pending=h.emit(v);await tick();
 if(action==='background')for(const fn of h.changes)fn('background');
 if(action==='delete')await rt.forget();if(action==='disable')await rt.auto.configure({incoming:false,ownReplies:false});if(action==='stop')h.stop();
 finish('late text');await pending;assert.equal(h.posts.length,0);assert(h.calls.includes('cancel'));if(action!=='stop')h.stop();await tick();
 }
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:false});const v=h.voice(2);await h.emit(v);
 assert.equal(new h.RowManager().generate({message:v}).message.content.length,2);
 for(const fn of h.changes)fn('background');await tick();assert.equal(new h.RowManager().generate({message:v}).message.content.length,1);
 h.stop();await tick();assert([...h.callbacks.values()].every(set=>set.size===0));assert([...h.finders.values()].every(set=>set.size===0));assert.equal(h.changes.size,0);
});
test('actual bundle: failed preference write never activates cost or posting; malformed prefs stay off',async()=>{
 const h=clientHost({prefs:{incoming:'true',ownReplies:1,external:true,publish:true,accountId:'10'}});const rt=await h.ready();assert.equal(rt.diagnostics.incoming,false);assert.equal(rt.diagnostics.ownReplies,false);
 h.failStorage(true);await assert.rejects(rt.auto.configure({incoming:true,ownReplies:true}));await h.emit(h.voice(2,true));assert.equal(h.posts.length,0);assert.equal(h.calls.filter(x=>x==='stt').length,0);h.stop();await tick();
});
test('actual bundle: rendered settings switches persist separate initial cost/publication controls, never a key nor implied manual consent',async()=>{
 const h=clientHost();const rt=await h.ready();rt.update({openAuto:true});
 const switches=()=>h.collect(h.definition.SettingsComponent()).filter(x=>x.type==='TableSwitchRow').map(x=>x.props);
 const rows=()=>h.collect(h.definition.SettingsComponent()).filter(x=>x.type===h.ActionSheetRow).map(x=>x.props);
 let incoming=switches().find(x=>x.label.startsWith('Transcribe others’ messages'));assert(incoming);assert.equal(incoming.disabled,false);assert.equal(incoming.value,false);
 assert.equal(rows().find(x=>x.label==='Turn off all automation'),undefined);
 incoming.onValueChange(true);await tick();assert.equal(h.prefs.incoming,true);assert.equal(h.prefs.ownReplies,false);assert.equal(h.prefs.publish,false);
 const own=switches().find(x=>x.label.startsWith('Auto-publish my transcripts'));own.onValueChange(true);await tick();assert.equal(h.prefs.ownReplies,true);assert.equal(h.prefs.publish,true);
 assert.deepEqual(Object.keys(h.prefs).sort(),['accountId','external','incoming','manual','ownReplies','publish']);assert(!JSON.stringify(h.prefs).includes(rt.key));
 assert.deepEqual(h.prefs.manual,{external:false,publish:false,accountId:''});assert.deepEqual(rt.consent.mode(),{external:false,publish:false}); // automatic consent never implies manual consent
 assert.equal(switches().find(x=>x.label.startsWith('Transcribe others’ messages')).value,true);
 rows().find(x=>x.label==='Turn off all automation').onPress();await tick();assert.equal(h.prefs.external,false);assert.equal(h.prefs.publish,false);h.stop();await tick();
});
test('actual bundle: manual recovery requires explicit publish consent and own cached vocal',async()=>{
 const h=clientHost();const rt=await h.ready();const own=h.voice(2,true);await h.emit(own);
 const target={channelId:'1',messageId:own.id,attachmentId:'3',url:own.attachments[0].url,size:3,seconds:1,mime:'audio/ogg'};
 rt.engine.cached=()=> 'manual transcript';assert.equal(rt.auto.canReplyTo(target),true);
 await assert.rejects(rt.auto.replyManually(target,'manual transcript',false),{code:'consent'});assert.equal(h.posts.length,0);
 await rt.auto.replyManually(target,'manual transcript',true);assert.equal(h.posts.length,1);assert.equal(h.posts[0].body.content,'Transcript:\nmanual transcript');assert.equal(h.prefs.ownReplies,undefined);
 assert.equal(h.posts[0].body.message_reference.message_id,own.id);
 h.records.set(`1/${own.id}`,{...own,author:{id:'20'}});await assert.rejects(rt.auto.replyManually(target,'manual transcript',true),{code:'reply'});assert.equal(h.posts.length,1);h.stop();await tick();
});
test('actual bundle: queued enable then disable cannot briefly resume after obsolete disk write',async()=>{
 const h=clientHost();const rt=await h.ready();let release;const held=new Promise(r=>release=r);let first=true;
 h.beforeSave(async()=>{if(first){first=false;await held}});
 const enable=rt.auto.configure({incoming:true,ownReplies:true});await tick();const disable=rt.auto.configure({incoming:false,ownReplies:false});
 release();await Promise.all([enable,disable]);await h.emit(h.voice(2,true));assert.equal(h.calls.filter(x=>x==='stt').length,0);assert.equal(h.prefs.external,false);assert.equal(rt.diagnostics.ownReplies,false);h.stop();await tick();
});
test('actual bundle: incompatible row fails closed and unrelated row identity is never annotated',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:false});
 const v=h.voice(2);await h.emit(v);
 const unrelated={...v,id:'123'};assert.equal(new h.RowManager().generate({message:unrelated}).message.content.length,1);
 new h.RowManager().generate({message:{id:'invalid'}});assert.equal(rt.diagnostics.autoReady,false);
 await h.emit(h.voice(3));assert.equal(h.calls.filter(x=>x==='stt').length,1);h.stop();await tick();
});

test('actual bundle: duplicate row module clears local refreshes before unpatch and suspends automation',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:true,ownReplies:false});
 const v=h.voice(2);await h.emit(v);assert.equal(new h.RowManager().generate({message:v}).message.content.length,2);
 class OtherRowManager { generate(){throw Error('ambiguous module must not be patched')} }
 h.discover('RowManager',OtherRowManager);await tick();assert.equal(rt.diagnostics.autoReady,false);
 assert.equal(h.RowManager.prototype.generate,h.originalRow);await h.emit(h.voice(3));assert.equal(h.calls.filter(x=>x==='stt').length,1);h.stop();await tick();
});

test('actual bundle: queued voices stay bounded and rate limited through the concrete adapter',async()=>{
 const h=clientHost();const rt=await h.ready();await rt.auto.configure({incoming:false,ownReplies:true});let finish;let runs=0;
 rt.engine.run=async()=>{runs++;if(runs===1)return new Promise(r=>finish=r);return 'queued'};
 const first=h.emit(h.voice(1,true));await tick();const rest=[];for(let n=2;n<=12;n++)rest.push(h.emit(h.voice(n,true)));
 await tick();assert.match(rt.diagnostics.autoProblem,/queue_full/);finish('first');await Promise.all([first,...rest]);
 assert.equal(runs,3);assert.equal(h.posts.length,3);assert.equal(h.reservations.size,3);assert.match(rt.diagnostics.autoProblem,/rate_limit/);h.stop();await tick();
});
