import { SafeError, validateKey } from './core.js';
export interface Vault { load(): Promise<string | null>; save(key: string): Promise<void>; delete(): Promise<void> }
// All settings/manual/automatic paths share this serialized source of truth.
export class KeyState {
  private value = '';
  private stopped = false;
  private suspended = false;
  private revision = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly vault: Vault, private readonly changed: () => void) {}
  get key() { return this.value; }
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      if (this.stopped) throw new SafeError('stopped', 'Plugin arrêté.');
      return op();
    });
    this.tail = next.catch(() => {}); return next;
  }
  load() { const revision = this.revision; return this.enqueue(async () => {
    this.value = ''; this.changed();
    const key = await this.vault.load();
    if (!this.stopped && !this.suspended && revision === this.revision) this.value = key === null ? '' : validateKey(key);
    this.changed();
  }); }
  save(input: string) {
    const key = validateKey(input);
    const revision = ++this.revision;
    this.value = ''; this.changed();
    return this.enqueue(async () => {
      // Failed/uncertain writes must never leave a false "saved" state.
      this.value = ''; this.changed();
      await this.vault.save(key);
      if (!this.stopped && !this.suspended && revision === this.revision) this.value = key;
      this.changed();
    });
  }
  delete() { ++this.revision; this.value = ''; this.changed(); return this.enqueue(async () => { this.value = ''; this.changed(); await this.vault.delete(); }); }
  suspend() { ++this.revision; this.suspended = true; this.value = ''; this.changed(); }
  resume() { this.suspended = false; return this.load(); }
  stop() { this.stopped = true; this.suspend(); }
}
