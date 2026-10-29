# Passe UI mobile bornée — contrat et limites

Branche `investigation/v020-lifecycle`, préversion `0.2.0-dev` non publiée. Cette passe modifie l’UI de `js/index.tsx`, ajoute deux aides pures (`js/menu.ts`, `js/consent.ts`), des tests UI et ce document. KeyState unique, façades `rt.setKey`/`rt.forget`, `ClientAutomation`, coffre, natif, `tools/` et `scripts/inspect.mjs` sont inchangés. Aucun commit, aucune release, aucun appel réel.

## Paramètres (SettingsComponent)

Quatre groupes natifs `Design.TableRowGroup` dans `Page` : clé, transcription manuelle, automatique, détails. Composants évidents dans `vendor/types` : `TableRow`, `TableSwitchRow`, `Button`, `Text` (variantes/couleurs à jetons utilisées par le host lui-même), `Card`, `Stack`. Le champ de clé reste un `TextInput` React Native masqué : les propriétés anti-autofill/anti-suggestion (`autoComplete`, `importantForAutofill`, `textContentType`, `contextMenuHidden`) ne sont pas évidentes sur `Design.TextInput`. Couleurs du champ fixes (thème sombre) : à revoir après observation appareil.

- Clé : ligne d’état, ligne « Enregistrer/Remplacer » qui ouvre l’éditeur, ligne « Supprimer » (variante danger). Succès seulement après résolution et `keySet` vrai ; en arrière-plan, message honnête. Jamais de validation ElevenLabs ni de validation Android prétendue.
- Manuel : deux interrupteurs persistants (voir ci-dessous). « Publier » est désactivé tant que l’envoi n’est pas accordé.
- Automatique : deux interrupteurs reliés à `ClientAutomation.configure` (contrat inchangé, retrait immédiat, activation après écriture réussie), ligne danger « Désactiver toute automatisation » quand un mode est actif.
- Détails : placement de l’action du menu, puis divulgation « Diagnostic, limites et licence » (texte technique masqué par défaut).

## Accords manuels persistants (`js/consent.ts`)

Enregistrement `manual: { external, publish, accountId }` dans le même document JSON que les préférences automatiques, via `PreferenceStore` : écrivain unique sérialisé ; la façade `automation` conserve le contrat de remplacement complet de `ClientAutomation` en réinjectant l’accord manuel courant, et une écriture manuelle réinjecte les champs automatiques connus. Aucune clé, audio, texte ou URL dans le JSON.

`ManualConsent.mode()` est fermé par défaut, lié au compte courant (`AuthenticationStore.getId`, relu à chaque appel), effectif seulement après chargement réussi et écriture réussie de la révision courante. Les retraits s’appliquent en mémoire avant l’écriture ; un retrait d’envoi retire aussi la publication. Échec disque : accord refusé (« rien n’est autorisé ») ou retrait « session seulement » avec avertissement de redémarrage, sans faux succès. Le mode automatique n’est jamais lu comme accord manuel, ni l’inverse.

## Feuille manuelle (TranscriptSheet)

`Design.ActionSheet` + `BottomSheetTitleHeader` (durée/taille en sous-titre). Sans clé : éditeur de clé seulement. Sans accord : un texte concis et un bouton d’accord persistant (traitement externe/coût, rétention, réversible). Avec accord : un seul bouton « Transcrire (coût possible) », avertissement de double facturation si un envoi a déjà été tenté, phases « Téléchargement… / Envoi… » avec « Annuler », erreur affichée puis « Réessayer ». Résultat dans une `Card` sélectionnable, copie volontaire, effacement local.

Publication : uniquement si `canReplyTo` (son propre vocal, permissions) et transcription en cache. Sans accord de publication : bouton d’accord persistant. Avec accord : un bouton explicite « Publier en réponse à mon vocal » ; `replyManually(target, text, true)` n’est appelé que si `consent.mode().publish` est vrai au moment de l’appui. Validations de `client.ts` et absence de retry conservées. Jamais de publication des vocaux d’autrui.

