# 0.2.0-dev — préversion de test, pas une validation Android

La distribution publique de ce candidat a été explicitement autorisée. Cette autorisation ne transforme pas les tests hors appareil en validation finale.

## Artefact inchangé

- ZIP plugin : `anezium.elevenlabs-transcription@0.2.0-dev.zip`, 48205 octets.
- SHA256 : `3329dca5b8ba06ef276e1b62a4cf0ae4001217e98e1515800fd52ca4bbeca08f`.
- Candidat de revue reconstruit à l'identique ; aucun changement runtime/manifest lors de la publication.
- Le texte historique « candidat local / publication soumise à revue » reste dans le manifest pour préserver les octets du candidat ; le présent document et la release décrivent son statut de distribution actuel.

## Compatibilité du dépôt

Source officielle Valenced auditée au commit `d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1` :

- `core/.../repos/RepoIndex.kt` : format 1, `latest` canal par défaut, version exacte et dépendances par version.
- `core/.../repos/Updates.kt` : suit le canal enregistré ; propose une version supérieure à celle installée/pending, puis résout les dépendances.
- `core/.../external/Artifacts.kt` : extrait les entrées du ZIP après validation du manifest, pas uniquement le JS.
- `core/.../external/ExternalManifest.kt` : `dist.android` pris en charge, champ JSON `class` mappé vers className.
- `android/.../external/FactoryBuilder.kt` et `NativeBuilder.kt` : chargement du JAR via DexClassLoader et recherche du PluginBuilder statique.

Le ZIP fournit script et JAR DEX avec la classe `app.anezium.elevenlabs.ElevenLabsPlugin`. Les 41 assertions JVM du build contrôlent notamment l'export PluginBuilder et le bridge async ; elles ne chargent pas AndroidKeyStore. Le comparateur Version/VersionRange réel de la source épinglée a été exercé dans une probe JVM supplémentaire : 6 assertions passent, dont `0.1.0 < 0.2.0-dev < 0.2.0` et les dépendances exactes.

Index généré par le CLI officiel vendored, pas par un schéma inventé. URL de l'index inchangée :
https://raw.githubusercontent.com/Anezium/valenced-elevenlabs-transcription/main/index.json

`latest`, `beta` et `testing` pointent vers 0.2.0-dev. `legacy` pointe vers 0.1.0. Le canal latest est une décision de distribution de test, pas un label stable. L'entrée complète 0.1.0 reste identique. Une installation provenant d'un fichier sans source de dépôt enregistrée peut ne pas recevoir automatiquement cette proposition.

## Contrôles rejoués

Voir `proofs/0.2.0-dev/` : logs expurgés et checks.json. Typecheck, 56 TS, 49 bundle, 2 probes UI synthétiques, 41 assertions JVM, vraie API/Kotlin/D8, paquet déterministe, audit vendor/paquet et provenance Fable passent. npm audit : 0 vulnérabilité signalée. 176 fichiers sources runtime/tests/vendor et dépendances identiques à l'archive de revue. Aucun stream privé, outil local, credential ou conversation n'est publié.

Le modèle UI réellement génératif était `claude-fable-5-1` / high, sans substitution ; fin du run HTTP429. Aucun nouvel appel de modèle pour cette distribution. Un scan de secrets par motifs est un contrôle limité, pas une garantie absolue.

## Limites impératives

- Aucun test appareil, installation téléphone ou modification d'APK effectué.
- AndroidKeyStore/AtomicFile réels, persistance après arrêt Android, menu 352.6, rendu mobile/accessibilité et hooks réels NON validés.
- Aucun audio utilisateur, STT payant ou POST Discord réel exécuté ; aucune preuve de réponse Discord réelle.
- Opt-ins désactivés par défaut ; refus fermé conservé. Autrui local seulement, propres vocaux publiables après accords explicites uniquement. Canal sélectionné, pas d'historique/catch-up.
- Journal de réservations limité à 1024, sans rotation ; au plus une tentative automatique n'est pas une garantie de livraison exactement une fois.
- Une requête déjà émise ne peut être annulée rétroactivement ; coûts/envois peuvent déjà être engagés.
- Si la révocation ne peut être écrite, elle reste effective pour la session mais les anciens accords peuvent réapparaître au redémarrage ; réessayer avant de quitter.
- Coffre protège le repos, pas le même processus/UID. Utiliser Supprimer la clé avant désinstallation du seul plugin ; alias/fichier peuvent sinon subsister.

La validation Android/E2E et la v0.2 finale restent ouvertes, avec accord de test séparé requis. Aucun succès d'installation utilisateur n'est revendiqué.
