# Source unique de clé — contrat d'intégration et preuves

Carte t_fa9a0b5f. Reprise du lot t_6d9b754f revu, sans réécriture de son coffre ou de ses adaptateurs. Les modifications de cette reprise sont les tests adversariaux dans tests/key-state.test.ts et ce document. Les sources runtime restent celles du lot technique existant.

## Diagnostic du défaut terrain

La v0.1.0 partageait déjà le même Runtime entre settings et action long-press : ce n'était pas une seconde copie de settings. La clé était explicitement effacée à inactive/background et stop. L'initialisation de purge du cache ne constituait pas la cause reproduite. Les fixtures historiques et leur exécution sont documentées dans V020_DIAGNOSTIC.md et build/v020-diagnostic-verify.log. Ne pas réintroduire un état de clé dans les composants UI pour corriger ce symptôme.

Les régressions actuelles du bundle réel dans tests/lifecycle.test.mjs vérifient settings/menu communs, saisie pendant init, restauration foreground, stop/start, coffre absent et suppression/remplacement. Le bridge, le disque et les événements de ces tests sont synthétiques : cela ne prouve pas un redémarrage Android réel.

## Interface stable pour les lots UI et auto

- Runtime possède UNE instance `keys: KeyState` construite avec `nativeVault`. `Runtime.key` délègue à `keys.key`. Ne jamais instancier KeyState dans un composant, un menu ou le moteur automatique.
- `key-state.ts` exporte `Vault { load(): Promise<string|null>; save(key: string): Promise<void>; delete(): Promise<void> }` et `KeyState`.
- `keys.key`: valeur momentanément utilisable en mémoire, ou chaîne vide. Ce n'est PAS une preuve permanente que le coffre est vide ou que l'API accepte la clé. En arrière-plan, cette valeur est volontairement vide même si le coffre est rempli.
- `keys.load(): Promise<void>`: vide la mémoire puis relit/valide le coffre. Chaque appel est sérialisé, pas fusionné : plusieurs initialisations ne chevauchent pas les opérations natives. Ne pas attendre un statut chargé dès l'appel ; attendre la résolution et traiter le rejet.
- `keys.save(input): Promise<void>`: valide, invalide immédiatement l'ancienne valeur, sérialise l'écriture, ne réexpose la clé qu'après succès natif et si sa révision est toujours courante/active. Validation de forme seulement, aucun appel fournisseur. Une entrée invalide peut lancer une exception avant de retourner une promesse : entourer l'appel par try/await/catch.
- `keys.delete(): Promise<void>`: révoque immédiatement en mémoire et invalide toute lecture ancienne ; le succès d'effacement du coffre n'est acquis qu'après résolution. En cas d'échec, afficher erreur et proposer de réessayer : un restart peut retrouver la clé encore présente. Aucun faux « supprimée ».
- `keys.suspend()`: invalide les lectures en vol et vide la mémoire, sans supprimer le coffre. `keys.resume(): Promise<void>`: réactive et recharge. `keys.stop()`: arrêt définitif de cette instance ; créer un nouveau Runtime au prochain démarrage.
- `changed()` notifie la disponibilité de la clé, jamais sa valeur. Ne pas logger arguments, réponses load ou exceptions natives.

Les composants doivent appeler `await rt.setKey(input)` et `await rt.forget()`, pas directement le coffre : ces façades invalident aussi le moteur automatique, annulent les transferts et retirent les résultats. Le changement de cycle de vie passe par `rt.pause()` puis le restore existant qui attend `rt.keys.resume()` avant reprise automatique. Ne pas conserver `rt.key` dans une closure durable : les consommateurs le relisent au moment de l'action.

L'UI ne doit afficher un succès qu'après résolution de la bonne opération. Une promesse ancienne peut se résoudre après une révocation, suspension ou opération plus récente sans réexposer la clé ; une résolution n'autorise donc pas à réarmer un mode ni à ignorer l'état actuel. État masqué, remplacement/suppression, erreur explicite ; jamais JSON storage, fallback mémoire présenté comme persistant, clipboard automatique ou validation STT implicite.

## Bridge et stockage natif

