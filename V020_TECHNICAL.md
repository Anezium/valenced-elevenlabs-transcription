> Archive des étapes techniques avant autorisation de distribution. La préversion de test 0.2.0-dev est désormais autorisée et distribuée ; cela ne valide ni Android ni E2E. Voir README.md et PREVIEW_020.md. Les mentions de tickets et de blocages ci-dessous sont historiques.

# v0.2 — lot technique partiel à revoir, pas une livraison utilisateur

Carte t_6d9b754f, branche `investigation/v020-lifecycle`. Préversion locale `0.2.0-dev`. Le ticket UI t_4808e6d4 reste séparé et bloqué ; aucun Claude/modèle de substitution exécuté. Le diagnostic précédent est conservé dans V020_DIAGNOSTIC.md et décrit l'état AVANT cette passe.

## État exact

Implémenté :

- Coffre Android réel : AES-256-GCM avec clé non exportable `AndroidKeyStore`, IV aléatoire 96 bits, tag 128 bits, AAD versionnée. Seuls version/IV/ciphertext/tag sont écrits via AtomicFile, dans `Context.noBackupFilesDir`. Aucun JSON de clé, chiffrement à clé embarquée ou fallback en clair.
- Bridge async namespacé load/save/delete ; verrou partagé, validation des arguments, réponse d'erreur générique sans exception/argument sensible dans le retour ou un log. Arrêt désactive les handlers restants ; contexte pas encore disponible = échec fermé, nouvelle tentative manuelle possible.
- KeyState unique pour settings et manuel : initialisation/save/delete sérialisés, invalidation des lectures anciennes, retour async après succès natif seulement, erreur sans faux état enregistré, suppression/remplacement. Arrière-plan annule les transferts et efface mémoire/résultats SANS supprimer le coffre ; foreground/restart relit le coffre. La clé n'est pas validée auprès du fournisseur par l'enregistrement.
- Moteur AutoPipeline exécutable hors hôte : accords distincts traitement/coût et publication de ses propres vocaux, autrui local seulement, propres messages uniquement après ACK/sent, canal original explicitement référencé, mentions désactivées, refus des textes trop longs plutôt que troncature/publications multiples, file 8 en attente + 1 actif, 3 tentatives/minute, pas de catch-up/retry, seuil de fraîcheur 60 s, barrières reprise/reconnexion, annulation/arrêt/changement compte ou canal, réservation avant le coût.
- Réservation native AtomicFile contenant uniquement des SHA256 des identités compte/canal/message. Cap 1024, saturation = arrêt fermé, sans éviction qui permettrait un replay. Pas encore de reset/rotation utilisateur : point d'intégration à résoudre avant activation générale.
- Build natif réel, JAR DEX, tests et ZIP local. Aucun index/release public modifié.

## Intégration client livrée pour revue technique

Le précédent checkpoint non raccordé est remplacé par `js/client.ts`, importé et démarré par le vrai `js/index.tsx` distribué :

- Stores Authentication/SelectedChannel/Message/Channel/Permission ; événements MESSAGE_CREATE et MESSAGE_SEND_SUCCESS différés après mise à jour du store. Le record doit être SENT avec ID serveur valide. MESSAGE_ACK est un accusé de lecture et n'est jamais utilisé comme preuve d'envoi.
- Vocaux frais du canal sélectionné seulement, aucune exploration d'historique. Les barrières démarrage/reconnexion, les réservations natives et les filtres bot/optimistic/ephemeral empêchent le rattrapage ordinaire et les doublons. Ces contrats restent à confirmer dans le runtime exact : ce n'est pas une preuve absolue de provenance live sur toutes les versions du client.
- Rendu local par patch RowManager.generate : copie du row et de sa liste de contenu, nœud texte brut associé aux IDs message/canal. Aucun changement du contenu du MessageRecord, aucune publication pour autrui. Rafraîchissement MESSAGE_UPDATE local ID-only, retrait au background/disable/stop, cap 10. Refus fermé si module absent/ambigu ou forme de row incompatible.
- Réponse publique de ses propres vocaux via le HTTP du client et Endpoints.MESSAGES : canal original, message_reference et fail_if_not_exists, mentions et replied_user désactivés, nonce stable et enforce_nonce, retries=0. Vérification SENT/auteur/canal/permissions à nouveau avant publication ; SEND_MESSAGES_IN_THREADS pour les threads. Échec ambigu = pas de retry automatique. Pas d'appel hypothétique à la signature privée sendMessage.
- Opt-out par défaut ; boutons distincts explicitant traitement externe/coût et publication de ses propres vocaux, écriture persistante réussie avant activation, accords liés au compte et sans clé/audio/transcript. Désactivation immédiate même pendant une écriture ancienne. Contrôle de reprise manuelle pour une transcription en cache de son propre vocal, confirmation de publication à chaque action.
- L'adaptateur est relié au même KeyState/Transcriber et au journal natif de réservations. Arrêt, arrière-plan, changement de clé/canal, déconnexion ou édition invalident les travaux en cours ; aucune réponse tardive après annulation avant envoi. Une requête HTTP déjà partie ne peut pas être rappelée et une facturation déjà engagée ne peut pas être annulée.

