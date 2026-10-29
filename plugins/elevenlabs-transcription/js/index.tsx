import Page from '@valenced/components/Page';
import { getAssetIdByName } from '@valenced/assets';
import { Design } from '@valenced/discord/design';
import { ActionSheetActionCreators } from '@valenced/discord/actions';
import { Stores } from '@valenced/discord/flux';
import { FileModule, ClientInfoModule } from '@valenced/discord/native';
import { Clipboard } from '@valenced/externals/react-native-clipboard';
import { getModules } from '@valenced/modules/finders';
import { withName } from '@valenced/modules/finders/filters';
import { instead } from '@valenced/patcher';
import { lookupGeneratedIconComponent } from '@valenced/utils/discord';
import { cloneElement, isValidElement, useEffect, useState } from 'react';
import { AppState, ScrollView, TextInput } from 'react-native';
import type { FC, ReactElement, ReactNode } from 'react';
import { CACHE_DIR, SafeError, Transcriber, bytesToBase64, compatibleClient, extractTarget, safeMessage } from './core.js';
import type { Files, Phase, Target } from './core.js';
import { XHRTransport } from './transport.js';
import type { ElementLike } from './tree.js';
import { KeyState } from './key-state.js';
import { nativeVault } from './vault.js';
import { ClientAutomation, DEFAULT_AUTO } from './client.js';
import type { AutoPreferences } from './client.js';
import type { AutoMode } from './automation.js';
import { DEFAULT_MANUAL, ManualConsent, PreferenceStore } from './consent.js';
import type { ManualConsentRecord, ManualKind } from './consent.js';
import { REFUSAL_MESSAGES, flattenChildren, planInsertion } from './menu.js';

