import { ENDPOINT, MAX_BYTES, SafeError, throwIfAborted, validateAudioURL } from './core.js';
import type { Download, Target, Transport } from './core.js';
export interface Multipart { append(name: string, value: unknown): void }
export interface Wire { xhr(): XMLHttpRequest; form(): Multipart }
export function statusError(status: number, upload: boolean): SafeError {
  const messages: Record<number, string> = {
    401: 'Clé ElevenLabs refusée (401). Effacez-la et saisissez une clé valide.',
    403: upload ? 'Accès ElevenLabs refusé (403) : vérifiez les permissions et votre offre.' : 'Fichier Discord inaccessible (403). Rouvrez le vocal pour renouveler son URL.',
    402: 'Crédit ElevenLabs insuffisant (402). Aucun nouvel essai automatique.',
    404: upload ? 'Service de transcription indisponible (404).' : 'Le fichier Discord n’est plus disponible (404).',
    413: 'Fichier trop volumineux pour le service (413).',
    422: 'Audio ou paramètres refusés par ElevenLabs (422).',
    429: 'Limite de débit ou quota atteint (429). Attendez avant un nouvel essai manuel.',
  };
  return new SafeError(`http-${status}`, messages[status] ?? `Échec ${upload ? 'ElevenLabs' : 'du téléchargement'} (HTTP ${Number.isFinite(status) ? status : 0}). Aucun nouvel essai automatique.`);
}
export class XHRTransport implements Transport {
  constructor(private readonly wire: Wire, private readonly timeoutMs = 90000) {}
  download(target: Target, signal: AbortSignal): Promise<Download> {
    validateAudioURL(target.url, target.channelId, target.attachmentId);
    return this.request('GET', target.url, signal, undefined, undefined, Math.min(target.size, MAX_BYTES), false).then(xhr => {
      const finalURL = validateAudioURL(xhr.responseURL, target.channelId, target.attachmentId);
      const bytes = xhr.response;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > MAX_BYTES) throw new SafeError('binary', 'Le runtime n’a pas retourné un audio binaire valide.');
      return { bytes, finalURL, mime: xhr.getResponseHeader('Content-Type') ?? '' };
    });
  }
  async upload(uri: string, mime: string, key: string, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (!uri.startsWith('file://') || key.length < 16) throw new SafeError('upload', 'Fichier ou clé non disponible.');
    const form = this.wire.form();
    form.append('model_id', 'scribe_v2');
    form.append('webhook', 'false');
    form.append('diarize', 'false');
    form.append('use_multi_channel', 'false');
    form.append('tag_audio_events', 'false');
    const extension: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };
    form.append('file', { uri, name: `voice.${extension[mime] ?? 'ogg'}`, type: mime });
    const xhr = await this.request('POST', ENDPOINT, signal, form, key, 256 * 1024, true);
    if (xhr.responseURL !== ENDPOINT) throw new SafeError('redirect', 'Réponse ElevenLabs redirigée ou origine impossible à vérifier.');
    let payload: unknown;
    try { payload = JSON.parse(xhr.responseText); }
    catch { throw new SafeError('json', 'Réponse ElevenLabs illisible. Aucun nouvel essai automatique.'); }
    if (!payload || typeof payload !== 'object' || !('text' in payload) || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 100000) throw new SafeError('response', 'Aucune transcription exploitable dans la réponse ElevenLabs.');
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
      const abort = () => fail(new SafeError('cancelled', 'Opération annulée. Un upload déjà commencé peut être facturé.'));
      signal.addEventListener('abort', abort, { once: true });
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) { finish(statusError(xhr.status, upload)); return; }
        if (!upload && (!(xhr.response instanceof ArrayBuffer) || xhr.response.byteLength > limit)) { finish(new SafeError('size', 'La taille audio réelle dépasse la limite annoncée.')); return; }
        if (upload && (typeof xhr.responseText !== 'string' || xhr.responseText.length > limit)) { finish(new SafeError('response', 'Réponse ElevenLabs trop volumineuse.')); return; }
        finish();
      };
      xhr.onerror = () => finish(new SafeError('network', 'Erreur réseau. Aucun nouvel essai automatique ; un upload commencé peut être facturé.'));
      xhr.onabort = () => finish(new SafeError('cancelled', 'Opération annulée. Un upload commencé peut être facturé.'));
      xhr.ontimeout = () => fail(new SafeError('timeout', 'Délai dépassé. Aucun nouvel essai automatique ; un upload commencé peut être facturé.'));
      xhr.onprogress = event => { if (event.loaded > limit || (event.lengthComputable && event.total > limit)) fail(new SafeError('size', 'Transfert interrompu : taille supérieure à la limite.')); };
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 2) return;
        const declared = xhr.getResponseHeader('Content-Length');
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { fail(new SafeError('size', 'Transfert interrompu : taille annoncée excessive.')); return; }
        if (xhr.responseURL) {
          try {
            if (upload) { if (xhr.responseURL !== ENDPOINT) throw new Error(); }
            else validateAudioURL(xhr.responseURL);
          } catch { fail(new SafeError('redirect', 'Destination de redirection non autorisée.')); }
        }
      };
      try {
        xhr.open(method, url, true);
        xhr.withCredentials = false;
        xhr.timeout = this.timeoutMs;
        if (!upload) xhr.responseType = 'arraybuffer';
        if (key !== undefined) xhr.setRequestHeader('xi-api-key', key);
        // Le runtime RN construit le boundary multipart : aucun Content-Type manuel.
        timer = setTimeout(() => fail(new SafeError('timeout', 'Délai dépassé. Un upload commencé peut être facturé.')), this.timeoutMs);
        throwIfAborted(signal);
        xhr.send(body as XMLHttpRequestBodyInit | undefined);
      } catch { fail(new SafeError('network', 'Le runtime réseau n’a pas pu démarrer le transfert.')); }
    });
  }
}
