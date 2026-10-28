// Pur : aucune dépendance Discord, aucun accès réseau implicite.
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_SECONDS = 300;
export const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
export const CACHE_DIR = 'anezium-elevenlabs-stt';
export const MIME = new Set(['audio/ogg', 'audio/opus', 'audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/wav', 'audio/x-m4a']);
export class SafeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SafeError'; }
}
export function safeMessage(error: unknown): string {
  return error instanceof SafeError ? error.message : 'Opération impossible. Aucun détail sensible n’est journalisé. Réessayez manuellement si nécessaire.';
}
export interface Target { channelId: string; messageId: string; attachmentId: string; url: string; size: number; seconds: number; mime: string }
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === 'string' && /^\d{1,22}$/.test(value);
export function validateAudioURL(value: unknown, channelId?: string, attachmentId?: string): string {
  if (typeof value !== 'string' || value.length > 4096) throw new SafeError('url', 'URL audio Discord non valide.');
  let url: URL;
  try { url = new URL(value); } catch { throw new SafeError('url', 'URL audio Discord non valide.'); }
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || url.username || url.password || url.port || url.hash) throw new SafeError('host', 'Seuls les fichiers HTTPS des CDN Discord officiels sont autorisés.');
  const match = /^\/attachments\/(\d{1,22})\/(\d{1,22})\/[^/]+$/.exec(url.pathname);
  if (!match || (channelId !== undefined && match[1] !== channelId) || (attachmentId !== undefined && match[2] !== attachmentId)) throw new SafeError('path', 'Pièce jointe Discord incohérente. Rouvrez le message.');
  return value; // ne réécrit ni la signature ni les paramètres de l’URL.
}
export function extractTarget(value: unknown, channel: unknown): Target | undefined {
  const msg = record(value); const chan = record(channel);
  if (!msg || !chan || !id(msg.id) || !id(chan.id)) return undefined;
  if (typeof msg.flags !== 'number' || !Number.isSafeInteger(msg.flags) || (msg.flags & (1 << 13)) === 0) return undefined;
  if (!Array.isArray(msg.attachments) || msg.attachments.length !== 1) throw new SafeError('attachment', 'Ce vocal doit contenir une seule pièce jointe audio.');
  const a = record(msg.attachments[0]);
  if (!a || !id(a.id)) throw new SafeError('attachment', 'Métadonnées du vocal non prises en charge.');
  const size = a.size; const seconds = a.duration_secs ?? a.durationSecs;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) throw new SafeError('size', 'Vocal trop volumineux ou taille inconnue (maximum 8 Mio).');
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0.1 || seconds > MAX_SECONDS) throw new SafeError('duration', 'Durée inconnue ou hors limite (0,1 seconde à 5 minutes).');
  const rawMime = a.content_type ?? a.contentType;
  const mime = typeof rawMime === 'string' ? rawMime.split(';')[0]!.toLowerCase() : '';
  if (!MIME.has(mime)) throw new SafeError('format', 'Format audio absent ou non pris en charge.');
  return { channelId: chan.id, messageId: msg.id, attachmentId: a.id, url: validateAudioURL(a.url, chan.id, a.id), size, seconds, mime };
}
export function validateTarget(target: Target): Target {
  const result = extractTarget({ id: target.messageId, flags: 1 << 13, attachments: [{ id: target.attachmentId, url: target.url, size: target.size, duration_secs: target.seconds, content_type: target.mime }] }, { id: target.channelId });
  if (!result) throw new SafeError('target', 'Vocal non pris en charge.');
  return result;
}
export function compatibleClient(info: unknown): boolean {
  const x = record(info);
  return !!x && x.Version === '352.6' && ['352206', '35220600000000'].includes(String(x.Build)) && x.ReleaseChannel === 'canaryRelease';
}
export function validateKey(key: string): string {
  const result = key.trim();
  if (result.length < 16 || result.length > 512 || !/^[A-Za-z0-9_-]+$/.test(result)) throw new SafeError('key', 'Saisissez une clé API ElevenLabs valide dans le champ masqué.');
  return result;
}
export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new SafeError('cancelled', 'Opération annulée. Si l’upload avait commencé, une facturation reste possible.');
}
export interface Download { bytes: ArrayBuffer; finalURL: string; mime: string }
export interface Transport {
  download(target: Target, signal: AbortSignal): Promise<Download>;
  upload(uri: string, mime: string, key: string, signal: AbortSignal): Promise<string>;
}
export interface Files {
  prepare(): Promise<void>;
  write(name: string, bytes: ArrayBuffer): Promise<string>;
  remove(name: string): Promise<void>;
}
export type Phase = 'download' | 'upload';
export class Transcriber {
  private active = new Map<string, { controller: AbortController; promise: Promise<string> }>();
  private results = new Map<string, { fingerprint: string; text: string }>();
  private attempted = new Set<string>();
  private stopped = false;
  private cleanupFailed = false;
  private residual = new Set<string>();
  private prepared: Promise<void> | undefined;
  private sequence = 0;
  private readonly session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  constructor(private readonly transport: Transport, private readonly files: Files) {}
  private identity(t: Target) { return `${t.channelId}/${t.messageId}/${t.attachmentId}`; }
  private fingerprint(t: Target) { return `${t.size}:${t.seconds}:${t.mime}:${new URL(t.url).pathname}`; }
  wasAttempted(t: Target) { return this.attempted.has(this.identity(t)); }
  initialize(): Promise<void> {
    this.prepared ??= this.files.prepare().catch(error => { this.prepared = undefined; throw error; });
    return this.prepared;
  }
  cached(t: Target): string | undefined {
    const item = this.results.get(this.identity(t));
    return item?.fingerprint === this.fingerprint(t) ? item.text : undefined;
  }
  run(target: Target, key: string, confirmed: boolean, phase: (phase: Phase) => void = () => {}): Promise<string> {
    if (this.stopped) return Promise.reject(new SafeError('stopped', 'Plugin arrêté.'));
    if (this.cleanupFailed) return Promise.reject(new SafeError('cleanup', 'Cache non nettoyé : arrêtez puis relancez le plugin.'));
    let t: Target; let secret: string;
    try { t = validateTarget(target); if (confirmed !== true) throw new SafeError('consent', 'Confirmation de transfert requise.'); secret = validateKey(key); }
    catch (e) { return Promise.reject(e); }
    const identity = this.identity(t);
    const pending = this.active.get(identity);
    if (pending) return pending.promise;
    const cached = this.cached(t);
    if (cached !== undefined) return Promise.resolve(cached);
    if (this.active.size) return Promise.reject(new SafeError('busy', 'Une transcription est déjà en cours.'));
    const controller = new AbortController();
    const name = `${this.session}-${++this.sequence}.audio`;
    const promise = this.perform(t, secret, controller.signal, name, phase).then(text => {
      throwIfAborted(controller.signal);
      if (this.stopped) throw new SafeError('stopped', 'Plugin arrêté.');
      if (!this.stopped && !controller.signal.aborted) {
        if (this.results.size >= 10) this.results.delete(this.results.keys().next().value!);
        this.results.set(identity, { fingerprint: this.fingerprint(t), text });
      }
      return text;
    }).finally(() => { this.active.delete(identity); secret = ''; });
    this.active.set(identity, { controller, promise });
    return promise;
  }
  private async perform(t: Target, key: string, signal: AbortSignal, name: string, phase: (phase: Phase) => void) {
    let writeAttempted = false;
    try {
      throwIfAborted(signal);
      await this.initialize(); throwIfAborted(signal);
      phase('download');
      const audio = await this.transport.download(t, signal); throwIfAborted(signal);
      validateAudioURL(audio.finalURL, t.channelId, t.attachmentId);
      if (!MIME.has(audio.mime.split(';')[0]!.toLowerCase())) throw new SafeError('format', 'Le CDN n’a pas retourné un fichier audio pris en charge.');
      if (!(audio.bytes instanceof ArrayBuffer) || audio.bytes.byteLength === 0 || audio.bytes.byteLength > MAX_BYTES || audio.bytes.byteLength !== t.size) throw new SafeError('size', 'Taille réelle audio inattendue ou supérieure à la limite.');
      writeAttempted = true;
      this.residual.add(name);
      const uri = await this.files.write(name, audio.bytes); throwIfAborted(signal);
      if (!/^file:\/\//.test(uri)) throw new SafeError('file', 'Le cache audio local n’est pas disponible.');
      phase('upload'); this.attempted.add(this.identity(t));
      const text = await this.transport.upload(uri, t.mime, key, signal); throwIfAborted(signal);
      if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new SafeError('response', 'La réponse ElevenLabs ne contient pas de transcription exploitable.');
      return text;
    } finally {
      key = '';
      if (writeAttempted) {
        try { await this.files.remove(name); this.residual.delete(name); }
        catch { this.cleanupFailed = true; throw new SafeError('cleanup', 'Impossible de supprimer le cache audio. Arrêtez puis relancez le plugin avant de réessayer.'); }
      }
    }
  }
  cancel(target: Target) { this.active.get(this.identity(target))?.controller.abort(); }
  clearResults() { this.results.clear(); }
  cancelAll() { for (const job of this.active.values()) job.controller.abort(); }
  async stop() {
    this.stopped = true;
    const jobs = [...this.active.values()];
    for (const job of jobs) job.controller.abort();
    this.results.clear(); this.attempted.clear();
    await Promise.allSettled(jobs.map(job => job.promise));
    await Promise.allSettled([...this.residual].map(name => this.files.remove(name)));
    this.residual.clear();
    this.active.clear();
  }
}
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  for (let base = 0; base < bytes.length; base += 12288) {
    let out = ''; const end = Math.min(bytes.length, base + 12288);
    for (let i = base; i < end; i += 3) {
      const a = bytes[i]!; const b = bytes[i + 1]; const c = bytes[i + 2];
      out += chars[a >> 2]! + chars[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : chars[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : chars[c & 63]!);
    }
    chunks.push(out);
  }
  return chunks.join('');
}