Contrats étudiés : Valenced `d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1` et exemples communautaires `c398e3115f8a6ec5e1f5fa2dac9069c4b98b210c`, notamment message-logger/js/rows.ts, message-link-preview/js/updates.ts et fetch.ts. Attribution dans NOTICE. La forme REST message_reference/allowed_mentions et les permissions sont documentées sur https://docs.discord.com/developers/resources/message et https://docs.discord.com/developers/topics/permissions. Ce sont des preuves de contrat source/documentaire, pas des observations sur téléphone.

NON livré au moment de ce lot : passe UI, déplacement/icône du menu, smoke visuel Android, installation sur appareil, exécution AndroidKeyStore/AtomicFile réelle. Mise à jour : la passe UI bornée est décrite dans UI_CONTRACT.md (réglages natifs, accords manuels persistants, politique d’insertion du menu avec refus explicite) ; smoke visuel, installation et vérification de l’arbre réel du menu restent non effectués. Aucun audio utilisateur, STT payant ou post Discord réel. Le ticket UI t_4808e6d4 reste inchangé. Ne pas publier cette préversion avant revue, validation appareil et règlement du lot UI.

## Build reproductible local

Prérequis : Node >=22.18 et Python >=3.11. Aucun pip, Gradle global, sudo, service ou compte modifié.

1. Obtenir en lecture seule les sources officielles du host, au commit exact ci-dessus. Définir `VALENCED_SOURCE` vers ce checkout. Le script vérifie HEAD ET chaque fichier compilé contre `git show HEAD:path`.
2. Activer le Node local déjà préparé dans `tools/node-v22.21.1-linux-x64/bin` ou un Node compatible.
3. Depuis la racine du dépôt :

       python3 scripts/setup-native.py
       npm ci --ignore-scripts --legacy-peer-deps
       export VALENCED_SOURCE=/chemin/du/checkout/valenced
       npm run verify
       node scripts/audit-dev.mjs

`setup-native.py` installe uniquement sous `build/toolchain` : Temurin 25.0.5+8, platform Android 37.0 r02 et build-tools 37. Les archives sont vérifiées contre le SHA officiel Adoptium et les checksums du XML Google, plus les SHA256 épinglés. Aucun SDK manager ni acceptation silencieuse de licences. Consulter les licences avant redistribution/utilisation hors de cette préparation.

Node 22.21.1 : SHA256 d'archive vérifié contre le SHASUMS256 officiel déjà conservé. Les toolchains ne sont pas distribuées avec le plugin.

`build-native.py` utilise Kotlin compiler 2.4.10, stdlib 2.4.10, coroutines host 1.11.0, DexKit 2.3.0, Xposed API 82 ; sources API réelles non modifiées (sous-ensemble core PluginManifest/Version + API Android). Seule la constante API_VERSION_STRING=1.0.0 habituellement générée est générée localement. Aucun stub host. JVM target 17 ; D8 réel min API 24 avec classpath compile-only. Le host fournit les dépendances au runtime ; le DEX n'embarque pas les classes Valenced/Kotlin/Xposed/DexKit. Une annotation LambdaMethod générée par D8 est explicitement autorisée dans l'audit des définitions.

Provenance et hashes : `build/toolchain/provenance.json`, `build/native/dependencies.json`, `build/native/host-source-manifest.json`. Xposed ne publie pas de sidecar checksum à cette URL : hash HTTPS constaté puis épinglé, PAS présenté comme une signature officielle. Les autres dépendances Maven ont leurs sidecars SHA256/SHA1 vérifiés. Les avertissements Kotlin/Java25 sur Unsafe/Jansi sont réels et non bloquants ; voir le log complet.

`npm run package` produit uniquement `dist/anezium.elevenlabs-transcription@0.2.0-dev.zip`, `dist/V020_SHA256SUMS` et `build/v020-package.json`. Il ne génère aucun index, URL de release ou téléchargement prétendument public. Le script historique scripts/package.mjs concerne v0.1 et ne doit pas être utilisé pour cette préversion.

## Vérifications effectuées

