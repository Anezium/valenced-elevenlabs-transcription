> Archive historique du diagnostic initial ; voir README.md et PREVIEW_020.md pour la préversion actuelle. Les blocages de modèle décrits ici ont été résolus depuis.

# v0.2 — investigation partielle, livraison bloquée

Ce document ne représente ni une v0.2 implémentée ni une validation Android. Aucun code fonctionnel du plugin n'a été modifié dans cette passe. Aucun nouveau ZIP v0.2, push, release ou changement d'index publié.

## Modèle UI explicitement demandé

Claude Code installé : 2.1.282. Probe sans outils, sans accès fichiers et sans persistance de session :

    claude --safe-mode -p 'Reply only PROBE_OK. Do not use tools or access files.' --model 'Claude Fable 5.1' --tools '' --strict-mcp-config --no-session-persistence --output-format json

Sortie effective : code 1 ; `unrecognized_model` pour ce nom littéral ; résultat `Failed to authenticate: OAuth session expired and could not be refreshed` ; `terminal_reason=api_error`, `is_error=true`, `duration_api_ms=0`, `modelUsage={}`, `total_cost_usd=0`.

Conclusion limitée : l'inférence n'a pas eu lieu. Le nom humain n'est pas reconnu comme identifiant par ce CLI et l'authentification actuelle empêche de vérifier l'accès au modèle exact. Cela ne prouve PAS que Claude Fable 5.1 n'existe pas ou est indisponible sur un autre compte. Aucun alias inventé exécuté, aucune substitution, aucun login/refresh manuel, aucune passe UI. Reprise requise avec authentification rétablie par l'opérateur et identifiant exact confirmé par le fournisseur/compte.

## Clé : reproduction et portée de la preuve

Quatre fixtures de diagnostic ajoutées à `tests/lifecycle.test.mjs`, exécutant le vrai bundle compilé :

- Le `Runtime` passé par settings et par l'action du menu est strictement le même objet. Une clé synthétique déposée via le runtime settings est immédiatement retrouvée par le menu, sans réseau.
- Une clé synthétique déposée avant la résolution de l'initialisation du cache reste présente après celle-ci. Cette séquence d'init ne reproduit pas de perte de clé.
- `inactive` OU `background`, puis `active`, fait perdre la clé. Reproduction déterministe : le listener AppState appelle `rt.forget()` pour tout état différent d'active (`js/index.tsx`, start).
- stop/start crée un nouveau runtime vide et l'ancien runtime refuse les changements. Ceci reproduit la perte après redémarrage logique, pas un redémarrage de processus Android réel.

La v0.1 était explicitement mémoire seule ; la perte AppState explique un chemin concret du retour utilisateur. Aucun doublon de source de vérité ni race d'initialisation effaçant la clé n'a été établi dans ces fixtures. Elles n'exécutent pas les interactions du champ masqué avec un vrai renderer React Native et ne prouvent pas le scénario téléphone exact. Ne pas présenter ces tests de caractérisation comme une correction de persistance.

Le contrat v0.2 demande au contraire une vraie persistance sécurisée. Supprimer simplement `forget()` ou écrire la clé dans JSON ne satisferait pas ce contrat.

## Extension native : chemin réel identifié

Source hôte officielle inspectée au commit de la cible : `Valenced/valenced@d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1`. Une révision plus récente a été explorée initialement ; les constats ci-dessous sont confirmés après checkout de la révision cible.

