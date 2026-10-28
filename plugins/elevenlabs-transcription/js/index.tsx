import Page from '@valenced/components/Page';
import { Design } from '@valenced/discord/design';
import { ActionSheetActionCreators } from '@valenced/discord/actions';
import { FileModule, ClientInfoModule } from '@valenced/discord/native';
import { Clipboard } from '@valenced/externals/react-native-clipboard';
import { getModules } from '@valenced/modules/finders';
import { withName } from '@valenced/modules/finders/filters';
import { instead } from '@valenced/patcher';
import { cloneElement, createElement, isValidElement, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { FC, ReactElement, ReactNode } from 'react';
import { CACHE_DIR, SafeError, Transcriber, bytesToBase64, compatibleClient, extractTarget, safeMessage, validateKey } from './core.js';
import type { Files, Target } from './core.js';
import { XHRTransport } from './transport.js';
import { findUniqueSheet } from './tree.js';

const SHEET_KEY = 'anezium-elevenlabs-transcription';
// Un reload rapide ne doit pas purger le fichier d’un ancien upload encore en arrêt.
let previousStop: Promise<void> = Promise.resolve();
const colors = { backgroundColor: '#191b22', color: '#f3f4f7' };
const textStyle = { color: colors.color, fontSize: 15, marginBottom: 12 };
const inputStyle = { color: colors.color, backgroundColor: '#30333e', padding: 12, borderRadius: 8, minHeight: 48, marginBottom: 12 };
interface Diagnostics { compatible: boolean; ready: boolean; candidates: number; menu: boolean; problem: string; keySet: boolean; last: string }
class Runtime {
  alive = true;
  key = '';
  listeners = new Set<() => void>();
  diagnostics: Diagnostics = { compatible: false, ready: false, candidates: 0, menu: false, problem: '', keySet: false, last: 'Aucun transfert' };
  engine: Transcriber;
  constructor() {
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
  forget() { this.key = ''; this.engine.cancelAll(); this.engine.clearResults(); this.update({ keySet: false, last: 'Clé et résultats oubliés' }); }
  setKey(value: string) { if (!this.alive) throw new SafeError('stopped', 'Plugin arrêté.'); this.key = validateKey(value); this.update({ keySet: true }); }
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
function Button({ text, onPress, disabled = false }: { text: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ padding: 13, marginBottom: 10, borderRadius: 8, backgroundColor: disabled ? '#3b3d45' : '#4059b8', opacity: disabled ? 0.65 : 1 }}><Text style={{ color: '#fff', fontSize: 15 }}>{text}</Text></Pressable>;
}
function KeyEditor({ rt }: { rt: Runtime }) {
  const [entry, setEntry] = useState(''); const [error, setError] = useState('');
  useRuntime(rt);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { setEntry(''); setError(''); }
    });
    return () => subscription.remove();
  }, [rt]);
  return <View>
    <Text style={textStyle}>Clé API : mémoire uniquement. À ressaisir après reload, arrêt ou passage en arrière-plan. Aucun coffre Keystore dans cette version.</Text>
    <TextInput accessibilityLabel="Clé API ElevenLabs (masquée)" placeholder="Clé ElevenLabs" placeholderTextColor="#adb2c4" value={entry} onChangeText={setEntry} secureTextEntry autoCorrect={false} autoCapitalize="none" autoComplete="off" textContentType="none" importantForAutofill="no" contextMenuHidden style={inputStyle} editable={rt.alive} />
    <Button text={rt.diagnostics.keySet ? 'Remplacer la clé en mémoire' : 'Utiliser la clé en mémoire'} disabled={!entry.trim() || !rt.alive} onPress={() => { try { rt.setKey(entry); setEntry(''); setError(''); } catch (e) { setError(safeMessage(e)); } }} />
    <Button text="Oublier la clé et les résultats / annuler" disabled={!rt.alive} onPress={() => { setEntry(''); setError(''); rt.forget(); }} />
    {!!error && <Text accessibilityRole="alert" style={textStyle}>{error}</Text>}
    <Text style={textStyle}>{rt.diagnostics.keySet ? 'Clé présente en mémoire.' : 'Aucune clé mémorisée.'}</Text>
  </View>;
}
export function SettingsComponent() {
  const rt = runtime; const d = useRuntime(rt);
  return <Page><ScrollView style={{ backgroundColor: colors.backgroundColor }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
    <Text style={{ ...textStyle, fontSize: 21 }}>Transcription ElevenLabs — expérimental 0.1.0</Text>
    <Text style={textStyle}>Copyright 2026 Anezium et contributeurs Valenced. Logiciel libre GPL-3.0, sans garantie. Sources, licence et redistribution : github.com/Anezium/valenced-elevenlabs-transcription.</Text>
    <Text style={textStyle}>Appui long sur un vocal existant → Transcrire avec ElevenLabs. Le résultat reste local ; seule la copie volontaire utilise le presse-papiers. Aucun message Discord n’est envoyé.</Text>
    {rt && <KeyEditor rt={rt} />}
    <Text selectable style={textStyle}>{!rt ? 'Activez le plugin pour commencer.' : `Diagnostic sans identifiants :\nClient ciblé : ${d?.compatible ? 'oui' : 'non'}\nCache prêt : ${d?.ready ? 'oui' : 'non'}\nModules de menu trouvés : ${d?.candidates ?? 0}\nPatch menu : ${d?.menu ? 'actif' : 'inactif'}\n${d?.problem || 'Aucun problème détecté'}\nDernière étape : ${d?.last}`}</Text>
    <Text style={textStyle}>Limites : 8 Mio / 5 minutes. Audio envoyé au service tiers ElevenLabs après confirmation ; coût possible et rétention selon votre offre. Le résultat local ne signifie pas traitement local. Le transport React Native contrôle les URL initiales/finales et les tailles au mieux, mais ne garantit pas le blocage préalable des redirections HTTP ni un plafond mémoire natif strict. Tests téléphone et API réelle non effectués.</Text>
    <Text style={textStyle}>Le stockage mémoire n’isole pas cette clé des autres plugins du client. N’installez que des plugins de confiance. Les transcriptions sont effacées en arrière-plan ; le presse-papiers, si vous copiez, reste géré par Android.</Text>
  </ScrollView></Page>;
}
function TranscriptSheet({ rt, target, initialError }: { rt: Runtime; target?: Target; initialError?: string }) {
  const d = useRuntime(rt);
  const [text, setText] = useState(() => target ? rt.engine.cached(target) ?? '' : '');
  const [error, setError] = useState(initialError ?? '');
  const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  const [consent, setConsent] = useState(false);
  useEffect(() => () => { if (target) rt.engine.cancel(target); }, [rt, target]);
  useEffect(() => { if (!d?.keySet) { setText(''); setConsent(false); } }, [d?.keySet]);
  const enabled = !!target && rt.alive && !!d?.compatible && !!d.ready && d.menu && d.keySet;
  const run = async () => {
    if (!enabled || !target || !consent || busy) return;
    setBusy(true); setError(''); setCopied(false);
    try {
      const result = await rt.engine.run(target, rt.key, true, stage => { if (rt.alive) rt.update({ last: stage === 'upload' ? 'Upload ElevenLabs en cours' : 'Téléchargement Discord en cours' }); });
      if (rt.alive && rt.diagnostics.keySet) { setText(result); rt.update({ last: 'Transcription reçue et cache audio nettoyé' }); }
    } catch (e) { if (rt.alive) { setError(safeMessage(e)); rt.update({ last: e instanceof SafeError ? `Échec contrôlé : ${e.code}` : 'Échec contrôlé' }); } }
    finally { if (rt.alive) { setBusy(false); setConsent(false); } }
  };
  const { ActionSheet, BottomSheetTitleHeader } = Design;
  return <ActionSheet><BottomSheetTitleHeader title="Transcription locale" /><ScrollView style={{ maxHeight: 560, backgroundColor: colors.backgroundColor }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
    {!rt.alive && <Text style={textStyle}>Plugin arrêté.</Text>}
    {target && <Text style={textStyle}>Vocal sélectionné : {Math.ceil(target.seconds)} s, {(target.size / 1024 / 1024).toFixed(2)} Mio. Ne transcrivez des voix d’autrui que si vous êtes autorisé à les communiquer à ce prestataire.</Text>}
    {!text && !busy && <>
      {!d?.keySet && <KeyEditor rt={rt} />}
      <Text style={textStyle}>En confirmant, vous autorisez l’envoi de ce fichier audio à ElevenLabs (Scribe v2). Traitement externe potentiellement payant, rétention selon l’offre, pas de garantie zéro rétention. Aucun texte ne sera publié dans Discord.</Text>
      {target && rt.engine.wasAttempted(target) && <Text accessibilityRole="alert" style={textStyle}>Un upload a déjà été tenté. Une nouvelle tentative peut entraîner une seconde facturation, même si aucun résultat n’a été reçu.</Text>}
      <Button text={consent ? 'Accord donné — cliquer pour le retirer' : 'J’autorise le transfert de ce vocal à ElevenLabs'} disabled={!enabled} onPress={() => setConsent(!consent)} />
      <Button text="Transcrire maintenant (coût possible)" disabled={!enabled || !consent} onPress={() => { void run(); }} />
    </>}
    {busy && <><Text accessibilityLiveRegion="polite" style={textStyle}>{d?.last}</Text><Button text="Annuler le transfert" onPress={() => { if (target) rt.engine.cancel(target); }} /></>}
    {!!error && <Text accessibilityRole="alert" selectable style={textStyle}>{error}</Text>}
    {!!text && <>
      <Text style={textStyle}>Transcription automatique locale — peut contenir des erreurs :</Text>
      <Text selectable style={{ ...textStyle, padding: 12, backgroundColor: '#30333e' }}>{text}</Text>
      <Button text={copied ? 'Copié dans le presse-papiers Android' : 'Copier le texte'} disabled={!rt.alive || !d?.keySet} onPress={() => { try { Clipboard.setString(text); setCopied(true); } catch { setError('Presse-papiers indisponible. Vous pouvez sélectionner le texte.'); } }} />
      <Button text="Effacer les transcriptions locales" onPress={() => { rt.engine.clearResults(); setText(''); setCopied(false); }} />
    </>}
    <Button text="Fermer (annule si en cours)" onPress={() => { if (target) rt.engine.cancel(target); ActionSheetActionCreators.hideActionSheet(SHEET_KEY); }} />
  </ScrollView></ActionSheet>;
}
function openSheet(rt: Runtime, target?: Target, initialError?: string) {
  if (!rt.alive) return;
  try { ActionSheetActionCreators.openLazy(Promise.resolve({ default: TranscriptSheet }), SHEET_KEY, { rt, target, initialError }, 'stack'); }
  catch { rt.update({ problem: 'Feuille de transcription indisponible sur ce build.' }); }
}
function mapTree(node: unknown, target: unknown, replacement: ReactNode, depth = 0): unknown {
  if (depth > 20) return node;
  if (node === target && isValidElement<{ children?: ReactNode }>(node)) return cloneElement(node, {}, [...[node.props.children].flat(), replacement]);
  if (Array.isArray(node)) return node.map(child => mapTree(child, target, replacement, depth + 1));
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children) return cloneElement(node, {}, mapTree(node.props.children, target, replacement, depth + 1) as ReactNode);
  return node;
}
export default plugin({
  start({ cleanup }) {
    const rt = new Runtime(); runtime = rt;
    let unpatch: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let appState: { remove(): void } | undefined;
    // Le cleanup est enregistré AVANT toute découverte/résolution native susceptible d’échouer.
    cleanup(() => {
      rt.alive = false; rt.forget();
      try { unpatch?.(); } catch { /* pas de log sensible */ }
      try { unsubscribe?.(); } catch { /* idem */ }
      try { appState?.remove(); } catch { /* poursuivre tous les cleanups */ }
      try { ActionSheetActionCreators.hideActionSheet(SHEET_KEY); } catch { /* aucun sheet ouvert */ }
      previousStop = rt.engine.stop().catch(() => {});
      if (runtime === rt) runtime = undefined;
      rt.listeners.clear();
    });
    try {
      if (typeof XMLHttpRequest !== 'function' || typeof FormData !== 'function' || typeof AbortController !== 'function' || typeof URL !== 'function') throw new SafeError('runtime', 'Primitives réseau manquantes ; aucun transfert possible.');
      const compatible = compatibleClient(ClientInfoModule.getConstants());
      rt.update({ compatible });
      if (!compatible) { rt.update({ problem: 'Build client différent ou métadonnées absentes : cible 352.6 / 352206 (ou code long fourni) / canaryRelease. Plugin désactivé pour ce client.' }); return; }
      appState = AppState.addEventListener('change', state => { if (state !== 'active') rt.forget(); });
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
            const { ActionSheet, ActionSheetRow } = Design;
            const sheet = findUniqueSheet(tree, ActionSheet);
            if (!sheet) { rt.update({ problem: 'Arbre du menu inattendu : action non injectée.' }); return tree; }
            const group = <ActionSheetRow.Group key="elevenlabs-transcription"><ActionSheetRow label="Transcrire avec ElevenLabs" onPress={() => openSheet(rt, target, error)} /></ActionSheetRow.Group>;
            return mapTree(tree, sheet, group) as ReactElement;
          } catch { rt.update({ problem: 'Menu vocal non pris en charge ; aucun transfert déclenché.' }); return tree; }
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
