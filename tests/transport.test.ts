import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINT, SafeError } from '../plugins/elevenlabs-transcription/js/core.js';
import { XHRTransport, statusError } from '../plugins/elevenlabs-transcription/js/transport.js';
import type { Target } from '../plugins/elevenlabs-transcription/js/core.js';
// Faux transport explicite : aucune connexion et aucun audio réel.
const KEY = 'synthetic_key_fixture_000000';
const target: Target = { channelId: '1', messageId: '2', attachmentId: '3', url: 'https://cdn.discordapp.com/attachments/1/3/a.ogg?ex=synthetic', mime: 'audio/ogg', size: 3, seconds: 1 };
interface Plan { status?: number; text?: string; bytes?: ArrayBuffer; mime?: string; finalURL?: string; length?: string; progress?: number; hold?: boolean; error?: boolean; timeout?: boolean }
class FakeXHR {
  method = ''; url = ''; body: unknown; headers: Record<string, string> = {}; readyState = 0; status = 200; responseURL = ''; response: unknown; responseText = ''; responseType = ''; timeout = 0; withCredentials = true; aborted = false;
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null; ontimeout: (() => void) | null = null; onreadystatechange: (() => void) | null = null;
  onprogress: ((event: { loaded: number; lengthComputable: boolean; total: number }) => void) | null = null;
  constructor(readonly plan: Plan) {}
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  getResponseHeader(name: string) { return name.toLowerCase() === 'content-type' ? this.plan.mime ?? 'audio/ogg' : name.toLowerCase() === 'content-length' ? this.plan.length ?? null : null; }
  abort() { this.aborted = true; this.onabort?.(); }
  send(body?: unknown) {
    this.body = body;
    if (this.plan.hold) return;
    queueMicrotask(() => {
      if (this.aborted) return;
      this.status = this.plan.status ?? 200; this.responseURL = this.plan.finalURL ?? this.url; this.readyState = 2;
      this.onreadystatechange?.(); if (this.aborted) return;
      if (this.plan.error) { this.onerror?.(); return; }
      if (this.plan.timeout) { this.ontimeout?.(); return; }
      if (this.plan.progress) this.onprogress?.({ loaded: this.plan.progress, lengthComputable: false, total: 0 });
      if (this.aborted) return;
      this.response = this.plan.bytes ?? new Uint8Array([1, 2, 3]).buffer;
      this.responseText = this.plan.text ?? '{"text":"FIXTURE SYNTHÉTIQUE"}';
      this.onload?.();
    });
  }
}
function setup(plans: Plan[]) {
  const requests: FakeXHR[] = []; const forms: Map<string, unknown>[] = [];
  const transport = new XHRTransport({
    xhr() { const plan = plans.shift(); assert(plan, 'Chaque requête doit avoir un scénario synthétique'); const xhr = new FakeXHR(plan); requests.push(xhr); return xhr as unknown as XMLHttpRequest; },
    form() { const fields = new Map<string, unknown>(); forms.push(fields); return { append(name, value) { fields.set(name, value); } }; },
  }, 1000);
  return { transport, requests, forms };
}
test('download GET uniquement CDN, pas de clé/token/cookie, arraybuffer et timeout', async () => {
  const f = setup([{}]); const result = await f.transport.download(target, new AbortController().signal);
  assert.equal(result.bytes.byteLength, 3); const req = f.requests[0]!;
  assert.equal(req.method, 'GET'); assert.equal(req.url, target.url); assert.deepEqual(req.headers, {}); assert.equal(req.withCredentials, false); assert.equal(req.responseType, 'arraybuffer'); assert.equal(req.timeout, 1000);
});
test('upload réel construit multipart RN, endpoint et options STT exacts', async () => {
  const f = setup([{}]); const result = await f.transport.upload('file:///private/fixture', 'audio/ogg', KEY, new AbortController().signal);
  assert.equal(result, 'FIXTURE SYNTHÉTIQUE'); const req = f.requests[0]!;
  assert.equal(req.url, ENDPOINT); assert.equal(req.method, 'POST');
  assert.equal(req.headers['content-type'], undefined); assert.equal(req.withCredentials, false);
  assert.deepEqual(req.headers, { 'xi-api-key': KEY });
  const form = f.forms[0]!;
  assert.deepEqual(Object.fromEntries(form), { model_id: 'scribe_v2', webhook: 'false', diarize: 'false', use_multi_channel: 'false', tag_audio_events: 'false', file: { uri: 'file:///private/fixture', name: 'voice.ogg', type: 'audio/ogg' } });
  assert.equal(form.has('enable_logging'), false); assert.equal(form.has('cloud_storage_url'), false); assert.equal(form.has('source_url'), false);
});
test('401/403/402/413/422/429/500 sont des erreurs sûres, aucun retry', async () => {
  for (const status of [401, 403, 402, 413, 422, 429, 500]) {
    const f = setup([{ status, text: JSON.stringify({ detail: KEY }) }]);
    await assert.rejects(f.transport.upload('file:///fixture', 'audio/ogg', KEY, new AbortController().signal), (e: unknown) => e instanceof SafeError && e.code === `http-${status}` && !e.message.includes(KEY));
    assert.equal(f.requests.length, 1);
  }
  assert.match(statusError(403, false).message, /Discord/);
});
test('Content-Length et progression excessive provoquent abort', async () => {
  for (const plan of [{ length: '99' }, { progress: 99 }, { length: 'invalid' }]) {
    const f = setup([plan]); await assert.rejects(f.transport.download(target, new AbortController().signal), { code: 'size' }); assert.equal(f.requests[0]!.aborted, true);
  }
});
test('contrôle final limite même sans header/progression', async () => {
  const f = setup([{ bytes: new Uint8Array(10).buffer }]); await assert.rejects(f.transport.download(target, new AbortController().signal), { code: 'size' });
});
test('URL initiale étrangère rejetée avant création XHR', async () => {
  const f = setup([]); assert.throws(() => f.transport.download({ ...target, url: 'https://evil.invalid/a' }, new AbortController().signal), SafeError); assert.equal(f.requests.length, 0);
});
test('redirections détectées et résultat refusé (pas preuve blocage natif préalable)', async () => {
  const f = setup([{ finalURL: 'https://evil.invalid/a' }]); await assert.rejects(f.transport.download(target, new AbortController().signal), { code: 'redirect' });
  const g = setup([{ finalURL: 'https://api.elevenlabs.io/other' }]); await assert.rejects(g.transport.upload('file:///fixture', 'audio/ogg', KEY, new AbortController().signal), { code: 'redirect' });
});
test('réponses JSON invalides, vides ou trop longues refusées', async () => {
  for (const text of ['not json', '{}', '{"text":""}', '{"text":123}', JSON.stringify({ text: 'x'.repeat(100001) })]) {
    const f = setup([{ text }]); await assert.rejects(f.transport.upload('file:///fixture', 'audio/ogg', KEY, new AbortController().signal), SafeError);
  }
});
test('erreur réseau et timeout : pas de retry, handlers détachés', async () => {
  for (const plan of [{ error: true }, { timeout: true }]) {
    const f = setup([plan]); await assert.rejects(f.transport.upload('file:///fixture', 'audio/ogg', KEY, new AbortController().signal), SafeError);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.onload, null); assert.equal(f.requests[0]!.onprogress, null);
  }
});
test('annulation avant requête et pendant transfert', async () => {
  const c = new AbortController(); c.abort(); const f = setup([]);
  await assert.rejects(f.transport.upload('file:///fixture', 'audio/ogg', KEY, c.signal), { code: 'cancelled' }); assert.equal(f.requests.length, 0);
  const d = new AbortController(); const g = setup([{ hold: true }]);
  const pending = g.transport.download(target, d.signal); d.abort();
  await assert.rejects(pending, { code: 'cancelled' }); assert.equal(g.requests[0]!.aborted, true); assert.equal(g.requests[0]!.onabort, null);
});
