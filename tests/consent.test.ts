import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MANUAL, ManualConsent, PreferenceStore, normalizeManual } from '../plugins/elevenlabs-transcription/js/consent.js';
// Disque et compte SYNTHÉTIQUES : prouvent la logique d’accord, pas le stockage JSON Android réel.
interface Auto { incoming: boolean; ownReplies: boolean; external: boolean; publish: boolean; accountId: string }
const DEFAULT_AUTO: Auto = { incoming: false, ownReplies: false, external: false, publish: false, accountId: '' };
const SECRET = 'synthetic_key_fixture_000000';
const manualOf = (disk: Record<string, unknown>) => disk.manual as Record<string, unknown>;
function fixture(initial: object = {}) {
  let disk: Record<string, unknown> = structuredClone(initial) as Record<string, unknown>; let fail = false; let readFail = false;
  // One-shot gates: the next write (or read) waits for the promise, later ones do not.
  let writeGate: Promise<void> | undefined; let readGate: Promise<void> | undefined;
  const writes: unknown[] = [];
  const raw = {
    // Snapshot first, then wait: models a read whose bytes left the disk before a later write landed.
    async get() { if (readFail) throw new Error('synthetic read failure'); const snapshot = structuredClone(disk) as unknown as Auto & { manual?: unknown }; if (readGate) { const gate = readGate; readGate = undefined; await gate; } return snapshot; },
    async set(value: Auto & { manual: unknown }, replace: true) {
      assert.equal(replace, true);
      if (writeGate) { const gate = writeGate; writeGate = undefined; await gate; }
      if (fail) throw new Error('synthetic disk failure');
      writes.push(structuredClone(value)); disk = structuredClone(value) as unknown as Record<string, unknown>;
    },
  };
  const store = new PreferenceStore<Auto>(raw, DEFAULT_AUTO);
  let account = '10'; let changes = 0;
  const consent = new ManualConsent(store, () => account, () => { changes++; });
  const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
  return { store, consent, writes, get disk() { return disk; }, fail: (v: boolean) => { fail = v; }, readFail: (v: boolean) => { readFail = v; },
    holdWrite: () => { const g = gate(); writeGate = g.promise; return g.release; }, holdRead: () => { const g = gate(); readGate = g.promise; return g.release; },
    account: (id: string) => { account = id; }, changes: () => changes };
}
test('closed by default; grants exposed only after write; publish requires external; document holds no secret', async () => {
  const f = fixture(); await f.consent.load();
  assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  const release = f.holdWrite();
  const grant = f.consent.set('external', true);
  await Promise.resolve(); assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  release(); await grant;
  assert.deepEqual(f.consent.mode(), { external: true, publish: false });
  assert.deepEqual(f.disk, { ...DEFAULT_AUTO, manual: { external: true, publish: false, accountId: '10' } });
  // publish alone is never effective without external; the write stays closed too
  const g = fixture(); await g.consent.load(); await g.consent.set('publish', true);
  assert.deepEqual(g.consent.mode(), { external: false, publish: false });
  assert.deepEqual(manualOf(g.disk), { external: false, publish: false, accountId: '10' });
  await f.consent.set('publish', true); assert.deepEqual(f.consent.mode(), { external: true, publish: true });
  assert(!JSON.stringify(f.writes).includes(SECRET)); assert.deepEqual(Object.keys(manualOf(f.disk)).sort(), ['accountId', 'external', 'publish']);
  assert(f.changes() > 0);
});
test('withdrawal is immediate, cascades publish, and reports honestly when the disk fails', async () => {
  const f = fixture(); await f.consent.load(); await f.consent.set('external', true); await f.consent.set('publish', true);
  const release = f.holdWrite();
  const revoke = f.consent.set('external', false);
  assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  await Promise.resolve(); assert.equal(manualOf(f.disk).external, true); // deliberately stale disk
  release(); await revoke; assert.deepEqual(manualOf(f.disk), { external: false, publish: false, accountId: '10' });
  await f.consent.set('external', true); await f.consent.set('publish', true); f.fail(true);
  await assert.rejects(f.consent.set('publish', false), { code: 'preferences' });
  assert.deepEqual(f.consent.mode(), { external: true, publish: false }); assert.match(f.consent.problem, /session seulement/); assert.match(f.consent.problem, /redémarrage/);
  assert.equal(manualOf(f.disk).publish, true);
  await assert.rejects(f.consent.set('publish', true), { code: 'preferences' });
  assert.deepEqual(f.consent.mode(), { external: true, publish: false }); assert.match(f.consent.problem, /rien n’est autorisé/);
  f.fail(false); await f.consent.set('publish', false); assert.equal(f.consent.problem, ''); assert.equal(manualOf(f.disk).publish, false);
});
test('account bound: other account sees nothing, unknown account cannot grant, regrant rebinds', async () => {
  const f = fixture({ ...DEFAULT_AUTO, manual: { external: true, publish: true, accountId: '10' } }); await f.consent.load();
  assert.deepEqual(f.consent.mode(), { external: true, publish: true });
  f.account('30'); assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  f.account(''); await assert.rejects(f.consent.set('external', true), { code: 'account' });
  f.account('30');
  const release = f.holdWrite();
  const grant = f.consent.set('external', true);
  // Another account's stored consent never leaks into the pending grant.
  await Promise.resolve(); assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  release(); await grant; assert.deepEqual(f.consent.mode(), { external: true, publish: false });
  assert.deepEqual(manualOf(f.disk), { external: true, publish: false, accountId: '30' });
  f.account('10'); assert.deepEqual(f.consent.mode(), { external: false, publish: false });
});
test('automation replace preserves manual consent; manual write preserves automation; stale read cannot regress', async () => {
  const f = fixture({ ...DEFAULT_AUTO, incoming: true, external: true, accountId: '10' }); await f.consent.load();
  const loaded = await f.store.automation.get(); assert.equal(loaded.incoming, true);
  await f.consent.set('external', true);
  assert.deepEqual(f.disk, { ...DEFAULT_AUTO, incoming: true, external: true, accountId: '10', manual: { external: true, publish: false, accountId: '10' } });
  const auto: Auto = { incoming: false, ownReplies: true, external: true, publish: true, accountId: '10' };
  await f.store.automation.set(auto, true);
  assert.deepEqual(f.disk, { ...auto, manual: { external: true, publish: false, accountId: '10' } });
  // A read that started before a write and resolves after it must not overwrite the newer state.
  const releaseRead = f.holdRead();
  const stale = f.store.load();
  await f.consent.set('publish', true);
  releaseRead(); assert.deepEqual(await stale, { external: true, publish: false, accountId: '10' });
  await f.store.automation.set({ ...auto, ownReplies: false }, true);
  assert.deepEqual(manualOf(f.disk), { external: true, publish: true, accountId: '10' });
  assert.equal((f.disk as Record<string, unknown>).ownReplies, false);
  assert.deepEqual(f.consent.mode(), { external: true, publish: true });
});
test('obsolete grant resolving after a newer withdrawal does not re-grant; stop closes everything', async () => {
  const f = fixture(); await f.consent.load();
  const release = f.holdWrite();
  const grant = f.consent.set('external', true);
  await Promise.resolve();
  const revoke = f.consent.set('external', false);
  assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  release(); await Promise.all([grant, revoke]);
  assert.deepEqual(f.consent.mode(), { external: false, publish: false }); assert.equal(manualOf(f.disk).external, false);
  assert.deepEqual(f.writes.map(w => manualOf(w as Record<string, unknown>).external), [true, false]);
  await f.consent.set('external', true); f.consent.stop();
  assert.deepEqual(f.consent.mode(), { external: false, publish: false });
  await assert.rejects(f.consent.set('external', true), { code: 'stopped' });
});
test('read failure fails closed with a visible problem; a later explicit grant recovers; malformed records normalized', async () => {
  const f = fixture({ ...DEFAULT_AUTO, manual: { external: true, publish: true, accountId: '10' } }); f.readFail(true);
  await f.consent.load(); assert.deepEqual(f.consent.mode(), { external: false, publish: false }); assert.match(f.consent.problem, /non lus/);
  f.readFail(false); await f.consent.set('external', true); assert.deepEqual(f.consent.mode(), { external: true, publish: false }); assert.equal(f.consent.problem, '');
  assert.deepEqual(normalizeManual({ external: 'true', publish: 1, accountId: 'abc' }), DEFAULT_MANUAL);
  assert.deepEqual(normalizeManual(null), DEFAULT_MANUAL);
  assert.deepEqual(normalizeManual({ external: true, publish: true, accountId: '10' }), { external: true, publish: true, accountId: '10' });
});
