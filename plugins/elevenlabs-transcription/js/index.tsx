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
const ACTION_LABEL = 'Transcrire avec ElevenLabs';
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
    compatible: false, ready: false, candidates: 0, menu: false, problem: '', keySet: false, last: 'Aucun transfert',
    autoReady: false, incoming: false, ownReplies: false, autoProblem: '',
    placement: 'Aucun menu de vocal ouvert pour l’instant.', manualExternal: false, manualPublish: false,
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
        if (cleared !== true) throw new SafeError('cache', 'Purge du cache impossible. Aucun transfert autorisé.');
      },
      write: async (name, bytes) => {
        const path = await FileModule.writeFile('cache', `${CACHE_DIR}/${name}`, bytesToBase64(bytes), 'base64');
        if (typeof path !== 'string' || !path.startsWith('/')) throw new SafeError('file', 'Chemin de cache non pris en charge.');
        return `file://${path}`;
      },
      remove: async name => {
        const relative = `${CACHE_DIR}/${name}`;
        const path = `${FileModule.getConstants().CacheDirPath}/${relative}`;
        if (await FileModule.fileExists(path)) {
          await FileModule.removeFile('cache', relative);
          if (await FileModule.fileExists(path)) throw new SafeError('cleanup', 'Suppression du cache impossible.');
        }
      },
    };
    this.engine = new Transcriber(new XHRTransport({ xhr: () => new XMLHttpRequest(), form: () => new FormData() as never }), files);
  }
  update(update: Partial<Diagnostics>) { this.diagnostics = { ...this.diagnostics, ...update }; for (const notify of this.listeners) notify(); }
  /** Mise à jour différée depuis un rendu (patch du menu) : évite un setState pendant le rendu d’un autre composant. */
  defer(update: Partial<Diagnostics>) { void Promise.resolve().then(() => { if (this.alive) this.update(update); }); }
  pause() { this.auto?.pause(); this.keys.suspend(); this.engine.cancelAll(); this.engine.clearResults(); }
  async forget() { this.auto?.invalidate(); this.engine.cancelAll(); this.engine.clearResults(); await this.keys.delete(); this.update({ last: 'Clé supprimée du coffre' }); }
  async setKey(value: string) { if (!this.alive) throw new SafeError('stopped', 'Plugin arrêté.'); this.auto?.invalidate(); this.engine.cancelAll(); this.engine.clearResults(); await this.keys.save(value); }
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
      if (rt.diagnostics.keySet) onDone?.(); else setError('Écriture terminée, clé indisponible pour l’instant : revenez au premier plan puis vérifiez l’état.');
    }).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setSaving(false); });
  };
  return <Stack spacing={8}>
    <Note>Clé chiffrée par Android Keystore, hors sauvegardes, réutilisée après retour au premier plan et redémarrage. Forme vérifiée localement seulement : aucune validation auprès d’ElevenLabs, aucun transfert sans bridge natif.</Note>
    <TextInput accessibilityLabel="Clé API ElevenLabs (masquée)" placeholder="Clé ElevenLabs" placeholderTextColor="#adb2c4" value={entry} onChangeText={setEntry} secureTextEntry autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none" importantForAutofill="no" contextMenuHidden style={secretInputStyle} editable={rt.alive && !saving} />
    <Button text={d.keySet ? 'Remplacer la clé sécurisée' : 'Enregistrer la clé sécurisée'} variant="primary" loading={saving} disabled={!entry.trim() || !rt.alive || saving} onPress={save} />
    {onCancel && <Button text="Annuler" variant="tertiary" disabled={saving} onPress={() => { setEntry(''); setError(''); onCancel(); }} />}
    {!!error && <Note tone="critical" alert>{error}</Note>}
  </Stack>;
}
function KeySection({ rt }: { rt: Runtime }) {
  const d = useRuntime(rt)!; const [editing, setEditing] = useState(false); const [deleting, setDeleting] = useState(false); const [error, setError] = useState('');
  const { TableRowGroup, TableRow } = Design;
  const vaultProblem = d.problem.startsWith('Coffre') ? d.problem : '';
  return <>
    <TableRowGroup title="Clé API ElevenLabs" description={d.keySet ? 'Forme vérifiée localement. Ni ElevenLabs ni le coffre Android réel ne sont validés avant un test appareil.' : undefined}>
      <TableRow label="Clé sécurisée" subLabel={d.keySet ? 'Présente en mémoire, chiffrée par Android Keystore.' : vaultProblem || 'Aucune clé en mémoire.'} />
      {!editing && <TableRow label={d.keySet ? 'Remplacer la clé' : 'Enregistrer une clé'} arrow disabled={!rt.alive} onPress={() => { setError(''); setEditing(true); }} />}
      <TableRow label="Supprimer la clé et les résultats" subLabel={deleting ? 'Suppression du coffre en cours…' : 'Annule les transferts. Réessayez ici si la suppression échoue, même sans clé en mémoire.'} variant="danger" disabled={deleting || !rt.alive} onPress={() => {
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
    <TableRowGroup title="Transcription manuelle" description="Déclenchée uniquement par appui long sur un vocal puis « Transcrire ». Aucun historique analysé, aucun déclenchement automatique.">
      <TableSwitchRow label="Autoriser l’envoi à ElevenLabs" subLabel="Service externe, coût possible et rétention selon votre offre. Après cet accord, « Transcrire » suffit, sans confirmation par vocal." accessibilityHint="Accord persistant lié à ce compte, révocable à tout moment" value={mode.external} disabled={!rt.alive || !!busy} onValueChange={value => toggle('external', value)} />
      <TableSwitchRow label="Publier mes transcriptions" subLabel="« Publier » poste le texte de votre propre vocal en réponse, dans son canal. Jamais les vocaux d’autrui, jamais sans appui sur « Publier »." accessibilityHint="Nécessite l’accord d’envoi ; révocable à tout moment" value={mode.publish} disabled={!rt.alive || !!busy || !mode.external} onValueChange={value => toggle('publish', value)} />
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
    <TableRowGroup title="Automatique — désactivé par défaut" description={d.autoReady ? 'Chat ouvert seulement, nouveaux vocaux uniquement, aucun historique ni rattrapage. Validation appareil encore requise.' : 'Modules automatiques absents ou ambigus : activation refusée.'}>
      <TableSwitchRow label="Vocaux d’autrui : transcrire et afficher localement" subLabel="Chaque nouveau vocal du chat ouvert est envoyé à ElevenLabs (coût). N’activez qu’avec l’autorisation des personnes concernées. Rien n’est publié." value={d.incoming} disabled={busy || (!d.incoming && !canEnable)} onValueChange={value => configure({ incoming: value, ownReplies: d.ownReplies })} />
      <TableSwitchRow label="Mes vocaux : publier la transcription en réponse" subLabel="Après envoi réussi, le texte est publié dans le canal d’origine, visible par ses membres. Coût pour chaque vocal." value={d.ownReplies} disabled={busy || (!d.ownReplies && !canEnable)} onValueChange={value => configure({ incoming: d.incoming, ownReplies: value })} />
      {(d.incoming || d.ownReplies) && <TableRow label="Désactiver toute automatisation" subLabel="Retrait immédiat pour cette session, puis enregistrement." variant="danger" disabled={busy} onPress={() => configure({ incoming: false, ownReplies: false })} />}
    </TableRowGroup>
    {(!!error || !!d.autoProblem) && <Note tone="critical" alert>{error || d.autoProblem}</Note>}
  </>;
}
function DetailsSection({ rt }: { rt: Runtime }) {
  const d = useRuntime(rt)!; const [open, setOpen] = useState(false);
  const { TableRowGroup, TableRow, Stack } = Design;
  return <>
    <TableRowGroup title="Détails">
      <TableRow label="Action du menu d’appui long" subLabel={d.placement} />
      <TableRow label={open ? 'Masquer le diagnostic et les limites' : 'Diagnostic, limites et licence'} arrow onPress={() => setOpen(!open)} />
    </TableRowGroup>
    {open && <Stack spacing={8}>
      <Note>{`Diagnostic sans identifiants :\nClient ciblé : ${d.compatible ? 'oui' : 'non'}\nCache prêt : ${d.ready ? 'oui' : 'non'}\nModules de menu trouvés : ${d.candidates}\nPatch menu : ${d.menu ? 'actif' : 'inactif'}\n${d.problem || 'Aucun problème détecté'}\nDernière étape : ${d.last}\nAccords manuels effectifs : envoi ${d.manualExternal ? 'oui' : 'non'}, publication ${d.manualPublish ? 'oui' : 'non'}`}</Note>
      <Note>Politique du menu : insertion seulement dans l’unique groupe natif éligible (lignes non dangereuses avec icônes) avec icône résolue par le host ; sinon refus explicite, jamais de groupe séparé. Structure réelle du client 352.6 non observée : vérification appareil requise.</Note>
      <Note>Limites : 8 Mio / 5 minutes. Audio envoyé au service tiers ElevenLabs ; coût possible et rétention selon votre offre. Un résultat local ne signifie pas un traitement local. Le transport contrôle les URL initiales/finales et les tailles au mieux, sans garantir le blocage préalable des redirections HTTP ni un plafond mémoire natif strict. Tests téléphone et API réelle non effectués.</Note>
      <Note>Le coffre protège le fichier au repos, pas contre les autres plugins du même processus. La clé passe en mémoire JS pendant le transfert. Les transcriptions sont effacées en arrière-plan ; le presse-papiers reste géré par Android. Si un retrait d’accord échoue sur le disque, il reste effectif pour la session seulement.</Note>
      <Note>Copyright 2026 Anezium et contributeurs Valenced. Logiciel libre GPL-3.0, sans garantie. Sources, licence et redistribution : github.com/Anezium/valenced-elevenlabs-transcription. Préversion 0.2.0-dev non publiée.</Note>
    </Stack>}
  </>;
}
export function SettingsComponent() {
  const rt = runtime; useRuntime(rt);
  const { Stack } = Design;
  return <Page spacing={0}><ScrollView keyboardShouldPersistTaps="handled"><Stack spacing={16} style={{ padding: 16, paddingBottom: 32 }}>
    <Note tone="default">{!rt ? 'Activez le plugin pour commencer.' : `Appui long sur un vocal → « ${ACTION_LABEL} ». Envoi manuel sur votre action ; automatique seulement après activation ci-dessous. Clé et accord requis.`}</Note>
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
      const result = await rt.engine.run(target, rt.key, true, stage => { if (rt.alive) { setPhase(stage); rt.update({ last: stage === 'upload' ? 'Upload ElevenLabs en cours' : 'Téléchargement Discord en cours' }); } });
      if (rt.alive && rt.diagnostics.keySet && rt.consent.mode().external) { setText(result); rt.update({ last: 'Transcription reçue et cache audio nettoyé' }); }
    } catch (e) { if (rt.alive) { setError(safeMessage(e)); rt.update({ last: e instanceof SafeError ? `Échec contrôlé : ${e.code}` : 'Échec contrôlé' }); } }
    finally { if (rt.alive) setPhase(''); }
  };
  const grant = (kind: ManualKind) => {
    setGranting(kind); setError('');
    void rt.consent.set(kind, true).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setGranting(''); });
  };
  const publish = () => {
    if (!rt.auto || !target || publishing || published) return;
    const allowed = rt.consent.mode().publish === true;
    if (!allowed) { setError('Accord de publication manuelle requis.'); return; }
    setPublishing(true); setError('');
    void rt.auto.replyManually(target, text, allowed).then(() => { if (rt.alive) setPublished(true); }).catch(e => { if (rt.alive) setError(safeMessage(e)); }).finally(() => { if (rt.alive) setPublishing(false); });
  };
  const close = () => { if (target) rt.engine.cancel(target); ActionSheetActionCreators.hideActionSheet(SHEET_KEY); };
  const { ActionSheet, BottomSheetTitleHeader, Button, Card, Stack, Text } = Design;
  const own = !!target && !!text && !!rt.auto?.canReplyTo(target);
  return <ActionSheet>
    <BottomSheetTitleHeader title={ACTION_LABEL} subtitle={target ? `Vocal de ${Math.ceil(target.seconds)} s · ${(target.size / 1024 / 1024).toFixed(2)} Mio` : undefined} />
    <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
      <Stack spacing={12}>
        {!rt.alive && <Note tone="critical" alert>Plugin arrêté.</Note>}
        {!text && !busy && <>
          {!d?.keySet && <>
            <Note tone="default">Une clé API ElevenLabs est nécessaire avant tout transfert.</Note>
            <KeyEditor rt={rt} />
          </>}
          {d?.keySet && !manual.external && <>
            <Note tone="default">Autoriser une fois : l’audio des vocaux que vous choisissez est envoyé à ElevenLabs (Scribe v2), service externe potentiellement payant, rétention selon votre offre. Ensuite, « Transcrire » suffit, sans nouvelle confirmation. Rien n’est publié sans une action distincte. Réversible dans les paramètres du plugin.</Note>
            <Button text="J’autorise l’envoi des vocaux choisis à ElevenLabs" variant="primary" loading={granting === 'external'} disabled={!rt.alive || !!granting} onPress={() => grant('external')} />
          </>}
          {d?.keySet && manual.external && <>
            <Note>Résultat affiché ici seulement. Ne transcrivez les voix d’autrui que si vous pouvez les communiquer à ce prestataire.</Note>
            {target && rt.engine.wasAttempted(target) && <Note tone="warning" alert>Un envoi a déjà été tenté pour ce vocal : réessayer peut entraîner une seconde facturation, même sans résultat.</Note>}
            <Button text={error ? 'Réessayer (coût possible)' : 'Transcrire (coût possible)'} variant="primary" disabled={!enabled} onPress={() => { void run(); }} />
          </>}
        </>}
        {busy && <>
          <Text accessibilityLiveRegion="polite" variant="text-sm/medium" color="text-default">{phase === 'upload' ? 'Envoi à ElevenLabs en cours…' : 'Téléchargement du vocal depuis Discord…'}</Text>
          <Button text="Annuler" variant="secondary" onPress={() => { if (target) rt.engine.cancel(target); }} />
        </>}
        {!!error && <Note tone="critical" alert>{error}</Note>}
        {!!text && <>
          <Note>Transcription ElevenLabs — peut contenir des erreurs. Conservée en mémoire seulement.</Note>
          <Card><Text selectable variant="text-md/normal" color="text-default">{text}</Text></Card>
          <Button text={copied ? 'Copié dans le presse-papiers Android' : 'Copier le texte'} variant="secondary" disabled={!rt.alive || !d?.keySet} onPress={() => { try { Clipboard.setString(text); setCopied(true); } catch { setError('Presse-papiers indisponible. Vous pouvez sélectionner le texte.'); } }} />
          {own && <Note>Après un envoi incertain, vérifiez le canal avant de republier : doublon possible. Aucun renvoi automatique.</Note>}
          {own && (manual.publish
            ? <Button text={published ? 'Réponse publiée' : 'Publier en réponse à mon vocal'} variant="primary" loading={publishing} disabled={publishing || published || !rt.alive || !d?.keySet} onPress={publish} />
            : <>
              <Note>Pour publier le texte de vos propres vocaux en réponse dans leur canal, autorisez-le une fois. Jamais les vocaux d’autrui. Après un envoi incertain, aucun renvoi automatique : un doublon reste possible.</Note>
              <Button text="J’autorise la publication de mes transcriptions" variant="secondary" loading={granting === 'publish'} disabled={!rt.alive || !!granting} onPress={() => grant('publish')} />
            </>)}
          <Button text="Effacer les transcriptions locales" variant="tertiary" onPress={() => { rt.auto?.invalidate(); rt.engine.clearResults(); setText(''); setCopied(false); setPublished(false); }} />
        </>}
        <Button text={busy ? 'Fermer (annule l’envoi)' : 'Fermer'} variant="tertiary" onPress={close} />
      </Stack>
    </ScrollView>
  </ActionSheet>;
}
function openSheet(rt: Runtime, target?: Target, initialError?: string) {
  if (!rt.alive) return;
  try { ActionSheetActionCreators.openLazy(Promise.resolve({ default: TranscriptSheet }), SHEET_KEY, { rt, target, initialError }, 'stack'); }
  catch { rt.update({ problem: 'Feuille de transcription indisponible sur ce build.' }); }
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
      if (typeof XMLHttpRequest !== 'function' || typeof FormData !== 'function' || typeof AbortController !== 'function' || typeof URL !== 'function') throw new SafeError('runtime', 'Primitives réseau manquantes ; aucun transfert possible.');
      const compatible = compatibleClient(ClientInfoModule.getConstants());
      rt.update({ compatible });
      if (!compatible) { rt.update({ problem: 'Build client différent ou métadonnées absentes : cible 352.6 / 352206 (ou code long fourni) / canaryRelease. Plugin désactivé pour ce client.' }); return; }
      rt.auto = new ClientAutomation(rt, rt.store.automation); rt.auto.start();
      void rt.consent.load();
      const restoreKey = () => { void rt.keys.resume().then(() => { if (rt.alive) rt.auto?.resume(); }).catch(() => { if (rt.alive) rt.update({ problem: 'Coffre Android indisponible. Aucun stockage en clair ni transfert sans clé.' }); }); };
      appState = AppState.addEventListener('change', state => { if (state !== 'active') rt.pause(); else restoreKey(); });
      restoreKey();
      void rt.engine.initialize().then(() => { if (rt.alive) rt.update({ ready: true }); }).catch(() => { if (rt.alive) rt.update({ ready: false, problem: 'Cache privé impossible à purger. Arrêtez puis relancez le plugin.' }); });
      const candidates = new Set<unknown>();
      type LongPress = FC<{ message: unknown; channel: unknown }>;
      unsubscribe = getModules(withName<LongPress>('LongPressMessageActionSheet'), mod => {
        try {
        if (!rt.alive || candidates.has(mod)) return;
        candidates.add(mod); rt.update({ candidates: candidates.size });
        if (candidates.size !== 1) { unpatch?.(); unpatch = undefined; rt.update({ menu: false, problem: 'Plusieurs modules de menu correspondent ; aucun patch conservé.' }); return; }
        const module = mod as unknown as { default: LongPress };
        if (!module || typeof module.default !== 'function') { rt.update({ problem: 'Signature du menu non prise en charge.' }); return; }
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
            if (!ActionSheet || !ActionSheetRow || !ActionSheetRow.Icon) { rt.defer({ placement: 'Refusée : composants natifs ActionSheet/ActionSheetRow/Icon indisponibles sur ce build ; aucune insertion.' }); return tree; }
            const plan = planInsertion(tree, { sheet: ActionSheet, groups: identities(ActionSheetRow.Group, TableRow?.Group, TableRowGroup), rows: identities(ActionSheetRow, TableRow) });
            if (!plan.ok) { rt.defer({ placement: REFUSAL_MESSAGES[plan.reason] }); return tree; }
            const icon = resolveIcon(rt);
            if (!icon) { rt.defer({ placement: `Refusée : icône native « ${ICON_ASSET} » introuvable via le host ; aucune insertion sans icône.` }); return tree; }
            const row = <ActionSheetRow key="anezium-elevenlabs-transcription" label={ACTION_LABEL} icon={<ActionSheetRow.Icon {...icon} />} onPress={() => openSheet(rt, target, error)} />;
            rt.defer({ placement: `Insérée en tête de l’unique groupe natif éligible (${plan.groups} groupe(s) visibles). Structure réelle du client à vérifier sur appareil.` });
            return appendToGroup(tree, plan.group, row) as ReactElement;
          } catch { rt.defer({ problem: 'Menu vocal non pris en charge ; aucun transfert déclenché.' }); return tree; }
        });
        rt.update({ menu: true });
        } catch {
          try { unpatch?.(); } catch { /* désactivation logique même si dépatch impossible */ }
          unpatch = undefined;
          rt.update({ menu: false, problem: 'Module de menu non patchable ; aucun transfert autorisé.' });
        }
      }, { returnNamespace: true });
    } catch (e) { unpatch?.(); rt.update({ menu: false, problem: safeMessage(e) }); }
  },
  SettingsComponent,
});
