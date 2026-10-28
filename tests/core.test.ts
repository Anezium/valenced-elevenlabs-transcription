import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, SafeError, Transcriber, bytesToBase64, compatibleClient, extractTarget, safeMessage, validateAudioURL } from '../plugins/elevenlabs-transcription/js/core.js';
import type { Files, Target, Transport } from '../plugins/elevenlabs-transcription/js/core.js';
import { findUniqueSheet } from '../plugins/elevenlabs-transcription/js/tree.js';
// Toutes les données de ce fichier sont des fixtures synthétiques, jamais un audio/API réel.
const key = 'synthetic_key_fixture_000000';
const target: Target = { channelId: '1', messageId: '2', attachmentId: '3', url: 'https://cdn.discordapp.com/attachments/1/3/voice.ogg?ex=synthetic', size: 3, seconds: 1, mime: 'audio/ogg' };
const bytes = () => new Uint8Array([1, 2, 3]).buffer;
function fixture() {
  const calls: string[] = [];
  const files: Files = { async prepare() { calls.push('prepare'); }, async write() { calls.push('write'); return 'file:///private/synthetic.audio'; }, async remove() { calls.push('remove'); } };
  const wire: Transport = { async download() { calls.push('download'); return { bytes: bytes(), finalURL: target.url, mime: target.mime }; }, async upload() { calls.push('upload'); return 'TRANSCRIPTION FIXTURE SYNTHÉTIQUE'; } };
  return { calls, files, wire, engine: new Transcriber(wire, files) };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise<void>(r => setImmediate(r));
test('URL signée conservée, domaines/chemins/ports/userinfo étrangers rejetés', () => {
  assert.equal(validateAudioURL(target.url, '1', '3'), target.url);
  for (const url of ['http://cdn.discordapp.com/attachments/1/3/a', 'https://cdn.discordapp.com.evil.invalid/attachments/1/3/a', 'https://127.0.0.1/attachments/1/3/a', 'https://user@cdn.discordapp.com/attachments/1/3/a', 'https://cdn.discordapp.com:444/attachments/1/3/a', 'https://cdn.discordapp.com/attachments/9/3/a', 'https://cdn.discordapp.com/attachments/1/3/a#x', 'file:///etc/private']) assert.throws(() => validateAudioURL(url, '1', '3'), SafeError);
});
test('extraction vocale bornée ; messages ordinaires ignorés', () => {
  const message = { id: '2', flags: 1 << 13, attachments: [{ id: '3', url: target.url, size: 3, duration_secs: 1, content_type: 'audio/ogg' }] };
  assert.deepEqual(extractTarget(message, { id: '1' }), target);
  assert.equal(extractTarget({ ...message, flags: 0 }, { id: '1' }), undefined);
  for (const update of [{ size: MAX_BYTES + 1 }, { size: -1 }, { duration_secs: 301 }, { duration_secs: NaN }, { content_type: 'text/html' }, { id: '../x' }]) assert.throws(() => extractTarget({ ...message, attachments: [{ ...message.attachments[0], ...update }] }, { id: '1' }), SafeError);
  assert.throws(() => extractTarget({ ...message, attachments: [] }, { id: '1' }), SafeError);
});
test('guard exact version / canary / codes observés, sans conversion numérique', () => {
  for (const Build of ['352206', '35220600000000', 352206]) assert.equal(compatibleClient({ Version: '352.6', Build, ReleaseChannel: 'canaryRelease' }), true);
  for (const info of [undefined, {}, { Version: '352.6', Build: '352206', ReleaseChannel: 'stable' }, { Version: '352.7', Build: '352206', ReleaseChannel: 'canaryRelease' }]) assert.equal(compatibleClient(info), false);
});
test('aucun download sans confirmation ou clé valide', async () => {
  const f = fixture();
  await assert.rejects(f.engine.run(target, key, false), { code: 'consent' });
  await assert.rejects(f.engine.run(target, 'invalid', true), { code: 'key' });
  assert.deepEqual(f.calls, []);
});
test('chaîne réelle orchestrée via fixtures, phases, déduplication et cache mémoire', async () => {
  const f = fixture(); const phases: string[] = [];
  const a = f.engine.run(target, key, true, x => phases.push(x)); const b = f.engine.run(target, key, true);
  assert.equal(a, b); assert.equal(await a, 'TRANSCRIPTION FIXTURE SYNTHÉTIQUE');
  assert.deepEqual(f.calls, ['prepare', 'download', 'write', 'upload', 'remove']);
  assert.deepEqual(phases, ['download', 'upload']);
  assert.equal(f.engine.wasAttempted(target), true);
  await f.engine.run({ ...target, url: target.url + '&new=signature' }, key, true);
  assert.equal(f.calls.filter(x => x === 'upload').length, 1);
  f.engine.clearResults(); await f.engine.run(target, key, true);
  assert.equal(f.calls.filter(x => x === 'upload').length, 2);
});
test('purge au démarrage avant action, préparation en erreur récupérable', async () => {
  const f = fixture(); let n = 0;
  f.files.prepare = async () => { if (n++ === 0) throw new SafeError('cache', 'Purge fixture impossible'); };
  await assert.rejects(f.engine.initialize());
  await f.engine.initialize(); assert.equal(n, 2); assert.deepEqual(f.calls, []);
});
test('échec ambigu après upload : cleanup, aucun retry automatique, tentative marquée', async () => {
  const f = fixture(); f.wire.upload = async () => { f.calls.push('upload'); throw new SafeError('network', 'Erreur réseau fixture'); };
  await assert.rejects(f.engine.run(target, key, true), { code: 'network' });
  assert.deepEqual(f.calls, ['prepare', 'download', 'write', 'upload', 'remove']);
  assert.equal(f.engine.wasAttempted(target), true);
});
test('redirection hors CDN, réponse non audio et fichier tronqué empêchent upload', async () => {
  for (const update of [{ finalURL: 'https://evil.invalid/audio' }, { mime: 'text/html' }, { bytes: new Uint8Array([1]).buffer }]) {
    const f = fixture(); f.wire.download = async () => ({ bytes: bytes(), finalURL: target.url, mime: target.mime, ...update });
    await assert.rejects(f.engine.run(target, key, true)); assert.equal(f.calls.includes('upload'), false); assert.equal(f.calls.includes('write'), false);
  }
});
test('échec écriture partielle nettoyé ; URI incorrecte interdit upload', async () => {
  const f = fixture(); f.files.write = async () => { throw new SafeError('file', 'Écriture fixture incomplète'); };
  await assert.rejects(f.engine.run(target, key, true)); assert.equal(f.calls.at(-1), 'remove');
  const g = fixture(); g.files.write = async () => 'content://bad';
  await assert.rejects(g.engine.run(target, key, true), { code: 'file' }); assert.equal(g.calls.includes('upload'), false);
});
test('échec nettoyage VERROUILLE les transferts puis stop retente suppression', async () => {
  const f = fixture(); let removals = 0;
  f.files.remove = async () => { removals++; throw new Error('détail sensible synthétique'); };
  await assert.rejects(f.engine.run(target, key, true), { code: 'cleanup' });
  const before = [...f.calls];
  await assert.rejects(f.engine.run(target, key, true), { code: 'cleanup' }); assert.deepEqual(f.calls, before);
  await f.engine.stop(); assert.equal(removals, 2);
});
test('annulation pendant download : aucun upload, promesse rejetée', async () => {
  const f = fixture(); const gate = deferred<void>();
  f.wire.download = async () => { await gate.promise; return { bytes: bytes(), finalURL: target.url, mime: target.mime }; };
  const job = f.engine.run(target, key, true); await tick(); f.engine.cancel(target); gate.resolve();
  await assert.rejects(job, { code: 'cancelled' }); assert.equal(f.calls.includes('write'), false);
});
test('annulation pendant cleanup ne publie pas un résultat tardif', async () => {
  const f = fixture(); const gate = deferred<void>(); f.files.remove = () => gate.promise;
  const job = f.engine.run(target, key, true); await tick(); f.engine.cancel(target); gate.resolve();
  await assert.rejects(job, { code: 'cancelled' }); assert.equal(f.engine.cached(target), undefined);
});
test('stop pendant upload annule, nettoie et refuse nouvelles actions', async () => {
  const f = fixture(); const gate = deferred<void>(); f.wire.upload = async () => { await gate.promise; return 'FIXTURE'; };
  const job = f.engine.run(target, key, true); const rejection = assert.rejects(job, { code: 'cancelled' }); await tick();
  const stopped = f.engine.stop(); gate.resolve(); await stopped; await rejection;
  assert.equal(f.calls.at(-1), 'remove'); assert.equal(f.engine.cached(target), undefined);
  await assert.rejects(f.engine.run(target, key, true), { code: 'stopped' });
});
test('un seul vocal actif : pas de concurrence cachée', async () => {
  const f = fixture(); const gate = deferred<void>(); f.wire.download = async () => { await gate.promise; return { bytes: bytes(), finalURL: target.url, mime: target.mime }; };
  const job = f.engine.run(target, key, true);
  await assert.rejects(f.engine.run({ ...target, messageId: '4' }, key, true), { code: 'busy' }); gate.resolve(); await job;
});
test('base64 exact, y compris frontières des chunks', () => {
  for (const length of [0, 1, 2, 3, 12287, 12288, 12289, 25001]) {
    const data = Uint8Array.from({ length }, (_, i) => i % 256);
    assert.equal(bytesToBase64(data.buffer), Buffer.from(data).toString('base64'));
  }
});
test('erreurs inconnues ne divulguent pas de détail', () => { assert.equal(safeMessage(new Error(key)).includes(key), false); });
test('arbre menu : unicité, cycles, profondeur et budget', () => {
  const type = {}; const sheet = { type, props: { children: [] } };
  assert.equal(findUniqueSheet({ type: 'root', props: { children: [sheet] } }, type), sheet);
  assert.equal(findUniqueSheet([sheet, { ...sheet }], type), undefined);
  const cycle: unknown[] = []; cycle.push(cycle); assert.equal(findUniqueSheet(cycle, type), undefined);
  assert.equal(findUniqueSheet(Array.from({ length: 400 }, () => ({})), type), undefined);
});
