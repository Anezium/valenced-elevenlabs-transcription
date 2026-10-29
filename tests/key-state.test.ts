import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyState, type Vault } from '../plugins/elevenlabs-transcription/js/key-state.js';
const A = 'synthetic_key_fixture_000000', B = 'synthetic_replacement_111111';
function fixture() {
  let disk: string | null = null; const ops: string[] = [];
  const vault: Vault = { async load() { ops.push('load'); return disk; }, async save(v) { ops.push('save'); disk = v; }, async delete() { ops.push('delete'); disk = null; } };
  return {vault,ops,make:()=>new KeyState(vault,()=>{})};
}
test('serialized init/save/replace/delete; restart uses same vault, never stale init',async()=>{
  const f=fixture(), k=f.make();const init=k.load(), save=k.save(A);await Promise.all([init,save]);assert.equal(k.key,A);
  await k.save(B);assert.equal(k.key,B);k.stop();assert.equal(k.key,'');
  const next=f.make();await next.load();assert.equal(next.key,B);await next.delete();assert.equal(next.key,'');
  const last=f.make();await last.load();assert.equal(last.key,'');assert.deepEqual(f.ops,['load','save','save','load','delete','load']);
});
test('background zeroes JS but restores from vault without re-entry',async()=>{
 const f=fixture(),k=f.make();await k.save(A);k.suspend();assert.equal(k.key,'');await k.resume();assert.equal(k.key,A);
});
test('native failures fail closed; later operation recovers; no false saved state',async()=>{
 const f=fixture(),k=f.make();await k.save(A);f.vault.save=async()=>{throw Error('native failure')};
 await assert.rejects(k.save(B));assert.equal(k.key,'');await k.load();assert.equal(k.key,A);
 f.vault.load=async()=>{throw Error('invalidated')};await assert.rejects(k.load());assert.equal(k.key,'');
});
test('stop during load/save prevents late key resurrection; rejects queued writes',async()=>{
 for(const op of ['load','save'] as const){let done!: (value:any)=>void;const wait=new Promise<any>(r=>done=r);
 const vault:Vault={load:()=>wait,save:()=>wait,async delete(){}};const k=new KeyState(vault,()=>{});
 const active=op==='load'?k.load():k.save(A);await Promise.resolve();const queued=k.save(B);k.stop();done(A);
 await active;await assert.rejects(queued,{code:'stopped'});assert.equal(k.key,'');}
});
test('delete/save preserves order despite failing delete; malformed loaded key refused',async()=>{
 const f=fixture(),k=f.make();f.vault.delete=async()=>{throw Error()};await assert.rejects(k.delete());await k.save(A);assert.equal(k.key,A);
 f.vault.load=async()=>'invalid';await assert.rejects(k.load(),{code:'key'});assert.equal(k.key,'');
});
test('concurrent initializations and replacement never overlap native operations', async () => {
 const AWAITERS = 12; let active = 0, maximum = 0, disk: string | null = A;
 const native = async <T>(work: () => T): Promise<T> => {
  active++; maximum = Math.max(maximum, active);
  try { await Promise.resolve(); return work(); } finally { active--; }
 };
 const k = new KeyState({load: () => native(() => disk), save: v => native(() => { disk = v; }), delete: () => native(() => { disk = null; })}, () => {});
 const loads = Array.from({length: AWAITERS}, () => k.load());
 const saved = k.save(B); await Promise.all([...loads, saved]);
 assert.equal(maximum, 1); assert.equal(k.key, B); assert.equal(disk, B);
});
test('suspend during native save cannot resurrect memory; foreground reloads committed value', async () => {
 let finish!: () => void; let disk: string | null = null;
 const pending = new Promise<void>(r => finish = r);
 const vault: Vault = {async load() { return disk; }, async save(v) { await pending; disk = v; }, async delete() { disk = null; }};
 const k = new KeyState(vault, () => {}); const save = k.save(A); await Promise.resolve();
 k.suspend(); finish(); await save; assert.equal(k.key, ''); assert.equal(disk, A);
 await k.resume(); assert.equal(k.key, A);
 const reload = new KeyState(vault, () => {}); k.stop(); await reload.load(); assert.equal(reload.key, A);
});
test('delete failure is explicit, clears memory, and does not pretend disk was erased', async () => {
 const f = fixture(), k = f.make(); await k.save(A);
 const nativeDelete = f.vault.delete;
 f.vault.delete = async () => { throw Error('fixture I/O failure'); };
 const deleted = k.delete(); assert.equal(k.key, ''); await assert.rejects(deleted);
 const restarted = f.make(); await restarted.load(); assert.equal(restarted.key, A);
 // Caller must show failure/retry, never a successful deletion status.
 f.vault.delete = nativeDelete; await restarted.delete();
 const afterRetry = f.make(); await afterRetry.load(); assert.equal(afterRetry.key, '');
});
test('delete revokes immediately and late init never resurfaces the deleted key',async()=>{
 let finish!:(value:string)=>void;const pending=new Promise<string>(r=>finish=r);let state:KeyState;
 const observed:string[]=[];const vault:Vault={load:()=>pending,async save(){},async delete(){}};
 state=new KeyState(vault,()=>observed.push(state.key));
 const load=state.load();await Promise.resolve();const deleted=state.delete();finish(A);
 await Promise.all([load,deleted]);assert.equal(state.key,'');assert(!observed.includes(A));
});