const SHEET_KEY = 'anezium-elevenlabs-transcription';
const ACTION_LABEL = 'Transcribe with ElevenLabs';
// Nom d’asset que le host Valenced d3e17fe utilise lui-même (HermesVersionSetting). Sa présence dans le
// client 352.6 installé reste à vérifier sur appareil : résolution via API host, refus fermé sinon.
const ICON_ASSET = 'TranscriptOutlineIcon';
// Un reload rapide ne doit pas purger le fichier d’un ancien upload encore en arrêt.
let previousStop: Promise<void> = Promise.resolve();
// Champ secret : TextInput React Native conservé pour ses propriétés anti-autofill/anti-suggestion
// évidentes ; Design.TextInput n’expose pas ces propriétés dans les types vendor. Couleurs fixes (thème sombre).
const secretInputStyle = { color: '#f3f4f7', backgroundColor: '#30333e', padding: 12, borderRadius: 8, minHeight: 48 } as const;
type IconComponent = NonNullable<ReturnType<typeof lookupGeneratedIconComponent>>;
type ResolvedIcon = { IconComponent: IconComponent } | { source: number };
type Document = AutoPreferences & { manual: ManualConsentRecord };
interface Storage { get(): Promise<Document>; set(value: Document, replace: true): Promise<void> }
interface Diagnostics {
  compatible: boolean; ready: boolean; candidates: number; menu: boolean; problem: string; keySet: boolean; last: string;
  autoReady: boolean; incoming: boolean; ownReplies: boolean; autoProblem: string;
  placement: string; manualExternal: boolean; manualPublish: boolean;
}
function currentAccount(): string {
  try {
    const store = (Stores as unknown as Record<string, { getId?: () => unknown } | undefined>)['AuthenticationStore'];
    const id = store?.getId?.();
    return typeof id === 'string' && /^\d{1,22}$/.test(id) ? id : '';
  } catch { return ''; }
}
class Runtime {
  alive = true;
  keys = new KeyState(nativeVault, () => this.update({ keySet: !!this.keys.key }));
  get key() { return this.keys.key; }
  listeners = new Set<() => void>();
  diagnostics: Diagnostics = {
    compatible: false, ready: false, candidates: 0, menu: false, problem: '', keySet: false, last: 'No transfer yet',
    autoReady: false, incoming: false, ownReplies: false, autoProblem: '',
    placement: 'No voice message menu opened yet.', manualExternal: false, manualPublish: false,
  };
  auto?: ClientAutomation;
  engine: Transcriber;
  store: PreferenceStore<AutoPreferences>;
  consent: ManualConsent;
  icon?: ResolvedIcon;
  constructor(storage: Storage) {
    this.store = new PreferenceStore<AutoPreferences>(storage, DEFAULT_AUTO);
    this.consent = new ManualConsent(this.store, currentAccount, () => {
      const mode = this.consent.mode();
      if ((this.diagnostics.manualExternal && !mode.external) || (this.diagnostics.manualPublish && !mode.publish)) {
        this.auto?.invalidate(); this.engine.cancelAll(); this.engine.clearResults();
      }
      this.update({ manualExternal: mode.external, manualPublish: mode.publish });
    });
    const files: Files = {
      prepare: async () => {
        await previousStop;
        // Crée le dossier privé si absent, puis purge AUSSI après redémarrage/crash.
        await FileModule.writeFile('cache', `${CACHE_DIR}/init.txt`, '', 'utf8');
        const cleared = await FileModule.clearFolder('cache', CACHE_DIR);
        if (cleared !== true) throw new SafeError('cache', 'Unable to clear the cache. No transfer allowed.');
      },
      write: async (name, bytes) => {
        const path = await FileModule.writeFile('cache', `${CACHE_DIR}/${name}`, bytesToBase64(bytes), 'base64');
        if (typeof path !== 'string' || !path.startsWith('/')) throw new SafeError('file', 'Unsupported cache path.');
        return `file://${path}`;
      },
      remove: async name => {
        const relative = `${CACHE_DIR}/${name}`;
        const path = `${FileModule.getConstants().CacheDirPath}/${relative}`;
        if (await FileModule.fileExists(path)) {
          await FileModule.removeFile('cache', relative);
          if (await FileModule.fileExists(path)) throw new SafeError('cleanup', 'Unable to delete the cache.');
        }
      },
    };
    this.engine = new Transcriber(new XHRTransport({ xhr: () => new XMLHttpRequest(), form: () => new FormData() as never }), files);
  }
  update(update: Partial<Diagnostics>) { this.diagnostics = { ...this.diagnostics, ...update }; for (const notify of this.listeners) notify(); }
  /** Mise à jour différée depuis un rendu (patch du menu) : évite un setState pendant le rendu d’un autre composant. */
  defer(update: Partial<Diagnostics>) { void Promise.resolve().then(() => { if (this.alive) this.update(update); }); }
  pause() { this.auto?.pause(); this.keys.suspend(); this.engine.cancelAll(); this.engine.clearResults(); }
  async forget() { this.auto?.invalidate(); this.engine.cancelAll(); this.engine.clearResults(); await this.keys.delete(); this.update({ last: 'Key deleted from the vault' }); }
  async setKey(value: string) { if (!this.alive) throw new SafeError('stopped', 'Plugin stopped.'); this.auto?.invalidate(); this.engine.cancelAll(); this.engine.clearResults(); await this.keys.save(value); }
  notifyAuto(autoReady: boolean, mode: AutoMode, autoProblem?: string) { this.update({ autoReady, incoming: mode.incoming, ownReplies: mode.ownReplies, ...(autoProblem !== undefined ? { autoProblem } : {}) }); }
}
let runtime: Runtime | undefined;
function useRuntime(rt: Runtime | undefined) {
  const [, render] = useState(0);
  useEffect(() => {
    if (!rt) return;
    const changed = () => render(n => n + 1); rt.listeners.add(changed);
    return () => { rt.listeners.delete(changed); };
  }, [rt]);
  return rt?.diagnostics;
}
function Note({ children, tone = 'muted', alert = false }: { children: ReactNode; tone?: 'muted' | 'default' | 'critical' | 'warning'; alert?: boolean }) {
  const { Text } = Design;
  const color = tone === 'critical' ? 'text-feedback-critical' : tone === 'warning' ? 'text-feedback-warning' : tone === 'default' ? 'text-default' : 'text-muted';
  return <Text accessibilityRole={alert ? 'alert' : undefined} selectable={alert} variant={alert ? 'text-sm/medium' : 'text-sm/normal'} color={color}>{children}</Text>;
}
function KeyEditor({ rt, onDone, onCancel }: { rt: Runtime; onDone?(): void; onCancel?(): void }) {
  const [entry, setEntry] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const d = useRuntime(rt)!;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { setEntry(''); setError(''); }
    });
    return () => subscription.remove();
  }, [rt]);
  const { Button, Stack } = Design;
  const save = () => {
    const value = entry; setEntry(''); setError(''); setSaving(true);
    void rt.setKey(value).then(() => {
      if (!rt.alive) return;
      // Une résolution ne prouve pas la disponibilité : en arrière-plan la clé reste volontairement vide.
      if (rt.diagnostics.keySet) onDone?.(); else setError('Write completed, but the key is not available yet: bring the app to the foreground, then check the status.');
    }).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setSaving(false); });
  };
  return <Stack spacing={8}>
    <Note>Key encrypted by Android Keystore, excluded from backups, and reused after returning to the foreground and after a restart. Format checked locally only: no validation with ElevenLabs, and no transfer without the native bridge.</Note>
    <TextInput accessibilityLabel="ElevenLabs API key (hidden)" placeholder="ElevenLabs key" placeholderTextColor="#adb2c4" value={entry} onChangeText={setEntry} secureTextEntry autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none" importantForAutofill="no" contextMenuHidden style={secretInputStyle} editable={rt.alive && !saving} />
    <Button text={d.keySet ? 'Replace the secured key' : 'Save the secured key'} variant="primary" loading={saving} disabled={!entry.trim() || !rt.alive || saving} onPress={save} />
    {onCancel && <Button text="Cancel" variant="tertiary" disabled={saving} onPress={() => { setEntry(''); setError(''); onCancel(); }} />}
    {!!error && <Note tone="critical" alert>{error}</Note>}
  </Stack>;
}
function KeySection({ rt }: { rt: Runtime }) {
  const d = useRuntime(rt)!; const [editing, setEditing] = useState(false); const [deleting, setDeleting] = useState(false); const [error, setError] = useState('');
  const { TableRowGroup, TableRow } = Design;
  const vaultProblem = d.problem.startsWith('Android vault') ? d.problem : '';
  return <>
    <TableRowGroup title="ElevenLabs API key" description={d.keySet ? 'Format checked locally. Not yet validated against ElevenLabs or a real Android vault (device test needed).' : undefined}>
      <TableRow label="Secured key" subLabel={d.keySet ? 'Present in memory, encrypted by Android Keystore.' : vaultProblem || 'No key in memory.'} />
      {!editing && <TableRow label={d.keySet ? 'Replace the key' : 'Save a key'} arrow disabled={!rt.alive} onPress={() => { setError(''); setEditing(true); }} />}
      <TableRow label="Delete the key and results" subLabel={deleting ? 'Deleting from the vault…' : 'Cancels transfers. Try again here if the deletion fails, even without a key in memory.'} variant="danger" disabled={deleting || !rt.alive} onPress={() => {
        setDeleting(true); setError('');
        void rt.forget().catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setDeleting(false); });
      }} />
    </TableRowGroup>
    {editing && <KeyEditor rt={rt} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
    {!!error && <Note tone="critical" alert>{error}</Note>}
  </>;
}
function ManualSection({ rt }: { rt: Runtime }) {
  useRuntime(rt); const [busy, setBusy] = useState<ManualKind | ''>(''); const [error, setError] = useState('');
  const mode = rt.consent.mode();
  const toggle = (kind: ManualKind, value: boolean) => {
    if (busy) return;
    setBusy(kind); setError('');
    void rt.consent.set(kind, value).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setBusy(''); });
  };
  const { TableRowGroup, TableSwitchRow } = Design;
  return <>
    <TableRowGroup title="Manual transcription" description="Triggered only by long-pressing a voice message, then “Transcribe”. No history is analyzed and nothing is triggered automatically.">
      <TableSwitchRow label="Allow sending to ElevenLabs" subLabel="External service; cost possible and retention depends on your plan. After this consent, “Transcribe” is enough, with no per-message confirmation." accessibilityHint="Persistent consent tied to this account, revocable at any time" value={mode.external} disabled={!rt.alive || !!busy} onValueChange={value => toggle('external', value)} />
      <TableSwitchRow label="Publish my transcripts" subLabel="“Publish” posts the text of your own voice message as a reply in its channel. Never other people’s voice messages, and never without pressing “Publish”." accessibilityHint="Requires the sending consent; revocable at any time" value={mode.publish} disabled={!rt.alive || !!busy || !mode.external} onValueChange={value => toggle('publish', value)} />
    </TableRowGroup>
    {(!!error || !!rt.consent.problem) && <Note tone="critical" alert>{error || rt.consent.problem}</Note>}
  </>;
}
function AutomaticSection({ rt }: { rt: Runtime }) {
  const d = useRuntime(rt)!; const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const configure = (mode: AutoMode) => {
    if (!rt.auto || busy) return;
    setBusy(true); setError('');
    void rt.auto.configure(mode).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setBusy(false); });
  };
  const canEnable = d.autoReady && d.keySet;
  const { TableRowGroup, TableSwitchRow, TableRow } = Design;
  return <>
    <TableRowGroup title="Automatic — off by default" description={d.autoReady ? 'Open chat only, new voice messages only, no history and no catch-up. Device validation still required.' : 'Automatic modules missing or ambiguous: activation refused.'}>
      <TableSwitchRow label="Others’ voice messages: transcribe and show locally" subLabel="Every new voice message in the open chat is sent to ElevenLabs (cost). Enable only with the permission of the people concerned. Nothing is published." value={d.incoming} disabled={busy || (!d.incoming && !canEnable)} onValueChange={value => configure({ incoming: value, ownReplies: d.ownReplies })} />
      <TableSwitchRow label="My voice messages: publish the transcript as a reply" subLabel="After a successful send, the text is published in the original channel, visible to its members. Each voice message incurs a cost." value={d.ownReplies} disabled={busy || (!d.ownReplies && !canEnable)} onValueChange={value => configure({ incoming: d.incoming, ownReplies: value })} />
      {(d.incoming || d.ownReplies) && <TableRow label="Turn off all automation" subLabel="Withdrawn immediately for this session, then saved." variant="danger" disabled={busy} onPress={() => configure({ incoming: false, ownReplies: false })} />}
    </TableRowGroup>
    {(!!error || !!d.autoProblem) && <Note tone="critical" alert>{error || d.autoProblem}</Note>}
  </>;
}
function DetailsSection({ rt }: { rt: Runtime }) {
  const d = useRuntime(rt)!; const [open, setOpen] = useState(false);
  const { TableRowGroup, TableRow, Stack } = Design;
  return <>
    <TableRowGroup title="Details">
      <TableRow label="Long-press menu action" subLabel={d.placement} />
      <TableRow label={open ? 'Hide diagnostics and limits' : 'Diagnostics, limits and license'} arrow onPress={() => setOpen(!open)} />
    </TableRowGroup>
    {open && <Stack spacing={8}>
      <Note>{`Diagnostics (no IDs or secrets):\nSupported client: ${d.compatible ? 'yes' : 'no'}\nCache ready: ${d.ready ? 'yes' : 'no'}\nMenu modules found: ${d.candidates}\nMenu patch: ${d.menu ? 'active' : 'inactive'}\n${d.problem || 'No problem detected'}\nLast step: ${d.last}\nEffective manual consents: sending ${d.manualExternal ? 'yes' : 'no'}, publishing ${d.manualPublish ? 'yes' : 'no'}`}</Note>
      <Note>Menu policy: insert only into the single eligible native group (non-destructive rows with icons), with an icon resolved by the host; otherwise explicit refusal, never a separate group. Actual structure of client 352.6 not observed: device verification required.</Note>
      <Note>Limits: 8 MiB / 5 minutes. Audio is sent to the third-party service ElevenLabs; cost possible and retention depends on your plan. A local result does not mean local processing. The transport checks initial/final URLs and sizes on a best-effort basis, without guaranteeing that HTTP redirects are blocked beforehand or a strict native memory cap. Phone and real API tests not performed.</Note>
      <Note>The vault protects the file at rest, not against other plugins in the same process. The key is held in JS memory during the transfer. Transcripts are cleared when the app goes to the background; the clipboard remains managed by Android. If a consent withdrawal fails to persist to disk, it stays effective for the session only.</Note>
      <Note>Copyright 2026 Anezium and Valenced contributors. Free software under GPL-3.0, without warranty. Sources, license and redistribution: github.com/Anezium/valenced-elevenlabs-transcription. Version 0.2.1.</Note>
    </Stack>}
  </>;
}
export function SettingsComponent() {
  const rt = runtime; useRuntime(rt);
  const { Stack } = Design;
  return <Page spacing={0}><ScrollView keyboardShouldPersistTaps="handled"><Stack spacing={16} style={{ padding: 16, paddingBottom: 32 }}>
    <Note tone="default">{!rt ? 'Enable the plugin to get started.' : `Long-press a voice message → “${ACTION_LABEL}”. Manual transcription only when you trigger it; automatic only after you enable it below. Key and consent required.`}</Note>
    {rt && <KeySection rt={rt} />}
    {rt && <ManualSection rt={rt} />}
    {rt && <AutomaticSection rt={rt} />}
    {rt && <DetailsSection rt={rt} />}
  </Stack></ScrollView></Page>;
}
function TranscriptSheet({ rt, target, initialError }: { rt: Runtime; target?: Target; initialError?: string }) {
  const d = useRuntime(rt);
  const [text, setText] = useState(() => target ? rt.engine.cached(target) ?? '' : '');
  const [error, setError] = useState(initialError ?? '');
  const [phase, setPhase] = useState<Phase | ''>(''); const [copied, setCopied] = useState(false);
  const [granting, setGranting] = useState<ManualKind | ''>('');
  const [publishing, setPublishing] = useState(false); const [published, setPublished] = useState(false);
  useEffect(() => () => { if (target) rt.engine.cancel(target); }, [rt, target]);
  useEffect(() => { if (!d?.keySet || !d.manualExternal) setText(''); }, [d?.keySet, d?.manualExternal]);
  const manual = rt.consent.mode(); const busy = phase !== '';
  const enabled = !!target && rt.alive && !!d?.compatible && !!d.ready && d.menu && d.keySet && manual.external;
  const run = async () => {
    // L’accord persistant est relu au moment de l’action ; jamais déduit du mode automatique.
    if (!enabled || !target || busy || !rt.consent.mode().external) return;
    setPhase('download'); setError(''); setCopied(false);
    try {
      const result = await rt.engine.run(target, rt.key, true, stage => { if (rt.alive) { setPhase(stage); rt.update({ last: stage === 'upload' ? 'ElevenLabs upload in progress' : 'Discord download in progress' }); } });
      if (rt.alive && rt.diagnostics.keySet && rt.consent.mode().external) { setText(result); rt.update({ last: 'Transcript received and audio cache cleaned' }); }
    } catch (e) { if (rt.alive) { setError(safeMessage(e)); rt.update({ last: e instanceof SafeError ? `Controlled failure: ${e.code}` : 'Controlled failure' }); } }
    finally { if (rt.alive) setPhase(''); }
  };
  const grant = (kind: ManualKind) => {
    setGranting(kind); setError('');
    void rt.consent.set(kind, true).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setGranting(''); });
  };
  const publish = () => {
    if (!rt.auto || !target || publishing || published) return;
    const allowed = rt.consent.mode().publish === true;
    if (!allowed) { setError('Consent to manual publishing required.'); return; }
    setPublishing(true); setError('');
    void rt.auto.replyManually(target, text, allowed).then(() => { if (rt.alive) setPublished(true); }).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setPublishing(false); });
  };
  const close = () => { if (target) rt.engine.cancel(target); ActionSheetActionCreators.hideActionSheet(SHEET_KEY); };
  const { ActionSheet, BottomSheetTitleHeader, Button, Card, Stack, Text } = Design;
  const own = !!target && !!text && !!rt.auto?.canReplyTo(target);
  return <ActionSheet>
    <BottomSheetTitleHeader title={ACTION_LABEL} subtitle={target ? `Voice message, ${Math.ceil(target.seconds)} s · ${(target.size / 1024 / 1024).toFixed(2)} MiB` : undefined} />
    <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      <Stack spacing={12}>
        {!rt.alive && <Note tone="critical" alert>Plugin stopped.</Note>}
        {!text && !busy && <>
          {!d?.keySet && <>
            <Note tone="default">An ElevenLabs API key is required before any transfer.</Note>
            <KeyEditor rt={rt} />
          </>}
          {d?.keySet && !manual.external && <>
            <Note tone="default">Allow once: the audio of the voice messages you choose is sent to ElevenLabs (Scribe v2), an external service that may be paid, with retention depending on your plan. After that, “Transcribe” is enough, with no further confirmation. Nothing is published without a separate action. Reversible in the plugin settings.</Note>
            <Button text="I allow sending the voice messages I choose to ElevenLabs" variant="primary" loading={granting === 'external'} disabled={!rt.alive || !!granting} onPress={() => grant('external')} />
          </>}
          {d?.keySet && manual.external && <>
            <Note>Result shown here only. Only transcribe other people’s voice messages if you are allowed to share them with this provider.</Note>
            {target && rt.engine.wasAttempted(target) && <Note tone="warning" alert>An upload was already attempted for this voice message: retrying may be billed a second time, even without a result.</Note>}
            <Button text={error ? 'Retry (cost possible)' : 'Transcribe (cost possible)'} variant="primary" disabled={!enabled} onPress={() => { void run(); }} />
          </>}
        </>}
        {busy && <>
          <Text accessibilityLiveRegion="polite" variant="text-sm/medium" color="text-default">{phase === 'upload' ? 'Sending to ElevenLabs…' : 'Downloading the voice message from Discord…'}</Text>
          <Button text="Cancel" variant="secondary" onPress={() => { if (target) rt.engine.cancel(target); }} />
        </>}
        {!!error && <Note tone="critical" alert>{error}</Note>}
        {!!text && <>
          <Note>ElevenLabs transcript — may contain errors. Kept in memory only.</Note>
          <Card><Text selectable variant="text-md/normal" color="text-default">{text}</Text></Card>
          <Button text={copied ? 'Copied to the Android clipboard' : 'Copy the text'} variant="secondary" disabled={!rt.alive || !d?.keySet} onPress={() => { try { Clipboard.setString(text); setCopied(true); } catch { setError('Clipboard unavailable. You can select the text instead.'); } }} />
          {own && <Note>After an uncertain send, check the channel before publishing again: a duplicate is possible. No automatic resend.</Note>}
          {own && (manual.publish
            ? <Button text={published ? 'Reply published' : 'Publish as a reply to my voice message'} variant="primary" loading={publishing} disabled={publishing || published || !rt.alive || !d?.keySet} onPress={publish} />
            : <>
              <Note>To publish the text of your own voice messages as a reply in their channel, allow it once. Never other people’s voice messages. After an uncertain send, there is no automatic resend: a duplicate remains possible.</Note>
              <Button text="I allow publishing my transcripts" variant="secondary" loading={granting === 'publish'} disabled={!rt.alive || !!granting} onPress={() => grant('publish')} />
            </>)}
          <Button text="Clear local transcripts" variant="tertiary" onPress={() => { rt.auto?.invalidate(); rt.engine.clearResults(); setText(''); setCopied(false); setPublished(false); }} />
        </>}
        <Button text={busy ? 'Close (cancels the upload)' : 'Close'} variant="tertiary" onPress={close} />
      </Stack>
    </ScrollView>
  </ActionSheet>;
}
function openSheet(rt: Runtime, target?: Target, initialError?: string) {
  if (!rt.alive) return;
  try { ActionSheetActionCreators.openLazy(Promise.resolve({ default: TranscriptSheet }), SHEET_KEY, { rt, target, initialError }, 'stack'); }
  catch { rt.update({ problem: 'Transcription sheet unavailable on this build.' }); }
}
/** Icône via les API host évidentes (types vendor, usage du host lui-même). Aucune invention : undefined = refus. */
function resolveIcon(rt: Runtime): ResolvedIcon | undefined {
  if (rt.icon) return rt.icon;
  try { const component = lookupGeneratedIconComponent(ICON_ASSET); if (typeof component === 'function') return rt.icon = { IconComponent: component }; } catch { /* module introuvable : essayer l’asset brut */ }
  try { const id = getAssetIdByName(ICON_ASSET); if (typeof id === 'number' && Number.isInteger(id) && id > 0) return rt.icon = { source: id }; } catch { /* asset absent */ }
  return undefined;
}
const identities = (...types: unknown[]) => new Set(types.filter(type => type !== undefined && type !== null));
/** Insère la ligne en tête du groupe cible, sans nouveau groupe ni changement d’ordre relatif des actions natives. */
function appendToGroup(node: unknown, group: ElementLike, row: ReactElement, depth = 0): unknown {
  if (depth > 20) return node;
  if (node === group && isValidElement(node)) return cloneElement(node, undefined, row, ...(flattenChildren(group.props.children) as ReactNode[]));
  if (Array.isArray(node)) {
    let changed = false;
    const mapped = node.map(child => { const next = appendToGroup(child, group, row, depth + 1); if (next !== child) changed = true; return next; });
    return changed ? mapped : node;
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children) {
    const next = appendToGroup(node.props.children, group, row, depth + 1);
    return next === node.props.children ? node : cloneElement(node, undefined, next as ReactNode);
  }
  return node;
}
export default plugin<{ jsonStorage: Document }>({
  jsonStorage: { load: true, default: { ...DEFAULT_AUTO, manual: DEFAULT_MANUAL } },
  start({ cleanup, jsonStorage }) {
    const rt = new Runtime(jsonStorage); runtime = rt;
    let unpatch: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let appState: { remove(): void } | undefined;
    // Le cleanup est enregistré AVANT toute découverte/résolution native susceptible d’échouer.
    cleanup(() => {
      rt.alive = false; rt.pause(); rt.keys.stop(); rt.consent.stop();
      try { unpatch?.(); } catch { /* pas de log sensible */ }
      try { unsubscribe?.(); } catch { /* idem */ }
      try { appState?.remove(); } catch { /* poursuivre tous les cleanups */ }
      try { ActionSheetActionCreators.hideActionSheet(SHEET_KEY); } catch { /* aucun sheet ouvert */ }
      previousStop = Promise.allSettled([rt.engine.stop(), rt.auto?.stop()]).then(() => {});
      if (runtime === rt) runtime = undefined;
      rt.listeners.clear();
    });
    try {
      if (typeof XMLHttpRequest !== 'function' || typeof FormData !== 'function' || typeof AbortController !== 'function' || typeof URL !== 'function') throw new SafeError('runtime', 'Missing network primitives; no transfer possible.');
      const compatible = compatibleClient(ClientInfoModule.getConstants());
      rt.update({ compatible });
      if (!compatible) { rt.update({ problem: 'Different client build or missing metadata: target 352.6 / 352206 (or build 35220600000000) / canaryRelease. Plugin disabled for this client.' }); return; }
      rt.auto = new ClientAutomation(rt, rt.store.automation); rt.auto.start();
      void rt.consent.load();
      const restoreKey = () => { void rt.keys.resume().then(() => { if (rt.alive) rt.auto?.resume(); }).catch(() => { if (rt.alive) rt.update({ problem: 'Android vault unavailable. No plaintext storage and no transfer without a key.' }); }); };
      appState = AppState.addEventListener('change', state => { if (state !== 'active') rt.pause(); else restoreKey(); });
      restoreKey();
      void rt.engine.initialize().then(() => { if (rt.alive) rt.update({ ready: true }); }).catch(() => { if (rt.alive) rt.update({ ready: false, problem: 'Private cache cannot be cleared. Stop and restart the plugin.' }); });
      const candidates = new Set<unknown>();
      type LongPress = FC<{ message: unknown; channel: unknown }>;
      unsubscribe = getModules(withName<LongPress>('LongPressMessageActionSheet'), mod => {
        try {
        if (!rt.alive || candidates.has(mod)) return;
        candidates.add(mod); rt.update({ candidates: candidates.size });
        if (candidates.size !== 1) { unpatch?.(); unpatch = undefined; rt.update({ menu: false, problem: 'Several menu modules match; no patch kept.' }); return; }
        const module = mod as unknown as { default: LongPress };
        if (!module || typeof module.default !== 'function') { rt.update({ problem: 'Unsupported menu signature.' }); return; }
        unpatch = instead(module, 'default', function (args, original) {
          const tree = Reflect.apply(original, this, args);
          if (!rt.alive || !rt.diagnostics.menu) return tree;
          try {
            const props = args[0]; let target: Target | undefined; let error: string | undefined;
            try { target = extractTarget(props?.message, props?.channel); }
            catch (e) { error = safeMessage(e); }
            if (!target && !error) return tree;
            // Alias déclarés par les types vendor : ActionSheetRow = TableRow, ActionSheetRowGroup = TableRowGroup. Valeurs absentes ignorées.
            const { ActionSheet, ActionSheetRow, TableRow, TableRowGroup } = Design;
            if (!ActionSheet || !ActionSheetRow || !ActionSheetRow.Icon) { rt.defer({ placement: 'Refused: native ActionSheet/ActionSheetRow/Icon components unavailable on this build; nothing inserted.' }); return tree; }
            const plan = planInsertion(tree, { sheet: ActionSheet, groups: identities(ActionSheetRow.Group, TableRow?.Group, TableRowGroup), rows: identities(ActionSheetRow, TableRow) });
            if (!plan.ok) { rt.defer({ placement: REFUSAL_MESSAGES[plan.reason] }); return tree; }
            const icon = resolveIcon(rt);
            if (!icon) { rt.defer({ placement: `Refused: native icon “${ICON_ASSET}” not found via the host; nothing inserted without an icon.` }); return tree; }
            const row = <ActionSheetRow key="anezium-elevenlabs-transcription" label={ACTION_LABEL} icon={<ActionSheetRow.Icon {...icon} />} onPress={() => openSheet(rt, target, error)} />;
            rt.defer({ placement: `Inserted at the top of the single eligible native group (${plan.groups} visible group(s)). Actual client structure to be verified on a device.` });
            return appendToGroup(tree, plan.group, row) as ReactElement;
          } catch { rt.defer({ problem: 'Voice message menu not supported; no transfer triggered.' }); return tree; }
        });
        rt.update({ menu: true });
        } catch {
          try { unpatch?.(); } catch { /* désactivation logique même si dépatch impossible */ }
          unpatch = undefined;
          rt.update({ menu: false, problem: 'Menu module cannot be patched; no transfer allowed.' });
        }
      }, { returnNamespace: true });
    } catch (e) { unpatch?.(); rt.update({ menu: false, problem: safeMessage(e) }); }
  },
  SettingsComponent,
});
