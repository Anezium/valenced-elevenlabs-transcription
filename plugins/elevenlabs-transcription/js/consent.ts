// Accords manuels persistants (traitement externe/coût, publication de ses propres vocaux) et
// écrivain unique du document JSON du plugin. Pur : aucun import Discord/React ; le compte est injecté.
// Le JSON ne contient jamais de clé, d’audio, de texte ni d’URL : seulement des booléens et un identifiant de compte.
import { SafeError } from './core.js';

export interface ManualConsentRecord { external: boolean; publish: boolean; accountId: string }
export const DEFAULT_MANUAL: ManualConsentRecord = { external: false, publish: false, accountId: '' };
export type ManualKind = 'external' | 'publish';
export interface ManualMode { external: boolean; publish: boolean }
type Doc<A> = A & { manual?: unknown };
interface RawStorage<A> { get(): Promise<Doc<A>>; set(value: A & { manual: ManualConsentRecord }, replace: true): Promise<void> }
const validId = (x: unknown): x is string => typeof x === 'string' && /^\d{1,22}$/.test(x);
export function normalizeManual(value: unknown): ManualConsentRecord {
  const x = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { external: x.external === true, publish: x.publish === true, accountId: validId(x.accountId) ? x.accountId : '' };
}

/**
 * Sérialise toutes les écritures du document. ClientAutomation conserve son contrat (remplacement du
 * document entier) via la façade `automation` ; cette façade réinjecte l’accord manuel courant pour
 * qu’un remplacement n’efface jamais l’autre famille d’accords. Aucune permission automatique n’est
 * dérivée en accord manuel, ni l’inverse.
 */
export class PreferenceStore<A extends object> {
  private tail: Promise<unknown> = Promise.resolve();
  private writes = 0;
  private auto?: A;
  private manual: ManualConsentRecord = { ...DEFAULT_MANUAL };
  constructor(private readonly raw: RawStorage<A>, private readonly defaults: A) {}
  private split(doc: Doc<A> | undefined) {
    const record = { ...(doc ?? {}) } as unknown as Record<string, unknown>;
    const manual = record.manual; delete record.manual;
    // Les champs automatiques inconnus reprennent leurs valeurs par défaut (toutes fermées) ; jamais inventés « actifs ».
    const auto = { ...this.defaults, ...(record as unknown as Partial<A>) } as A;
    return { auto, manual: normalizeManual(manual) };
  }
  private async read() {
    const writes = this.writes;
    const doc = await this.raw.get();
    const parts = this.split(doc);
    // Une lecture ancienne ne doit pas régresser un état déjà écrit depuis.
    if (writes === this.writes) { this.auto = parts.auto; this.manual = parts.manual; }
    return { doc, ...parts };
  }
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.then(op);
    this.tail = next.catch(() => {});
    return next;
  }
  readonly automation = {
    get: (): Promise<A> => this.read().then(parts => parts.doc as A),
    set: (value: A, replace: true): Promise<void> => this.enqueue(async () => {
      if (replace !== true) throw new SafeError('preferences', 'Partial writes are not supported.');
      await this.raw.set({ ...value, manual: this.manual }, true);
      ++this.writes; this.auto = value;
    }),
  };
  load(): Promise<ManualConsentRecord> { return this.read().then(parts => parts.manual); }
  writeManual(manual: ManualConsentRecord): Promise<void> {
    return this.enqueue(async () => {
      await this.raw.set({ ...(this.auto ?? this.defaults), manual: { ...manual } }, true);
      ++this.writes; this.manual = { ...manual };
    });
  }
}

export interface ManualStore { load(): Promise<ManualConsentRecord>; writeManual(record: ManualConsentRecord): Promise<void> }
/**
 * État effectif des accords manuels : lié au compte courant, fermé par défaut, retraits immédiats en
 * mémoire, accords exposés seulement après écriture réussie de la révision courante.
 */
export class ManualConsent {
  private record: ManualConsentRecord = { ...DEFAULT_MANUAL };
  private loaded = false;
  private revision = 0;
  private stopped = false;
  /** Dernier problème de persistance, affiché tel quel par l’UI ; vide sinon. */
  problem = '';
  constructor(private readonly store: ManualStore, private readonly account: () => string, private readonly changed: () => void) {}
  mode(): ManualMode {
    const id = this.account();
    const bound = !this.stopped && this.loaded && !!id && this.record.accountId === id;
    return { external: bound && this.record.external, publish: bound && this.record.external && this.record.publish };
  }
  async load(): Promise<void> {
    const revision = this.revision;
    try {
      const record = await this.store.load();
      if (revision === this.revision && !this.stopped) { this.record = record; this.loaded = true; this.problem = ''; }
    } catch {
      if (revision === this.revision && !this.stopped) {
        this.record = { ...DEFAULT_MANUAL }; this.loaded = false;
        this.problem = 'Manual consents could not be read: no manual upload until a new explicit consent is saved.';
      }
    } finally { this.changed(); }
  }
  set(kind: ManualKind, value: boolean): Promise<void> {
    if (this.stopped) return Promise.reject(new SafeError('stopped', 'Plugin stopped.'));
    const id = this.account();
    if (!id) return Promise.reject(new SafeError('account', 'Unknown active account: manual consent is not possible.'));
    const current = this.mode(); const grant = value === true;
    const next: ManualConsentRecord = {
      external: kind === 'external' ? grant : current.external,
      publish: kind === 'publish' ? grant : current.publish,
      accountId: id,
    };
    if (!next.external) next.publish = false;
    const revision = ++this.revision;
    // Retraits effectifs avant l’écriture ; accords seulement après succès de la révision courante.
    this.record = { external: current.external && next.external, publish: current.publish && next.publish, accountId: id };
    this.loaded = true; this.problem = ''; this.changed();
    return this.store.writeManual(next).then(() => {
      if (revision === this.revision && !this.stopped && this.account() === id) this.record = next;
      this.changed();
    }, () => {
      const message = grant
        ? 'Consent not saved: nothing is authorized. Try again.'
        : 'Withdrawal effective for this session only: the disk may keep the old consent after a restart. Retry the withdrawal before closing the app.';
      if (revision === this.revision) this.problem = message;
      this.changed();
      throw new SafeError('preferences', message);
    });
  }
  stop() { this.stopped = true; ++this.revision; this.record = { ...DEFAULT_MANUAL }; this.loaded = false; }
}
