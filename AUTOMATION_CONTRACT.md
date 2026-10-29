# Automatisation — contrat d'intégration t_c6e58394

## Portée de ce lot

Le moteur et l'adaptateur 0.2.0-dev de t_6d9b754f existent déjà et sont conservés, non réécrits. Ce lot durcit leur frontière dispatcher par une epoch synchrone, ajoute tests/auto-boundaries.test.mjs au script test:lifecycle et vérifie le vrai bundle généré. Aucun changement UI/index.tsx, coffre/vault.ts, Android, source de clé ou protocole de stockage ; aucune publication, aucun ZIP partagé reconstruit. Les modifications concurrentes du lot clé restent préservées. Les fichiers non suivis scripts/inspect.mjs et tools/ ne sont pas modifiés ni ajoutés à Git.

## Interfaces

- AutoPipeline (js/automation.ts) ne découvre ni messages ni secrets. AutoHost injecte accountId, selectedChannelId, canReply, reserve, transcribe, showLocal, sendReply, clearLocal et report. Les cibles sont validées et copiées avant mise en file.
- ClientAutomation (js/client.ts) fournit l'adaptateur de ces interfaces au host réel. Runtime.key/engine est la seule source de transcription ; ce Runtime utilise le KeyState commun du lot clé. Aucun stockage supplémentaire de clé.
- configure({incoming, ownReplies}) est appelé par une action explicite dont le libellé explique traitement externe/coût et, séparément, publication de ses propres vocaux. Préférences liées au compte ; activation seulement après écriture réussie de la révision courante. Les retraits sont immédiats même si le disque échoue. Une erreur de retrait ne garantit pas sa persistance après crash/restart (avertissement existant explicite).
- MESSAGE_CREATE/MESSAGE_SEND_SUCCESS sont les seules entrées candidates. Le store doit confirmer SENT, identité serveur, auteur, canal et métadonnées audio valides. MESSAGE_ACK est un accusé de lecture, jamais une confirmation d'envoi. Updates, fetch/historique, bots, optimistic, ephemeral et réponses texte ne sont pas des entrées STT.
- Le subscriber contrôle déjà consentement, compte, connexion, disponibilité et clé avant de différer la lecture du MessageStore. Il capture une epoch et le compte. Toute frontière configure (début ET activation réussie), pause/resume, reconnexion, changement canal, suppression, vraie édition ou arrêt invalide cette provenance ; le différé antérieur est rejeté même dans la même milliseconde. Cela complète la barrière timestamp du pipeline, sans s'y substituer.

## Effets autorisés

Autrui : showLocal uniquement. RowManager.generate reçoit une copie du row/contenu avec un nœud texte brut, associé au message/canal ; MESSAGE_UPDATE ID-only provoque le rafraîchissement local. Aucun contenu Discord modifié, aucun REST/clipboard. Cache local mémoire de dix résultats, retiré au stop/background/invalidation.

Propre vocal : uniquement après confirmation SENT, permission avant STT puis revalidée à la publication. HTTP.post vers /channels/<canal original>/messages, avec message_reference original, fail_if_not_exists=true, allowed_mentions.parse=[], replied_user=false, retries=0, nonce déterministe et enforce_nonce. Auteur/canal/type vocal revalidés dans le store à l'envoi. Texte >1850 caractères : résultat local + diagnostic, aucun envoi tronqué/multiple. La récupération manuelle existante exige un résultat en cache, son propre vocal et une confirmation explicite de publication.

La séparation multi-canal est fail-closed : seul le canal actuellement sélectionné est éligible. Changer de canal annule la file/les résultats ; rien n'est envoyé dans le nouveau canal à la place de l'ancien. Ce n'est PAS un watcher de tous les canaux d'un compte. Aucun scan d'historique ni catch-up à la reprise.

## Bornes et garanties réalistes

- File : huit en attente et un actif ; trois tentatives/minute ; taille audio <=8 Mio, durée <=300 s ; fraîcheur <=60 s et dérive future <=5 s.
- Réservation durable native avant STT : hash compte/canal/message, cap 1024 sans éviction. Dédoublonnage au plus une tentative automatique, pas garantie de livraison exactement une fois : perte réseau/envoi ambigu ou crash après réservation peuvent donner zéro réponse. Reprise manuelle disponible. Pas de nouvelle tentative automatique susceptible de doubler coût/publication.
- Annulation avant publication supprime les effets tardifs et annule le transcriber. Un POST déjà émis ou un upload déjà facturable ne peut pas être rappelé.
- Journal plein, absence/ambiguïté d'un module privé, erreur permission, clé/cache non prêt ou forme de row incompatible : refus sûr et diagnostic natif notifyAuto. Aucun fallback clipboard présenté comme auto.
- Les hooks étudiés sont ceux du host Valenced d3e17fe0416c3dc5f4b4d783b465eeb4a99caec1 et du client ciblé Discord 352.6 canary. Les événements privés et la provenance live restent à confirmer sur appareil ; la fixture ne prouve pas leur comportement Android réel. Le journal durable n'a pas encore de rotation utilisateur : saturation fail-closed, limitation d'usage prolongé.

## Vérification exécutée

Node local 22.21.1. Commandes depuis la racine :

    export PATH="$PWD/tools/node-v22.21.1-linux-x64/bin:$PATH"
    npm run typecheck
    npm test
    npm run build:cli
    npm run bundle
    npm run test:lifecycle
    git diff --check

Résultat : exit 0, 45/45 tests TypeScript, 38/38 tests du vrai bundle (aucun échec), build CLI/bundle OK et diff --check sans erreur. Log : build/t_c6e58394-verify.log. Les 45 incluent les régressions du lot clé concurrent, ne pas les attribuer toutes à ce lot. Ce lot ajoute trois tests bundle : matrice de cinq frontières différées avec contrôles positifs, activation à l'ingress, et séparation locale/publication sur deux canaux. Les suites existantes couvrent ACK, dedupe durable, permissions, queue/rate, erreurs HTTP, opt-out, stop pendant STT, suppression, édition, retrait consentement et nettoyage.

La première exécution sur l'ancien bundle a effectivement échoué : frontière foreground attendait STT=0, observait STT=1 (et tentative POST synthétique). La même régression et toutes les frontières passent après correction epoch. Une première passe a aussi détecté un diagnostic de compte non rafraîchi après le nouveau filtre synchrone ; le notify préalable corrige cela, suite complète repassée.

Aucun réseau réel, audio utilisateur, API ElevenLabs payante, message Discord ou installation appareil exécuté. Les mocks interdisent le transport XHR réel et le clipboard. Le build natif n'est pas refait par ce lot puisqu'aucun natif n'est modifié ; son contrôle et le ZIP final appartiennent à l'intégration t_afc7bdda. Smoke Android, rendu visuel téléphone, AndroidKeyStore/AtomicFile et hooks live ne sont pas validés par ces tests. Le modèle UI exact relève du lot UI, aucune substitution effectuée ici.
