import { Dispatcher } from '@valenced/discord/common/flux';
import { Stores } from '@valenced/discord/flux';
import { getModules } from '@valenced/modules/finders';
import { withName, withProps } from '@valenced/modules/finders/filters';
import { instead } from '@valenced/patcher';
import { AutoPipeline } from './automation.js';
import type { AutoMode, Reply } from './automation.js';
import { extractTarget, SafeError, throwIfAborted } from './core.js';
import type { Target, Transcriber } from './core.js';
import { reserveAutomaticIdentity } from './vault.js';

export interface AutoPreferences { incoming: boolean; ownReplies: boolean; external: boolean; publish: boolean; accountId: string }
export const DEFAULT_AUTO: AutoPreferences = { incoming: false, ownReplies: false, external: false, publish: false, accountId: '' };
interface Preferences { get(): Promise<AutoPreferences>; set(value: AutoPreferences, replace: true): Promise<void> }
interface Runtime {
  alive: boolean; key: string; engine: Transcriber;
  diagnostics: { compatible: boolean; ready: boolean };
  notifyAuto(ready: boolean, mode: AutoMode, problem?: string): void;
}
interface HTTP { post(options: { url: string; body: object; retries: number; oldFormErrors: boolean }): Promise<{ status?: number; body?: unknown }> }
interface Endpoints { MESSAGES(channel: string): string }
interface Row { type?: number; changeType?: number; message?: { id: string; content?: unknown[] } }
interface RowManager { generate(args: { message?: unknown }): Row }
const object = (x: unknown): Record<string, any> | undefined => x !== null && typeof x === 'object' ? x as Record<string, any> : undefined;
const validId = (x: unknown): x is string => typeof x === 'string' && /^\d{1,22}$/.test(x);
function store(name: string) { try { return Stores[name] as unknown as Record<string, any> | undefined; } catch { return undefined; } }
function account() { try { const id = store('AuthenticationStore')?.getId?.(); return validId(id) ? id : ''; } catch { return ''; } }
function channelId() { const id = store('SelectedChannelStore')?.getChannelId?.(); return validId(id) ? id : undefined; }
function message(channel: string, id: string) { return store('MessageStore')?.getMessage?.(channel, id); }

