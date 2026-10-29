import { ENDPOINT, MAX_BYTES, SafeError, throwIfAborted, validateAudioURL } from './core.js';
import type { Download, Target, Transport } from './core.js';
export interface Multipart { append(name: string, value: unknown): void }
export interface Wire { xhr(): XMLHttpRequest; form(): Multipart }
export function statusError(status: number, upload: boolean): SafeError {
  const messages: Record<number, string> = {
    401: 'ElevenLabs key rejected (401). Delete it and enter a valid key.',
    403: upload ? 'ElevenLabs access denied (403): check the permissions and your plan.' : 'Discord file inaccessible (403). Reopen the voice message to refresh its URL.',
    402: 'Insufficient ElevenLabs credit (402). No automatic retry.',
    404: upload ? 'Transcription service unavailable (404).' : 'The Discord file is no longer available (404).',
    413: 'File too large for the service (413).',
    422: 'Audio or parameters rejected by ElevenLabs (422).',
    429: 'Rate limit or quota reached (429). Wait before trying again manually.',
  };
  return new SafeError(`http-${status}`, messages[status] ?? `${upload ? 'ElevenLabs request' : 'Download'} failed (HTTP ${Number.isFinite(status) ? status : 0}). No automatic retry.`);
}
export class XHRTransport implements Transport {
  constructor(private readonly wire: Wire, private readonly timeoutMs = 90000) {}
  download(target: Target, signal: AbortSignal): Promise<Download> {
    validateAudioURL(target.url, target.channelId, target.attachmentId);
    return this.request('GET', target.url, signal, undefined, undefined, Math.min(target.size, MAX_BYTES), false).then(xhr => {
      const finalURL = validateAudioURL(xhr.responseURL, target.channelId, target.attachmentId);
      const bytes = xhr.response;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > MAX_BYTES) throw new SafeError('binary', 'The runtime did not return valid binary audio.');
      return { bytes, finalURL, mime: xhr.getResponseHeader('Content-Type') ?? '' };
    });
  }
  async upload(uri: string, mime: string, key: string, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (!uri.startsWith('file://') || key.length < 16) throw new SafeError('upload', 'File or key not available.');
    const form = this.wire.form();
    form.append('model_id', 'scribe_v2');
    form.append('webhook', 'false');
    form.append('diarize', 'false');
    form.append('use_multi_channel', 'false');
    form.append('tag_audio_events', 'false');
    const extension: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };
    form.append('file', { uri, name: `voice.${extension[mime] ?? 'ogg'}`, type: mime });
    const xhr = await this.request('POST', ENDPOINT, signal, form, key, 256 * 1024, true);
    if (xhr.responseURL !== ENDPOINT) throw new SafeError('redirect', 'ElevenLabs response was redirected or its origin cannot be verified.');
    let payload: unknown;
    try { payload = JSON.parse(xhr.responseText); }
    catch { throw new SafeError('json', 'Unreadable ElevenLabs response. No automatic retry.'); }
    if (!payload || typeof payload !== 'object' || !('text' in payload) || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 100000) throw new SafeError('response', 'No usable transcript in the ElevenLabs response.');
    return payload.text;
  }
  private request(method: 'GET' | 'POST', url: string, signal: AbortSignal, body: Multipart | undefined, key: string | undefined, limit: number, upload: boolean): Promise<XMLHttpRequest> {
    return new Promise((resolve, reject) => {
      try { throwIfAborted(signal); } catch (e) { reject(e); return; }
      const xhr = this.wire.xhr(); let finished = false; let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: SafeError) => {
        if (finished) return;
        finished = true; if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = xhr.onprogress = xhr.onreadystatechange = null;
        if (error) reject(error); else resolve(xhr);
      };
      const fail = (error: SafeError) => { finish(error); try { xhr.abort(); } catch { /* rien à journaliser */ } };
      const abort = () => fail(new SafeError('cancelled', 'Operation cancelled. An upload that has already started may be billed.'));
      signal.addEventListener('abort', abort, { once: true });
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) { finish(statusError(xhr.status, upload)); return; }
        if (!upload && (!(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength > limit)) { finish(new SafeError('size', 'The actual audio size exceeds the announced limit.')); return; }
        if (upload && (typeof xhr.responseText !== 'string' || xhr.responseText.length > limit)) { finish(new SafeError('response', 'ElevenLabs response too large.')); return; }
        finish();
      };
      xhr.onerror = () => finish(new SafeError('network', 'Network error. No automatic retry; an upload that has started may be billed.'));
      xhr.onabort = () => finish(new SafeError('cancelled', 'Operation cancelled. An upload that has started may be billed.'));
      xhr.ontimeout = () => fail(new SafeError('timeout', 'Timed out. No automatic retry; an upload that has started may be billed.'));
      xhr.onprogress = event => { if (event.loaded > limit || (event.lengthComputable && event.total > limit)) fail(new SafeError('size', 'Transfer interrupted: size above the limit.')); };
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 2) return;
        const declared = xhr.getResponseHeader('Content-Length');
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { fail(new SafeError('size', 'Transfer interrupted: announced size is excessive.')); return; }
        if (xhr.responseURL) {
          try {
            if (upload) { if (xhr.responseURL !== ENDPOINT) throw new Error(); }
            else validateAudioURL(xhr.responseURL);
          } catch { fail(new SafeError('redirect', 'Redirect destination not allowed.')); }
        }
      };
      try {
        xhr.open(method, url, true);
        xhr.withCredentials = false;
        xhr.timeout = this.timeoutMs;
        if (!upload) xhr.responseType = 'arraybuffer';
        if (key !== undefined) xhr.setRequestHeader('xi-api-key', key);
        // Le runtime RN construit le boundary multipart : aucun Content-Type manuel.
        timer = setTimeout(() => fail(new SafeError('timeout', 'Timed out. An upload that has started may be billed.')), this.timeoutMs);
        throwIfAborted(signal);
        xhr.send(body as XMLHttpRequestBodyInit | undefined);
      } catch { fail(new SafeError('network', 'The network runtime could not start the transfer.')); }
    });
  }
}
