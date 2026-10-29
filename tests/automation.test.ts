import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoPipeline, type AutoHost, type VoiceEvent, type Reply } from '../plugins/elevenlabs-transcription/js/automation.js';
const time = 1800000000000;
const id=(offset:number)=>String((BigInt(time+offset)-1420070400000n)<<22n);
function fixture(){
 let now=time, account='10',channel='1',permission=true;
 const calls:string[]=[], replies:{channel:string;reply:Reply}[]=[], reserved=new Set<string>();
 const host:AutoHost={accountId:()=>account, selectedChannelId:()=>channel, canReply:()=>permission,
 async reserve(key){if(reserved.has(key))return false;reserved.add(key);calls.push('reserve');return true},
 async transcribe(){calls.push('stt');return 'Texte synthétique @everyone <@123>'},
 showLocal(){calls.push('local')},async sendReply(channel,reply){calls.push('reply');replies.push({channel,reply})},
 clearLocal(){calls.push('clear')},report(code){calls.push(code)}};
 const pipeline=new AutoPipeline(host,()=>now);
 const event=(offset=0,own=false):VoiceEvent=>({kind:own?'ack':'create',authorId:own?'10':'20',accountId:'10',live:true,sent:own,
 target:{channelId:'1',messageId:id(offset),attachmentId:'3',url:'https://cdn.discordapp.com/attachments/1/3/a.ogg',size:3,seconds:1,mime:'audio/ogg'}});
 const enable=()=>pipeline.configure({incoming:true,ownReplies:true},{externalProcessingAndCost:true,publishOwnReplies:true});
 return {host,pipeline,event,enable,calls,replies,reserved,advance:(n:number)=>now+=n,channel:(v:string)=>channel=v,account:(v:string)=>account=v,permission:(v:boolean)=>permission=v};
}
test('opt-in distinct processing/cost and own public replies; no implicit activation',async()=>{
 const f=fixture();assert.equal(f.pipeline.accept(f.event()),false);
 assert.throws(()=>f.pipeline.configure({incoming:true,ownReplies:false},{externalProcessingAndCost:false,publishOwnReplies:false}),{code:'consent'});
 assert.throws(()=>f.pipeline.configure({incoming:false,ownReplies:true},{externalProcessingAndCost:true,publishOwnReplies:false}),{code:'consent'});
 await f.pipeline.idle();assert(!f.calls.includes('stt'));
});
test('incoming renders locally only; own requires ACK/sent then replies to exact original without mentions',async()=>{
 const f=fixture();f.enable();assert(f.pipeline.accept(f.event()));await f.pipeline.idle();assert.equal(f.replies.length,0);assert(f.calls.includes('local'));
 const own=f.event(1,true);assert.equal(f.pipeline.accept({...own,kind:'create'}),false);assert.equal(f.pipeline.accept({...own,sent:false}),false);
 assert(f.pipeline.accept(own));await f.pipeline.idle();assert.equal(f.replies.length,1);
 assert.deepEqual(f.replies[0]!.reply.message_reference,{channel_id:'1',message_id:id(1),fail_if_not_exists:true});
 assert.deepEqual(f.replies[0]!.reply.allowed_mentions,{parse:[],replied_user:false});assert.equal(f.replies[0]!.channel,'1');
});
test('duplicates/edit/reconnect/startup/other-channel/account/future events never processed',async()=>{
 const f=fixture();f.enable();const e=f.event();assert(f.pipeline.accept(e));assert.equal(f.pipeline.accept(e),false);await f.pipeline.idle();
 for(const event of [{...f.event(1),live:false},f.event(-1),f.event(6000),{...f.event(1),accountId:'99'}, {...f.event(1),kind:'update'}])assert.equal(f.pipeline.accept(event as VoiceEvent),false);
 f.channel('2');assert.equal(f.pipeline.accept(f.event(1)),false);f.channel('1');f.account('99');assert.equal(f.pipeline.accept(f.event(1)),false);
 assert.equal(f.calls.filter(x=>x==='stt').length,1);
});
test('persistent reservation before STT; no retry after ambiguous send failure',async()=>{
 const f=fixture();f.enable();f.host.sendReply=async()=>{f.calls.push('send-failed');throw Error('network')};
 assert(f.pipeline.accept(f.event(0,true)));await f.pipeline.idle();assert.equal(f.pipeline.accept(f.event(0,true)),false);
 assert.deepEqual(f.calls.slice(1),['reserve','stt','send-failed','auto_failed_no_retry']);
 const next=new AutoPipeline(f.host,()=>time);next.configure({incoming:false,ownReplies:true},{externalProcessingAndCost:true,publishOwnReplies:true});
 assert(next.accept(f.event(0,true)));await next.idle();assert.equal(f.calls.filter(x=>x==='stt').length,1);
});
test('permissions checked before cost and again before publication',async()=>{
 const f=fixture();f.enable();f.permission(false);f.pipeline.accept(f.event(0,true));await f.pipeline.idle();assert(!f.calls.includes('stt'));assert(f.calls.includes('permission'));
 f.permission(true);f.host.transcribe=async()=>{f.permission(false);return 'safe'};f.pipeline.accept(f.event(1,true));await f.pipeline.idle();assert.equal(f.replies.length,0);
});
test('bounded queue and three attempts/minute, then recovery without automatic retry',async()=>{
 const f=fixture();f.enable();let done!:(v:string)=>void;f.host.transcribe=()=>new Promise(r=>done=r);
 f.pipeline.accept(f.event());await Promise.resolve();for(let i=1;i<=8;i++)assert(f.pipeline.accept(f.event(i)));
 assert.equal(f.pipeline.accept(f.event(9)),false);assert(f.calls.includes('queue_full'));
 f.host.transcribe=async()=>{f.calls.push('stt');return 'safe'};done('safe');await f.pipeline.idle();assert(f.calls.includes('rate_limit'));
 assert.equal(f.reserved.size,3);f.advance(61000);assert(f.pipeline.accept(f.event(61000)));await f.pipeline.idle();assert.equal(f.reserved.size,4);
});
test('pause/stop/disable/key-change cancellation and channel switch suppress late publication',async()=>{
 for(const action of ['pause','stop','disable','channel','account']){
  const f=fixture();f.enable();let done!:(v:string)=>void;let signal:AbortSignal|undefined;
  f.host.transcribe=(_t,s)=>{signal=s;return new Promise(r=>done=r)};
  f.pipeline.accept(f.event(0,true));await Promise.resolve();await Promise.resolve();
  if(action==='pause')f.pipeline.pause();if(action==='stop')f.pipeline.stop();if(action==='disable')f.pipeline.configure({incoming:false,ownReplies:false},{externalProcessingAndCost:false,publishOwnReplies:false});
  if(action==='channel')f.channel('2');if(action==='account')f.account('99');done('late');await f.pipeline.idle();assert.equal(f.replies.length,0);
  if(['pause','stop','disable'].includes(action))assert.equal(signal!.aborted,true);
 }
});
test('reservation failure, STT failure, oversized text fail safely; feedback text not a voice',async()=>{
 const f=fixture();f.enable();f.host.reserve=async()=>{throw Error()};f.pipeline.accept(f.event());await f.pipeline.idle();assert(!f.calls.includes('stt'));
 const g=fixture();g.enable();g.host.transcribe=async()=>{throw Error()};g.pipeline.accept(g.event());await g.pipeline.idle();assert.equal(g.replies.length,0);assert(g.calls.includes('auto_failed_no_retry'));
 const h=fixture();h.enable();h.host.transcribe=async()=>'x'.repeat(1851);h.pipeline.accept(h.event(0,true));await h.pipeline.idle();assert.equal(h.replies.length,0);assert(h.calls.includes('reply_too_long'));assert(h.calls.includes('local'));
 assert.equal(h.pipeline.accept({...h.event(1),target:{...h.event(1).target,mime:'text/plain'}}),false);
});
test('resume rejects replay older than reconnect barrier; queued tasks expire before STT',async()=>{
 const f=fixture();f.enable();f.pipeline.pause();f.advance(100);f.pipeline.resume();
 assert.equal(f.pipeline.accept(f.event(50)),false);assert(f.pipeline.accept(f.event(100)));await f.pipeline.idle();
 const g=fixture();g.enable();let done!:(v:string)=>void;g.host.transcribe=()=>new Promise(r=>done=r);
 g.pipeline.accept(g.event());await Promise.resolve();await Promise.resolve();g.pipeline.accept(g.event(1));
 g.advance(61001);done('expired');await g.pipeline.idle();assert.equal(g.reserved.size,1);assert(!g.calls.includes('local'));
});
