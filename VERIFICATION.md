# Vérifications de la livraison 0.1.0

Exécution locale Linux, Node 22.21.1, npm 10.9.4. Ce document rapporte des tests exécutés, pas une exécution Android ou ElevenLabs.

## Résultats

- `npm run typecheck` : code de sortie 0.
- `npm test` : 27 tests passent, 0 échec, 0 ignoré. Core, extraction/validation, consentement, cache, déduplication, annulation, nettoyage, multipart RN via XHR injecté, erreurs HTTP et tailles/redirects.
- `npm run build:cli` : compilation TypeScript du CLI officiel, code de sortie 0.
- `npm run bundle` : `✓ Built JS for anezium.elevenlabs-transcription` avec le CLI officiel fixé dans NOTICE.
- `npm run test:lifecycle` : 5 tests passent, 0 échec, 0 ignoré. Évaluation du vrai bundle par `new Function` suivant la convention hôte, dans un hôte synthétique : menu manuel, refus avant consentement, oubli de clé en arrière-plan, stop/reload, retrait patches/listeners, client/primitives incompatibles, découverte ambiguë et module gelé, message ordinaire/arbre inattendu, purge échouée. Aucun réseau autorisé dans ces tests.
- `npm run package` : archive créée et réouverte, entrées comparées octet pour octet, manifest JS-only vérifié ; `generate-index` officiel : `1 plugin(s), 1 artifact(s)`.
- `npm audit --audit-level=high` : `found 0 vulnerabilities` au moment de cette livraison. Des dépendances transitives de développement émettent des avertissements de dépréciation (rimraf/inflight/glob) ; aucune n'est embarquée dans le ZIP plugin.
- Reconstruction depuis une archive du seul arbre Git préparé, dans un répertoire vierge, avec `npm ci --ignore-scripts --legacy-peer-deps`, puis `npm run verify` : succès. Comparaison `cmp` du ZIP et de l'index aux artefacts originaux : identiques octet pour octet.
- `git diff --cached --check` : sans erreur. Liste de publication explicite ; aucun gitlink/submodule, dépendance installée, historique Git amont, binaire Node, journal local, fichier audio, clé ou autre projet.
- `scripts/audit.mjs` : scan des fichiers préparés pour commit et des entrées du ZIP, chemins privés/tokens connus, vérification des SHA256 fichier par fichier des sources vendored inchangées. Pas de correspondance sensible trouvée. Relecture du code réseau et du diff effectuée ; un scan regex ne constitue pas une preuve universelle d'absence de secrets.

ZIP `anezium.elevenlabs-transcription@0.1.0.zip` : 27285 octets.
SHA256 : `55aedbfe9480de98f576440c79fc8643c4258b4fb7141c63e7caebb16b3d9dcc`.
Entrées : manifest.json, index.js, LICENSE, NOTICE, Apache-2.0.txt. Aucun JAR requis.
Index format 1, canal `latest` = `0.1.0`, URL release fixée au tag `v0.1.0`, taille et SHA256 calculés sur ce ZIP. Le statut prerelease GitHub n'est pas le mécanisme de canal Valenced ; l'index porte volontairement la mention expérimentale tout en permettant l'installation par défaut.

## Audit fonctionnel et limites

Les seules destinations déclarées dans le code réseau sont le GET HTTPS des pièces jointes cdn.discordapp.com / media.discordapp.net et le POST https://api.elevenlabs.io/v1/speech-to-text. La clé n'est ajoutée qu'au POST ElevenLabs ; pas de token Discord, de stockage JSON, de logging de secret, de télémétrie ni d'envoi de message. Les redirections natives et allocations mémoire ne peuvent pas être strictement bornées avant exécution par les seules API XHR : limites explicitement affichées en UI/README.

La garde runtime refuse les builds non reconnus. Elle n'est pas une preuve que les modules privés Discord, signatures FileModule, constantes exactes, URI multipart, Clipboard, affichage ou permissions fonctionnent sur le téléphone cible. Le manifest est validé par l'outil officiel ; l'installeur Android lui-même n'a pas été exécuté.

NON TESTÉS : installation et runtime téléphone, smoke visuel Android et accessibilité, réseau réel ElevenLabs, clé réelle, qualité STT, audio Discord réel, facturation. Aucune clé/audio utilisateur ni requête STT payante utilisée. Les sorties de tests sont exclusivement synthétiques et ne sont pas incluses dans le bundle plugin. Aucun changement de production ou du téléphone.

Le guide README donne le protocole de test utilisateur volontaire et le retour arrière. Les preuves locales détaillées et la vérification anonyme après publication sont remises au reviewer séparément, sans publier de journaux privés.