/** Concrete client adapter. Missing/ambiguous modules fail closed, never a clipboard fallback. */
export class ClientAutomation {
  private http?: HTTP;
  private endpoints?: Endpoints;
  private rowReady = false;
  private cleanups: (() => void)[] = [];
  private stopped = false;
  private suspended = false;
  private connected = true;
  private loaded = false;
  private settings: AutoPreferences = { ...DEFAULT_AUTO };
  private writes: Promise<unknown> = Promise.resolve();
  private revision = 0;
  // Provenance barrier for synchronous dispatch -> deferred MessageStore reads.
  private ingress = 0;
  private unpatchRows?: () => void;
  private rowTeardown: Promise<unknown> = Promise.resolve();
  private refreshes = new Set<Promise<unknown>>();
  private pipeline?: AutoPipeline;
  private pipelineAccount = '';
  private local = new Map<string, { target: Target; text: string }>();
  private changed = new Set<string>();
  constructor(private readonly rt: Runtime, private readonly preferences: Preferences) {}
  private mode(): AutoMode {
    const match = this.loaded && !!account() && this.settings.accountId === account();
    return { incoming: match && this.settings.external && this.settings.incoming,
      ownReplies: match && this.settings.external && this.settings.publish && this.settings.ownReplies };
  }
  private ready() {
    try {
      return !this.stopped && !!this.http && !!this.endpoints && this.rowReady && !!account()
        && typeof store('SelectedChannelStore')?.getChannelId === 'function'
        && typeof store('ChannelStore')?.getChannel === 'function'
        && typeof store('MessageStore')?.getMessage === 'function'
        && typeof store('PermissionStore')?.can === 'function';
    } catch { return false; }
  }
  private notify(problem?: string) { if (!this.stopped) { this.ensurePipeline(); this.rt.notifyAuto(this.ready(), this.mode(), problem); } }
  private clearLocal() {
    const entries = [...this.local.values()]; this.local.clear();
    for (const { target } of entries) { this.changed.add(target.messageId); this.refresh(target); }
  }
  private refresh(target: Target) {
    // Evidenced local rerender hook: does NOT change MessageRecord content or call Discord REST.
    const task = Promise.resolve().then(() => Dispatcher.dispatch({ type: 'MESSAGE_UPDATE', message: { id: target.messageId, channel_id: target.channelId } }))
      .catch(() => this.notify('Local refresh unavailable.')).finally(() => this.refreshes.delete(task));
    this.refreshes.add(task);
  }
  private showLocal(target: Target, text: string) {
    if (this.stopped || this.suspended) return;
    if (this.local.size >= 10) {
      const oldest = this.local.keys().next().value!; const old = this.local.get(oldest)!;
      this.local.delete(oldest); this.changed.add(old.target.messageId); this.refresh(old.target);
    }
    this.local.set(target.messageId, { target, text }); this.changed.add(target.messageId); this.refresh(target);
  }
  private canReply(channel: string) {
    try {
      const target = store('ChannelStore')?.getChannel?.(channel);
      if (!target || target.id !== channel || target.archived === true || target.locked === true) return false;
      if (target.type === 1 || target.type === 3) return true; // server remains authority for private recipients
      const can = store('PermissionStore')?.can;
      if (typeof can !== 'function') return false;
      const send = [10, 11, 12].includes(target.type) ? 1n << 38n : 1n << 11n;
      return can.call(store('PermissionStore'), 1n << 10n, target) === true
        && can.call(store('PermissionStore'), 1n << 16n, target) === true
        && can.call(store('PermissionStore'), send, target) === true;
    } catch { return false; }
  }
  private async reply(channel: string, reply: Reply, manual = false) {
    if (!this.ready() || !this.canReply(channel) || (!manual && !this.mode().ownReplies) || this.suspended || !this.connected) throw new SafeError('permission', 'Publishing not authorized.');
    const original = object(message(channel, reply.message_reference.message_id));
    if (!original || original.channel_id !== channel || original.author?.id !== account() || original.state !== 'SENT'
      || reply.message_reference.channel_id !== channel || reply.content.length > 2000) throw new SafeError('reply', 'Original voice message unavailable.');
    if (!extractTarget(original, { id: channel })) throw new SafeError('reply', 'The original message is no longer a voice message.');
    const url = this.endpoints!.MESSAGES(channel);
    if (url !== `/channels/${channel}/messages`) throw new SafeError('endpoint', 'Unexpected Discord route.');
    const result = await this.http!.post({ url, retries: 0, oldFormErrors: true, body: {
      ...reply, nonce: `stt${reply.message_reference.message_id}`, enforce_nonce: true, tts: false,
    } });
    const body = object(result?.body);
    if (!body || !validId(body.id) || body.channel_id !== channel || (result.status !== undefined && (result.status < 200 || result.status >= 300))) throw new SafeError('reply', 'Reply delivery uncertain: no automatic retry.');
  }
  private ensurePipeline() {
    const id = account();
    if (!this.loaded || !this.ready() || !id) { this.pipeline?.pause(); return undefined; }
    if (this.pipeline && this.pipelineAccount !== id) { this.pipeline.stop(); this.pipeline = undefined; }
    if (!this.pipeline) {
      this.pipelineAccount = id;
      this.pipeline = new AutoPipeline({ accountId: account, selectedChannelId: channelId,
        canReply: channel => this.canReply(channel), reserve: reserveAutomaticIdentity,
        transcribe: async (target, signal) => {
          throwIfAborted(signal);
          if (!this.rt.alive || !this.rt.diagnostics.compatible || !this.rt.diagnostics.ready || !this.rt.key) throw new SafeError('key', 'Key or cache unavailable.');
          const cancel = () => this.rt.engine.cancel(target); signal.addEventListener('abort', cancel, { once: true });
          try { return await this.rt.engine.run(target, this.rt.key, true); }
          finally { signal.removeEventListener('abort', cancel); }
        },
        showLocal: (target, text) => this.showLocal(target, text), sendReply: (channel, body) => this.reply(channel, body),
        clearLocal: () => this.clearLocal(), report: code => this.notify(`Automation: ${code}. Retry manually if needed.`),
      });
      this.pipeline.configure(this.mode(), { externalProcessingAndCost: this.settings.external, publishOwnReplies: this.settings.publish });
      if (this.suspended || !this.connected) this.pipeline.pause();
    }
    return this.pipeline;
  }
  private async event(payload: unknown, ingress: number, dispatchedAccount: string) {
    if (ingress !== this.ingress || dispatchedAccount !== account()) return;
    if (this.stopped || this.suspended || !this.connected || !this.loaded || !this.rt.key) return;
    this.notify();
    try {
      const event = object(payload); const raw = object(event?.message);
      if (!event || !raw || !['MESSAGE_CREATE', 'MESSAGE_SEND_SUCCESS'].includes(event.type) || event.optimistic === true
        || !validId(raw.id) || !validId(raw.channel_id)) return;
      // Deferred until MessageStore has applied the dispatch. SENT is the ACK, never MESSAGE_ACK (read receipt).
      const record = object(message(raw.channel_id, raw.id));
      if (!record || record.id !== raw.id || record.channel_id !== raw.channel_id || record.state !== 'SENT'
        || !validId(record.author?.id) || record.author?.bot === true || (record.flags & (1 << 6)) !== 0) return;
      if (event.type === 'MESSAGE_SEND_SUCCESS' && record.author.id !== account()) return;
      const channel = store('ChannelStore')?.getChannel?.(raw.channel_id);
      const target = extractTarget(record, channel); if (!target) return;
      const own = record.author.id === account();
      this.ensurePipeline()?.accept({ kind: own ? 'ack' : 'create', target, authorId: record.author.id, accountId: account(), live: true, sent: own });
    } catch { this.notify('Incompatible voice event: no transfer.'); }
  }
  configure(mode: AutoMode) {
    // Snapshot caller input. Revocation is synchronous and monotonic until a NEW
    // explicit configure action has persisted successfully; pause alone is not a
    // consent barrier because channel/foreground/reconnect handlers can resume.
    mode = { incoming: mode.incoming === true, ownReplies: mode.ownReplies === true };
    ++this.ingress;
    this.pipeline?.pause();
    this.settings = { ...this.settings,
      incoming: this.settings.incoming && mode.incoming,
      ownReplies: this.settings.ownReplies && mode.ownReplies,
      external: this.settings.external && (mode.incoming || mode.ownReplies),
      publish: this.settings.publish && mode.ownReplies,
    };
    this.pipeline?.configure(this.mode(), { externalProcessingAndCost: this.settings.external, publishOwnReplies: this.settings.publish });
    const revision = ++this.revision;
    this.notify('Consents are being saved; withdrawals are already effective for this session.');
    const operation = this.writes.then(async () => {
      if (this.stopped) throw new SafeError('stopped', 'Plugin stopped.');
      if ((mode.incoming || mode.ownReplies) && !this.ready()) throw new SafeError('hooks', 'Automatic modules unavailable or ambiguous.');
      const id = account(); const value: AutoPreferences = { incoming: mode.incoming === true, ownReplies: mode.ownReplies === true,
        external: mode.incoming === true || mode.ownReplies === true, publish: mode.ownReplies === true, accountId: id };
      try { await this.preferences.set(value, true); }
      catch {
        const problem = 'Consents not saved: withdrawals kept for this session only. The disk may keep the old consents after a restart; turn it off again before closing the app.';
        if (revision === this.revision) this.notify(problem);
        throw new SafeError('preferences', problem);
      }
      if (this.stopped || revision !== this.revision || account() !== id) return;
      ++this.ingress;
      this.settings = value; this.loaded = true;
      const pipeline = this.ensurePipeline();
      pipeline?.configure(this.mode(), { externalProcessingAndCost: value.external, publishOwnReplies: value.publish });
      if (!this.suspended && this.connected) pipeline?.resume(); this.notify('');
    });
    this.writes = operation.catch(() => {}); return operation;
  }
  start() {
    const discover = <T>(filter: any, accept: (value: T | undefined) => void) => {
      const found = new Set<T>();
      this.cleanups.push(getModules(filter, value => { if (this.stopped || found.has(value as T)) return;
        found.add(value as T); accept(found.size === 1 ? value as T : undefined); this.notify();
      }));
    };
    discover<{ HTTP?: HTTP }>(withProps('HTTP'), value => { this.http = typeof value?.HTTP?.post === 'function' ? value.HTTP : undefined; if (!this.http) this.pipeline?.pause(); });
    discover<{ Endpoints?: Endpoints }>(withProps('Endpoints'), value => { this.endpoints = typeof value?.Endpoints?.MESSAGES === 'function' ? value.Endpoints : undefined; if (!this.endpoints) this.pipeline?.pause(); });
    discover<{ prototype: RowManager }>(withName('RowManager'), value => {
      if (this.unpatchRows) {
        this.pipeline?.pause();
        const remove = this.unpatchRows; this.unpatchRows = undefined;
        this.rowTeardown = Promise.allSettled([...this.refreshes, this.rowTeardown]).then(() => remove());
      }
      this.rowReady = false;
      if (!value || typeof value.prototype?.generate !== 'function') { this.pipeline?.pause(); return; }
      const adapter = this;
      this.unpatchRows = instead(value.prototype, 'generate', function(args, original) {
        const row = Reflect.apply(original, this, args) as Row;
        if (row?.type !== 1 || !row.message) return row;
        if (!validId(row.message.id) || (row.message.content !== undefined && !Array.isArray(row.message.content))) {
          adapter.rowReady = false; adapter.pipeline?.pause(); adapter.notify('Incompatible native rendering: automation suspended.'); return row;
        }
        const entry = adapter.local.get(row.message.id);
        if (!entry && !adapter.changed.has(row.message.id)) return row;
        const record = object(args[0]?.message);
        if (record?.id !== row.message.id || record?.channel_id !== (entry?.target.channelId ?? channelId())) return row;
        const changed = adapter.changed.delete(row.message.id);
        return { ...row, ...(changed ? { changeType: 2 } : {}), message: { ...row.message,
          content: entry ? [...(row.message.content ?? []), { type: 'text', content: `\nLocal transcript (ElevenLabs, may contain errors):\n${entry.text}` }] : row.message.content,
        } };
      });
      this.rowReady = true;
    });

    const subscribe = (type: string, handler: (payload: any) => void) => { Dispatcher.subscribe(type, handler); this.cleanups.push(() => Dispatcher.unsubscribe(type, handler)); };
    for (const type of ['MESSAGE_CREATE', 'MESSAGE_SEND_SUCCESS']) subscribe(type, payload => {
      // Refresh account-scoped status even when its consent gate rejects ingress.
      if (!this.stopped) this.notify();
      // Events without consent at ingress cannot become eligible after yielding.
      const mode = this.mode();
      if (this.stopped || this.suspended || !this.connected || !this.ready() || !this.rt.key || (!mode.incoming && !mode.ownReplies)) return;
      const ingress = this.ingress, dispatchedAccount = account();
      void Promise.resolve().then(() => this.event(payload, ingress, dispatchedAccount)).catch(() => this.notify('Incompatible event.'));
    });
    for (const type of ['CONNECTION_CLOSED', 'CONNECTION_INTERRUPTED', 'LOGOUT']) subscribe(type, () => { ++this.ingress; this.connected = false; this.pipeline?.pause(); this.notify(); });
    for (const type of ['CONNECTION_OPEN', 'CONNECTION_RESUMED']) subscribe(type, () => { ++this.ingress; this.connected = true; this.ensurePipeline()?.resume(); this.notify(); });
    subscribe('CHANNEL_SELECT', () => { ++this.ingress; this.pipeline?.pause(); if (!this.suspended && this.connected) this.ensurePipeline()?.resume(); this.notify(); });
    for (const type of ['MESSAGE_DELETE', 'MESSAGE_DELETE_BULK']) subscribe(type, () => { ++this.ingress; this.pipeline?.pause(); if (!this.suspended && this.connected) this.pipeline?.resume(); });
    subscribe('MESSAGE_UPDATE', payload => {
      const updated = object(payload?.message);
      if (!updated || !['attachments', 'flags', 'content'].some(key => key in updated)) return;
      // Ignore our ID-only local rerenders; real edits invalidate stale audio/results.
      this.invalidate();
    });
    void this.preferences.get().then(value => {
      if (this.stopped || this.revision !== 0) return;
      this.settings = { incoming: value?.incoming === true, ownReplies: value?.ownReplies === true,
        external: value?.external === true, publish: value?.publish === true, accountId: validId(value?.accountId) ? value.accountId : '' };
      this.loaded = true; this.notify();
    }).catch(() => this.notify('Consents not loaded: automation disabled.'));
  }
  pause() { ++this.ingress; this.suspended = true; this.pipeline?.pause(); }
  resume() { ++this.ingress; this.suspended = false; if (this.connected) this.ensurePipeline()?.resume(); this.notify(); }
  invalidate() { ++this.ingress; this.pipeline?.pause(); if (!this.suspended && this.connected) this.pipeline?.resume(); }
  canReplyTo(target: Target) {
    try { return this.ready() && this.canReply(target.channelId) && message(target.channelId, target.messageId)?.author?.id === account(); }
    catch { return false; }
  }
  async replyManually(target: Target, text: string, confirmed: boolean) {
    if (confirmed !== true) throw new SafeError('consent', 'Explicit consent to publish required.');
    if (!text.trim() || text.length > 1850 || this.rt.engine.cached(target) !== text) throw new SafeError('reply', 'Local transcript missing or too long for a reply.');
    await this.reply(target.channelId, { content: `Transcript:\n${text}`,
      message_reference: { channel_id: target.channelId, message_id: target.messageId, fail_if_not_exists: true },
      allowed_mentions: { parse: [], replied_user: false },
    }, true);
  }
  async stop() { ++this.ingress; this.stopped = true; ++this.revision; this.pipeline?.stop(); this.clearLocal();
    for (const cleanup of this.cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* no sensitive logs */ } }
    await Promise.allSettled([...this.refreshes, this.rowTeardown]); this.unpatchRows?.(); this.unpatchRows = undefined; this.changed.clear();
  }
  async idle() { await this.pipeline?.idle(); }
}