## Menu d’appui long : politique structurelle (`js/menu.ts`)

L’arbre exact du client propriétaire n’est PAS établi. Le plugin n’ajoute plus de groupe séparé. Il insère une ligne native `ActionSheetRow` avec icône en tête du groupe natif seulement si :

1. une unique `Design.ActionSheet` est trouvée (`findUniqueSheet`) ;
2. en traversant uniquement `props.children` (hôtes/tableaux, jamais de rendu de composant ni descente dans un groupe), les groupes visibles sont de type `ActionSheetRow.Group`/`TableRow.Group`/`TableRowGroup` (alias déclarés par les types vendor) ;
3. exactement un groupe est éligible : uniquement des lignes `ActionSheetRow`/`TableRow`, aucune variante `danger`, au moins une ligne pressable, support d’icône (`hasIcons` ou icône sur chaque ligne) ;
4. l’icône est résolue par le host : `lookupGeneratedIconComponent('TranscriptOutlineIcon')` puis `getAssetIdByName('TranscriptOutlineIcon')`, nom que le host Valenced d3e17fe utilise lui-même. Sans résultat, refus.

Tout autre cas (feuille absente/multiple, aucun groupe, aucun ou plusieurs groupes éligibles, fragment ou composant inconnu dans un groupe, profondeur/largeur excessive, icône introuvable) retourne l’arbre intact et affiche un diagnostic « Refusée : … » dans Détails > Action du menu. Position en tête de groupe : priorité à l’action manuelle, ordre relatif des actions natives conservé ; à confirmer après observation.

Corrections indépendantes Forge après génération : annulation/invalidation immédiate au retrait manuel (même si écriture échoue), suppression du coffre toujours réessayable sans clé en mémoire, suppression du résultat tardif après retrait, position haute, avertissement de publication incertaine permanent et deux casts stricts dans les tests. Aucun remplacement du modèle UI : ces corrections sont attribuées à Forge, pas au run Fable. Le run Fable a réellement écrit l’UI, puis terminé sur quota HTTP429/exit1 ; il n’a pas conclu avec succès. Voir ui-pass/REPORT.txt et provenance.json.

Limite précise : sur l’appareil, si le client enveloppe ses lignes dans des composants composites, utilise plusieurs groupes non dangereux ou n’enregistre pas cet asset, l’action manuelle n’apparaîtra pas et seul le diagnostic l’indiquera. La vérification sur le client 352.6 (`canaryRelease`, build 352206) reste requise ; ajuster ensuite les prédicats ou le nom d’asset avec preuve.

## Tests ajoutés (synthétiques, pas une observation appareil)

- `tests/menu.test.ts`, `tests/consent.test.ts` : aides pures (suite `npm test`).
- `tests/lifecycle.test.mjs` : fixture de feuille synthétique (un groupe éligible avec icônes + un groupe danger, étiquetée synthétique), insertion en tête de groupe avec icône host, sept refus explicites sans groupe ajouté, repli sur identifiant d’asset.
- `tests/ui.test.mjs` (ajouté à `test:lifecycle`) : groupes rendus, accords manuels persistés par compte sans secret, retrait immédiat avant écriture, échecs disque honnêtes, redémarrage, indépendance automatique/manuel, lignes de clé via façades, feuille : accord unique puis « Transcrire » confirmé, publication conditionnée à l’accord explicite et au vocal propre, éditeur de clé seulement sans clé.
- `tests/client.test.mjs` : test des réglages adapté aux interrupteurs natifs ; le document contient désormais `manual`.

`useState` est figé dans ces hôtes : les transitions visuelles (phase en cours, bouton « Réessayer », éditeur ouvert) ne sont pas rendues en test ; leur logique l’est via le runtime. Les résultats d’exécution appartiennent à l’exécution indépendante de Forge, pas à ce document.