`vault.ts` appelle uniquement ces méthodes async namespacées :

    anezium.elevenlabs.vault.load([]) -> {ok:true,key:string|null}
    anezium.elevenlabs.vault.save([key]) -> {ok:true}
    anezium.elevenlabs.vault.delete([]) -> {ok:true}

Notation ci-dessus : entre parenthèses se trouve le tableau d'arguments transmis à callNativeMethod. L'échec natif renvoie `{ok:false}` ; bridge absent/réponse incorrecte/exception devient SafeError code `vault` avec message générique. Pas de retour d'exception sensible. Les appels sont verrouillés côté plugin ; contexte indisponible ou plugin arrêté = refus fermé, aucun fallback. Une nouvelle tentative de restauration peut être déclenchée après disponibilité du contexte ; aucun succès natif inventé.

`android/ElevenLabsPlugin.kt` utilise réellement AndroidKeyStore (AES 256 GCM, randomizedEncryptionRequired), alias `anezium.elevenlabs.api.v1`. Envelope.kt utilise IV 96 bits, tag 128 bits et AAD versionnée. Enveloppe binaire uniquement : version + IV + ciphertext/tag. AtomicFile sous Context.noBackupFilesDir, pas JSON. L'écriture est relue avant succès ; delete vérifie disparition des fichiers et de l'alias. Aucune garantie matérielle n'est déduite de l'API.

Le coffre protège le repos, pas les autres plugins du même UID/processus. Les Strings JS/JVM ne permettent pas un effacement mémoire forensic garanti. L'alias et noBackupFilesDir peuvent survivre à la désinstallation du seul plugin : supprimer la clé avant de le retirer. Aucun effacement forensic des anciennes pages de disque promis.

## Vérifications réellement relancées pour cette carte

Commande depuis la racine, Node 22.21.1 local et source host épinglée :

    export PATH="$PWD/tools/node-v22.21.1-linux-x64/bin:$PATH"
    export VALENCED_SOURCE=/chemin/du/checkout/valenced-d3e17fe
    npm run verify

Journal : build/t_fa9a0b5f-verify.log, exit 0.

- Typecheck, 45 tests TS (dont les tests KeyState), 35 tests du vrai bundle réussis.
- Trois régressions ajoutées : 12 initialisations concurrentes + remplacement sans chevauchement natif ; suspension pendant écriture puis foreground/reload ; échec d'effacement explicite, risque au restart et récupération après nouvelle suppression.
- Compilation réelle des sources API host épinglées, plugin Kotlin, 41 assertions JVM (vrai AES-GCM/JCE, corruption, mauvais secret, taille, chargement PluginBuilder et refus bridge sans contexte/après arrêt), puis D8 réel réussis. Avertissements Java25 Unsafe/Jansi présents, non bloquants.
- ZIP local reconstruit par package-dev.mjs : vrai header DEX et class_defs vérifiés, dépendances host non embarquées, index public inchangé. Hash et taille du résultat de ce run dans build/v020-package.json ; artefact partagé susceptible d'être reconstruit par les lots suivants.

## Limites Android et porte de validation

Aucun adb disponible dans le PATH de ce run ; aucun téléphone/émulateur connecté utilisé ou installé. Les tests JVM n'exécutent PAS AndroidKeyStore, AtomicFile ni le Context Android réel. Le code natif existe et compile, le DEX est produit ; la persistance effective sur appareil entre foreground/reload/process restart n'est PAS acquise par ces preuves. Cela reste la porte runtime de l'intégration, pas une raison de remplacer le coffre par de la crypto factice.

Procédure appareil, après autorisation distincte d'installation/test : sans STT ni publication, utiliser seulement une chaîne synthétique de 16 à 512 caractères ASCII autorisés ; save, load, replace, background/foreground, reload JS, restart du processus, delete puis restart. Vérifier refus sûr si bridge/contexte manquant, coffre corrompu et I/O refusée ; absence de plaintext dans stockage plugin/backups/logs sans exporter leur contenu sensible. Ne jamais utiliser de vraie clé ni audio pour ce smoke. Consigner version client/host, résultat et limites avant de déclarer la persistance Android validée.

Aucun appel payant, audio utilisateur, message Discord, installation ou publication effectué pour cette carte. Pas de commit des changements préexistants d'autres lots, pas de modification tools/ ni scripts/inspect.mjs.
