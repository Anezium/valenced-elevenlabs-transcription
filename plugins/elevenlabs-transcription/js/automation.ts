import { SafeError, validateTarget } from './core.js';
import type { Target } from './core.js';
export type AutoMode = Readonly<{ incoming: boolean; ownReplies: boolean }>;
export interface VoiceEvent {
  kind: 'create' | 'ack'; target: Target; authorId: string;
  // Adapter must attest these from the live host, never from stored history.
  live: boolean; sent: boolean; accountId: string;
}
export interface Reply {
  content: string;
  message_reference: { channel_id: string; message_id: string; fail_if_not_exists: true };
  allowed_mentions: { parse: never[]; replied_user: false };
}
export interface AutoHost {
  accountId(): string;
  selectedChannelId(): string | undefined;
  canReply(channelId: string): boolean;
  // Resolves only after durable reservation; never store audio, text, URL, or key here.
  reserve(identity: string): Promise<boolean>;
  transcribe(target: Target, signal: AbortSignal): Promise<string>;
  showLocal(target: Target, text: string): void;
  sendReply(channelId: string, reply: Reply): Promise<void>;
  clearLocal(): void;
  report(code: string): void;
}
const DISCORD_EPOCH = 1420070400000n;
export function snowflakeTime(value: string) {
  if (!/^\d{1,22}$/.test(value)) return NaN;
  return Number((BigInt(value) >> 22n) + DISCORD_EPOCH);
}
/** At-most-once, no catch-up, no retries after ambiguous publication. */
export class AutoPipeline {
  private mode: AutoMode = { incoming: false, ownReplies: false };
  private seen = new Set<string>();
  private queue: VoiceEvent[] = [];
  private running?: Promise<void>;
  private controller?: AbortController;
  private generation = 0;
  private closed = false;
  private paused = false;
  private attempts: number[] = [];
  private started: number;
  private readonly account: string;
  constructor(private readonly host: AutoHost, private readonly now: () => number = Date.now) {
    this.started = now(); this.account = host.accountId();
    if (!/^\d{1,22}$/.test(this.account)) throw new SafeError('account', 'Compte actif inconnu.');
  }
  configure(mode: AutoMode, consent: { externalProcessingAndCost: boolean; publishOwnReplies: boolean }) {
    if ((mode.incoming || mode.ownReplies) && consent.externalProcessingAndCost !== true) throw new SafeError('consent', 'Accord de traitement externe/coût requis.');
    if (mode.ownReplies && consent.publishOwnReplies !== true) throw new SafeError('consent', 'Accord de publication de vos réponses requis.');
    this.invalidate(); this.started = this.now(); this.mode = { incoming: mode.incoming === true, ownReplies: mode.ownReplies === true };
  }
  accept(event: VoiceEvent): boolean {
    if (this.closed || this.paused || !event.live || !/^\d{1,22}$/.test(event.authorId) || event.accountId !== this.account || this.host.accountId() !== this.account) return false;
    const own = event.authorId === this.account;
    if (own ? (!this.mode.ownReplies || event.kind !== 'ack' || !event.sent) : (!this.mode.incoming || event.kind !== 'create')) return false;
    if (event.target.channelId !== this.host.selectedChannelId()) return false;
    const timestamp = snowflakeTime(event.target.messageId);
    if (!Number.isFinite(timestamp) || timestamp < this.started || timestamp > this.now() + 5000 || this.now() - timestamp > 60000) return false;
    let target: Target;
    try { target = validateTarget(event.target); } catch { return false; }
    const identity = `${this.account}/${target.channelId}/${target.messageId}`;
    if (this.seen.has(identity)) return false;
    // Bound the entire session, not an LRU which could replay evicted events.
    if (this.seen.size >= 1024 || this.queue.length >= 8) { this.host.report('queue_full'); return false; }
    this.seen.add(identity); this.queue.push({ ...event, target });
    this.running ??= this.drain().finally(() => { this.running = undefined; });
    return true;
  }
  private valid(event: VoiceEvent, generation: number) {
    return !this.closed && !this.paused && this.generation === generation && this.host.accountId() === this.account
      && this.now() - snowflakeTime(event.target.messageId) <= 60000
      && this.host.selectedChannelId() === event.target.channelId
      && (event.authorId === this.account ? this.mode.ownReplies : this.mode.incoming);
  }
  private async drain() {
    while (this.queue.length && !this.closed && !this.paused) {
      const event = this.queue.shift()!; const generation = this.generation;
      if (!this.valid(event, generation)) continue;
      this.attempts = this.attempts.filter(t => this.now() - t < 60000);
      if (this.attempts.length >= 3) { this.host.report('rate_limit'); continue; }
      const own = event.authorId === this.account;
      if (own && !this.host.canReply(event.target.channelId)) { this.host.report('permission'); continue; }
      const controller = new AbortController(); this.controller = controller;
      try {
        const identity = `${this.account}/${event.target.channelId}/${event.target.messageId}`;
        if (!await this.host.reserve(identity) || !this.valid(event, generation)) continue;
        this.attempts.push(this.now());
        const text = await this.host.transcribe(event.target, controller.signal);
        if (!this.valid(event, generation) || controller.signal.aborted) continue;
        if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new SafeError('response', 'Transcription vide ou trop longue.');
        if (!own) this.host.showLocal(event.target, text);
        else {
          if (!this.host.canReply(event.target.channelId)) { this.host.report('permission'); continue; }
          // No silent truncation or multi-post bursts. Manual recovery retains full transcript.
          if (text.length > 1850) { this.host.showLocal(event.target, text); this.host.report('reply_too_long'); continue; }
          await this.host.sendReply(event.target.channelId, {
            content: `Transcription automatique (peut contenir des erreurs) :\n${text}`,
            message_reference: { channel_id: event.target.channelId, message_id: event.target.messageId, fail_if_not_exists: true },
            allowed_mentions: { parse: [], replied_user: false },
          });
        }
      } catch { this.host.report('auto_failed_no_retry'); }
      finally { if (this.controller === controller) this.controller = undefined; }
    }
  }
  private invalidate() { this.generation++; this.queue = []; this.controller?.abort(); this.host.clearLocal(); }
  pause() { this.paused = true; this.invalidate(); }
  resume() { if (!this.closed) { this.started = this.now(); this.paused = false; } }
  stop() { this.closed = true; this.invalidate(); }
  async idle() { await this.running; }
}