- `android/api/src/main/kotlin/app/valenced/plugins/Plugin.kt` : démarrage natif `start(ctx: PluginScope)`.
- `android/api/src/main/kotlin/app/valenced/plugins/PluginScope.kt` : stockage du plugin persistant entre updates, partagé avec JSON JS. Ce dossier n'est PAS un coffre.
- `android/api/src/main/kotlin/app/valenced/xposed/api/HostScope.kt` : `withAppContext`, `bridge`, `registerNativeMethod` et `registerNativeAsyncMethod` permettent une extension dédiée.
- `android/src/main/kotlin/app/valenced/xposed/tweaks/plugins/external/NativeBuilder.kt` : chargement réel via `DexClassLoader`, `dist.android.path`, `dist.android.className` et export d'un `PluginBuilder` ; le JAR doit contenir du DEX, pas seulement des classes JVM.
- Les types JS vendored ne fournissent pas de coffre et `AdditionalBridgeMethods.kt` fournit lecture/écriture fichiers en clair, pas une opération Keystore. Aucun équivalent sûr déjà disponible n'a été établi. Le KeyStore de signature des patches n'est pas un coffre runtime pour cette clé.
- `gradle/libs.versions.toml` de la cible fixe AGP 9.2.1, Kotlin 2.4.10, compileSdk 37 et Java 25.

Vérification réelle : `./gradlew --version` dans cette source échoue code 1 : `JAVA_HOME is not set and no 'java' command could be found in your PATH`. java, adb et gradle ne sont pas disponibles dans PATH ; JAVA_HOME, ANDROID_HOME et ANDROID_SDK_ROOT non définis ; emplacements usuels vérifiés sans installation détectée. Ce constat ne prouve pas l'absence d'outils dans tous les répertoires de la machine. Aucun outil installé ni système modifié. Un JDK/SDK local à la tâche pourrait être provisionné à la reprise ; l'absence de PATH seule n'est pas une impossibilité structurelle.

Implémentation non effectuée : aucune crypto de façade ni bridge prétendument fonctionnel ajouté. La reprise doit construire et tester un vrai bridge Keystore avec écriture atomique du seul ciphertext et IV, suppression/remplacement, invalidation de clé, erreurs sans secrets et sérialisation init/save/delete. La clé reste nécessairement exposée en mémoire JS pendant le POST ; ne pas promettre une isolation des autres plugins.

## Automatisation et UI

Aucune automatisation ajoutée. Le plugin actuel ne s'abonne pas aux nouveaux messages et n'envoie aucune réponse Discord. Les contrats privés du client cible pour MESSAGE_CREATE/ACK, permissions, reply et rendu inline n'ont pas été validés ; il serait incorrect de substituer un bouton copie ou une signature inventée à ces contrats. Ils restent à examiner puis tester avec fixtures et runtime cible avant livraison.

Restent non satisfaits : consentement one-shot, file bornée, déduplication durable, suppression de catch-up/replay, arrêt/reconnect, distinction auteur, reply propre après ACK uniquement dans le canal original et transcription d'autrui locale dans le chat. Pas de vérification visuelle Android, ni de passe UI par le modèle demandé.

## Vérification locale

Environnement effectif : Node v20.19.2, npm 9.2.0. Attention : Node est inférieur au minimum déclaré >=22.18 ; les succès observés ici ne constituent pas une nouvelle certification de compatibilité Node 20.

Avant ajout des fixtures, `npm run verify` réussit : typecheck, 27 tests core/transport, build CLI, bundle, 5 tests lifecycle, packaging et index officiels. Après ajout, 9 tests lifecycle passent, sans échec et sans réseau. La vérification complète finale est consignée dans `build/v020-diagnostic-verify.log`.

Le packaging effectué reste STRICTEMENT celui de v0.1.0 : 27285 octets, SHA256 `55aedbfe9480de98f576440c79fc8643c4258b4fb7141c63e7caebb16b3d9dcc`, identique à la livraison précédente. Il ne faut pas le distribuer comme v0.2. Les fichiers non suivis préexistants `scripts/inspect.mjs` et `tools/` sont préservés. Aucun appel ElevenLabs, audio utilisateur, message Discord ou installation téléphone.

## Handoff Zer0

La carte doit rester bloquée et non terminée. Pré-requis humain : restaurer l'accès Claude Code et confirmer l'identifiant exact du modèle demandé, sans transmettre de secret dans le chat. La reprise peut ensuite provisionner une toolchain Android isolée dans l'espace de tâche, implémenter le bridge et les hooks réels, exécuter tests/build/contrôles sécurité, puis demander revue à default avant toute publication.