- `npm run verify` : typecheck, 42 tests core/transport/KeyState/AutoPipeline, CLI officiel, bundle officiel Hermes, 35 tests du vrai bundle (11 lifecycle + 14 intégration client + 10 régressions consentement) avec host/bridge/HTTP/STT synthétiques, compilation API + plugin JVM, 41 assertions JVM AES-GCM/chargement PluginBuilder/bridge async, D8 et ZIP. Tous passent dans le log `build/v020-technical-verify.log` ; 77 tests au total, hors assertions JVM.
- Correction P1 après revue : `configure()` copie les paramètres et retire synchroniquement les modes/accords effectifs ainsi que ceux du pipeline AVANT l'écriture. Les reprises ne peuvent plus réarmer un accord retiré. Une activation exige toujours une nouvelle action explicite et une écriture réussie de la révision courante ; une écriture ancienne réussie ou une erreur ne restaure aucun mode retiré. Le mode indépendant non retiré conserve son accord.
- Régressions `tests/consent-revocation.test.mjs` : matrice de 60 scénarios (retrait complet/incoming/own × pending/échec × 10 reprises : canal, reconnect, interrupted/resumed, foreground, suppression simple/multiple, édition, remplacement clé, invalidate et resume). Zéro STT/publication pour les modes retirés ; contrôles positifs du mode conservé. Tests supplémentaires : activation échouée/en attente après retrait, annulation STT actif, courses de révisions et copie des paramètres. `tests/consent-write-race.test.mjs` couvre aussi écriture ancienne réussie suivie de retrait échoué, puis nouvelle désactivation persistée et restart.
- Les deux probes indépendantes du reviewer passent désormais (`build/v020-reviewer-probes.log`) : chaque scénario donne STT=0/POST=0, contre 1/1 avant correction. Ces deux probes sont hors du total des 77 tests officiels.
- Limite de persistance explicite : si le disque refuse le retrait, il reste effectif dans la session courante, mais un crash/restart peut relire les anciens accords persistés. L'erreur utilisateur et le diagnostic indiquent « session seulement », le risque au redémarrage et la nécessité de réessayer avant de quitter. Aucun faux succès de sauvegarde ; aucune garantie de persistance quand l'I/O échoue. Une requête déjà émise avant le retrait reste irrévocable.
- Les 14 intégrations couvrent opt-out/accords persistants, rendu inline sans mutation ni doublon, SENT versus SENDING/read ACK, reply référencé sans mentions/retry, pas de publication d'autrui, redémarrage/compte/reconnexion, permissions avant coût, échec HTTP réservé durablement, modules absents/ambigus, background/delete/disable/stop sans réponse tardive, échec et course des écritures, actions de settings réellement rendues, reprise manuelle consentie, garde de row incompatible, retrait de patch ambigu et file/rate limit. Aucun transport réseau réel n'est autorisé dans cet hôte.
- Les tests JVM crypto utilisent le vrai JCE AES-GCM : IV différents, round-trip 16/512 caractères, mauvaise clé, corruption en-tête/IV/tag/ciphertext et troncature rejetées. Les tests de bridge sans Context vérifient le refus sûr avant contexte/après stop, PAS AtomicFile ou AndroidKeyStore sur appareil.
- `scripts/package-dev.mjs` vérifie chaque entrée ZIP et le vrai header DEX ; parse les class_defs pour empêcher l'embarquement de dépendances host.
- `scripts/audit-dev.mjs` : patterns secrets/chemins privés dans les sources nouvelles, tests et paquet, fixtures/logging absents du JS/DEX runtime, hashes vendor intacts, index byte-for-byte identique à HEAD. Un scan regex ne prouve pas l'absence de toute fuite possible.

## Revue et tests appareil à autoriser séparément

Commencer sans réseau/STT ni Discord post : installation du ZIP local dans un environnement de test approuvé, chargement natif, save/load/delete/replace avec clé synthétique, background/foreground, reload et redémarrage de processus, coffre invalide/ciphertext altéré, contexte tardif et échec I/O. Vérifier absence du plaintext dans les fichiers du plugin/backups/logs et bonne suppression. Puis tester les probes de hooks avec métadonnées synthétiques/minimisées ; ne pas exporter tokens, audio, URL signée ou messages privés.

Le coffre protège le repos, pas le même UID/processus : d'autres plugins peuvent appeler le bridge/lire la mémoire JS. Pas de garantie matérielle. Avant désinstallation du seul plugin, utiliser Supprimer la clé : `noBackupFilesDir` et l'alias Keystore ne sont pas gérés par le dossier de stockage du plugin et peuvent subsister si l'on désinstalle seulement ce plugin. Désinstaller toute l'app obéit au cycle de vie Android. Aucun effacement sûr forensic des anciennes pages de stockage n'est promis.

L'adaptateur est maintenant raccordé. Sur appareil, confirmer d'abord sans publication les contrats privés (stores, SENT, dispatcher, RowManager, HTTP/Endpoints uniques), le rendu et son retrait, puis seulement après autorisation distincte une transcription et une réponse à un vocal de test. Tester les canaux/threads et suppressions/éditions, compte/canal changé pendant attente et perte réseau. Pas d'envoi réel ou STT facturable sans autorisation de test distincte. Ne pas réessayer automatiquement une publication incertaine. Le journal à 1024 réservations reste fail-closed sans rotation automatique ; une stratégie utilisateur de rotation reste à concevoir avant usage général prolongé.

Aucun commit fabriqué : auteur v0.1 retrouvé (`Forge <forge@users.noreply.github.com>`), mais aucune identité Git locale approuvée configurée ; aucun besoin de modifier la configuration globale. Sources/diff restent dans le working tree, changements staged précédents préservés, tools/ et scripts/inspect.mjs non touchés.
